#!/usr/bin/env bash
set -e

# Configuration
NETWORK="medocr-net"
BACKEND_IMAGE="medocr-backend:local"
OCR_IMAGE="medocr-ocr:local"
FRONTEND_IMAGE="medocr-frontend:local"
ENV_FILE="/Users/agyhernandez/Desktop/medocr/.env"
PROJECT_DIR="/Users/agyhernandez/Desktop/medocr"

echo "==> Cleaning up existing containers..."
docker rm -f api ocr frontend 2>/dev/null || true

echo "==> Ensuring network exists..."
docker network create "$NETWORK" 2>/dev/null || echo "Network already exists"

echo "==> Starting backend (local arm64 build)"
docker run -d \
    --name api \
    --network "$NETWORK" \
    -p 4387:4387 \
    --env-file "$ENV_FILE" \
    "$BACKEND_IMAGE"

echo "==> Starting OCR service..."
docker run -d \
    --name ocr \
    --network "$NETWORK" \
    --platform linux/amd64 \
    -p 8000:8000 \
    "$OCR_IMAGE"

echo "==> Starting Frontend..."
docker run -d \
    --name frontend \
    --network "$NETWORK" \
    --platform linux/amd64 \
    -p 5173:80 \
    "$FRONTEND_IMAGE"

echo ""
echo "==> Done! Containers started:"
docker ps --filter "name=api" --filter "name=ocr" --filter "name=frontend" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "==> Checking logs..."
echo "--- API logs (last 10 lines) ---"
docker logs api 2>&1 | tail -10
echo ""
echo "--- OCR logs (last 5 lines) ---"
docker logs ocr 2>&1 | tail -5
echo ""
echo "--- Frontend logs (last 5 lines) ---"
docker logs frontend 2>&1 | tail -5

echo ""
echo "✓ Stack is running!"
echo "  - Frontend: http://localhost:5173"
echo "  - API: http://localhost:4387"
echo "  - OCR: http://localhost:8000"
