# Windows Intel Docker Setup

## ⚠️ IMPORTANT: Don't Use Full Docker Stack on Windows Intel

The `docker-compose.yml` includes a GPU-based LLM service that **won't work on your Intel system**. 

**Use this simpler approach instead:**

---

## Quick Setup (Recommended)

### Option 1: Use Published Docker Images (Easiest)

Pull the pre-built images from GitHub Container Registry:

```bash
docker pull ghcr.io/gustosrepo/medocr-ocr:latest
docker pull ghcr.io/gustosrepo/medocr-backend:latest
docker pull ghcr.io/gustosrepo/medocr-frontend:latest
```

Then use the docker-compose file below.

**This is the recommended approach - no building required.**

---

### Option 2: Partial Docker (OCR Only)

If you want to use Docker for OCR but Ollama for LLM:

**1. Create a simplified docker-compose file:**

Create `docker-compose.windows.yml`:

```yaml
version: '3.8'

services:
  ocr:
    image: ghcr.io/gustosrepo/medocr-ocr:latest
    ports:
      - "8000:8000"
    volumes:
      - ./ocr_service/models:/app/models:ro
    environment:
      - MEDOCR_RENDER_DPI=300
      - MEDOCR_DOWNSAMPLE_PAGES=4
      - MEDOCR_DOWNSAMPLE_PAGES_HIGH=8
      - MEDOCR_DOWNSAMPLE_SCALE=0.5
      - MEDOCR_DOWNSAMPLE_SCALE_HIGH=0.4
      - MEDOCR_PREPROCESS_MODE=enhanced
      - MEDOCR_USE_CLAHE=true
      - MEDOCR_CLAHE_CLIP_LIMIT=2.0
      - MEDOCR_CLAHE_TILE_SIZE=8
      - MEDOCR_ENABLE_CONFIDENCE_RETRY=true
      - MEDOCR_CONFIDENCE_THRESHOLD=0.65
      - MEDOCR_DET_MODEL_PATH=/app/models/ch_PP-OCRv4_det_server_infer.onnx
      - MEDOCR_CLS_MODEL_PATH=/app/models/ch_ppocr_mobile_v2.0_cls_infer.onnx
      - MEDOCR_REC_MODEL_PATH=/app/models/ch_PP-OCRv4_rec_server_infer.onnx
    restart: unless-stopped
    networks:
      - medocr-net

  api:
    image: ghcr.io/gustosrepo/medocr-backend:latest
    ports:
      - "4387:4387"
    environment:
      - NODE_ENV=development
      - OCR_SERVICE_URL=http://ocr:8000
      - ENABLE_LLM=true
      - OLLAMA_HOST=http://host.docker.internal:11434
      - OLLAMA_MODEL=llava-phi3
      - OLLAMA_TIMEOUT=120000
      - LLM_TIMEOUT=300000
      - LLM_MODE=extract
      - OCR_TIMEOUT_MS=900000
      - OCR_MAX_CONCURRENCY=4
      - DOC_MAX_CONCURRENCY=2
      - MAX_PDF_PAGES=150
      - UPLOAD_MAX_BYTES=52428800
    depends_on:
      - ocr
    restart: unless-stopped
    volumes:
      - ./backend/data:/app/data
      - ./data:/app/data
      - ./uploads:/app/uploads
    networks:
      - medocr-net

  frontend:
    image: ghcr.io/gustosrepo/medocr-frontend:latest
    ports:
      - "5173:80"
    restart: unless-stopped
    networks:
      - medocr-net

networks:
  medocr-net:
    driver: bridge
```

**2. Install Ollama on your Windows host:**

```powershell
# Download from https://ollama.com/download
ollama pull llava-phi3
ollama pull llama3.2:latest
ollama serve
```

**3. Run Docker services:**

```powershell
docker-compose -f docker-compose.windows.yml up -d
```

This way:
- ✅ OCR runs in Docker (optimized)
- ✅ API/Backend runs in Docker
- ✅ Frontend runs in Docker
- ✅ LLM uses Ollama on your Windows host (optimized for Intel CPU)

---

## Why the Error Happened

The main `docker-compose.yml` has:

```yaml
llm:
  image: medocr-llm:local
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

This requires:
- ❌ NVIDIA GPU (you have Intel Arc)
- ❌ CUDA drivers (Intel doesn't support CUDA)
- ❌ Docker GPU passthrough (complicated on Windows)

**Your Intel system can't use this service.**

---

## Recommended Approach

**Use Option 1 (Docker with published images):**

1. Pull the images (see Option 1 above)
2. Install Ollama on Windows: `ollama pull llava-phi3 && ollama pull llama3.2:latest`
3. Use the docker-compose file from Option 2
4. Run: `docker-compose -f docker-compose.windows.yml up -d`

**Backend will connect to Ollama on your Windows host via `host.docker.internal:11434`**

---

## If You Really Want Docker

Use Option 2 above (partial Docker + Ollama on host).

But honestly, **Option 1 is easier and works just as well** for development/testing.

---

## Summary

**The error you saw:**
```
pull access denied for medocr-llm
```

**Means:** Docker tried to pull a custom image that doesn't exist publicly.

**Solution:** Don't use that LLM service - use Ollama locally instead.

**Next step:** 
1. Pull the published images: `docker pull ghcr.io/gustosrepo/medocr-ocr:latest` (and backend, frontend)
2. Install Ollama: Download from https://ollama.com/download
3. Use the docker-compose.windows.yml from Option 2 above
