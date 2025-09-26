# MEDOCR API Contracts (Local-only)

Base URL: http://127.0.0.1:<port>/api

All endpoints are local-only (Electron-spawned services). Responses are JSON unless noted.

## POST /api/documents
- Description: Upload a referral PDF for processing.
- Request: multipart/form-data { file: <pdf> }
- Response: 202 Accepted
```
{ "id": "doc_123", "status": "queued" }
```

## GET /api/documents/:id/status
- Description: Processing status and flags.
- Response:
```
{ "id": "doc_123", "status": "processing|done|error", "progress": 0.42, "flags": { "verifyManually": true, "reasons": ["ocr_low_confidence"] }, "error": null }
```

## GET /api/documents/:id/result
- Description: Full extraction result (see schema).
- Response: application/json matching extraction_result.schema.json

## GET /api/batch/:date/summary
- Description: Daily batch summary for cover sheet.
- Response:
```
{ "date": "2025-09-24", "patients": [ { "id": "doc_123", "name": "Doe, Jane", "dob": "01/02/1970", "insurance": "Aetna", "memberId": "ABC123", "additionalActions": ["authorization_required"] } ], "forms": { "insuranceVerification": 1, "authorizationRequests": 1, "utsReferrals": 0, "providerFollowUps": 0, "patientContacts": 0 }, "totals": { "processed": 10, "readyToSchedule": 7, "additionalActions": 3 } }
```

## GET /api/forms/:id/:type
- Description: Generated PDFs (content-type: application/pdf)
- :type in { patient, batch_cover, problem_log }

## Notes
- Authentication: none (local-only). Bound to 127.0.0.1.
- File size limits: configurable; recommend 50MB max.
- Errors use RFC7807-ish shape:
```
{ "error": { "code": "bad_request", "message": "file required" } }
```
