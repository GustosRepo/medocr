#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/data/pids"

KILL_PORTS=0
for arg in "$@"; do
  case "$arg" in
    --ports) KILL_PORTS=1 ;;
  esac
done

kill_if_running() {
  local name="$1"
  local pid_file="$PID_DIR/$1.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file" || true)
    if [ -n "${pid}" ]; then
      if ps -p "$pid" >/dev/null 2>&1; then
        echo "[info] Stopping $name (pid $pid)"
        kill "$pid" || true
        sleep 0.4
        if ps -p "$pid" >/dev/null 2>&1; then
          echo "[warn] Forcing $name (pid $pid)"
          kill -9 "$pid" || true
        fi
      else
        echo "[info] Removing stale pid file for $name (pid $pid not running)"
      fi
    fi
    rm -f "$pid_file"
  fi
}

kill_if_running ocr
for port in 8000 8001 8002 8003; do
  kill_if_running "ocr-$port"
done
kill_if_running backend
kill_if_running frontend

if [ $KILL_PORTS -eq 1 ]; then
  for port in 8000 8001 8002 8003 4387 5173 5174; do
    pids=$(lsof -ti tcp:"$port" || true)
    for p in $pids; do
      echo "[ports] Killing process $p on port $port"
      kill "$p" 2>/dev/null || true
      sleep 0.2
      kill -9 "$p" 2>/dev/null || true
    done
  done
fi

echo "==> MEDOCR: all services stopped."
