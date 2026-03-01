import os
from fastapi import FastAPI, UploadFile, File, Request
from typing import List, Tuple, Optional, Dict, Any
from fastapi.responses import JSONResponse
from pdf2image import convert_from_bytes
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError, PDFSyntaxError
from typing import List, Tuple, Any
import math
import numpy as np
from PIL import Image, ImageOps, ImageFilter
from datetime import datetime
import signal
from contextlib import contextmanager

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


def _timestamp():
    """Return current timestamp for logging."""
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


class TimeoutError(Exception):
    pass


@contextmanager
def time_limit(seconds):
    """Context manager to limit execution time of a block."""
    def signal_handler(signum, frame):
        raise TimeoutError(f"Timed out after {seconds} seconds")
    
    # Set the signal handler
    signal.signal(signal.SIGALRM, signal_handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)  # Disable the alarm


def _bbox_to_xywh(quad: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    """Convert quad points to (x, y, width, height) bounding box."""
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return (x_min, y_min, x_max - x_min, y_max - y_min)


def _iou(box1: Tuple[float, float, float, float], box2: Tuple[float, float, float, float]) -> float:
    """Calculate Intersection over Union for two (x,y,w,h) boxes."""
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2
    
    # Calculate intersection
    x_left = max(x1, x2)
    y_top = max(y1, y2)
    x_right = min(x1 + w1, x2 + w2)
    y_bottom = min(y1 + h1, y2 + h2)
    
    if x_right < x_left or y_bottom < y_top:
        return 0.0
    
    intersection = (x_right - x_left) * (y_bottom - y_top)
    area1 = w1 * h1
    area2 = w2 * h2
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0


def _find_tables_cv(img_bgr):
    """
    Detect grid tables using OpenCV morphology (horizontal/vertical line detection).
    Returns list of table bounding boxes: [(x, y, w, h), ...]
    """
    if not _cv_available or img_bgr is None:
        return []
    
    try:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # Detect horizontal lines
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
        horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)
        
        # Detect vertical lines
        vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
        vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=2)
        
        # Combine lines to find table grid
        table_mask = cv2.addWeighted(horizontal_lines, 0.5, vertical_lines, 0.5, 0.0)
        _, table_mask = cv2.threshold(table_mask, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Find contours of table regions
        contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        tables = []
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            # Filter: must be reasonably sized table (>100px both dimensions, aspect ratio check)
            if w > 100 and h > 100 and w < img_bgr.shape[1] * 0.95 and h < img_bgr.shape[0] * 0.95:
                tables.append((x, y, w, h))
        
        return tables
    except Exception as e:
        print(f"[table_detect] error: {e}", flush=True)
        return []


def _extract_cells_from_table(img_bgr, table_bbox):
    """
    Extract grid cells from a table region using line detection.
    Returns list of cell info: [{r, c, bbox: (x,y,w,h)}, ...]
    """
    if not _cv_available or img_bgr is None:
        return []
    
    try:
        tx, ty, tw, th = table_bbox
        table_roi = img_bgr[ty:ty+th, tx:tx+tw]
        
        gray = cv2.cvtColor(table_roi, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # Detect horizontal and vertical lines
        h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (tw // 10, 1))
        v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, th // 10))
        
        h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel, iterations=1)
        v_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel, iterations=1)
        
        # Find horizontal line positions (row separators)
        h_proj = np.sum(h_lines, axis=1)
        row_separators = [0] + [i for i in range(1, len(h_proj)-1) if h_proj[i] > tw * 20] + [th]
        
        # Find vertical line positions (column separators)
        v_proj = np.sum(v_lines, axis=0)
        col_separators = [0] + [i for i in range(1, len(v_proj)-1) if v_proj[i] > th * 20] + [tw]
        
        # Build cell grid
        cells = []
        for r in range(len(row_separators) - 1):
            for c in range(len(col_separators) - 1):
                y1, y2 = row_separators[r], row_separators[r + 1]
                x1, x2 = col_separators[c], col_separators[c + 1]
                
                # Filter tiny cells (noise)
                if (x2 - x1) > 10 and (y2 - y1) > 10:
                    cells.append({
                        'r': r,
                        'c': c,
                        'bbox': (tx + x1, ty + y1, x2 - x1, y2 - y1)
                    })
        
        return cells
    except Exception as e:
        print(f"[cell_extract] error: {e}", flush=True)
        return []
    
    intersection = (x_right - x_left) * (y_bottom - y_top)
    area1 = w1 * h1
    area2 = w2 * h2
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0


def autorotate_with_cls(pil_img: Image.Image, det_engine, cls_engine) -> Image.Image:
    """
    Auto-rotate page by testing detection confidence at all 4 orientations.
    
    ENABLED BY DEFAULT - Set MEDOCR_ENABLE_AUTOROTATE=false to disable.
    Adds ~5-10s per page overhead but catches rotated faxes.
    
    Tries detecting text boxes at 0°, 90°, 180°, 270° rotations and picks
    the orientation with best detection confidence (most boxes with high scores).
    
    Args:
        pil_img: PIL Image to potentially rotate
        det_engine: RapidOCR detection engine
        cls_engine: Not used (kept for compatibility)
    
    Returns:
        Rotated PIL Image if rotation detected, else original
    """
    # Enabled by default — rotated faxes are common. Set MEDOCR_ENABLE_AUTOROTATE=false to disable.
    if os.getenv("MEDOCR_ENABLE_AUTOROTATE", "true").lower() not in ("true", "1", "yes"):
        return pil_img
    
    if det_engine is None:
        return pil_img
    
    # Downscale for speed (600px max dimension - balance between speed and accuracy)
    w, h = pil_img.size
    scale = 600 / max(w, h) if max(w, h) > 600 else 1.0
    if scale < 1.0:
        small = pil_img.resize((int(w * scale), int(h * scale)), Image.Resampling.BILINEAR)
    else:
        small = pil_img
    
    # Convert PIL to numpy for detection
    import numpy as np
    
    # Try all 4 rotations and pick the one with most detected boxes
    try:
        rotation_scores = {}
        
        for angle in [0, 90, 180, 270]:
            # Rotate image
            if angle == 0:
                test_img = small
            else:
                test_img = small.rotate(-angle, expand=True)  # Negative for clockwise
            
            test_np = np.array(test_img)
            
            # Run detection
            result, _ = det_engine(test_np)
            
            if result is None or len(result) == 0:
                rotation_scores[angle] = 0
                continue
            
            # Score = number of boxes detected (more boxes = better orientation)
            rotation_scores[angle] = len(result)
        
        # Pick rotation with most detected boxes
        if not rotation_scores or max(rotation_scores.values()) == 0:
            print(f"[autorotate] skipped: no boxes detected at any rotation", flush=True)
            return pil_img
        
        best_angle = max(rotation_scores, key=rotation_scores.get)
        print(f"[autorotate] rotation_scores={rotation_scores} winner={best_angle}°", flush=True)
        
        # Rotate if not already at 0°
        if best_angle != 0:
            print(f"INFO: Auto-rotating page by {best_angle}° (detected {rotation_scores[best_angle]} boxes vs {rotation_scores[0]} at 0°)", flush=True)
            return pil_img.rotate(-best_angle, expand=True)  # Negative because PIL rotates CCW
        
    except Exception as e:
        print(f"WARN: autorotate_with_cls failed: {e}", flush=True)
    
    return pil_img


def reading_order(boxes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Sort OCR boxes in reading order (top-to-bottom, left-to-right).
    
    Detects two-column layout by finding large center-X gap. If found,
    sorts each column separately then concatenates left→right.
    Falls back to single-column sort if no clear column split.
    
    Args:
        boxes: List of box dicts with 'bbox': [x, y, w, h]
    
    Returns:
        Sorted list of boxes in reading order
    """
    if not boxes:
        return boxes
    
    # Extract x-centers
    centers = []
    for box in boxes:
        bbox = box.get('bbox', [0, 0, 0, 0])
        x, y, w, h = bbox[0], bbox[1], bbox[2], bbox[3]
        centers.append((x + w / 2, box))
    
    centers.sort(key=lambda c: c[0])
    
    # Look for large gap in center region (two-column heuristic)
    if len(centers) >= 10:
        gaps = []
        for i in range(len(centers) - 1):
            gap = centers[i + 1][0] - centers[i][0]
            gaps.append((gap, i))
        
        gaps.sort(reverse=True)
        largest_gap, gap_idx = gaps[0]
        
        # Check if gap is in middle third and significantly larger than average
        mid_start = len(centers) // 3
        mid_end = 2 * len(centers) // 3
        avg_gap = sum(g[0] for g in gaps[1:6]) / 5 if len(gaps) > 5 else 0
        
        if mid_start <= gap_idx <= mid_end and largest_gap > avg_gap * 2.5:
            # Two-column layout detected
            left_boxes = [c[1] for c in centers[:gap_idx + 1]]
            right_boxes = [c[1] for c in centers[gap_idx + 1:]]
            
            # Sort each column by (y, x)
            left_sorted = sorted(left_boxes, key=lambda b: (b['bbox'][1], b['bbox'][0]))
            right_sorted = sorted(right_boxes, key=lambda b: (b['bbox'][1], b['bbox'][0]))
            
            print(f"INFO: Two-column layout detected ({len(left_sorted)} left, {len(right_sorted)} right)", flush=True)
            return left_sorted + right_sorted
    
    # Single-column: sort by (y, x)
    return sorted(boxes, key=lambda b: (b['bbox'][1], b['bbox'][0]))


def maybe_tile(image: Image.Image, det_engine, rec_engine, max_side: int = 4000, 
               tile_size: int = 1600, overlap: int = 160) -> Tuple[List[Any], bool]:
    """
    Tile large images to avoid memory issues.
    
    Only tiles if max(width, height) > max_side. Runs det+rec on each tile,
    translates boxes by tile offset, merges tiles, and de-duplicates by IoU.
    
    Args:
        image: PIL Image
        det_engine: RapidOCR detection engine
        rec_engine: RapidOCR recognition engine  
        max_side: Threshold for tiling (pixels)
        tile_size: Tile dimension (pixels)
        overlap: Overlap between tiles (pixels)
    
    Returns:
        (merged_results, was_tiled) tuple
    """
    w, h = image.size
    
    if max(w, h) <= max_side:
        # No tiling needed
        return None, False
    
    print(f"INFO: Tiling {w}x{h} image (max_side={max_side}, tile={tile_size}, overlap={overlap})", flush=True)
    
    stride = tile_size - overlap
    all_results = []
    
    y = 0
    while y < h:
        x = 0
        while x < w:
            # Extract tile
            x2 = min(x + tile_size, w)
            y2 = min(y + tile_size, h)
            tile = image.crop((x, y, x2, y2))
            
            try:
                # Run OCR on tile
                tile_result, _ = det_engine(tile) if rec_engine is None else rec_engine(tile)
                
                if tile_result:
                    # Translate box coordinates by tile offset
                    for item in tile_result:
                        if isinstance(item, (list, tuple)) and len(item) >= 3:
                            first = item[0]
                            if isinstance(first, (list, tuple)) and len(first) >= 4:
                                # Box-first format: [box, text, score]
                                translated_box = [[p[0] + x, p[1] + y] for p in first]
                                all_results.append([translated_box, item[1], item[2] if len(item) > 2 else 0.0])
                            else:
                                # Text-first format: [text, score, box]
                                if len(item) > 2 and isinstance(item[2], (list, tuple)):
                                    translated_box = [[p[0] + x, p[1] + y] for p in item[2]]
                                    all_results.append([item[0], item[1], translated_box])
            except Exception as e:
                print(f"WARN: Tile ({x},{y}) failed: {e}", flush=True)
            
            x += stride
            if x >= w:
                break
        
        y += stride
        if y >= h:
            break
    
    # De-duplicate overlapping boxes by IoU
    if len(all_results) > 1:
        deduped = []
        for result in all_results:
            # Convert to (x,y,w,h) for IoU check
            box_points = result[0] if isinstance(result[0], list) and len(result[0]) >= 4 else result[2] if len(result) > 2 else None
            if box_points is None:
                deduped.append(result)
                continue
            
            bbox = _bbox_to_xywh(box_points)
            conf = _to_float(result[2] if isinstance(result[0], list) and len(result[0]) >= 4 else result[1], 0.0)
            
            # Check IoU with existing boxes
            is_duplicate = False
            for i, existing in enumerate(deduped):
                existing_points = existing[0] if isinstance(existing[0], list) and len(existing[0]) >= 4 else existing[2] if len(existing) > 2 else None
                if existing_points is None:
                    continue
                
                existing_bbox = _bbox_to_xywh(existing_points)
                existing_conf = _to_float(existing[2] if isinstance(existing[0], list) and len(existing[0]) >= 4 else existing[1], 0.0)
                
                if _iou(bbox, existing_bbox) > 0.6:
                    # Keep higher confidence version
                    if conf > existing_conf:
                        deduped[i] = result
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                deduped.append(result)
        
        print(f"INFO: Tiling merged {len(all_results)} → {len(deduped)} boxes (removed {len(all_results) - len(deduped)} duplicates)", flush=True)
        return deduped, True
    
    return all_results, True


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


def _to_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except Exception:
        return default

def _to_int(v: Any, default: int = 0) -> int:
    try:
        if v is None:
            return default
        return int(float(v))
    except Exception:
        return default


def preprocess_image(image: Image.Image, settings: Optional[Dict[str, Any]] = None) -> Image.Image:
    """Normalize fax-quality scans for better OCR."""
    settings = settings or {}
    mode = str(settings.get("mode") or os.getenv("MEDOCR_PREPROCESS_MODE", "enhanced")).lower()
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
    use_clahe = bool(settings.get("use_clahe") if settings.get("use_clahe") is not None else (os.getenv("MEDOCR_USE_CLAHE", "true").lower() in ("true", "1", "yes")))
    if use_clahe:
        clip_limit = _to_float(settings.get("clahe_clip") if settings.get("clahe_clip") is not None else os.getenv("MEDOCR_CLAHE_CLIP_LIMIT", "4.0"), 4.0)
        tile_size = _to_int(settings.get("clahe_tile") if settings.get("clahe_tile") is not None else os.getenv("MEDOCR_CLAHE_TILE_SIZE", "8"), 8)
        clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile_size, tile_size))
        np_img = clahe.apply(np_img)
    
    # Optional: Bilateral filter for edge-preserving noise reduction
    use_bilateral = bool(settings.get("use_bilateral") if settings.get("use_bilateral") is not None else (os.getenv("MEDOCR_USE_BILATERAL", "true").lower() in ("true", "1", "yes")))
    if use_bilateral:
        bilateral_d = _to_int(settings.get("bilateral_d") if settings.get("bilateral_d") is not None else os.getenv("MEDOCR_BILATERAL_D", "9"), 9)
        bilateral_sigma = _to_float(settings.get("bilateral_sigma") if settings.get("bilateral_sigma") is not None else os.getenv("MEDOCR_BILATERAL_SIGMA", "75"), 75.0)
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

def preprocess_variants(image: Image.Image, base_settings: Optional[Dict[str, Any]] = None) -> List[Tuple[Image.Image, str]]:
    """
    Generate preprocessing variants for low-confidence retry.
    Returns list of (preprocessed_image, variant_name) tuples.
    """
    variants = []
    
    # Variant 1: Enhanced mode (default)
    base = dict(base_settings or {})
    base['mode'] = 'enhanced'
    variants.append((preprocess_image(image, base), 'enhanced'))
    
    # Variant 2: No CLAHE (in case CLAHE over-processes)
    base2 = dict(base)
    base2['use_clahe'] = False
    variants.append((preprocess_image(image, base2), 'no_clahe'))
    
    # Variant 3: Basic mode (minimal preprocessing)
    base3 = dict(base)
    base3['mode'] = 'basic'
    variants.append((preprocess_image(image, base3), 'basic'))
    
    # Variant 4: Off mode (no preprocessing, raw image)
    base4 = dict(base)
    base4['mode'] = 'off'
    variants.append((preprocess_image(image, base4), 'off'))
    
    return variants


def _calculate_median_char_height(boxes):
    """Calculate median character height from OCR boxes."""
    heights = []
    for box in boxes:
        if 'bbox' in box and len(box['bbox']) >= 4:
            height = box['bbox'][3]  # bbox is [x, y, w, h]
            if height > 0:
                heights.append(height)
    
    if not heights:
        return 0
    
    heights.sort()
    mid = len(heights) // 2
    if len(heights) % 2 == 0:
        return (heights[mid - 1] + heights[mid]) / 2
    return heights[mid]


def _should_bump_dpi(boxes, avg_conf, current_dpi, max_dpi):
    """
    Decide if we should re-render at higher DPI.
    Returns (should_bump, reason, next_dpi)
    """
    if current_dpi >= max_dpi:
        return False, None, None
    
    # Calculate median character height
    median_height = _calculate_median_char_height(boxes)
    
    # Bump if confidence is low (<0.90) OR characters are too small (<11px)
    if avg_conf < 0.90:
        return True, f"low_conf_{avg_conf:.3f}", min(current_dpi + 150, max_dpi)
    
    if median_height > 0 and median_height < 11:
        return True, f"small_text_{median_height:.1f}px", min(current_dpi + 150, max_dpi)
    
    return False, None, None


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
            rec_keys_path = os.getenv("MEDOCR_REC_KEYS_PATH")
            
            kwargs = {}
            if det_path and os.path.exists(det_path):
                kwargs['det_model_path'] = det_path
            if cls_path and os.path.exists(cls_path):
                kwargs['cls_model_path'] = cls_path
            if rec_path and os.path.exists(rec_path):
                kwargs['rec_model_path'] = rec_path
                # PP-OCRv4 models need character dictionary
                if rec_keys_path and os.path.exists(rec_keys_path):
                    kwargs['rec_keys_path'] = rec_keys_path
            
            if kwargs:
                print(f"Loading RapidOCR with custom models: {list(kwargs.keys())}", flush=True)
                try:
                    _rapid_engine = RapidOCR(**kwargs)
                    print("✓ Custom models loaded successfully", flush=True)
                except Exception as e:
                    print(f"✗ Custom models failed ({e}), falling back to defaults", flush=True)
                    _rapid_engine = RapidOCR()
            else:
                print("Loading RapidOCR with default bundled models (PP-OCRv3 lite)", flush=True)
                _rapid_engine = RapidOCR()
        except Exception as e:
            print(f"Failed to load RapidOCR: {e}", flush=True)
            _rapid_engine = None
    else:
        _rapid_engine = None

@app.post("/ocr")
async def ocr(request: Request, file: UploadFile = File(...)):
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
        q = request.query_params
        override_dpi = q.get('dpi')
        base_dpi = int(override_dpi) if (override_dpi and str(override_dpi).isdigit()) else int(os.getenv('MEDOCR_RENDER_DPI', '300'))
        images: List = convert_from_bytes(data, dpi=base_dpi, fmt='png')
        page_count = len(images)

        # Downsample large faxes to keep OCR throughput reasonable
        # BUT never below 250 DPI effective — that's the OCR quality floor
        if page_count:
            threshold = int(os.getenv('MEDOCR_DOWNSAMPLE_PAGES', '10'))
            high_threshold = int(os.getenv('MEDOCR_DOWNSAMPLE_PAGES_HIGH', '20'))
            scale_primary = float(os.getenv('MEDOCR_DOWNSAMPLE_SCALE', '0.85'))
            scale_secondary = float(os.getenv('MEDOCR_DOWNSAMPLE_SCALE_HIGH', '0.75'))
            min_effective_dpi = 250
            min_scale = min_effective_dpi / base_dpi  # e.g., 250/300 = 0.83
            scale = None
            if page_count >= high_threshold:
                scale = max(scale_secondary, min_scale)
            elif page_count >= threshold:
                scale = max(scale_primary, min_scale)
            if scale and scale < 1.0:
                downsized = []
                for img in images:
                    w, h = img.size
                    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                    downsized.append(img.resize(new_size, Image.BILINEAR))
                images = downsized
    except PDFInfoNotInstalledError as e:
        # Poppler not installed
        print(f"[ocr] poppler_missing: {e}", flush=True)
        return JSONResponse(status_code=500, content={
            "error": {"code": "poppler_missing", "message": "Poppler (pdftoppm) not installed. On macOS: brew install poppler"}
        })
    except (PDFPageCountError, PDFSyntaxError) as e:
        print(f"[ocr] pdf_render_failed: {e}", flush=True)
        return JSONResponse(status_code=400, content={
            "error": {"code": "pdf_render_failed", "message": str(e)}
        })
    except Exception as e:
        print(f"[ocr] pdf_render_unexpected: {e}", flush=True)
        return JSONResponse(status_code=500, content={
            "error": {"code": "pdf_render_error", "message": str(e)}
        })

    engine = globals().get('_rapid_engine') or (RapidOCR() if _rapid_available else None)
    pages = []

    def quad_to_bbox(quad: List[Tuple[float, float]]):
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        return [
            _to_float(x_min, 0.0),
            _to_float(y_min, 0.0),
            _to_float(x_max - x_min, 0.0),
            _to_float(y_max - y_min, 0.0)
        ]

    # Confidence retry configuration
    q = request.query_params
    enable_retry = (q.get('enable_retry') or os.getenv("MEDOCR_ENABLE_CONFIDENCE_RETRY", "true")).lower() in ("true", "1", "yes")
    confidence_threshold = _to_float(q.get('retry_threshold') or os.getenv("MEDOCR_CONFIDENCE_THRESHOLD", "0.65"), 0.65)
    
    # Early-exit configuration
    enable_early_exit = os.getenv("MEDOCR_ENABLE_EARLY_EXIT", "true").lower() in ("true", "1", "yes")
    early_exit_time_threshold = _to_float(os.getenv("MEDOCR_EARLY_EXIT_TIME_THRESHOLD", "60"), 60.0)
    early_exit_min_pages = _to_int(os.getenv("MEDOCR_EARLY_EXIT_MIN_PAGES", "3"), 3)
    early_exit_min_items = _to_int(os.getenv("MEDOCR_EARLY_EXIT_MIN_ITEMS", "10"), 10)
    early_exit_min_conf = _to_float(os.getenv("MEDOCR_EARLY_EXIT_MIN_CONF", "0.70"), 0.70)
    
    # Per-page timeout (hard limit for stuck pages)
    page_timeout_seconds = _to_int(os.getenv("MEDOCR_PAGE_TIMEOUT_SECONDS", "90"), 90)

    # Build per-request preprocessing settings from query params (fallback to env)
    preproc_settings = {
        'mode': (q.get('mode') or os.getenv("MEDOCR_PREPROCESS_MODE", "enhanced")),
        'use_clahe': None if q.get('use_clahe') is None else (q.get('use_clahe').lower() in ("true", "1", "yes")),
        'clahe_clip': _to_float(q.get('clahe_clip'), None) if q.get('clahe_clip') is not None else None,
        'clahe_tile': _to_int(q.get('clahe_tile'), None) if q.get('clahe_tile') is not None else None,
        'use_bilateral': None if q.get('use_bilateral') is None else (q.get('use_bilateral').lower() in ("true", "1", "yes")),
        'bilateral_d': _to_int(q.get('bilateral_d'), None) if q.get('bilateral_d') is not None else None,
        'bilateral_sigma': _to_float(q.get('bilateral_sigma'), None) if q.get('bilateral_sigma') is not None else None,
    }

    try:
        for i, img in enumerate(images):
            import time
            page_start = time.time()
            print(f"[ocr] {_timestamp()} page={i+1} START", flush=True)
            
            # Stage 1: Auto-rotate page if needed (using classifier on detected boxes)
            t1 = time.time()
            # Pass the sub-engines (text_det and text_cls) to autorotate function
            img = autorotate_with_cls(img, engine.text_det, engine.text_cls)
            print(f"[ocr] {_timestamp()} page={i+1} autorotate took {time.time()-t1:.2f}s", flush=True)
            
            # Stage 2: Check if tiling needed for very large images
            t2 = time.time()
            # Pass the sub-engines (text_det and text_rec) to tiling function
            tiled_result, was_tiled = maybe_tile(img, engine.text_det, engine.text_rec)
            print(f"[ocr] {_timestamp()} page={i+1} tiling_check took {time.time()-t2:.2f}s (tiled={was_tiled})", flush=True)
            
            if was_tiled:
                # Use tiled results directly
                result = tiled_result
            else:
                # Standard single-image OCR
                t3 = time.time()
                processed_img = preprocess_image(img, preproc_settings)
                # RapidOCR returns: result, elapse = engine(img)
                # result is list of [text, score, boxPoints]
                try:
                    # Note: signal.alarm timeout doesn't work reliably on macOS with FastAPI
                    result, _ = engine(processed_img)
                    print(f"[ocr] {_timestamp()} page={i+1} standard_ocr took {time.time()-t3:.2f}s", flush=True)
                except Exception as e:
                    print(f"[ocr] {_timestamp()} engine_error: {e}", flush=True)
                    result = []
            
            print(f"[ocr] {_timestamp()} page={i+1} total_stage1+2+ocr: {time.time()-page_start:.2f}s, items={len(result) if result else 0}", flush=True)

            # Check average confidence - retry with variants if too low
            if enable_retry and result:
                t_conf = time.time()
                scores = []
                for item in result:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        first = item[0]
                        if isinstance(first, (list, tuple)) and len(first) >= 4:
                            # Box-first format: [box, text, score]
                            scores.append(_to_float(item[2], 0.0) if len(item) > 2 else 0.0)
                        else:
                            # Text-first format: [text, score, box]
                            scores.append(_to_float(item[1], 0.0) if len(item) > 1 else 0.0)
                
                avg_conf = sum(scores) / len(scores) if scores else 0.0
                print(f"[ocr] {_timestamp()} page={i+1} avg_confidence={avg_conf:.3f} threshold={confidence_threshold:.3f}", flush=True)
                
                # If confidence too low, try preprocessing variants
                if avg_conf < confidence_threshold:
                    print(f"[ocr] {_timestamp()} page={i+1} trying_variants (low confidence)", flush=True)
                    best_result = result
                    best_conf = avg_conf
                    
                    variants = preprocess_variants(img, preproc_settings)
                    for variant_idx, (variant_img, variant_name) in enumerate(variants):
                        t_var = time.time()
                        try:
                            variant_result, _ = engine(variant_img)
                            if variant_result:
                                variant_scores = []
                                for item in variant_result:
                                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                                        first = item[0]
                                        if isinstance(first, (list, tuple)) and len(first) >= 4:
                                            variant_scores.append(_to_float(item[2], 0.0) if len(item) > 2 else 0.0)
                                        else:
                                            variant_scores.append(_to_float(item[1], 0.0) if len(item) > 1 else 0.0)
                                
                                variant_conf = sum(variant_scores) / len(variant_scores) if variant_scores else 0.0
                                print(f"[ocr] {_timestamp()} page={i+1} variant_{variant_idx}={variant_name} conf={variant_conf:.3f} took {time.time()-t_var:.2f}s", flush=True)
                                
                                if variant_conf > best_conf:
                                    best_result = variant_result
                                    best_conf = variant_conf
                        except Exception:
                            continue
                        finally:
                            # Clean up variant image to prevent memory leaks at DPI 600
                            if hasattr(variant_img, 'close'):
                                variant_img.close()
                    
                    result = best_result
                    print(f"[ocr] {_timestamp()} page={i+1} variants_complete best_conf={best_conf:.3f} took {time.time()-t_conf:.2f}s", flush=True)
                else:
                    print(f"[ocr] {_timestamp()} page={i+1} skipping_variants (confidence OK)", flush=True)
            
            # Stage 3: Build boxes with bbox coordinates
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
                            score = _to_float(item[2], 0.0) if len(item) > 2 else 0.0
                        else:
                            # Assume text-first format: [text, score, box]
                            text = str(item[0])
                            score = _to_float(item[1], 0.0) if len(item) > 1 else 0.0
                            box_points = item[2] if len(item) > 2 else None
                    elif isinstance(item, dict):
                        text = str(item.get("text", ""))
                        score = _to_float(item.get("score", 0.0), 0.0)
                        box_points = item.get("box") or item.get("points")

                    if not text:
                        continue
                    
                    if box_points and isinstance(box_points, (list, tuple)) and len(box_points) >= 4:
                        # box_points is 4 points [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                        try:
                            bbox = quad_to_bbox([(_to_float(p[0], 0.0), _to_float(p[1], 0.0)) for p in box_points[:4]])
                        except Exception:
                            bbox = [0.0, 0.0, 0.0, 0.0]
                    else:
                        bbox = [0.0, 0.0, 0.0, 0.0]
                    
                    conf_val = _to_float(score, 0.0)
                    if conf_val < 0.0:
                        conf_val = 0.0
                    elif conf_val > 1.0:
                        conf_val = 1.0
                    boxes.append({"bbox": bbox, "text": text, "conf": conf_val})
            
            # Stage 3.5: Auto-DPI bump if enabled and quality is poor
            current_dpi = base_dpi
            auto_dpi_enabled = os.getenv("OCR_AUTO_DPI", "0") in ("1", "true", "yes")
            
            if auto_dpi_enabled and boxes:
                dpi_base = int(os.getenv("OCR_DPI_BASE", "300"))
                dpi_max = int(os.getenv("OCR_DPI_MAX", "600"))
                
                # Calculate average confidence
                scores = [b['conf'] for b in boxes if 'conf' in b]
                avg_conf = sum(scores) / len(scores) if scores else 1.0
                
                should_bump, reason, next_dpi = _should_bump_dpi(boxes, avg_conf, current_dpi, dpi_max)
                
                if should_bump and next_dpi:
                    print(f"[ocr] auto_dpi: {current_dpi}→{next_dpi} on page {i+1} ({reason})", flush=True)
                    
                    try:
                        # Re-render this single page at higher DPI
                        t_dpi = time.time()
                        page_bytes = data  # Original PDF bytes
                        high_dpi_images = convert_from_bytes(
                            page_bytes,
                            dpi=next_dpi,
                            fmt='png',
                            first_page=i+1,  # 1-indexed
                            last_page=i+1
                        )
                        
                        if high_dpi_images:
                            high_img = high_dpi_images[0]
                            high_processed = preprocess_image(high_img, preproc_settings)
                            high_result, _ = engine(high_processed)
                            
                            # Rebuild boxes with high-DPI result
                            high_boxes = []
                            if high_result:
                                for item in high_result:
                                    text_h = ""
                                    score_h = 0.0
                                    box_points_h = None
                                    
                                    if isinstance(item, (list, tuple)) and len(item) >= 3:
                                        first = item[0]
                                        if isinstance(first, (list, tuple)) and len(first) >= 4 and isinstance(first[0], (list, tuple)):
                                            box_points_h = first
                                            text_h = str(item[1])
                                            score_h = _to_float(item[2], 0.0) if len(item) > 2 else 0.0
                                        else:
                                            text_h = str(item[0])
                                            score_h = _to_float(item[1], 0.0) if len(item) > 1 else 0.0
                                            box_points_h = item[2] if len(item) > 2 else None
                                    
                                    if text_h:
                                        if box_points_h and isinstance(box_points_h, (list, tuple)) and len(box_points_h) >= 4:
                                            try:
                                                bbox_h = quad_to_bbox([(_to_float(p[0], 0.0), _to_float(p[1], 0.0)) for p in box_points_h[:4]])
                                            except Exception:
                                                bbox_h = [0.0, 0.0, 0.0, 0.0]
                                        else:
                                            bbox_h = [0.0, 0.0, 0.0, 0.0]
                                        
                                        conf_h = _to_float(score_h, 0.0)
                                        if conf_h < 0.0: conf_h = 0.0
                                        elif conf_h > 1.0: conf_h = 1.0
                                        high_boxes.append({"bbox": bbox_h, "text": text_h, "conf": conf_h})
                            
                            # Calculate new confidence
                            high_scores = [b['conf'] for b in high_boxes if 'conf' in b]
                            high_avg_conf = sum(high_scores) / len(high_scores) if high_scores else 0.0
                            
                            # Use high-DPI result if better
                            if high_avg_conf > avg_conf + 0.02:  # At least 2% improvement
                                boxes = high_boxes
                                # Don't update img reference - keep original for table detection
                                # (high_img will be closed below, causing "Operation on closed image")
                                result = high_result  # Update result for consistency
                                current_dpi = next_dpi
                                print(f"[ocr] auto_dpi: using {next_dpi} DPI result (conf {avg_conf:.3f}→{high_avg_conf:.3f}) took {time.time()-t_dpi:.2f}s", flush=True)
                            else:
                                print(f"[ocr] auto_dpi: keeping {current_dpi} DPI (no improvement: {avg_conf:.3f} vs {high_avg_conf:.3f})", flush=True)
                            
                            # Cleanup high-DPI image
                            if hasattr(high_img, 'close'):
                                high_img.close()
                            if hasattr(high_processed, 'close'):
                                high_processed.close()
                    except Exception as e:
                        print(f"[ocr] {_timestamp()} auto_dpi_error page={i+1}: {e}", flush=True)
            
            # Stage 4: Sort boxes in reading order (handles multi-column layouts)
            print(f"[ocr] {_timestamp()} page={i+1} sorting_boxes (reading order)", flush=True)
            boxes = reading_order(boxes)
            print(f"[ocr] {_timestamp()} page={i+1} reading_order complete", flush=True)
            
            # Stage 5: Detect tables if enabled
            tables = []
            if os.getenv("OCR_ENABLE_TABLES", "1") in ("1", "true", "yes"):
                print(f"[ocr] {_timestamp()} page={i+1} table_detection START", flush=True)
                try:
                    t_table = time.time()
                    # Convert PIL to OpenCV format for table detection
                    img_np = np.array(img)
                    if img_np.ndim == 2:  # Grayscale
                        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_GRAY2BGR)
                    elif img_np.shape[2] == 3:  # RGB
                        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
                    else:  # RGBA
                        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGBA2BGR)
                    
                    table_bboxes = _find_tables_cv(img_bgr)
                    print(f"[ocr] {_timestamp()} page={i+1} found {len(table_bboxes)} table candidates", flush=True)
                    
                    for tb_idx, tb_bbox in enumerate(table_bboxes):
                        print(f"[ocr] {_timestamp()} page={i+1} extracting table {tb_idx+1}/{len(table_bboxes)}", flush=True)
                        cells_info = _extract_cells_from_table(img_bgr, tb_bbox)
                        
                        # Limit max cells to process per table (avoid massive table hangs)
                        max_cells_per_table = int(os.getenv("OCR_MAX_CELLS_PER_TABLE", "15"))
                        if len(cells_info) > max_cells_per_table:
                            print(f"[ocr] {_timestamp()} page={i+1} table {tb_idx+1} has {len(cells_info)} cells (limiting to {max_cells_per_table})", flush=True)
                            cells_info = cells_info[:max_cells_per_table]
                        
                        print(f"[ocr] {_timestamp()} page={i+1} table {tb_idx+1} has {len(cells_info)} cells, starting OCR", flush=True)
                        
                        # OCR each cell
                        cells_with_text = []
                        cell_start_time = time.time()
                        for cell_idx, cell in enumerate(cells_info):
                            # Skip remaining cells if we've been processing this table too long
                            if time.time() - cell_start_time > 60:  # 60s total for all cells in this table
                                print(f"[ocr] {_timestamp()} page={i+1} table {tb_idx+1} cell processing timeout after {cell_idx} cells", flush=True)
                                break
                            
                            cx, cy, cw, ch = cell['bbox']
                            # Crop cell region from PIL image
                            cell_img = img.crop((cx, cy, cx + cw, cy + ch))
                            
                            try:
                                # No signal timeout - doesn't work on macOS
                                cell_result, _ = engine(cell_img)
                                cell_text = ""
                                cell_conf = 0.0
                                
                                if cell_result:
                                    # Take first detected text in cell
                                    item = cell_result[0]
                                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                                        first = item[0]
                                        if isinstance(first, (list, tuple)) and len(first) >= 4:
                                            cell_text = str(item[1])
                                            cell_conf = _to_float(item[2], 0.0) if len(item) > 2 else 0.0
                                        else:
                                            cell_text = str(item[0])
                                            cell_conf = _to_float(item[1], 0.0)
                                
                                cells_with_text.append({
                                    'r': cell['r'],
                                    'c': cell['c'],
                                    'bbox': [float(cx), float(cy), float(cw), float(ch)],
                                    'text': cell_text,
                                    'conf': float(cell_conf)
                                })
                            except Exception:
                                continue
                        
                        if cells_with_text:
                            tables.append({
                                'bbox': [float(tb_bbox[0]), float(tb_bbox[1]), float(tb_bbox[2]), float(tb_bbox[3])],
                                'cells': cells_with_text
                            })
                    
                    if tables:
                        print(f"[ocr] {_timestamp()} page={i+1} tables={len(tables)} took {time.time()-t_table:.2f}s", flush=True)
                except Exception as e:
                    print(f"[ocr] {_timestamp()} table_detection_error page={i+1}: {e}", flush=True)
            
            # Stage 6: Assemble text from sorted boxes
            lines = [box["text"] for box in boxes]
            page_text = "\n".join(lines)
            
            page_dict = {
                "page": i + 1,
                "text": page_text,
                "boxes": boxes
            }
            if tables:
                page_dict["tables"] = tables
            
            pages.append(page_dict)
            
            # Smart early-exit: skip remaining pages if current page is useless and took too long
            if enable_early_exit:
                page_duration = time.time() - page_start
                remaining_pages = len(images) - (i + 1)
                
                # Only consider early exit after processing minimum required pages
                if i >= (early_exit_min_pages - 1) and remaining_pages > 0:
                    # Check if page took too long
                    if page_duration > early_exit_time_threshold:
                        # Calculate page quality metrics
                        num_items = len(boxes)
                        avg_page_conf = sum(box.get("conf", 0.0) for box in boxes) / num_items if num_items > 0 else 0.0
                        
                        # Exit if page has very few items OR very low confidence
                        should_exit = (num_items < early_exit_min_items) or (avg_page_conf < early_exit_min_conf)
                        
                        if should_exit:
                            print(f"[ocr] {_timestamp()} early_exit: page {i+1} took {page_duration:.1f}s (items={num_items}, conf={avg_page_conf:.3f}), skipping remaining {remaining_pages} pages", flush=True)
                            break
        
        print(f"[ocr] {_timestamp()} processing complete: {len(pages)} pages processed", flush=True)
    except Exception as e:
        import traceback
        print(f"[ocr] processing_unexpected: {e}\n{traceback.format_exc()}", flush=True)
        return JSONResponse(status_code=500, content={
            "error": {"code": "ocr_processing_error", "message": str(e)}
        })
    finally:
        # Explicit memory cleanup for DPI 600 documents
        import gc
        if 'images' in locals():
            for img in images:
                if hasattr(img, 'close'):
                    img.close()
            del images
        if 'processed_img' in locals():
            if hasattr(processed_img, 'close'):
                processed_img.close()
            del processed_img
        # Force garbage collection to free memory from large DPI 600 images
        gc.collect()

    return JSONResponse({"ocr": pages})
