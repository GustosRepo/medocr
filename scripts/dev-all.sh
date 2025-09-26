#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/data/logs"
PID_DIR="$ROOT_DIR/data/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

echo "==> MEDOCR: starting OCR service, API, and Frontend"

# Helper: check if port is in use
in_use() { lsof -i TCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Check poppler for pdf2image (pdftoppm)
if ! command -v pdftoppm >/dev/null 2>&1; then
  echo "[warn] 'pdftoppm' not found. Install poppler (macOS): brew install poppler" >&2
fi

# Start OCR service (FastAPI + RapidOCR)
start_ocr() {
  local ocr_dir="$ROOT_DIR/ocr_service"
  if [ ! -d "$ocr_dir/.venv" ]; then
    echo "[error] Python venv not found at ocr_service/.venv" >&2
    echo "        Create it and install deps:" >&2
    echo "          cd ocr_service && python3 -m venv .venv && source .venv/bin/activate && pip install fastapi uvicorn pillow pdf2image rapidocr-onnxruntime python-multipart" >&2
    return 1
  fi
  if in_use 8000; then
    echo "[info] OCR port 8000 already in use; skipping start"
    return 0
  fi
  echo "[info] Starting OCR on 127.0.0.1:8000"
  (
    cd "$ocr_dir"
    source .venv/bin/activate
    exec uvicorn app:app --host 127.0.0.1 --port 8000
  ) >"$LOG_DIR/ocr.log" 2>&1 &
  echo $! > "$PID_DIR/ocr.pid"
}

# Start Backend API
start_api() {
  if in_use 4387; then
    echo "[info] API port 4387 already in use; skipping start"
    return 0
  fi
  echo "[info] Starting API on 127.0.0.1:4387"
  (
    cd "$ROOT_DIR"
    export NODE_ENV=development
    export OCR_SERVICE_URL="http://127.0.0.1:8000"
    exec node backend/server.js
  ) >"$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
}

# Start Frontend (Vite)
start_frontend() {
  if in_use 5173 || in_use 5174; then
    echo "[info] Frontend port already in use; skipping start"
    return 0
  fi
  echo "[info] Starting Frontend (Vite)"
  (
    cd "$ROOT_DIR/frontend"
    exec npm run dev
  ) >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$PID_DIR/frontend.pid"
}

start_ocr || true
start_api || true
start_frontend || true

echo "==> MEDOCR: started. Logs: $LOG_DIR"
echo "    OCR:      http://127.0.0.1:8000 (log: $LOG_DIR/ocr.log)"
echo "    API:      http://127.0.0.1:4387 (log: $LOG_DIR/backend.log)"
echo "    Frontend: http://127.0.0.1:5173 (log: $LOG_DIR/frontend.log)"
echo "    To stop: bash scripts/stop-all.sh"
