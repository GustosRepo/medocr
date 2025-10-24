# OCR Test Data

This directory contains test files for OCR benchmarking.

## Structure

For each test file, you can optionally provide a ground truth text file:
- `sample.pdf` → `sample.txt` (ground truth)
- `referral_001.pdf` → `referral_001.txt` (ground truth)

The benchmark script will automatically detect and use ground truth files to compute accuracy metrics (CER, WER).

## Adding Test Files

1. **Copy test PDFs** to this directory:
   ```bash
   cp path/to/your/test_referral.pdf test_data/
   ```

2. **Create ground truth** (optional but recommended):
   ```bash
   # Manually transcribe the PDF text into a .txt file
   # Example: test_referral.txt
   ```

3. **Run benchmark**:
   ```bash
   cd ocr_service
   source .venv/bin/activate
   python benchmark.py --test-dir test_data --output baseline_results.json
   ```

## Sample Ground Truth Format

Ground truth files should be plain text files containing the expected OCR output:

```
Patient Name: John Doe
Date of Birth: 01/15/1980
Insurance: Blue Cross Blue Shield
Member ID: 123456789

Referring Provider: Dr. Jane Smith, MD
Provider Phone: (555) 123-4567

Procedure Requested: Home Sleep Study (95800)
...
```

## Benchmark Workflow

1. **Establish Baseline** (before changes):
   ```bash
   python benchmark.py --test-dir test_data --output baseline.json
   ```

2. **Make OCR improvements** (e.g., add CLAHE, upgrade models)

3. **Run comparison**:
   ```bash
   python benchmark.py --test-dir test_data --output improved.json
   ```

4. **Compare results**:
   - Character accuracy improvement
   - Throughput gains
   - Confidence score changes
   - Low-confidence line reduction

## Quick Test (Single File)

```bash
python benchmark.py --single test_data/sample.pdf --ground-truth test_data/sample.txt
```

## Expected Baseline Metrics (v1.3.24 RapidOCR)

Target metrics to beat:
- **Throughput:** ~1-2 pages/sec (CPU)
- **Avg Confidence:** 0.75-0.85
- **Low Confidence Rate:** 15-25% (lines < 0.65)
- **Character Accuracy:** 85-95% (with ground truth)

After PP-OCRv4 + CLAHE improvements:
- **Throughput:** 2-10x faster (with batching/GPU)
- **Avg Confidence:** +5-10% improvement
- **Low Confidence Rate:** <10%
- **Character Accuracy:** >95%
