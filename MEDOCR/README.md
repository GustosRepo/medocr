# MEDOCR

A full-stack OCR desktop project with React frontend, Node.js backend, and Python OCR worker.

## Structure
- `/frontend` — React app (file upload, trigger OCR, display results)
- `/backend` — Node.js + Express server (API endpoint `/ocr`)
- `/ocr-worker` — Python script (pytesseract + Pillow)

## How it works
1. User uploads a file in React UI.
2. React sends file to Node backend at `/ocr`.
3. Node saves file, calls Python OCR worker.
4. Python extracts text, returns to Node.
5. Node responds with JSON.
6. React displays OCR result.

## Scripts
- `npm run dev` in `/frontend` — starts React app
- `npm start` in `/backend` — starts Node server
- `python main.py <imagepath>` in `/ocr-worker` — tests OCR standalone

## Ready for Electron packaging and further expansion.
