import mimetypes
import sys, os, json, argparse
from io import BytesIO
from typing import List, Tuple

import numpy as np
from PIL import Image
import pytesseract
import cv2

# If Tesseract isn't on PATH (Windows), uncomment and set:
# Industry-standard: Set Tesseract path for macOS/Homebrew
pytesseract.pytesseract.tesseract_cmd = "/opt/homebrew/bin/tesseract"

# Use tessdata_best if available
TESSDATA_BEST = "/opt/homebrew/share/tessdata_best"
if os.path.isdir(TESSDATA_BEST):
    os.environ["TESSDATA_PREFIX"] = TESSDATA_BEST
pytesseract.pytesseract.tesseract_cmd = "/opt/homebrew/bin/tesseract"

def pdf_to_images(pdf_path: str, dpi: int = 600) -> List[Image.Image]:
    try:
        from pdf2image import convert_from_path
    except Exception:
        print("pdf2image not installed or Poppler missing.", file=sys.stderr)
        sys.exit(3)
    return convert_from_path(pdf_path, dpi=dpi)

def deskew_cv(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.size == 0:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    (h, w) = image.shape[:2]
    M = cv2.getRotationMatrix2D((w//2, h//2), angle, 1.0)
    return cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

def preprocess_for_ocr(pil_img: Image.Image, upscale: float = 2.0, do_deskew: bool = True) -> Image.Image:
    # Industry standard: upscale to 2x, strong denoise, adaptive threshold, deskew, sharpen
    img = np.array(pil_img)
    if img.ndim == 2:
        gray = img
    else:
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    gray = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)
    bin_img = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY, 31, 8)
    if do_deskew:
        bin_bgr = cv2.cvtColor(bin_img, cv2.COLOR_GRAY2BGR)
        bin_img = cv2.cvtColor(deskew_cv(bin_bgr), cv2.COLOR_BGR2GRAY)
    if upscale != 1.0:
        bin_img = cv2.resize(bin_img, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    blur = cv2.GaussianBlur(bin_img, (0, 0), sigmaX=1.2)
    sharp = cv2.addWeighted(bin_img, 1.7, blur, -0.7, 0)
    return Image.fromarray(sharp)

def ocr_pil(pil_img: Image.Image, lang: str = "eng", psm: int = 6, oem: int = 1) -> Tuple[str, float]:
    # Industry standard: oem 1 (LSTM only), psm configurable
    config = f"--oem {oem} --psm {psm}"
    if os.path.isdir(TESSDATA_BEST):
        config += f" --tessdata-dir {TESSDATA_BEST}"
    data = pytesseract.image_to_data(pil_img, lang=lang, config=config, output_type=pytesseract.Output.DICT)
    text = pytesseract.image_to_string(pil_img, lang=lang, config=config)
    confs = [c for c in data.get("conf", []) if str(c).isdigit() and c != "-1"]
    confs = [float(c) for c in confs]
    avg_conf = round(sum(confs) / len(confs), 2) if confs else -1.0
    return text, avg_conf

def run_file(path: str, lang: str = "eng", psm: int = 12) -> Tuple[str, float]:
    mime, _ = mimetypes.guess_type(path)
    is_pdf = False
    if mime == 'application/pdf':
        is_pdf = True
    else:
        # Fallback: check file header for PDF
        try:
            with open(path, 'rb') as f:
                header = f.read(5)
                if header == b'%PDF-':
                    is_pdf = True
        except Exception:
            pass
    if is_pdf:
        pages = pdf_to_images(path, dpi=400)
        all_text, weights = [], []
        for p in pages:
            pre = preprocess_for_ocr(p, upscale=2.0, do_deskew=True)
            txt, conf = ocr_pil(pre, lang=lang, psm=psm, oem=1)
            all_text.append(txt)
            if conf >= 0:
                weights.append(conf)
        return "\n\n".join(all_text), (round(sum(weights) / len(weights), 2) if weights else -1.0)
    else:
        img = Image.open(path)
        pre = preprocess_for_ocr(img, upscale=2.0, do_deskew=True)
        return ocr_pil(pre, lang=lang, psm=psm, oem=1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_path", help="Path to image or PDF")
    ap.add_argument("--lang", default="eng", help="Tesseract language code, e.g., eng or eng+spa")
    ap.add_argument("--psm", type=int, default=12, help="Tesseract page segmentation mode (default: 12)")
    args = ap.parse_args()
    if not os.path.exists(args.input_path):
        print("Input file not found", file=sys.stderr)
        sys.exit(1)
    try:
        text, avg_conf = run_file(args.input_path, lang=args.lang, psm=args.psm)
        print(json.dumps({"text": text, "avg_conf": avg_conf}))
        sys.exit(0)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
