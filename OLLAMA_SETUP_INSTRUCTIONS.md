# 🦙 Ollama Setup Instructions for v1.2.1

## What Changed
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

**Recommended model:** `llava-phi3` (fastest, good quality, ~4GB)

### Step 3: Start Services

**Option A - Use dev-all script (recommended):**
```bash
npm run dev:all
```

This automatically:
- Checks if Ollama is running
- Starts Ollama if needed
- Verifies the model is pulled
- Starts all services (backend, frontend, OCR)

**Option B - Manual start:**
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

| Model | Size | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| llava:13b | ~8GB | Slower (20-30s) | Best | High accuracy needed |
| llava:7b | ~5GB | Medium (15-20s) | Good | Balance |
| **llava-phi3** | ~4GB | Fast (10-15s) | Good | **Recommended** |
| bakllava | ~5GB | Medium | Good | Document-heavy |

## Environment Variables

The system defaults to Ollama if available. Your `.env` should have:

```bash
# LLM Configuration
ENABLE_LLM=true
LLM_BACKEND=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llava-phi3
OLLAMA_TIMEOUT=60000
```

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

### Model not pulled
```bash
# Pull the model manually
ollama pull llava-phi3

# Or run setup script
./setup-ollama.sh
```

### Dual-engine not activating
Check backend logs:
```bash
tail -f backend/backend.log | grep -i "dual\|ollama"
```

You should see:
```
dual_engine_init: {"enabled":true,"backend":"ollama"}
ollama_health_check: {"status":"ok","model":"llava-phi3"}
```

## What's New in v1.2.1

✅ **Fixed:** Patient name extraction from appointment types  
✅ **Fixed:** False positives from address patterns  
✅ **Fixed:** State abbreviation confusion  
✅ **Added:** "Patient Information" header recognition  
✅ **Added:** Comprehensive medical terminology filters  
✅ **Updated:** .gitignore for runtime data files  

All patient names now extract correctly across document types!

## Quick Test

```bash
# 1. Verify Ollama is running
curl http://localhost:11434/api/tags

# 2. Verify model is available
ollama list | grep llava

# 3. Start services
npm run dev:all

# 4. Upload a test document and verify extraction
```

---

**Need help?** Check the dev-all.sh script logs for detailed startup information.
