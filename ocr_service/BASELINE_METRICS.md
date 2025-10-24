# OCR Baseline Metrics (Pre-Enhancement)

**Date:** October 23, 2025  
**Branch:** ocr-enhancements  
**Engine:** RapidOCR v1.3.24 (PP-OCRv3 lite models)  
**Backend:** ONNX Runtime CPU  

---

## Smoke Test Results

**Test File:** `smoke_test.png` (synthetic medical form, 800x400px)

### Performance Metrics
- **Total Time:** 433ms (433ms/page)
- **Preprocessing:** 7.2ms/page (1.7% of total)
- **Inference:** 423.2ms/page (97.7% of total)
- **Throughput:** ~2.3 pages/sec

### Quality Metrics
- **Characters Extracted:** 245
- **Lines Detected:** 9
- **Avg Confidence:** 0.983 (very high for synthetic image)
- **Min/Max Confidence:** 0.965 / 0.996
- **Low Confidence Lines:** 0/9 (0.0%)

### Accuracy Metrics (vs Ground Truth)
- **Character Accuracy:** 87.5%
- **Character Error Rate (CER):** 0.125
- **Word Error Rate (WER):** 0.125

**Note:** Synthetic test image has very clean text. Real-world faxed documents typically show:
- Lower confidence (0.75-0.85 avg)
- Higher error rates (CER ~0.15-0.25)
- More low-confidence lines (15-25%)

---

## Expected Real-World Baseline

Based on typical medical fax documents (300 DPI scans, varying quality):

| Metric | Expected Range | Target After Enhancement |
|--------|----------------|--------------------------|
| Throughput (CPU) | 1-2 pages/sec | 2-4 pages/sec |
| Throughput (GPU) | N/A | 5-15 pages/sec |
| Avg Confidence | 0.75-0.85 | 0.80-0.90 |
| Low Conf Rate | 15-25% | <10% |
| Character Accuracy | 85-95% | >95% |
| CER | 0.05-0.15 | <0.05 |

---

## Enhancement Roadmap Impact Estimates

### Prompt #3: CLAHE Preprocessing
- **Confidence:** +5-10% on low-quality scans
- **Low Conf Rate:** -30% reduction
- **Throughput:** -5% (slight overhead)
- **Risk:** Low (feature flag enabled)

### Prompt #2: PP-OCRv4 Server Models
- **Accuracy:** +10-30% character accuracy
- **Confidence:** +5-15% average confidence
- **Throughput:** +50-100% (better models + optimizations)
- **Risk:** Medium (model compatibility, file size)

### Prompt #5: Batch Recognition
- **Throughput:** +2-5x on multi-page docs
- **Latency:** Unchanged (per-page time same)
- **Risk:** Low (batching at page level)

### Prompt #4: Confidence Retry
- **Low Conf Rate:** -50% (retry catches missed text)
- **Throughput:** -10-20% (retry overhead)
- **Accuracy:** +5-10% on difficult sections
- **Risk:** Low (configurable threshold)

---

## Benchmark Command Reference

### Baseline Test (Single File)
```bash
cd ocr_service
source .venv/bin/activate
python benchmark.py --single test_data/smoke_test.png --ground-truth test_data/smoke_test.txt
```

### Full Suite (Multiple Files)
```bash
# Copy real test PDFs to test_data/
cp ~/path/to/real_referral.pdf test_data/
cp ~/path/to/real_referral.txt test_data/  # ground truth (optional)

# Run benchmark
python benchmark.py --test-dir test_data --output baseline_v1.3.24.json
```

### After Each Enhancement
```bash
# Example: After adding CLAHE
python benchmark.py --test-dir test_data --output clahe_results.json --preprocess enhanced

# Compare results
python -c "
import json
baseline = json.load(open('baseline_v1.3.24.json'))
clahe = json.load(open('clahe_results.json'))
print(f'Confidence improvement: {clahe[\"summary\"][\"avg_confidence\"] - baseline[\"summary\"][\"avg_confidence\"]:.3f}')
print(f'Throughput change: {clahe[\"summary\"][\"avg_throughput_pages_per_s\"] / baseline[\"summary\"][\"avg_throughput_pages_per_s\"]:.2f}x')
"
```

---

## Next Steps

1. ✅ **Benchmark harness created** (Prompt #8)
2. ⏭️ **Run baseline on real PDFs** (user needs to provide test files)
3. ⏭️ **Implement CLAHE** (Prompt #3) → measure impact
4. ⏭️ **Upgrade to PP-OCRv4** (Prompt #2) → measure impact
5. ⏭️ **Add confidence retry** (Prompt #4) → measure impact
6. ⏭️ **Add batch processing** (Prompt #5) → measure impact
7. 📊 **Final comparison:** Baseline vs Enhanced pipeline

---

**Status:** Ready for real-world testing. Smoke test confirms benchmark script works correctly.
