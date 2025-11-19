# 🦙 Ollama vs Python: Which to Use?

Since you have Ollama installed, you have **two options** for the LLM backend. Here's how they compare:

## Quick Comparison

| Feature | Ollama (Recommended for Mac) | Python Service |
|---------|------------------------------|----------------|
| **Setup** | `./setup-ollama.sh` (2 min) | `./setup-mac.sh` (10-15 min) |
| **Dependencies** | Just Ollama | Python + PyTorch + transformers |
| **Architecture** | Node.js → Ollama HTTP API | Node.js → Python FastAPI → PyTorch |
| **Models** | llava, bakllava (vision models) | Phi-3.5-vision, Qwen2-VL, etc. |
| **Speed on M4** | ~10-20s (llava-phi3) | ~15-25s (Phi-3.5) |
| **Memory** | ~6-8GB | ~8-12GB |
| **Ease of Use** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Model Switching** | `ollama pull <model>` | Edit code, re-download |
| **Best For** | Mac dev/testing | Production, specific models |

---

## 🚀 Option 1: Ollama (RECOMMENDED for You)

### Pros
- ✅ **You already have it installed!**
- ✅ Simpler setup (~2 minutes)
- ✅ Pure Node.js backend (no Python service)
- ✅ Easy model switching
- ✅ Automatic MPS acceleration
- ✅ Built-in model management

### Cons
- ❌ Limited to Ollama's model library
- ❌ Slightly less control over inference parameters

### Setup

```bash
./setup-ollama.sh
```

That's it! The script will:
1. Check Ollama is installed ✓
2. Let you choose a vision model
3. Pull the model (~5GB download)
4. Configure .env automatically

### Start Services

```bash
# Terminal 1 - Ollama (if not already running)
ollama serve

# Terminal 2 - Backend
cd backend && npm start

# Terminal 3 - Frontend  
cd frontend && npm run dev
```

### Verify It's Working

```bash
curl http://localhost:11434/api/tags  # Should list your models
```

---

## 🐍 Option 2: Python Service

### Pros
- ✅ More model options (Phi-3.5, Qwen2-VL, LLaVA-1.6)
- ✅ Fine-grained control over inference
- ✅ Can use bitsandbytes for quantization (Linux only)
- ✅ Better for production deployment

### Cons
- ❌ More complex setup
- ❌ Need to manage Python virtual environment
- ❌ Separate service to maintain
- ❌ Slower model switching

### Setup

```bash
./setup-mac.sh
```

### Start Services

```bash
# Terminal 1 - LLM Service
cd llm_service
source venv/bin/activate
python main.py

# Terminal 2 - Backend
cd backend && npm start

# Terminal 3 - Frontend
cd frontend && npm run dev
```

---

## 📊 Model Recommendations

### For Ollama

**Best Quality** (slow but accurate):
```bash
ollama pull llava:13b
OLLAMA_MODEL=llava:13b npm start
```

**Best Balance** (recommended):
```bash
ollama pull llava-phi3
OLLAMA_MODEL=llava-phi3 npm start
```

**Fastest** (good for testing):
```bash
ollama pull llava:7b
OLLAMA_MODEL=llava:7b npm start
```

**Document Optimized**:
```bash
ollama pull bakllava
OLLAMA_MODEL=bakllava npm start
```

### For Python Service

**Best for Medical** (most accurate):
```env
MODEL_NAME=Qwen/Qwen2-VL-7B-Instruct
```

**Balanced** (recommended):
```env
MODEL_NAME=microsoft/phi-3.5-vision-instruct
```

**Fastest**:
```env
MODEL_NAME=microsoft/phi-3-vision-128k-instruct
```

---

## 🔄 Switching Between Them

The system auto-detects which backend to use based on environment variables:

### Use Ollama
```bash
# .env
ENABLE_LLM=true
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llava-phi3
# Don't set LLM_SERVICE_URL
```

### Use Python Service
```bash
# .env
ENABLE_LLM=true
LLM_SERVICE_URL=http://127.0.0.1:8001
MODEL_NAME=microsoft/phi-3.5-vision-instruct
# Don't set OLLAMA_HOST
```

The `dualEngineProcessor.js` checks for `OLLAMA_HOST` first, then falls back to `LLM_SERVICE_URL`.

---

## 💡 My Recommendation for You

Since you **already have Ollama installed**, start with:

```bash
./setup-ollama.sh
```

Choose option **3** (llava-phi3) for best balance of speed and quality.

This gives you:
- ⚡ **Fastest setup** - 2 minutes
- 🎯 **Good accuracy** - llava-phi3 is trained for documents
- 🔧 **Easy to test** - no Python complexity
- 🚀 **Production ready** - Ollama is stable and maintained

You can always switch to the Python service later if you need specific models or advanced features.

---

## 🧪 Testing Performance

After setup, test with a document:

```bash
# Upload via API
curl -X POST http://localhost:4387/api/documents \
  -F "file=@test_referral.pdf"
```

Check the response for:
```json
{
  "dualEngine": {
    "mode": "ocr_llm_merged",
    "agreementScore": 92,
    "timing": {
      "llm": 12000  // 12 seconds with llava-phi3
    }
  }
}
```

If `timing.llm` is:
- **<15s** - Excellent (llava-phi3, llava:7b)
- **15-25s** - Good (llava:13b, Phi-3.5)
- **>25s** - Check if MPS is working or try smaller model

---

## 🆘 Quick Troubleshooting

### "Ollama not found"
```bash
# Install from https://ollama.com/download
# Or via homebrew:
brew install ollama
```

### "Connection refused to port 11434"
```bash
# Start Ollama
ollama serve
```

### "Model not found"
```bash
# Pull the model
ollama pull llava-phi3
```

### "Running on CPU instead of GPU"
```bash
# Check MPS availability
python3 -c "import torch; print(torch.backends.mps.is_available())"

# Should print: True
```

---

**Ready to go?** Run `./setup-ollama.sh` and you'll be processing documents in 2 minutes! 🚀
