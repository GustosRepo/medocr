#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/data/pids"

kill_if_running() {
  local pid_file="$PID_DIR/$1.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file" || true)
    if [ -n "${pid}" ] && ps -p "$pid" >/dev/null 2>&1; then
      echo "[info] Stopping $1 (pid $pid)"
      kill "$pid" || true
      sleep 0.3
      if ps -p "$pid" >/dev/null 2>&1; then
        echo "[warn] Forcing $1 (pid $pid)"
        kill -9 "$pid" || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

kill_if_running ocr
kill_if_running backend
kill_if_running frontend

echo "==> MEDOCR: all services stopped."
