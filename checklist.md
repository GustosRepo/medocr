# Project Checklist & Roadmap

Last Updated: 2025-09-30 (evening update)
Owner: (update when you take an item)

Legend: 
- [x] = Done  |  [~] = In Progress  |  [ ] = Todo  | (R) = Risk  | (QA) = Test-related  | (Spec) = Client requirement

---
## 1. Completed (Foundation & Recent Milestones)
- [x] OCR pipeline integration (FastAPI RapidOCR) with Express orchestration
- [x] Error propagation & status polling endpoints
- [x] CPT multi-candidate detection + intent promotion (titration 95811 logic)
- [x] ICD detection + primary diagnosis description mapping
- [x] Carrier detection + policy overlays (baseline)
- [x] DME detection (baseline catalog)
- [x] Phone extraction + normalization (NANP, toll-free exclusion, provider/fax filtering)
- [x] altPhones separation
- [x] Email extraction with business suppression + contextual acceptance
- [x] Member ID / Group ID extraction (primary)
- [x] Secondary insurance heuristic (2nd carrier line)
- [x] Provider detection (name, NPI, fax, phone heuristic)
- [x] Provider notes aggregation (procedure context)
- [x] Clinical bundle (primaryDiagnosis, symptoms, vitals)
- [x] Info alerts: PPE, safety, communication, accommodations
- [x] Flags & actions derivation (wrong test, missing info, etc.)
- [x] Authorization notes narrative (initial heuristics)
- [x] Batch cover & problem logs (JSON + PDF)
- [x] Patient summary PDF endpoint w/ hidden markers for test stability
- [x] Suggested filename spec (Last_First_DOB_ReferralDate)
- [x] Test-only injection endpoint for deterministic PDF tests
- [x] Expanded README (fields + endpoints)
- [x] 19 automated tests (all passing)
- [x] Hidden PDF marker strategy + no-compression switch
- [x] Authorization notes included in patient PDF (metadata + hidden markers)
- [x] Data Quality section added to patient PDF (confidence, QC, CPT ambiguity)
- [x] Test coverage for authorizationNotes (PDF metadata assertion)
- [x] Refined secondary insurance detection (scoring + distance heuristic)
- [x] Provider contact classification (phone vs fax) & extraction
- [x] Frontend: provider phone, authorization notes, CPT ambiguity & altPhones rendering
- [x] Structured schema validation test (Ajv) added
- [x] DME edge tests (presence & absence)
- [x] Secondary insurance negative test (no false second) 
- [x] Test suite expanded to 25 passing tests

---
## 2. In Progress / Monitoring
- [~] Further secondary insurance precision tuning (reduce residual false positives)
- [~] Expand authorizationNotes richness (carrier & policy nuance)
- [~] Confidence scoring recalibration after new fields

---
## 3. Immediate Next (Sprint Candidate)
1. [ ] Emergency contact extraction enhancement (relationship + phone validation)
2. [ ] Expand symptom phrase library + source tagging
3. [~] Secondary insurance precision evaluation test harness (baseline negative test added; add multi-sample metrics)
4. [ ] CPT ambiguity UX improvements (surface reasons & confidence hints)
5. [ ] Authorization notes enrichment (carrier policy mapping) (Spec)
6. [ ] Snapshot JSON contract test (freeze representative extraction payloads)
7. [ ] Optional: collapse/expand UI for long authorization notes

---
## 4. Short-Term Backlog
- [ ] Merge multi-page PDF support for patient summary if content length grows
- [ ] Expand carriers catalog with status-specific pre-auth rules
- [ ] Policy-driven action inference (e.g., order needs PCP referral)
- [ ] More robust fax vs phone separation via lexical + number pattern
- [ ] Additional ICD enrichment (severity / chronic flags)
- [ ] DME rules linking (e.g., CPAP + compliance prerequisites)
- [ ] Inline risk scoring for manual review triage
- [ ] Rate limiting & defensive controls (to prevent accidental flooding OCR service)

---
## 5. Longer-Term / Strategic
- [ ] Confidence model ML calibration (beyond heuristic stacking)
- [ ] Document version diffing (track changes across uploads)
- [ ] Feedback loop ingestion (human corrections -> model refinement)
- [ ] Analytics dashboard (throughput, error classes, action frequencies)
- [ ] Multi-language / locale adaptation (future regulatory markets)
- [ ] Structured export (FHIR mapping experiment)

---
## 6. Quality & Testing Enhancements
- [ ] Snapshot baseline for extraction JSON (contract tests) 
- [ ] PDF smoke hashing (ensure no unintended layout shifts)
- [ ] Add test harness for randomized phone/email noise injection
- [ ] Regression test: ambiguous multi-CPT with forced fallback
- [ ] Performance test: batch of N (decide threshold) documents

---
## 7. Technical Debt / Hygiene
- [ ] Centralize regex patterns in a constants module
- [ ] Logging standardization (levels + correlation IDs)
- [ ] Error taxonomy (user vs system vs external OCR)
- [ ] Rate-limit / concurrency guard around OCR calls
- [ ] Normalize date parsing (single util with confidence rating)

---
## 8. Risk Register
| Risk | Impact | Mitigation |
|------|--------|------------|
| Secondary insurance false positives | Incorrect dual coverage actions | Improve pattern logic, cross-field validation |
| Over-expanding heuristics w/o tests | Silent regressions | Guard with contract tests & schema validation |
| PDF layout future changes | Breaks tests | Marker-based assertions + layout hash |
| Confidence misinterpretation | Wrong triage decisions | Add explanatory fields & thresholds doc |

---
## 9. Metrics To Track (TBD Implementation)
- Extraction latency (p50/p95)
- OCR failure rate
- Manual review flag rate
- Ambiguous CPT rate
- Secondary insurance detection precision (after labeled sample)
- Action recommendation acceptance rate (needs feedback loop)

---
## 10. Decision Log (Key Past Decisions)
| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-09 | Hidden PDF markers instead of text extraction | Compression & encoding variability made naive regex brittle |
| 2025-09 | Multi-CPT candidate + intent model | Preserve ambiguity to avoid silent misclassification |
| 2025-09 | Conservative confidence downgrades | Client risk tolerance favors false negatives over false positives |
| 2025-09 | Test injection endpoint | Deterministic artifact creation for PDF validation |

---
## 11. How To Update This File
1. Update Last Updated date.
2. Move completed items from sections 2–5 into section 1 (append at bottom for chronology).
3. Keep section 3 capped (~10 actionable items).
4. Record significant architecture or policy decisions in section 10.

---
## 12. Open Questions
- Should authorizationNotes become structured (array of objects) vs free-text?
- Do we need jurisdiction-specific pre-auth rule mapping now or defer?
- Minimum dataset size before confidence recalibration?

---
## 13. Quick Status Snapshot (Today)
Core extraction: Stable
PDF: Stable (markers implemented)
Tests: 25 passing
Biggest near-term risk: Secondary insurance precision

---
(End of checklist)
