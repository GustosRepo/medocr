# 🦙 Ollama Setup Instructions for v1.2.4

## What's New in v1.2.4
✅ **Real-time log streaming** - Live OCR and Ollama logs visible in UI (Server-Sent Events)  
✅ **Docker production support** - Full dual-engine processing in containerized environments  
✅ **Canvas polyfills** - Node.js compatibility for pdfjs-dist in Docker  
✅ **Enhanced monitoring** - EventSource-based streaming replaces polling  

## Previous Updates (v1.2.1)
The patient name extraction has been fixed to prevent false positives from:
- Medical appointment types (e.g., "Disease Management")
- Address patterns (e.g., "123 MAIN ST")
- State abbreviations (e.g., "LAS VEGAS, NV")

## Ollama is Required for Dual-Engine Mode

The system uses **Ollama** (not Python) for the LLM vision model. You need to install it separately.

### Step 1: Install Ollama

**Mac/Windows:**
1. Visit https://ollama.com/download
2. Download and install Ollama for your platform
3. Verify installation: `ollama --version`

### Step 2: Run Automated Setup

```bash
# This will pull the vision model and configure everything
./setup-ollama.sh
```

**Required models:** 
- `llama3.2:latest` (2GB) - AI analysis engine
- `llava:7b` (4.7GB) - OCR vision processing

### Step 3: Start Services

**Option A - Local Development (recommended):**
```bash
npm run dev:all
```

This automatically:
- Checks if Ollama is running
- Starts Ollama if needed
- Verifies the model is pulled
- Starts all services (backend, frontend, OCR)

**Option B - Docker Production:**
```bash
# Build all images
docker-compose -f docker-compose.test.yml build

# Start all services
docker-compose -f docker-compose.test.yml up -d

# View logs (with real-time streaming)
docker-compose -f docker-compose.test.yml logs -f api
```

**Note:** For Docker, Ollama must be running on the **host machine** at `http://host.docker.internal:11434`

**Option C - Manual start:**
```bash
# Terminal 1 - Start Ollama (if not running)
ollama serve

# Terminal 2 - Start all services
npm run dev:all
```

### Step 4: Verify Dual-Engine is Working

1. Open http://localhost:5173
2. Upload a document
3. Check the extraction result - you should see:
   ```json
   "dualEngine": {
     "enabled": true,
     "llmBackend": "ollama",
     "pagesProcessed": 3,
     ...
   }
   ```

## Ollama Models Comparison

### Required Models for Client Setup

| Model | Size | Purpose | Required |
|-------|------|---------|----------|
| **llama3.2:latest** | ~2GB | Text reasoning & analysis | ✅ **YES** |
| **llava:7b** | ~4.7GB | OCR vision processing | ✅ **YES** |
| **llava:13b** | ~8GB | High-accuracy OCR (optional) | ⚪ Optional |

### Installation Commands
```bash
# Pull required models
ollama pull llama3.2:latest  # For AI analysis
ollama pull llava:7b          # For vision/OCR

# Optional high-accuracy model
ollama pull llava:13b         # For difficult handwriting
```

### Model Details

**llama3.2:latest (2GB)** - Primary analysis engine
- Used for: AI document analysis, text reasoning, pattern detection
- Speed: Very fast (5-10s per document)
- Purpose: Analyzes extracted data and generates forensic reports

**llava:7b (4.7GB)** - Standard vision model
- Used for: OCR extraction, narrative fields, clinical notes
- Speed: Medium (15-20s per document)
- Purpose: Extracts text and structured data from PDF pages

**llava:13b (8GB)** - High-accuracy vision (optional)
- Used for: Difficult handwriting, poor quality scans
- Speed: Slower (20-30s per document)
- Purpose: Fallback for challenging documents

## Environment Variables

**Local Development (.env):**
```bash
# LLM Configuration
ENABLE_LLM=true
LLM_MODE=extract
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llava:7b
OLLAMA_TIMEOUT=90000
LLM_TIMEOUT=300000
```

**Docker (docker-compose.test.yml):**
```yaml
environment:
  - ENABLE_LLM=true
  - LLM_MODE=extract
  - OLLAMA_HOST=http://host.docker.internal:11434
  - OLLAMA_MODEL=llava:7b
  - OLLAMA_TIMEOUT=90000
  - LLM_TIMEOUT=300000
  - LOG_LEVEL=debug  # Set to info for production
```

**LLM_MODE options:**
- `extract` - Extract narrative fields only (clinical notes, history)
- `validate` - Cross-check OCR results with LLM
- `off` - Disable LLM processing

## Troubleshooting

### Ollama not found
```bash
# Check if installed
which ollama

# If not, install from https://ollama.com
```

### Ollama service not running
```bash
# Start manually
ollama serve

# Or let dev-all.sh start it automatically
npm run dev:all
```

### Models not pulled
```bash
# Pull required models manually
ollama pull llama3.2:latest  # AI analysis (2GB)
ollama pull llava:7b          # OCR vision (4.7GB)

# Or run automated setup script
./setup-ollama.sh
```

### Dual-engine not activating

**Local:**
```bash
tail -f backend/backend.log | grep -i "dual\|ollama"
```

**Docker:**
```bash
docker logs medocr-backend-test -f | grep -i "dual\|ollama"
```

You should see:
```
[CanvasSetup] Polyfills installed: DOMMatrix, Path2D, ImageData, Image
dual_engine_init: {"enabled":true,"backend":"ollama"}
ollama_health_check: {"status":"ok","model":"llava:7b"}
```

### Canvas/DOMMatrix errors in Docker
If you see `DOMMatrix is not defined` or `process.getBuiltinModule is not a function`:
1. Verify `canvasSetup.js` exists in `backend/utils/`
2. Rebuild backend image: `docker build -t medocr-backend:v1.2.3-local -f backend/Dockerfile .`
3. Recreate container: `docker-compose -f docker-compose.test.yml up -d --force-recreate api`

### Logs not streaming in UI
1. Hard refresh browser: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+F5` (Windows)
2. Check browser console for EventSource errors
3. Verify nginx SSE config: `docker exec medocr-frontend-test cat /etc/nginx/conf.d/default.conf`
4. Test SSE directly: `curl -N http://localhost:5173/api/logs/ocr/stream`

## Docker-Specific Features (v1.2.4)

✅ **Real-time log streaming** - UI updates via Server-Sent Events (SSE)  
✅ **Canvas polyfills** - DOMMatrix, ImageData, Path2D for pdfjs-dist  
✅ **Node 18 compatibility** - process.getBuiltinModule polyfill  
✅ **Auto-detect environment** - Backend switches between local file tailing and `docker logs`  
✅ **Nginx SSE support** - Proxy configured for unbuffered event streaming  

### Log Streaming in UI
The application now shows real-time processing logs:
- **OCR Processing Logs** - Live DPI adjustments, confidence scores, page processing
- **Ollama Processing Logs** - LLM requests, page selection, extraction results

Logs stream via EventSource API (replaces 2-second polling for instant updates).

## Previous Features (v1.2.1)

✅ **Fixed:** Patient name extraction from appointment types  
✅ **Fixed:** False positives from address patterns  
✅ **Fixed:** State abbreviation confusion  
✅ **Added:** "Patient Information" header recognition  
✅ **Added:** Comprehensive medical terminology filters  

All patient names now extract correctly across document types!

## Quick Test

```bash
# 1. Verify Ollama is running
curl http://localhost:11434/api/tags

# 2. Verify both required models are available
ollama list | grep -E "llama3.2|llava"

# Expected output:
# llama3.2:latest    2.0 GB
# llava:7b           4.7 GB

# 3. Start services
npm run dev:all

# 4. Upload a test document and verify:
#    - OCR extraction completes
#    - AI Analysis button appears
#    - Problems are extracted correctly
```

---

**Need help?** Check the dev-all.sh script logs for detailed startup information.
