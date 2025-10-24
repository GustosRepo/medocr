# OCR Model Formats & Upgrade Plan

**Context:** We evaluated upgrading the OCR stack to PaddleOCR v4 *server* models. The artifacts we obtained are **PaddlePaddle native formats** (`.pdmodel`, `.pdiparams`). Our current runtime (**RapidOCR + ONNX Runtime, CPU-only**) expects **ONNX** models, not native Paddle formats.

---

## Current State (Production)

- **Engine:** RapidOCR `rapidocr-onnxruntime`
- **Models:** Bundled RapidOCR ONNX weights (detection + angle classification + recognition), likely PP-OCRv3 lite
- **Infra:** Containerized FastAPI OCR service, concurrency controls in place
- **Preproc:** Grayscale → deskew → adaptive threshold → morphology
- **Postproc:** Regex-based extraction, confidence scoring, date rules
- **Why it works:** Zero Paddle dependency; light footprint; predictable CPU performance

---

## Problem Statement

- PaddleOCR model files we have are in **Paddle formats**: `*.pdmodel` + `*.pdiparams`
- **RapidOCR requires ONNX**. It **cannot load** `.pdmodel/.pdiparams` directly.
- Converting Paddle → ONNX requires **`paddle2onnx`** and **shape/op set alignment** work (non-trivial, test-heavy).

---

## Options Considered

### Option A — Convert Paddle models to ONNX (deferred)
- **What:** Use `paddle2onnx` to export `det/cls/rec` to `*.onnx`, validate with ONNX Runtime
- **Pros:** Access to **PP-OCRv4 server** accuracy while staying in RapidOCR/ONNXRuntime
- **Cons:** Conversion friction (dynamic shapes, opset versions, custom ops), regression validation required
- **Status:** **Out of scope for this iteration**; keep infra ready

### Option B — Use RapidOCR’s built-in ONNX models (current)
- **What:** Keep RapidOCR’s default ONNX models (PP-OCRv3 lite class), or upgrade to **RapidOCR-provided ONNX v4** if/when available
- **Pros:** Plug-and-play, stable, no dependency changes
- **Cons:** Slightly lower accuracy than PP-OCRv4 server; still acceptable with good preprocessing
- **Status:** **Chosen for now**

### Option C — Hybrid: Run Paddle sidecar for complex pages (future)
- **What:** Keep RapidOCR for standard pages; invoke **PaddleOCR (PP-Structure / v4 server)** in a separate container for tables/forms/low-confidence pages
- **Pros:** Best-of-both (accuracy where needed), isolates heavy deps
- **Cons:** Extra service to operate; routing logic; GPU optional for throughput
- **Status:** Candidate for Phase 2

---

## Immediate Actions (this PR)

- ✅ Documented model format mismatch and constraints
- ✅ Kept RapidOCR as primary engine (ONNX Runtime)
- ✅ Preserved configuration hooks for external model paths (env: `OCR_DET_MODEL`, `OCR_REC_MODEL`, `OCR_CLS_MODEL`) in case we drop-in ONNX v4 later
- ✅ Added preprocessing feature flags (CLAHE/bilateral) to stabilize faint scans (if implemented in this branch)
- ✅ Left room for confidence-based retry / batch rec (if implemented)

---

## Future Work (Backlog)

1. **Paddle → ONNX conversion spike**
   - Try `paddle2onnx` for `ppocrv4_det_server`, `ppocrv4_rec_server_en`, `ppocrv4_cls`
   - Validate with ONNX Runtime (dynamic axes, opset >= 13)
   - Build a small benchmark comparing RapidOCR default vs converted v4 server

2. **Hybrid “layout mode”**
   - Integrate **PP-Structure** for table/form pages
   - Route by heuristic (ruled lines, text density, low confidence pages)

3. **Fine-tuning (domain adaptation)**
   - Label 500–2k cropped text lines from our PDFs
   - Fine-tune recognizer, export to ONNX, drop-in to RapidOCR

4. **Performance**
   - Batch recognition (REC_BATCH=8–16)
   - Optional quantization (INT8) for detector on CPU
   - Worker pool scaling

---

## Deployment Notes

- **No runtime change** required to stay on RapidOCR defaults
- If/when ONNX v4 models are added:
  - Mount to `/models`, set:
    ```env
    OCR_DET_MODEL=/models/ppocrv4_det_server.onnx
    OCR_REC_MODEL=/models/ppocrv4_rec_server_en.onnx
    OCR_CLS_MODEL=/models/ppocrv4_cls.onnx
    ```
  - Log startup to confirm paths are picked up
- Keep `client_max_body_size 50m;` in frontend Nginx to avoid 413 on large PDFs

---

## Bottom Line

- **Now:** Stay on RapidOCR **ONNX** models (stable), improve pre/post-processing
- **Later:** Evaluate **Paddle v4 server** via **conversion to ONNX** or **sidecar** where accuracy demands it
