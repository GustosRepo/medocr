import os
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from pdf2image import convert_from_bytes
from typing import List, Tuple, Any
import math
import numpy as np
from PIL import Image, ImageOps, ImageFilter

try:
    # RapidOCR is lightweight and easy to install locally (onnxruntime backend)
    from rapidocr_onnxruntime import RapidOCR  # type: ignore
    _rapid_available = True
except Exception:
    RapidOCR = None  # type: ignore
    _rapid_available = False

try:
    import cv2  # type: ignore
    _cv_available = True
except Exception:  # pragma: no cover
    cv2 = None  # type: ignore
    _cv_available = False

app = FastAPI(title="MEDOCR OCR Service")


def _deskew(gray: np.ndarray) -> np.ndarray:
    if not _cv_available:
        return gray
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh < 255))
    if coords.size == 0:
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 1.5 or abs(angle) > 25:
        # Ignore tiny or extreme rotations to avoid warping forms
        return gray
    (h, w) = gray.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    rotated = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def preprocess_image(image: Image.Image) -> Image.Image:
    """Normalize fax-quality scans for better OCR."""
    mode = os.getenv("MEDOCR_PREPROCESS_MODE", "enhanced").lower()
    if mode == "off":
        return image.convert('RGB')

    # Convert to grayscale and autocontrast regardless of backend.
    gray = ImageOps.grayscale(image)
    gray = ImageOps.autocontrast(gray, cutoff=2)
    if mode == "basic" or not _cv_available:
        # Conservative path: only light sharpening, no thresholding that could erase text.
        enhanced = gray.filter(ImageFilter.UnsharpMask(radius=1.3, percent=120, threshold=5))
        return enhanced.convert('RGB')

    np_img = np.array(gray)
    
    # Optional: CLAHE (Contrast Limited Adaptive Histogram Equalization) for low-quality scans
    use_clahe = os.getenv("MEDOCR_USE_CLAHE", "true").lower() in ("true", "1", "yes")
    if use_clahe:
        clip_limit = float(os.getenv("MEDOCR_CLAHE_CLIP_LIMIT", "2.0"))
        tile_size = int(os.getenv("MEDOCR_CLAHE_TILE_SIZE", "8"))
        clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile_size, tile_size))
        np_img = clahe.apply(np_img)
    
    # Optional: Bilateral filter for edge-preserving noise reduction
    use_bilateral = os.getenv("MEDOCR_USE_BILATERAL", "false").lower() in ("true", "1", "yes")
    if use_bilateral:
        bilateral_d = int(os.getenv("MEDOCR_BILATERAL_D", "9"))
        bilateral_sigma = float(os.getenv("MEDOCR_BILATERAL_SIGMA", "75"))
        np_img = cv2.bilateralFilter(np_img, bilateral_d, bilateral_sigma, bilateral_sigma)
    
    # Gaussian blur (original)
    blurred = cv2.GaussianBlur(np_img, (5, 5), 0)
    deskewed = _deskew(blurred)
    # Adaptive threshold to enhance faded text / form boxes.
    binary = cv2.adaptiveThreshold(
        deskewed,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        21,
        7,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    refined = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

    output = Image.fromarray(cv2.cvtColor(refined, cv2.COLOR_GRAY2RGB))

    debug_dir = os.getenv("MEDOCR_PREPROC_DEBUG_DIR")
    if debug_dir:
        try:
            os.makedirs(debug_dir, exist_ok=True)
            # Use a simple counter based on env to avoid collisions
            fname = os.path.join(debug_dir, f"preproc-{os.getpid()}-{id(image)}.png")
            output.save(fname)
        except Exception:
            pass

    return output

@app.get("/health")
def health():
    return {"status": "ok"}

@app.on_event("startup")
def _load_engine():  # warm engine once
    global _rapid_engine
    if _rapid_available:
        try:
            # Support custom model paths for PP-OCRv4 or other models
            det_path = os.getenv("MEDOCR_DET_MODEL_PATH")
            cls_path = os.getenv("MEDOCR_CLS_MODEL_PATH")
            rec_path = os.getenv("MEDOCR_REC_MODEL_PATH")
            
            kwargs = {}
            if det_path and os.path.exists(det_path):
                kwargs['det_model_path'] = det_path
            if cls_path and os.path.exists(cls_path):
                kwargs['cls_model_path'] = cls_path
            if rec_path and os.path.exists(rec_path):
                kwargs['rec_model_path'] = rec_path
            
            if kwargs:
                print(f"Loading RapidOCR with custom models: {list(kwargs.keys())}", flush=True)
            else:
                print("Loading RapidOCR with default bundled models (PP-OCRv3 lite)", flush=True)
            
            _rapid_engine = RapidOCR(**kwargs)
        except Exception as e:
            print(f"Failed to load RapidOCR: {e}", flush=True)
            _rapid_engine = None
    else:
        _rapid_engine = None

@app.post("/ocr")
async def ocr(file: UploadFile = File(...)):
    """
    Run OCR on a PDF and return per-page text and bounding boxes.
    Uses RapidOCR if available; otherwise returns an informative error.
    """
    if not _rapid_available:
        return JSONResponse(status_code=503, content={
            "error": {
                "code": "ocr_unavailable",
                "message": "RapidOCR not installed. Install rapidocr-onnxruntime in the venv."
            }
        })

    data = await file.read()
    try:
        # Render pages to images (PNG) for OCR
        base_dpi = int(os.getenv('MEDOCR_RENDER_DPI', '300'))
        images: List = convert_from_bytes(data, dpi=base_dpi, fmt='png')
        page_count = len(images)

        # Downsample large faxes to keep OCR throughput reasonable
        if page_count:
            threshold = int(os.getenv('MEDOCR_DOWNSAMPLE_PAGES', '6'))
            high_threshold = int(os.getenv('MEDOCR_DOWNSAMPLE_PAGES_HIGH', '10'))
            scale_primary = float(os.getenv('MEDOCR_DOWNSAMPLE_SCALE', '0.6'))
            scale_secondary = float(os.getenv('MEDOCR_DOWNSAMPLE_SCALE_HIGH', '0.5'))
            scale = None
            if page_count >= high_threshold:
                scale = scale_secondary
            elif page_count >= threshold:
                scale = scale_primary
            if scale and scale < 1.0:
                downsized = []
                for img in images:
                    w, h = img.size
                    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                    downsized.append(img.resize(new_size, Image.BILINEAR))
                images = downsized
    except Exception as e:
        return JSONResponse(status_code=400, content={
            "error": {"code": "pdf_render_failed", "message": str(e)}
        })

    engine = globals().get('_rapid_engine') or (RapidOCR() if _rapid_available else None)
    pages = []

    def quad_to_bbox(quad: List[Tuple[float, float]]):
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        return [float(x_min), float(y_min), float(x_max - x_min), float(y_max - y_min)]

    for i, img in enumerate(images):
        processed_img = preprocess_image(img)
        # RapidOCR returns: result, elapse = engine(img)
        # result is list of [text, score, boxPoints]
        try:
            result, _ = engine(processed_img)
        except Exception as e:
            result = []
        lines = []
        boxes = []
        if result:
            for item in result:
                # Compatible handling: RapidOCR sometimes returns [box, text, score]
                # Normalize based on detected structure.
                text: str = ""
                score: float = 0.0
                box_points: Any = None
                if isinstance(item, (list, tuple)) and len(item) >= 3:
                    # Heuristic: if first element is list-like of points (len>=4), it's box-first format.
                    first = item[0]
                    if isinstance(first, (list, tuple)) and len(first) >= 4 and isinstance(first[0], (list, tuple)):
                        box_points = first
                        text = str(item[1])
                        score = float(item[2]) if len(item) > 2 else 0.0
                    else:
                        # Assume text-first format: [text, score, box]
                        text = str(item[0])
                        score = float(item[1]) if len(item) > 1 else 0.0
                        box_points = item[2] if len(item) > 2 else None
                elif isinstance(item, dict):
                    text = str(item.get("text", ""))
                    score = float(item.get("score", 0.0))
                    box_points = item.get("box") or item.get("points")

                if not text:
                    continue
                lines.append(text)
                if box_points and isinstance(box_points, (list, tuple)) and len(box_points) >= 4:
                    # box_points is 4 points [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                    try:
                        bbox = quad_to_bbox([(float(p[0]), float(p[1])) for p in box_points[:4]])
                    except Exception:
                        bbox = [0.0, 0.0, 0.0, 0.0]
                else:
                    bbox = [0.0, 0.0, 0.0, 0.0]
                boxes.append({"bbox": bbox, "text": text, "conf": max(0.0, min(1.0, score))})

        page_text = "\n".join(lines)
        pages.append({
            "page": i + 1,
            "text": page_text,
            "boxes": boxes
        })

    return JSONResponse({"ocr": pages})
