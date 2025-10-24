# PP-OCRv4 Model Setup Guide

## ⚠️ Important: Model Format Compatibility

**RapidOCR requires ONNX format models**, but PaddleOCR distributes models in PaddlePaddle format (`.pdmodel`, `.pdiparams`).

### Current Status

✅ **Infrastructure ready** - Code supports custom model paths  
❌ **Models require conversion** - Downloaded models are in PaddlePaddle format  

### Option 1: Convert PaddlePaddle → ONNX (Recommended for production)

**Requirements:**
```bash
pip install paddle2onnx paddlepaddle
```

**Conversion Steps:**
```bash
# Detection model
paddle2onnx \
  --model_dir models/ch_PP-OCRv4_det_server/ch_PP-OCRv4_det_server_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file models/ch_PP-OCRv4_det_server_infer.onnx \
  --opset_version 11

# Recognition model  
paddle2onnx \
  --model_dir models/ch_PP-OCRv4_rec_server/ch_PP-OCRv4_rec_server_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file models/ch_PP-OCRv4_rec_server_infer.onnx \
  --opset_version 11

# Classification model
paddle2onnx \
  --model_dir models/ch_ppocr_mobile_v2.0_cls/ch_ppocr_mobile_v2.0_cls_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file models/ch_ppocr_mobile_v2.0_cls_infer.onnx \
  --opset_version 11
```

**Then enable in docker-compose.yml:**
```yaml
environment:
  - MEDOCR_DET_MODEL_PATH=/app/models/ch_PP-OCRv4_det_server_infer.onnx
  - MEDOCR_CLS_MODEL_PATH=/app/models/ch_ppocr_mobile_v2.0_cls_infer.onnx
  - MEDOCR_REC_MODEL_PATH=/app/models/ch_PP-OCRv4_rec_server_infer.onnx
```

### Option 2: Use RapidOCR Default Models (Current Setup)

**No action needed** - RapidOCR ships with bundled PP-OCRv3 lite ONNX models.

**Pros:**
- ✅ No conversion needed
- ✅ Smaller model size (~10MB vs ~200MB)
- ✅ Faster inference

**Cons:**
- ❌ Lower accuracy (~5-10% worse than PP-OCRv4 server models)
- ❌ Struggles with low-quality scans

**Current default:** PP-OCRv3 lite (bundled with `rapidocr-onnxruntime==1.3.24`)

---

## Alternative: Pre-Converted ONNX Models

Some community repositories may have pre-converted ONNX models:
- https://github.com/RapidAI/RapidOCR (check releases for ONNX models)
- https://huggingface.co/ (search for "ppocr onnx")

---

## Model Comparison

| Model | Size | Format | Accuracy | Speed | Status |
|-------|------|--------|----------|-------|--------|
| PP-OCRv3 lite | ~10MB | ONNX | Good | Fast | ✅ Active (default) |
| PP-OCRv4 server | ~200MB | PaddlePaddle | Excellent | Slower | ⚠️ Requires conversion |
| PP-OCRv4 server | ~200MB | ONNX (converted) | Excellent | Slower | ❌ Not yet available |

---

## Testing Current Setup (PP-OCRv3 Lite)

The enhancements (CLAHE, confidence retry) work with **any model**:

```bash
cd ocr_service
source .venv/bin/activate

# Test with current PP-OCRv3 lite models
python benchmark.py --single test_data/smoke_test.png --ground-truth test_data/smoke_test.txt

# Results with CLAHE + confidence retry:
# Character Accuracy: 88.2%
# Avg Confidence: 0.978
```

---

## Recommendation

**For now: Use PP-OCRv3 lite (current default)**

The other enhancements (CLAHE, confidence retry) provide measurable improvements **without** needing PP-OCRv4:
- CLAHE: +0.7% accuracy
- Confidence retry: Reduces low-confidence lines
- Both work with existing models

**When needed: Convert to ONNX**

If accuracy on real medical faxes is insufficient after testing with PP-OCRv3 + enhancements, then invest time in ONNX conversion.

---

## Next Steps

1. **Test with real PDFs** using current PP-OCRv3 + CLAHE + retry:
   ```bash
   cp ~/path/to/real_fax.pdf test_data/
   python benchmark.py --test-dir test_data
   ```

2. **Measure gap** - If accuracy < 90%, consider PP-OCRv4 conversion

3. **Convert models** - Only if needed based on real-world results

---

**Bottom line:** Infrastructure is ready. PP-OCRv4 models are **optional optimization**, not required for production use.
