#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/data/logs"
PID_DIR="$ROOT_DIR/data/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Load .env so OCR service URLs (and others) are available
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

OCR_URLS="${OCR_SERVICE_URLS:-${OCR_SERVICE_URL:-http://127.0.0.1:8000}}"
IFS=',' read -ra OCR_URL_ARR <<< "$OCR_URLS"
PRIMARY_OCR_URL="${OCR_URL_ARR[0]}"

HOLD=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --hold) HOLD=1 ;;
    --force) FORCE=1 ;;
  esac
done

# Always clear stale PID files and free the expected ports before starting so
# repeated dev cycles don't leave zombie uvicorn/node processes behind.
bash "$ROOT_DIR/scripts/stop-all.sh" --ports >/dev/null 2>&1 || true

echo "==> MEDOCR: starting OCR service, API, and Frontend"

# Ensure node modules are installed before we spawn any watchers
ensure_node_modules() {
  local dir="$1"
  local label="$2"
  if [ ! -f "$dir/package.json" ]; then
    return
  fi
  if [ $FORCE -eq 1 ] || [ ! -d "$dir/node_modules" ]; then
    echo "[deps] Installing npm packages for $label"
    (cd "$dir" && npm install)
  fi
}

# Helper: check if port is in use
in_use() { lsof -i TCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Remove stale pid file (pid not running)
ensure_pid_slot() {
  local name="$1" file="$PID_DIR/$1.pid"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file" || true)
    if [ -n "$pid" ] && ! ps -p "$pid" >/dev/null 2>&1; then
      rm -f "$file"
    elif [ $FORCE -eq 1 ]; then
      echo "[force] Killing existing $name pid $pid"
      kill "$pid" 2>/dev/null || true
      sleep 0.3
      kill -9 "$pid" 2>/dev/null || true
      rm -f "$file"
    fi
  fi
}

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

  for url in "${OCR_URL_ARR[@]}"; do
    local host="127.0.0.1"
    local port="8000"
    if [[ "$url" =~ ^https?://([^:/]+):([0-9]+) ]]; then
      host="${BASH_REMATCH[1]}"
      port="${BASH_REMATCH[2]}"
    elif [[ "$url" =~ ^https?://([^:/]+)$ ]]; then
      host="${BASH_REMATCH[1]}"
    elif [[ "$url" =~ ^([0-9]+)$ ]]; then
      port="${BASH_REMATCH[1]}"
    fi

    local name="ocr-$port"
    ensure_pid_slot "$name"

    if in_use "$port"; then
      echo "[info] OCR port $port already in use; skipping start"
      continue
    fi

    echo "[info] Starting OCR on ${host}:$port"
    (
      cd "$ocr_dir"
      source .venv/bin/activate
      exec uvicorn app:app --host "$host" --port "$port"
    ) >"$LOG_DIR/ocr-$port.log" 2>&1 &
    echo $! > "$PID_DIR/$name.pid"
  done
}

# Start Backend API
start_api() {
  ensure_pid_slot backend
  if in_use 4387; then
    echo "[info] API port 4387 already in use; skipping start"
    return 0
  fi
  echo "[info] Starting API on 127.0.0.1:4387"
  (
    cd "$ROOT_DIR"
    export NODE_ENV=development
    export OCR_SERVICE_URLS="$OCR_URLS"
    export OCR_SERVICE_URL="$PRIMARY_OCR_URL"
    exec node backend/server.js
  ) >"$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
}

# Start Frontend (Vite)
start_frontend() {
  ensure_pid_slot frontend
  if in_use 5173 || in_use 5174; then
    echo "[info] Frontend port already in use; skipping start"
    return 0
  fi
  echo "[info] Starting Frontend (Vite)"
  (
    cd "$ROOT_DIR/frontend"
    exec npm run dev -- --host 127.0.0.1 --port 5173
  ) >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$PID_DIR/frontend.pid"
}

start_ocr || true
ensure_node_modules "$ROOT_DIR" "backend"
start_api || true
ensure_node_modules "$ROOT_DIR/frontend" "frontend"
start_frontend || true

echo "==> MEDOCR: started. Logs: $LOG_DIR"
for url in "${OCR_URL_ARR[@]}"; do
  if [[ "$url" =~ ^https?://([^:/]+):([0-9]+) ]]; then
    host="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[2]}";
  elif [[ "$url" =~ ^https?://([^:/]+)$ ]]; then
    host="${BASH_REMATCH[1]}"; port="8000";
  else
    host="127.0.0.1"; port="${url}";
  fi
  echo "    OCR:      ${host}:$port (log: $LOG_DIR/ocr-$port.log)"
done
echo "    API:      http://127.0.0.1:4387 (log: $LOG_DIR/backend.log)"
echo "    Frontend: http://127.0.0.1:5173 (log: $LOG_DIR/frontend.log)"
echo "    To stop: bash scripts/stop-all.sh"
if [ $HOLD -eq 1 ]; then
  echo "==> HOLD MODE: Ctrl-C to stop all services"
  trap 'echo "\n[trap] Stopping services"; bash "$ROOT_DIR/scripts/stop-all.sh"; exit 0' INT TERM
  while true; do sleep 3600; done
fi
