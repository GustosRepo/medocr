# OCR Codebase Map
**Created:** ocr-enhancements branch  
**Purpose:** Surgical reference for OCR pipeline improvements (Prompts #2-#10)

---

## 1. RapidOCR Engine Initialization & Configuration

### Primary OCR Service: `ocr_service/app.py`

**Engine Loading:**
- **Lines 11-15:** RapidOCR import with fallback handling
  ```python
  from rapidocr_onnxruntime import RapidOCR  # type: ignore
  _rapid_available = True
  ```
  
- **Lines 97-103:** Startup event - warm engine initialization
  ```python
  @app.on_event("startup")
  def _load_engine():
      global _rapid_engine
      if _rapid_available:
          try:
              _rapid_engine = RapidOCR()  # 👈 MODEL LOADED HERE
  ```

- **Lines 151-154:** Engine retrieval in OCR endpoint
  ```python
  engine = globals().get('_rapid_engine') or (RapidOCR() if _rapid_available else None)
  ```

**Current Configuration:**
- 📦 **Dependency:** `rapidocr-onnxruntime==1.3.24` (requirements.txt line 6)
- 🧠 **Models:** Default bundled ONNX weights (likely PP-OCRv3 lite)
  - Detection model (text region detection)
  - Angle classification model (rotation correction)
  - Recognition model (text extraction)
- ⚙️ **Runtime:** ONNX Runtime CPU backend (no GPU acceleration)
- 📝 **No explicit model path configuration** - uses package defaults

**Improvement Targets:**
- ✅ Add explicit model path configuration for PP-OCRv4 server models (Prompt #2)
- ✅ Add GPU inference support via `use_cuda` parameter (Prompt #2)
- ✅ Add confidence threshold configuration (Prompt #4)
- ✅ Add batch processing capability (Prompt #5)

---

## 2. PDF Rendering (pdf2image)

### PDF to Image Conversion: `ocr_service/app.py`

**Lines 123-142:** PDF rendering with adaptive downsampling
```python
base_dpi = int(os.getenv('MEDOCR_RENDER_DPI', '300'))  # Line 123
images: List = convert_from_bytes(data, dpi=base_dpi, fmt='png')  # Line 124

# Adaptive downsampling for large documents
threshold = int(os.getenv('MEDOCR_DOWNSAMPLE_PAGES', '6'))       # Line 128
high_threshold = int(os.getenv('MEDOCR_DOWNSAMPLE_PAGES_HIGH', '10'))
scale_primary = float(os.getenv('MEDOCR_DOWNSAMPLE_SCALE', '0.6'))     # Line 130
scale_secondary = float(os.getenv('MEDOCR_DOWNSAMPLE_SCALE_HIGH', '0.5'))

if page_count >= high_threshold:
    scale = scale_secondary  # 50% for 10+ pages
elif page_count >= threshold:
    scale = scale_primary    # 60% for 6-9 pages
```

**Environment Variables:**
- `MEDOCR_RENDER_DPI` (default: 300) - Base rendering resolution
- `MEDOCR_DOWNSAMPLE_PAGES` (default: 6) - Page threshold for primary downsampling
- `MEDOCR_DOWNSAMPLE_PAGES_HIGH` (default: 10) - Page threshold for aggressive downsampling
- `MEDOCR_DOWNSAMPLE_SCALE` (default: 0.6) - Primary downsampling ratio
- `MEDOCR_DOWNSAMPLE_SCALE_HIGH` (default: 0.5) - Aggressive downsampling ratio

**Improvement Targets:**
- ⚠️ Consider impact of downsampling on OCR accuracy
- ✅ Benchmark optimal DPI settings for PP-OCRv4 (Prompt #8)

---

## 3. Preprocessing Pipeline

### Image Preprocessing: `ocr_service/app.py`

**Lines 48-91:** `preprocess_image()` function - complete preprocessing pipeline

**Mode Control:**
- **Line 50:** `mode = os.getenv("MEDOCR_PREPROCESS_MODE", "enhanced").lower()`
  - `"off"` - No preprocessing (RGB conversion only)
  - `"basic"` - Grayscale + autocontrast + light sharpening (no OpenCV)
  - `"enhanced"` - Full pipeline (default, requires OpenCV)

**Basic Mode (Lines 54-59):**
```python
gray = ImageOps.grayscale(image)
gray = ImageOps.autocontrast(gray, cutoff=2)
if mode == "basic":
    enhanced = gray.filter(ImageFilter.UnsharpMask(radius=1.3, percent=120, threshold=5))
    return enhanced.convert('RGB')
```

**Enhanced Mode Pipeline (Lines 61-87):**
1. **Grayscale + Autocontrast** (Lines 54-55)
2. **Gaussian Blur** (Line 62):
   ```python
   blurred = cv2.GaussianBlur(np_img, (5, 5), 0)
   ```
3. **Deskew** (Line 63) - calls `_deskew()` function:
   - **Lines 27-46:** Angle detection via `cv2.minAreaRect()`
   - Angle constraints: 1.5° < |angle| < 25° (Line 40)
   - Uses `cv2.warpAffine()` with `INTER_CUBIC` interpolation
4. **Adaptive Threshold** (Lines 65-71):
   ```python
   binary = cv2.adaptiveThreshold(
       deskewed, 255,
       cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
       cv2.THRESH_BINARY,
       21,  # Block size
       7,   # Constant subtracted from mean
   )
   ```
5. **Morphological Closing** (Lines 72-73):
   ```python
   kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
   refined = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
   ```

**Debug Output:**
- **Lines 78-86:** Save preprocessed images to `MEDOCR_PREPROC_DEBUG_DIR` if set

**Improvement Targets:**
- ✅ Add CLAHE (Contrast Limited Adaptive Histogram Equalization) stage (Prompt #3)
- ✅ Add bilateral filtering for noise reduction (Prompt #3)
- ✅ Add preprocessing variants for low-confidence retry (Prompt #4)
- ✅ Make CLAHE/bilateral configurable via env vars (Prompt #3)

---

## 4. OCR Inference (RapidOCR)

### OCR Execution: `ocr_service/app.py`

**Lines 147-218:** Main OCR loop per page

**Inference Call (Line 163-166):**
```python
for i, img in enumerate(images):
    processed_img = preprocess_image(img)  # Apply preprocessing
    try:
        result, _ = engine(processed_img)   # 👈 RAPIDOCR INFERENCE
    except Exception as e:
        result = []
```

**Output Format Parsing (Lines 167-208):**
RapidOCR returns: `result, elapse = engine(img)`
- `result` is list of detections: `[[box, text, score], ...]` or `[[text, score, box], ...]`
- Handles both format variants (Lines 173-191)

**Box Format Conversion:**
- **Lines 154-160:** `quad_to_bbox()` - converts 4-point quadrilateral to [x, y, w, h] bbox
- Input: `[[x1,y1], [x2,y2], [x3,y3], [x4,y4]]`
- Output: `[x_min, y_min, width, height]`

**Response Structure (Lines 210-217):**
```python
pages.append({
    "page": i + 1,
    "text": page_text,      # Joined lines
    "boxes": [              # Per-detection metadata
        {"bbox": [x,y,w,h], "text": str, "conf": float},
        ...
    ]
})
```

**Improvement Targets:**
- ✅ Add batch recognition for multiple crops (Prompt #5)
- ✅ Add confidence-based retry logic (Prompt #4)
- ✅ Add per-line confidence thresholds (Prompt #4)

---

## 5. Backend Orchestration

### Document Processing Queue: `backend/server.js`

**Concurrency Control (Lines 126-147):**
```javascript
const OCR_MAX_CONCURRENCY = parseInt(process.env.OCR_MAX_CONCURRENCY || '4', 10);  // Line 126
let ocrInFlight = 0;
const ocrQueue = [];

function scheduleOcr(fn) {  // Line 129
  return new Promise((resolve, reject) => {
    const task = async () => {
      try {
        ocrInFlight++;
        resolve(await fn());
      } catch (e) { reject(e); }
      finally {
        ocrInFlight--;
        if (ocrQueue.length) {
          const next = ocrQueue.shift();
          setTimeout(next, 0);
        }
      }
    };
    if (ocrInFlight < OCR_MAX_CONCURRENCY) {
      task();
    } else {
      ocrQueue.push(() => { task(); });
    }
  });
}
```

**Environment Variables:**
- `OCR_MAX_CONCURRENCY` (default: 4) - Max parallel OCR requests
- `DOC_MAX_CONCURRENCY` (default: 5) - Max parallel document processing jobs
- `OCR_TIMEOUT_MS` (default: 60000) - OCR request timeout in milliseconds

**OCR Service Call (Lines 925-949 in processDocument):**
```javascript
const resp = await scheduleOcr(() => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), ocrTimeoutMsConfig);
  const serviceUrl = nextOcrServiceUrl();
  return fetch(`${serviceUrl.replace(/\/$/, '')}/ocr`, {
    method: 'POST',
    body: form,  // FormData with PDF blob
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutHandle));
});
```

**Load Balancing:**
- **Lines 83-93:** Multiple OCR service URLs via `OCR_SERVICE_URLS` (comma-separated)
- Round-robin selection via `nextOcrServiceUrl()` function

**Improvement Targets:**
- ✅ Add retry logic with exponential backoff (Prompt #10)
- ✅ Add circuit breaker for failing OCR services (Prompt #10)
- ✅ Add detailed OCR telemetry (queue wait, inference time) (Prompt #8)

---

## 6. Post-Processing (Rules Engine)

### Field Extraction: `backend/rules/index.js`

**Main Extraction Function (Lines 93-100):**
```javascript
export function runExtraction(ocrPages) {
  const { fullText, lines } = normalizePages(ocrPages);
  const patternOverrides = getPatternOverrides();
  // ... builds regex patterns from config ...
```

**Extraction Modules:**
1. **Patient Detection:** `detectName()`, `detectDob()`, `detectPhones()` (patient.js)
2. **Procedure Codes:** `detectCpt()` (cpt.js)
3. **Diagnosis Codes:** `detectICDs()` (icd.js)
4. **Insurance:** `detectCarrier()` (carriers.js)
5. **Dates:** `detectDates()` (date.js)
6. **DME:** `detectDME()` (dme.js)

**Pattern Configuration:**
- **Lines 18-21:** `getPatternOverrides()` loads `pattern_overrides.json`
- **Lines 35-43:** Default provider name patterns (regex strings)
- **Lines 59-69:** Default provider credential patterns (MD, DO, NP, etc.)

**Confidence Scoring:**
- Implemented via field coverage heuristics
- Not currently exposed in main extraction flow
- Potential integration point for OCR confidence scores

**Improvement Targets:**
- ✅ Integrate OCR box confidence into extraction scoring (Prompt #4)
- ✅ Add field-level confidence thresholds (Prompt #4)
- ✅ Use box coordinates for spatial validation (future enhancement)

---

## 7. Upload & Size Limits

### Upload Configuration: `backend/server.js`

**Lines 67-76:** Multer upload configuration
```javascript
const uploadDir = path.join(process.cwd(), 'data', 'uploads');
const uploadLimits = (() => {
  const raw = process.env.UPLOAD_MAX_BYTES || '';
  const n = parseInt(raw || '0', 10);
  if (Number.isFinite(n) && n > 0) return { fileSize: n };
  return undefined;
})();
const upload = uploadLimits
  ? multer({ dest: uploadDir, limits: uploadLimits })
  : multer({ dest: uploadDir });
```

**Nginx Upload Limit:** `frontend/nginx.conf`
```nginx
client_max_body_size 50M;  # Line 12
```

**Environment Variables:**
- `UPLOAD_MAX_BYTES` - Backend upload limit (optional, defaults to multer's default)
- `MAX_PDF_PAGES` (default: 150) - Maximum allowed pages per document

**Improvement Targets:**
- ✅ Add upload size validation with user-friendly errors (Prompt #10)
- ✅ Add page count warnings before processing (Prompt #10)

---

## 8. Timeout & Rate Limiting

### Timeouts: `backend/server.js`

**OCR Timeout:**
- **Line 902:** `const ocrTimeoutMsConfig = parseInt(process.env.OCR_TIMEOUT_MS || '60000', 10);`
- **Line 927:** Timeout starts **after** acquiring concurrency slot (fixed in v1.0.2)

**Rate Limiting:**
- **Lines 51-57:** Sliding window rate limiter
```javascript
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || '60000', 10);
const RATE_MAX = parseInt(process.env.RATE_MAX || '120', 10);  // Increased to 500 in production
```

**Environment Variables:**
- `OCR_TIMEOUT_MS` (default: 60000) - 60 seconds, increased to 900000 (15 min) in production
- `RATE_WINDOW_MS` (default: 60000) - Rate limit window
- `RATE_MAX` (default: 120) - Max requests per window (production: 500)

**Improvement Targets:**
- ✅ Add per-page timeout estimation based on page count (Prompt #10)
- ✅ Add graceful timeout handling with partial results (Prompt #10)

---

## 9. Dependencies & Package Management

### Python Dependencies: `ocr_service/requirements.txt`

**Current Versions:**
```plaintext
fastapi==0.115.0
uvicorn[standard]==0.30.6
pillow==10.4.0
pdf2image==1.17.0
numpy==1.26.4
rapidocr-onnxruntime==1.3.24     # 👈 PRIMARY OCR ENGINE
opencv-python-headless==4.10.0.84  # 👈 PREPROCESSING
python-multipart==0.0.9
```

**System Dependencies:**
- Poppler (required by pdf2image)
- ONNX Runtime (bundled with rapidocr-onnxruntime)

**Upgrade Targets:**
- ✅ Pin to specific PP-OCRv4 model versions (Prompt #2)
- ✅ Add explicit ONNX Runtime GPU package if GPU support added (Prompt #2)
- ⚠️ Test opencv-python compatibility with CLAHE (should be compatible)

---

## 10. Benchmarking & Telemetry

### Current Metrics: `backend/metrics/store.js`

**Available Metrics (imported in server.js lines 10-11):**
- `incCounter(name)` - Increment counter
- `recordLatency(ms)` - Record processing time
- `recordConfidence(score)` - Record confidence scores
- `recordConcurrency(n)` - Record concurrent OCR jobs
- `recordOcrQueueDepth(n)` - Record queue depth

**Logged Counters:**
- `docsProcessed`, `docsErrored`, `ocrFailures`
- `ocrQueueWaitSamples` - Queue wait time samples
- `ocrQueueWait_lt1s`, `ocrQueueWait_lt5s`, `ocrQueueWait_lt15s`, `ocrQueueWait_ge15s`

**Missing Metrics:**
- ❌ Per-page OCR inference time
- ❌ Per-page average confidence
- ❌ Preprocessing time breakdown
- ❌ Retry counts and success rates
- ❌ Model version/variant used

**Improvement Targets:**
- ✅ Create dedicated benchmarking script (Prompt #8)
- ✅ Add detailed OCR telemetry (Prompt #8)
- ✅ Add ground truth comparison framework (Prompt #8)

---

## Quick Reference: Critical File Paths

### OCR Core
- **Engine:** `ocr_service/app.py` (218 lines)
  - Models: Lines 97-103 (initialization)
  - Preprocessing: Lines 48-91
  - Inference: Lines 147-218
  
### Backend Orchestration
- **Queue:** `backend/server.js` (1161 lines)
  - Concurrency: Lines 126-147
  - OCR Call: Lines 925-949
  - Document Processing: Lines 901-1050

### Rules & Extraction
- **Main:** `backend/rules/index.js` (1385 lines)
  - Entry: Lines 93-100 (`runExtraction()`)
  - Patterns: Lines 18-69

### Configuration
- **Python Deps:** `ocr_service/requirements.txt` (9 lines)
- **Env Template:** `.env.example` (if exists) or `docker-compose.yml`

---

## Next Actions (Per Enhancement Roadmap)

**Ready to Execute:**
1. ✅ **Prompt #2:** Upgrade to PP-OCRv4 server models
   - Modify: `ocr_service/app.py` lines 97-103 (add model paths)
   - Add env vars: `MEDOCR_DET_MODEL_PATH`, `MEDOCR_CLS_MODEL_PATH`, `MEDOCR_REC_MODEL_PATH`
   
2. ✅ **Prompt #3:** Add CLAHE preprocessing
   - Modify: `ocr_service/app.py` lines 61-87 (insert CLAHE stage)
   - Add env vars: `MEDOCR_USE_CLAHE`, `MEDOCR_USE_BILATERAL`
   
3. ✅ **Prompt #4:** Implement confidence-based retry
   - Modify: `ocr_service/app.py` lines 163-208 (add retry logic)
   - Add env var: `MEDOCR_CONFIDENCE_THRESHOLD`
   
4. ✅ **Prompt #5:** Add batch recognition
   - Modify: `ocr_service/app.py` lines 163-166 (batch multiple images)
   - Add env var: `MEDOCR_BATCH_SIZE`
   
5. ✅ **Prompt #8:** Create benchmark harness
   - New file: `ocr_service/benchmark.py`
   - Measure: Current baseline before changes

---

**End of OCR Codebase Map**  
Branch: `ocr-enhancements` | Date: 2024 | Status: Ready for surgical edits
