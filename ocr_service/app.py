from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from pdf2image import convert_from_bytes
from typing import List, Tuple, Any
import math

try:
    # RapidOCR is lightweight and easy to install locally (onnxruntime backend)
    from rapidocr_onnxruntime import RapidOCR  # type: ignore
    _rapid_available = True
except Exception:
    RapidOCR = None  # type: ignore
    _rapid_available = False

app = FastAPI(title="MEDOCR OCR Service")

@app.get("/health")
def health():
    return {"status": "ok"}

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
        images: List = convert_from_bytes(data, dpi=220, fmt='png')
    except Exception as e:
        return JSONResponse(status_code=400, content={
            "error": {"code": "pdf_render_failed", "message": str(e)}
        })

    engine = RapidOCR()
    pages = []

    def quad_to_bbox(quad: List[Tuple[float, float]]):
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        return [float(x_min), float(y_min), float(x_max - x_min), float(y_max - y_min)]

    for i, img in enumerate(images):
        # RapidOCR returns: result, elapse = engine(img)
        # result is list of [text, score, boxPoints]
        try:
            result, _ = engine(img)
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
