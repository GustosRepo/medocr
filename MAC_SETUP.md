# Mac M4 Setup Guide

## 🍎 Running Dual-Engine MedOCR on Apple Silicon

Your Mac M4 chip has a powerful GPU that can run the Phi-3.5 Vision model using **Metal Performance Shaders (MPS)** instead of NVIDIA CUDA.

### Quick Start

```bash
# Run the automated setup script
./setup-mac.sh
```

This will:
1. Install all dependencies
2. Create virtual environment for Python
3. Configure .env for Mac (MPS device)
4. Optionally pre-download the model

---

## Manual Setup (Alternative)

If you prefer manual setup:

### 1. Install Dependencies

```bash
# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# LLM Service
cd llm_service
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install torch torchvision torchaudio  # Mac version with MPS
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment

Create `.env` file:

```bash
# LLM Service Configuration
ENABLE_LLM=true
LLM_SERVICE_URL=http://127.0.0.1:8001
LLM_TIMEOUT=30000

# Model will use MPS (Metal) on Mac
MODEL_NAME=microsoft/phi-3.5-vision-instruct
DEVICE=mps
TRANSFORMERS_CACHE=./llm_service/models
```

### 3. Start Services

**Terminal 1 - LLM Service:**
```bash
cd llm_service
source venv/bin/activate
python main.py
```

You should see:
```
🍎 Using Apple Metal Performance Shaders (MPS)
[LLM] Loading model: microsoft/phi-3.5-vision-instruct
[LLM] Device: mps
[LLM] Apple Silicon GPU detected (MPS)
[LLM] Model loaded successfully on mps
✅ Model ready for inference
INFO:     Uvicorn running on http://0.0.0.0:8001
```

**Terminal 2 - Backend:**
```bash
cd backend
npm start
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm run dev
```

**Terminal 4 - OCR Service (if needed):**
```bash
cd ocr_service
docker-compose up -d
```

### 4. Test It

Open browser: http://localhost:5173

Upload a test document and check for:
- Dual-engine results with agreement score
- Conflict resolution display
- Decision tree routing

---

## Performance on Mac M4

### Expected Performance

| Component | Time | Notes |
|-----------|------|-------|
| OCR | 2-5s | PaddleOCR (unchanged) |
| LLM | 15-25s | Phi-3.5 Vision on MPS |
| Merge | <1s | Conflict resolution |
| **Total** | **15-30s** | Still faster than manual review! |

### Model Size & Memory

- **Model Download**: ~5GB (first run only)
- **RAM Usage**: ~8-12GB
- **GPU Memory**: ~6GB (unified memory)

Your M4 chip with unified memory architecture handles this well!

### Optimization Tips

1. **Close other GPU-intensive apps** (Chrome with many tabs, Final Cut, etc.)
2. **Use smaller model if needed**:
   ```bash
   MODEL_NAME=microsoft/phi-3-vision-128k-instruct  # Smaller, faster
   ```
3. **Increase swap if low memory**:
   ```bash
   # Check memory: Activity Monitor > Memory tab
   ```

---

## Troubleshooting

### "MPS backend not available"

**Solution**: Make sure you're on macOS 12.3+ with Apple Silicon

```bash
# Check architecture
uname -m  # Should show "arm64"

# Check macOS version
sw_vers  # Should be 12.3 or higher
```

### "Out of memory" errors

**Solution**: Reduce model precision or batch size

Edit `llm_service/main.py`:
```python
# Change from float16 to float32 (uses more RAM but more stable)
torch_dtype=torch.float32
```

Or use a smaller model:
```bash
MODEL_NAME=microsoft/phi-3-vision-128k-instruct
```

### Slow inference (>60s per document)

**Possible causes**:
1. Model running on CPU instead of MPS
2. Other apps using GPU
3. Thermal throttling

**Check device**:
```bash
curl http://localhost:8001/
```

Should show:
```json
{
  "device": "mps",
  "mps_available": true
}
```

If showing `"device": "cpu"`, MPS isn't working. Check Python version (need 3.10+) and PyTorch version.

### Model download fails

**Solution**: Download manually

```bash
cd llm_service
source venv/bin/activate
python3
```

```python
from transformers import AutoModelForVision2Seq, AutoProcessor
model_name = "microsoft/phi-3.5-vision-instruct"
processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForVision2Seq.from_pretrained(model_name, trust_remote_code=True)
print("✅ Downloaded!")
```

---

## Docker Alternative (Not Recommended for Mac)

Docker on Mac uses emulation and doesn't support MPS acceleration. **Native installation is 3-5x faster.**

If you still want Docker:

```bash
# This will run on CPU (slow)
docker-compose up -d

# Edit docker-compose.yml to remove GPU requirements:
# Remove the entire "deploy.resources.reservations" section
```

---

## Comparison: Mac vs Linux/Windows

| Feature | Mac M4 (MPS) | Linux/Windows (CUDA) |
|---------|--------------|----------------------|
| GPU API | Metal | NVIDIA CUDA |
| Setup | Native Python | Docker or native |
| Performance | 15-25s | 10-15s |
| Cost | $0 (built-in) | Need NVIDIA GPU |
| Installation | Easier | More complex |

Your M4 is perfect for development and testing! For production with high volume, consider a Linux server with NVIDIA GPU.

---

## Next Steps

1. ✅ Run `./setup-mac.sh`
2. ✅ Start all services (see above)
3. ✅ Upload test documents
4. ✅ Review agreement scores and conflicts
5. ✅ Tune conflict resolution thresholds

---

## Additional Resources

- **PyTorch MPS**: https://pytorch.org/docs/stable/notes/mps.html
- **Apple ML Compute**: https://developer.apple.com/metal/pytorch/
- **Model Hub**: https://huggingface.co/microsoft/phi-3.5-vision-instruct

---

**Questions?** Check [DUAL_ENGINE_README.md](./DUAL_ENGINE_README.md) for architecture details or [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for full overview.
