# Medical OCR Worker

## Directory Structure

### Core System Files
- `semantic_template_mapper.py` - Advanced semantic extraction with contextual pattern matching
- `enhanced_extract.py` - Main extraction pipeline integrating semantic and legacy methods
- `backend_integration.py` - Integration layer for Node.js backend
- `ocr_preprocessing.py` - OCR text preprocessing and correction
- `flag_rules.py` - Quality control and intelligent flagging system
- `main.py` - CLI interface for direct processing

### Configuration
- `config/` - Configuration files and schemas
  - `flags_catalog.json` - Flag definitions and routing rules
  - `patient_form.schema.json` - Form validation schema
  - `rules/` - Pattern matching rules and templates

### Test Data
- `test_data/` - Sample images and test files
  - `Patient_Referral_pic.png` - Real medical form for testing

### Environment
- `.venv/` - Python virtual environment
- `requirements.txt` - Python dependencies
- `package.json` - Node.js dependencies (if needed)

## Usage

### Semantic Extraction (Primary Method)
```python
from semantic_template_mapper import SemanticTemplateMapper

mapper = SemanticTemplateMapper()
result = mapper.extract_with_context(ocr_text)
# Returns: {extracted_data, confidence_scores, overall_confidence, extraction_method}
```

### Full Pipeline
```python
from enhanced_extract import analyze_medical_form

result = analyze_medical_form(ocr_text, ocr_confidence)
# Returns complete structured medical form data
```

### Backend Integration
```python
from backend_integration import process_ocr_result

result = process_ocr_result(image_path, ocr_text, confidence)
# Handles full pipeline from OCR to structured output
```

## Features

- **Semantic Template Mapping**: 85%+ confidence on real medical forms
- **Contextual Pattern Matching**: Understands formal medical document structures
- **Quality Control**: Intelligent flagging and confidence scoring
- **Medical Specialization**: Optimized for sleep medicine and general referrals
- **Error Correction**: OCR text preprocessing and correction
- **Flexible Architecture**: Supports both semantic and legacy extraction methods

## PDF Ingestion

- Image-first OCR remains the core. PDF files are supported by rasterizing pages to images (via `pdf2image`) and running the same preprocessing + OCR pipeline.
- Defaults: `OCR_PDF_DPI=200` and `OCR_PDF_MAX_PAGES=3` (env vars). Adjust for quality vs speed.
- Dependencies: install `pdf2image` and `PyPDF2`. For `pdf2image`, ensure Poppler is available on your system (e.g., macOS via `brew install poppler`, Ubuntu via `apt-get install poppler-utils`).

### Quick Start

- CLI automatically handles `.pdf` inputs:
  - `python3 main.py /path/to/file.pdf` (adds page labels and aggregates confidence)
- Backend already accepts `application/pdf` uploads and routes them through the same worker (`index.js`).

## Archived Files

Old test files, debug outputs, and legacy code have been moved to `../archive/old-ocr-worker/` for reference.
