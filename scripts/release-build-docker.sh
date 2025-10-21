#!/usr/bin/env bash
# Build and save local images using the docker CLI (for Colima or Docker Desktop users)
# Usage: ./scripts/release-build-docker.sh [output-dir]
set -euo pipefail
OUT_DIR=${1:-./release}
mkdir -p "$OUT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI not found. Install Docker CLI or ensure Colima has configured the docker socket." >&2
  exit 1
fi

echo "Building and saving images to ${OUT_DIR}"

# Backend
echo "Building backend..."
docker build -t medocr-backend:local ./backend
docker save -o "${OUT_DIR}/medocr-backend-local.tar" medocr-backend:local

# OCR
echo "Building OCR service..."
docker build -t medocr-ocr:local ./ocr_service
docker save -o "${OUT_DIR}/medocr-ocr-local.tar" medocr-ocr:local

# Frontend
echo "Building frontend..."
docker build -t medocr-frontend:local ./frontend
docker save -o "${OUT_DIR}/medocr-frontend-local.tar" medocr-frontend:local

echo "All images built and saved in ${OUT_DIR}"
cat <<EOF
To run the images locally (quick smoke):
  docker load -i ${OUT_DIR}/medocr-backend-local.tar
  docker run -d --name medocr-api -p 4387:4387 --env-file .env medocr-backend:local
  docker load -i ${OUT_DIR}/medocr-ocr-local.tar
  docker run -d --name medocr-ocr -p 8000:8000 medocr-ocr:local
  docker load -i ${OUT_DIR}/medocr-frontend-local.tar
  docker run -d --name medocr-frontend -p 5173:80 medocr-frontend:local

Or use the provided compose file:
  docker compose -f docker-compose.images.yml up -d
EOF
