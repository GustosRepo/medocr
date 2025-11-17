# Upgrade Guide: v1.0.2 → v1.1.0

## 📋 Overview

Version 1.1.0 introduces the **RuleEngine system** for scalable medical document processing and **optional PP-OCRv4 models** for improved OCR accuracy.

---

## 🚀 Quick Start (Minimal Upgrade)

If you just want the new features without enhanced OCR:

```bash
# 1. Pull latest code
git fetch
git checkout v1.1.0

# 2. Install new Node.js dependencies
npm install
cd frontend && npm install && cd ..

# 3. Rebuild and restart Docker
docker compose down
docker compose build
docker compose up -d
```

**Done!** The system will use existing OCR models and all new features will work.

---

## 📦 What's Required vs Optional

| Component | Required? | Action |
|-----------|-----------|--------|
| **Node.js packages** | ✅ REQUIRED | `npm install` |
| **Docker rebuild** | ✅ REQUIRED | `docker compose build` |
| **PP-OCRv4 models** | ❌ Optional | See below for better OCR |
| **Python packages** | ❌ No changes | Already included |

---

## 🎯 Optional: Upgrade to PP-OCRv4 Models

### Why Upgrade OCR Models?

The default RapidOCR models work well, but PP-OCRv4 provides:
- **~15-20% better accuracy** on medical documents
- **Improved confidence scores** on challenging text
- **Better handling** of poor quality scans

### Model Requirements

- **Total Size**: ~194 MB (3 files)
- **Storage**: `ocr_service/models/` directory
- **Format**: ONNX (required for RapidOCR)

---

## 📥 Method 1: Download Pre-Converted Models (Recommended)

If you have access to the pre-converted ONNX models:

```bash
# 1. Create models directory
mkdir -p ocr_service/models

# 2. Copy these files into ocr_service/models/:
#    - ch_PP-OCRv4_det_server_infer.onnx (108 MB)
#    - ch_PP-OCRv4_rec_server_infer.onnx (86 MB)
#    - ch_ppocr_mobile_v2.0_cls_infer.onnx (565 KB)

# 3. Verify files exist
ls -lh ocr_service/models/*.onnx

# Should show:
# ch_PP-OCRv4_det_server_infer.onnx    (108M)
# ch_PP-OCRv4_rec_server_infer.onnx    (86M)
# ch_ppocr_mobile_v2.0_cls_infer.onnx  (565K)

# 4. Restart Docker to mount models
docker compose down
docker compose up -d
```

**That's it!** The OCR service will automatically detect and use the new models.

---

## 🔧 Method 2: Download & Convert From Scratch

If you need to download and convert the models yourself:

### Step 1: Download PaddleOCR Models

```bash
cd ocr_service

# Run the automated download script
python download_models.py --output models/

# This downloads ~300MB of PaddlePaddle format models
```

### Step 2: Install Conversion Tools

```bash
# Install paddle2onnx and paddlepaddle
pip install paddle2onnx paddlepaddle
```

### Step 3: Convert to ONNX Format

```bash
# Detection model (text box detection)
paddle2onnx \
  --model_dir models/ch_PP-OCRv4_det_server/ch_PP-OCRv4_det_server_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file models/ch_PP-OCRv4_det_server_infer.onnx \
  --opset_version 11

# Recognition model (text reading)
paddle2onnx \
  --model_dir models/ch_PP-OCRv4_rec_server/ch_PP-OCRv4_rec_server_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file models/ch_PP-OCRv4_rec_server_infer.onnx \
  --opset_version 11

# Classification model (text angle detection)
paddle2onnx \
  --model_dir models/ch_ppocr_mobile_v2.0_cls/ch_ppocr_mobile_v2.0_cls_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file models/ch_ppocr_mobile_v2.0_cls_infer.onnx \
  --opset_version 11
```

### Step 4: Verify Conversion

```bash
# Check that ONNX files were created
ls -lh models/*.onnx

# Should show all three .onnx files
```

### Step 5: Restart Services

```bash
docker compose down
docker compose up -d
```

---

## ✅ Verify Installation

### 1. Check Docker Logs

```bash
docker compose logs ocr-service | grep -i model

# Should see:
# "Using custom detection model: /app/models/ch_PP-OCRv4_det_server_infer.onnx"
# "Using custom recognition model: /app/models/ch_PP-OCRv4_rec_server_infer.onnx"
# "Using custom classification model: /app/models/ch_ppocr_mobile_v2.0_cls_infer.onnx"
```

### 2. Test OCR Endpoint

```bash
# Check OCR service health
curl http://localhost:8000/

# Should return: {"status": "ok", "version": "..."}
```

### 3. Process a Test Document

Upload a document through the web UI at `http://localhost:5173` and verify:
- ✅ Extraction completes successfully
- ✅ Confidence scores are reported
- ✅ Text accuracy is improved (if comparing to previous results)

---

## 🔄 Rollback to Default Models

If you experience issues with PP-OCRv4 models:

```bash
# 1. Remove custom models
rm -rf ocr_service/models/*.onnx

# 2. Restart services
docker compose restart ocr-service

# System will automatically fall back to bundled RapidOCR models
```

---

## 📊 Model Comparison

| Model | Size | Speed | Accuracy | Use Case |
|-------|------|-------|----------|----------|
| **RapidOCR (Default)** | ~20 MB | Fast | Good | General documents |
| **PP-OCRv4 Server** | 194 MB | Slower | Excellent | Medical/complex docs |

**Recommendation**: Use PP-OCRv4 for production medical document processing where accuracy is critical.

---

## 🆘 Troubleshooting

### Models Not Loading

**Symptom**: Docker logs show "Using bundled models" instead of custom paths

**Solution**:
```bash
# Check that models directory has correct files
ls -lh ocr_service/models/*.onnx

# Ensure Docker can access the directory
chmod -R 755 ocr_service/models/

# Rebuild and restart
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Conversion Errors

**Symptom**: `paddle2onnx` command fails

**Solution**:
```bash
# Ensure you have the right Python version (3.8+)
python --version

# Reinstall conversion tools
pip uninstall paddle2onnx paddlepaddle -y
pip install paddle2onnx paddlepaddle --upgrade
```

### Low Memory Issues

**Symptom**: Docker container crashes or OOM errors

**Solution**:
```bash
# Increase Docker memory allocation
# Docker Desktop → Settings → Resources → Memory: 8GB+

# Or edit docker-compose.yml:
services:
  ocr-service:
    deploy:
      resources:
        limits:
          memory: 4G
```

---

## 📚 Additional Resources

- **Full PP-OCRv4 Setup Guide**: See `ocr_service/PPOCR4_SETUP.md`
- **Model Download Script**: See `ocr_service/download_models.py`
- **Benchmark Results**: See `ocr_service/BASELINE_METRICS.md`

---

## 🎉 New Features in v1.1.0

Beyond OCR improvements, this release includes:

### RuleEngine System
- 93 carrier rules in individual JSON files
- 10 CPT codes + 21 ICD-10 codes
- Multi-factor scoring for member ID detection
- Hot-reload capability

### Extraction Improvements
- Provider name detection with credentials (MD, DO, NP, APRN, etc.)
- Disclaimer filtering (prevents legal text extraction)
- Enhanced member ID accuracy

### UI Enhancements
- Checklist page fully functional
- Printable view with download
- Archive/unarchive workflow

---

## 📞 Support

If you encounter issues during upgrade:

1. Check Docker logs: `docker compose logs`
2. Verify file permissions: `ls -la ocr_service/models/`
3. Review `ocr_service/PPOCR4_SETUP.md` for detailed troubleshooting
4. Check GitHub issues for known problems

---

**Last Updated**: November 16, 2025  
**Version**: 1.1.0
