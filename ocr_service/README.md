# OCR Service (FastAPI + RapidOCR / PaddleOCR)

Local HTTP service to run OCR on referral PDFs. Required for real processing; when it's not running the backend will return an error.

## Endpoints
- POST /ocr — multipart form with `file` (PDF). Response: `{ ocr: [{ page, text, boxes: [{ bbox, text, conf }] }] }`

## Dev setup (macOS)
- Create venv, install deps (pdf2image needs poppler via Homebrew):
  - python3 -m venv .venv && source .venv/bin/activate
  - pip install fastapi uvicorn pydantic pillow pdf2image rapidocr-onnxruntime opencv-python-headless numpy
  - brew install poppler
- Optional env toggles:
  - `MEDOCR_PREPROCESS_MODE=basic|enhanced|off` (default `enhanced`) to tune image preprocessing.
  - `MEDOCR_PREPROC_DEBUG_DIR=/tmp/ocr-debug` to dump processed page images for inspection.
  - `MEDOCR_RENDER_DPI`, `MEDOCR_DOWNSAMPLE_PAGES`, `MEDOCR_DOWNSAMPLE_SCALE` (and `_HIGH`) to tune page downsampling for large PDFs.
- Run: uvicorn app:app --host 127.0.0.1 --port 8000

By default, the service uses RapidOCR (ONNX). If RapidOCR isn't installed, the endpoint returns 503. You may switch to PaddleOCR by installing paddleocr and wiring it similarly.
