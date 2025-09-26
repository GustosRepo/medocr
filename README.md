# MEDOCR

Local, Electron-based referral processing for sleep study workflows. Processes scanned/faxed PDFs, extracts key data with OCR, applies conservative rules, and generates per‑patient PDFs and a batch cover sheet.

Key files:
- docs/api/contracts.md — REST API contracts (Node/Express)
- docs/schema/extraction_result.schema.json — JSON Schema for OCR + extraction result
- examples/sample_extraction_result.json — Example output matching the schema

Directories:
- frontend/ — React UI (Vite)
- backend/ — Node.js + Express API
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

## Notes
- UI has a "Load sample" button to visualize results without OCR.
- Endpoints documented in `docs/api/contracts.md`.
