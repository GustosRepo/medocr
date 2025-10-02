# MEDOCR

Local, Electron-based referral processing for sleep study workflows. Processes scanned/faxed PDFs, extracts key data with OCR, applies conservative & auditable rules, and generates:
* Structured JSON extraction + trace
* Manual review & quality control (QC) flags
* Suggested per‑patient filename pattern
* Batch cover + problem log (JSON & PDF)
* Actionable alerts (e.g. insurance issues, wrong test, missing chart notes)
* Patient summary PDF (individual) with demographics, insurance IDs, procedure, provider, clinical, alerts, flags, confidence

Key files:
- docs/api/contracts.md — REST API contracts (Node/Express)
- docs/schema/extraction_result.schema.json — JSON Schema for OCR + extraction result
- examples/sample_extraction_result.json — Example output matching the schema

Directories:
- frontend/ — React UI (Vite)
- backend/ — Node.js + Express API + PDF report generation (pdfkit)
- backend/rules — Catalog-driven rules (CPT, ICD, carriers, DME), conservative confidence + QC
- backend/batch — Batch reporting helpers (JSON + PDF)
- ocr_service/ — Python FastAPI + RapidOCR (ONNX) OCR service
- data/ — Local storage (uploads, logs, pids)

## Run (dev)

1) API (Node/Express)
	- From repo root:
	  - `npm install`
	  - `npm run dev:api`
	- Env: `OCR_SERVICE_URL` (default `http://127.0.0.1:8000`)

2) Frontend (Vite/React)
	- `cd frontend`
	- `npm install`
	- `npm run dev` (opens http://localhost:5173 or next free port)

3) OCR Service (FastAPI)
		- `cd ocr_service`
		- Create venv, install deps (see README), then:
			- `uvicorn app:app --host 127.0.0.1 --port 8000`
		- The API posts to `/ocr`; if OCR is down, the API returns an error (no fallback).

4) One-liner (starts OCR, API, and Frontend):
		- From repo root:
			- `npm run dev:all`
		- Stop all:
			- `npm run stop:all`
		- Logs: `data/logs`; PIDs: `data/pids`

## Feature Highlights

### OCR & Extraction
* FastAPI + RapidOCR (ONNX) returns per-page `text` + `boxes[{ text, conf, bbox }]`.
* Strict failure propagation: If OCR is unreachable, API returns an error (no sample fallback).

### Rules Engine (backend/rules)
* CPT selection via regex catalog + candidates + intent reasoning (mentions vs titration indicators).
* CPT descriptions surfaced (e.g. 95811 → In-lab PAP titration / split-night polysomnography).
* ICD detection (explicit codes + keyword inference) with allowlist & alerts mapping, plus primaryDiagnosis description.
* Symptoms list (normalized labels) and vitals (BMI, BP, height, weight) extraction.
* Insurance carrier detection + policy overlay (sunsets, auto-flags, status) with memberId/groupId extraction (primary + secondary).
* DME vendor/issues detection -> review flags.
* Provider block (name, NPI, fax) + provider notes phrase normalization (e.g. urgent/stat, eval & treat, titration).
* Patient phones (primary + altPhones) with provider fax filtering.
* Info alerts: PPE requirements, safety, communication, accommodations.
* Conservative confidence mapping (High/Medium/Low → may escalate to Manual Review):
	- Low OCR signal / empty pages / low text volume
	- Mixed/contradictory symptoms
	- Complex history (multiple severe ICDs)
	- Handwriting / low confidence ratio
* Problem detection: wrong test, missing chart notes, insurance terms (inactive/expired), pediatric/DME/mobility special considerations.

### Quality Control (QC)
Exposed at `result.qc` and influences `result.flags`:
| Check | Values | Logic |
|-------|--------|-------|
| nameConsistency | pass/unknown | Finds both first + last in proximity |
| dateValidity | pass/fail/unknown | DOB strict MM/DD/YYYY |
| phoneValidity | pass/fail/unknown | 10 digits if phone-like string present |
| cptValid | pass/fail/unknown | In approved CPT set |

### Flags & Actions
* `result.flags.verifyManually` + `flags.reasons[]` list triggers.
* `result.alerts.actions[]` canonical lower-snake actions (e.g. `missing_chart_notes`, `wrong_test_ordered`, `insurance_issue`, `review_95811_required`, `special_considerations`).

### Suggested Filenames
* `documentMeta.suggestedFilename`: `Last_First_DOB_IntakeDate.pdf` (sanitized) when patient fields are known.

### Individual Patient Summary PDF
Endpoint: `GET /api/documents/:id/summary.pdf`
Sections:
1. Header (Patient, DOB, Referral Date)
2. Demographics (phones, email, emergency contact when present)
3. Insurance (Primary + optional Secondary with IDs)
4. Procedure Ordered (CPT code + description + provider notes)
5. Referring Physician (name, NPI, phone, fax)
6. Clinical Information (primary diagnosis w/ description, symptoms, vitals)
7. Information Alerts (PPE, safety, communication, accommodations)
8. Problem Flags (flags.reasons)
9. Authorization Notes (derived from actions list)
10. Confidence Level

### Batch Reporting
Batch groups by `documentMeta.intakeDate` (YYYY-MM-DD).

Endpoints:
| Purpose | Endpoint |
|---------|----------|
| List batch dates | `GET /api/batch` |
| Cover JSON | `GET /api/batch/:date/cover.json` |
| Cover PDF | `GET /api/batch/:date/cover.pdf` |
| Problem log JSON | `GET /api/batch/:date/problem-log.json` |
| Problem log PDF | `GET /api/batch/:date/problem-log.pdf` |

PDFs (pdfkit) include headers, optional logo (`BATCH_LOGO_PATH`), pagination, and simple tables.

### Frontend (frontend/src/App.jsx)
* Drag/drop or click upload.
* Displays patient, CPT (candidates + details + description), insurance (IDs), primary diagnosis (code + description), symptoms, vitals, provider notes, provider block, info alerts, QC & flags, actions, trace, full JSON.
* Batch panel lists available dates with direct links to JSON & PDF reports.
* Sample data button uses `/api/fixtures/...` for quick visualization.

## Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `OCR_SERVICE_URL` | `http://127.0.0.1:8000` | OCR service base URL |
| `OCR_TIMEOUT_MS` | `30000` | Abort OCR request after this many ms |
| `BATCH_LOGO_PATH` | (unset) | Optional PNG/JPG for PDF headers |

## Testing
Run backend tests:

```
npm test
```

What tests cover:
* Health endpoint
* Document upload → OCR failure propagation (mock/no OCR) path
* Status and result endpoints (error path)
* Batch summary stub
* Coverage endpoint
* Multi-CPT detection & titration promotion
* Phone detection & filtering (fax removal, altPhones separation)
* ICD primary diagnosis description
* Member/group ID extraction & secondary insurance detection
* Email filtering (ignores business address, captures patient-labeled)
* Provider notes normalization

Recommended manual smoke:
1. Start all services: `npm run dev:all`
2. Upload a real or sample PDF; verify Quality panel (flags, QC, actions) & suggested filename.
3. Open `/api/batch` → confirm dates.
4. Visit cover & problem log JSON + PDF endpoints.
5. Set `BATCH_LOGO_PATH` to a local logo and refresh a PDF.
6. Induce a manual review (e.g. remove DOB) and confirm it appears in problem log.

## Data Catalogs
Located under `backend/rules/data/`:
* `cpt_catalog.json`
* `icd_catalog.json`, `icd_keywords.json`, `icd_alerts.json`
* `carriers_catalog.json`, `insurance_policies.json`
* `dme_catalog.json`

These drive deterministic detection; edits require restart in dev.

## Extending
Add new ICD keywords: edit `icd_keywords.json` (ensure codes exist in `icd_catalog.json`).
Add carrier policies (sunsets, notes, auto flags): `insurance_policies.json`.
Add actions: ensure downstream UI / batch PDFs expect them; actions are surfaced verbatim.

## Roadmap (Potential)
* PDF snapshot tests (content assertions per section)
* ZIP export of all batch PDFs
* More robust secondary insurance parsing & prioritization
* Multi-page patient detail sheets
* Role-based auth & audit logging
* Confidence calibration metrics dashboard
* Optional cloud OCR fallback

## License
Internal / client project (add explicit license if distributing externally).

---
Questions or additions: open an issue or extend the relevant catalog.
