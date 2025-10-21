#!/usr/bin/env bash
set -euo pipefail

# Build a linux wheelhouse (manylinux wheels) and produce amd64 image tars locally.
# Requires Docker with buildx available. Intended for macOS dev machines.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/release"
mkdir -p "$OUT_DIR/wheelhouse"

echo "Creating manylinux wheelhouse..."
docker run --rm -v "$ROOT_DIR":/src -w /src quay.io/pypa/manylinux_2_24_x86_64 bash -lc \
  "python3 -m pip install --upgrade pip && python3 -m pip download -r ocr_service/requirements.txt -d /src/release/wheelhouse"

echo "Ensuring buildx builder exists..."
docker buildx create --use --name medocr-builder || true

echo "Building amd64 OCR image tar..."
docker buildx build --platform linux/amd64 -f ocr_service/Dockerfile --build-arg WHEELHOUSE=release/wheelhouse --output type=tar,dest=release/medocr-ocr-amd64.tar .

echo "Building amd64 backend image tar..."
docker buildx build --platform linux/amd64 -f backend/Dockerfile --output type=tar,dest=release/medocr-backend-amd64.tar .

echo "Building amd64 frontend image tar..."
docker buildx build --platform linux/amd64 -f frontend/Dockerfile --output type=tar,dest=release/medocr-frontend-amd64.tar ./frontend

echo "Done. Tars are in $OUT_DIR"
