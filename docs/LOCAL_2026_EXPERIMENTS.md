# Local 2026 OCR/VLM Experiments

This branch keeps the current production path intact while we test better local
engines against real referral documents.

## What We Are Testing

1. Current OCR service: RapidOCR + ONNX Runtime.
2. PaddleOCR 3.x candidate: PP-OCRv5 / PP-StructureV3 family.
3. Local VLM extraction/verification: Qwen2.5-VL 7B by default, 32B if the
   machine has enough memory.

The goal is field-level accuracy, not model-card accuracy. A candidate only wins
if it improves the fields MEDOCR actually needs: patient identifiers, insurance,
provider, CPT, ICD, dates, DME/prior-study evidence, and routing outcome.

## Gold-Set Format

Place PDFs and optional gold JSON files in `examples/benchmark/` or another
local folder:

```text
case_001.pdf
case_001.gold.json
case_002.pdf
case_002.gold.json
```

Gold JSON can contain any subset of the final app result schema. Only provided
fields are scored.

## Baseline Run

Start the current app:

```bash
npm run dev:all
```

Run the benchmark against the local backend:

```bash
node scripts/benchmark-local-extraction.mjs examples/benchmark data/benchmarks/baseline.json
```

## VLM Model Comparison

Use the same benchmark set and switch model/env before starting the backend:

```bash
VLM_MODEL=qwen2.5vl:7b npm run dev:all
node scripts/benchmark-local-extraction.mjs examples/benchmark data/benchmarks/qwen25vl-7b.json
```

If available locally and hardware can handle it:

```bash
VLM_MODEL=qwen2.5vl:32b npm run dev:all
node scripts/benchmark-local-extraction.mjs examples/benchmark data/benchmarks/qwen25vl-32b.json
```

## PaddleOCR Candidate

Install optional dependencies inside your OCR Python environment:

```bash
python -m pip install -r ocr_service/requirements.paddle.txt
```

The adapter is in `ocr_service/paddle_candidate.py`. It is not wired into
production startup yet. First use it from focused OCR/layout benchmarks so we can
prove whether it beats the existing service on real referral pages.

## Decision Rule

Do not switch production OCR just because a newer model exists. Switch only if
the same gold set shows:

- better field-level accuracy,
- no unacceptable latency increase,
- stable behavior on rotated/faxed/low-contrast documents,
- fewer manual-review failures in the checklist.

