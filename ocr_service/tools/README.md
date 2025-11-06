# OCR Testing Tools

## collect_and_report.py

Automated script to run benchmarks, collect OCR outputs, and package everything into a shareable troubleshooting report.

### Quick Start

1. **Prepare your test data:**
   ```bash
   # Place test images/PDFs in:
   ocr_service/test_data/inputs/
   
   # Place corresponding ground truth text files in:
   ocr_service/test_data/gt/
   # (named exactly like: foo.png → foo.txt)
   ```

2. **Run the collector:**
   ```bash
   cd ocr_service
   source .venv/bin/activate
   python tools/collect_and_report.py --test-dir test_data --top-n 10
   ```

3. **Get your report:**
   ```bash
   # Output: test_data/report.zip
   # This file contains everything needed for troubleshooting
   ```

### What's Included in the Report

- **results.json**: Full benchmark metrics (CER/WER per file, averages, throughput)
- **worst_cases/**: Top N files with highest error rates
  - Original input files
  - Ground truth `.txt` files
  - Raw OCR JSON outputs with confidences and bounding boxes
- **ocr_outputs/**: All raw OCR JSON responses for every test file
- **ocr_service.log**: Last 200 lines of the OCR service log
- **summary.txt**: Human-readable overview of results and worst cases

### Options

```bash
# Collect top 20 worst cases instead of 10
python tools/collect_and_report.py --top-n 20

# Skip re-running benchmark (use existing results.json)
python tools/collect_and_report.py --skip-benchmark

# Skip collecting raw outputs (use existing ocr_outputs/)
python tools/collect_and_report.py --skip-raw-outputs

# Custom test directory
python tools/collect_and_report.py --test-dir my_tests
```

### Example Workflow

```bash
# Make sure OCR service is running
npm run dev:all  # or just start OCR service

# In another terminal:
cd ocr_service
source .venv/bin/activate

# Run the collector
python tools/collect_and_report.py --test-dir test_data --top-n 15

# The report.zip is now ready at test_data/report.zip
# Share this file for troubleshooting
```

### What to Look For in Results

- **High CER/WER**: Character/Word Error Rate - lower is better
- **Low confidence scores**: In `worst_cases/*_ocr.json` files - indicates uncertain recognition
- **Merged/split lines**: Check bounding boxes in OCR JSON
- **Consistent patterns**: Numbers, names, dates, small fonts - suggests targeted fixes needed
- **Preprocessing artifacts**: If text is faded or low contrast, CLAHE preprocessing helps

### Tips

- Start with 5-10 representative test cases to iterate quickly
- Include a mix: clean scans, faded faxes, handwriting, small text, rotated pages
- Name your test files descriptively: `faded_patient_form.png`, `rotated_referral.pdf`
- Ground truth should be UTF-8 plain text with the exact expected output
