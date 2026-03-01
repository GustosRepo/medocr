# Project Checklist & Roadmap

Last Updated: 2026-02-28 (VLM-primary architecture migration + frontend audit)

---
## 0. MVP Critical Focus (Due 2025-10-03 Friday)
Goal: Stable referral extraction + usable UI + basic analytics & export. Everything else defers.

Must Have (ship-blocking)
- [ ] Frontend error boundary + fallback screen (prevents blank app on crash)
- [ ] API error taxonomy mapping applied to HTTP responses (consistent codes/messages)
- [ ] Download JSON button (Raw JSON) for immediate data export
- [ ] E2E sanity test: sample upload -> processed result (assert key fields present)
- [ ] README deployment snippet (start backend + frontend + sample doc walk-through)

Nice-to-Have (only if Musts done early)
- [ ] Persist color scheme preference (quality polish)
- [ ] Copy to clipboard shortcut for JSON
- [ ] Basic auth stub (if external exposure planned)

Deferred (Post-MVP) – leave in existing backlog
- Full-screen JSON modal
- Accessibility contrast/focus pass
- Storybook expansion
- Lazy route loading
- Confidence weight audit
- Secondary insurance labeled sample expansion

MVP Success Criteria
1. User can upload PDF, see status, view structured fields, download JSON.
2. Errors show a friendly message; network/backend failures don’t white-screen.
3. Metrics/analytics page loads with current stats (no runtime errors).
4. All automated tests pass (>=66) plus new e2e test.
5. Deployment instructions allow a fresh clone to run in <5 minutes.

Key Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Silent UI crash (React error) | Implement error boundary + logging |
| Inconsistent API error shapes | Central mapping layer w/ tests |
| Regression in extraction flow | Add e2e upload -> result test |
| Confusion on setup | Harden README deploy steps |

---
Owner: (update when you take an item)

Legend: 
- [x] = Done  |  [~] = In Progress  |  [ ] = Todo  | (R) = Risk  | (QA) = Test-related  | (Spec) = Client requirement

---
## A. Architecture Overhaul — VLM Migration (Branch: vlm-experiment-2)
**Problem Identified (2026-02-28):** Regex-over-linearized-text approach is fundamentally limited for diverse fax documents. 544 regex patterns can't handle multi-column layouts, tables, handwriting, or novel formats. LLM was being used as a rubber stamp validator instead of primary extractor. This architecture is ~5 years behind current best practice.

**Decision:** Migrate to VLM-primary architecture (self-hosted, no cloud tokens). MiniCPM-V via Ollama on Apple M4 Pro (24GB unified RAM).

### A1. OCR & Backend — VLM Migration
- [x] Hardware check: M4 Pro, 16-core GPU, 24GB RAM confirmed
- [x] P0: Enable auto-rotation default in OCR service
- [x] P0: Enable table detection default in OCR service
- [x] P0: Enable bilateral filter default in OCR service
- [x] P0: Fix DPI downsampling (was destroying quality below 250 DPI on 6+ page docs)
- [x] Pull & test minicpm-v model via Ollama
- [x] Build VLM extraction prompt (14 rules tuned from real test failures)
- [x] Create VLM extractor service (backend/vlmExtractor.js)
- [x] Wire VLM as primary extractor in server.js (VLM_PRIMARY=true env var)
- [x] Add cross-validation layer (VLM primary, regex fills gaps)
- [x] Add normalizers: name order swap fix, NPI validation, phone formatting, CPT/ICD coercion
- [x] Smoke test on real 15-page medical referral PDF — successful extraction
- [x] Git commit on vlm-experiment-2 (437b4ce)
- [ ] Refine VLM prompt for CPT codes (currently returns "OSA" instead of "95810")
- [ ] Refine VLM prompt for name order (still occasionally swaps first/last)
- [ ] Side-by-side accuracy test: run same documents through regex vs VLM, compare field-by-field
- [ ] Full pipeline test through UI with VLM_PRIMARY=true
- [ ] Evaluate Qwen2.5-VL as alternative to MiniCPM-V (better accuracy on tables)
- [ ] Benchmark VLM extraction speed at scale (currently ~15s/page)
- [ ] Standardize backend conflict format (Bug 17 — objects vs strings depending on LLM mode)
- [ ] Unify confidence fields (Bug 21 — `confidence` string vs `confidenceLevel` computed score)

### A2. Frontend — Critical Data-Loss Bugs (SHIP BLOCKERS)
- [x] Fix: edit-save destroys secondary insurance (wraps array as single-element) (Bug 9)
- [x] Fix: edit-save truncates phone list to single entry (Bug 10)
- [x] Fix: validation drawer save corrupts insurance array structure (Bug 16)
- [x] Fix: validation drawer reads `insurance.carrier` instead of `insurance[0].carrier` — always shows "—" (Bug 14)
- [x] Fix: validation drawer reads `patient.phone` instead of `patient.phones` — always shows "—" (Bug 15)
- [x] Fix: conflict format mismatch crashes DualEngineResults or ValidationIssuesDrawer depending on LLM mode (Bug 17)

### A3. Frontend — Missing Data Display (~30-40% of extracted data invisible)
- [x] Display full diagnoses array, not just primaryDiagnosis (Bug 1)
- [x] Display structured symptoms with status/context (confirmed/denied) (Bug 2)
- [x] Display DME data (codes, providers, issues) (Bug 3)
- [x] Display prior study data (Bug 4)
- [x] Display QC validation flags (bad phone, invalid date, etc.) (Bug 5)
- [x] Display alerts.info and alerts.review categories (only alerts.actions shown) (Bug 6)
- [x] Display insurance status ("accepted"/"pending") (Bug 7)
- [x] Display procedure notes array (Bug 8)

### A4. Frontend — Edit Flow & Consistency
- [x] Fix: editing diagnosis doesn't update `diagnoses[]` array (Bug 13)
- [x] Add edit field for patient email (Bug 11)
- [x] Add edit field for insurance groupId (Bug 12)
- [x] Fix: `confidence` string always overrides computed `confidenceLevel` (Bug 21)
- [x] Wire in DualEngineResults component (built but never imported/rendered) (Bug 24)

### A5. Frontend — Race Conditions & State
- [x] Fix: localStorage persistence saves inconsistent snapshots (result/order mismatch) (Bug 19)
- [x] Fix: `purgeSelected` reload races with state/storage writes (Bug 20)
- [x] Fix: stale `selectedId` closure in `pollStatus` during parallel uploads (Bug 18)

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
- [x] Emergency contact extraction enhancement (relationship + phone + adult support)
- [x] Test suite currently 21 passing (post-consolidation + emergency contact test)
- [x] Symptom phrase expansion + denial handling + context tagging
- [x] Secondary insurance precision evaluation harness (no FP/FN in curated sample)
- [x] CPT ambiguity UX improvements (confidence tier + pruning of weak home-study mentions)
- [x] Authorization notes enrichment (carrier policy mapping + structured tags)
- [x] Snapshot JSON contract test (core extraction subset)
- [x] Optional: collapse/expand UI for long authorization notes
- [x] PDF smoke fingerprint test (layout guard)
- [x] Centralized regex patterns module (patterns.js)
- [x] Pre-authorization heuristic rules (carrier + CPT) with test
- [x] Carrier catalog expansion (additional variants & Medicare/Tricare nuances)
- [x] Policy-driven action inference heuristics + tests
- [x] Provider fax vs phone refined classification + test
- [x] Inline risk scoring (score, tier, factors) + test
- [x] Basic rate limiting middleware (sliding window) + test harness
- [x] ICD enrichment (chronic/severity/note metadata) integrated into extraction + test
// --- New completions (Oct 1, 2025) ---
- [x] Structured logging (levels + correlation IDs middleware) + tests
- [x] Date normalization utility (detectDates) + labeled/unknown date tests
- [x] CPAP compliance metrics extraction (hours, AHI, p90, usage %, pressure range) + test
- [x] Policy inference enhancements (prior study evidence, PCP referral requirement) + tests
- [x] Provider credential expansion (MD/DO/NP/FNP/PA-C/APRN/ANP/DC/RN/PhD) + aggregation test
- [x] Risk scoring chronic/severity weighting integration (factors extended) + test
- [x] Authorization notes structured enrichment (source & confidence fields)
- [x] FHIR export scaffold (Bundle + DiagnosticReport endpoint) + test
- [x] Secondary insurance regression fix (precision-preserving heuristic)
- [x] Secondary insurance metrics harness (precision/recall/F1 curated sample = 1.0)
- [x] Generic second 'Insurance:' line fallback detection (distinct carrier + memberId)
- [x] Confidence scoring recalibration (weighted anchors + OCR adjustments)
- [x] Confidence transparency object (`confidenceDetail` anchors/score/adjustments)
- [x] FHIR export expansion (Patient identifiers, Coverage, Condition, ServiceRequest, Observations)
- [x] Authorization notes category enrichment (policy/carrier/carrier_policy/documentation/clinical_support)
- [x] Error taxonomy propagation (API error responses include category)
- [x] Confidence calibration harness (distribution stats + buckets)
- [x] Performance harness (batch p50/p95 timing thresholds)
- [x] Randomized phone/email noise injection robustness test
// --- New completions (Feedback & Metrics) ---
- [x] In-memory metrics endpoint (/api/metrics) with latency distribution
- [x] Feedback ingestion endpoints (create/list/stats) + tests
// --- Persistence Extensions ---
- [x] Feedback persistence (NDJSON file) with lazy load
- [x] Metrics persistence (counters + latency snapshot JSON)
// --- Post-persistence Additions ---
- [x] Metrics persistence test (file flush + counters)
- [x] Moved docsQueued increment to include test environment (consistency)
- [x] Flush throttle bypass in tests for deterministic assertions
// --- New In-Progress Sprint (Analytics & Interop) ---
- [x] OCR concurrency guard (semaphore) added
- [x] FHIR expansion: Practitioner, Organization, Provenance
- [x] Analytics endpoint (/api/analytics) aggregating metrics + feedback
// --- Analytics & Drift Additions ---
- [x] Extraction snapshot persistence (NDJSON) with ambiguous CPT tracking
- [x] Analytics endpoint extended with snapshots & ambiguous CPT rate
- [x] Confidence samples + drift computation (baseline vs recent)
- [x] File hash (sha256) stored in documentMeta and FHIR Provenance extension
- [x] Practitioner NPI mapping when available
- [x] Provenance resource added with source file hash extension
- [x] Confidence recording on document process & inject
// --- Feedback Loop & Security Enhancements ---
- [x] Feedback acceptance tracking (accepted/overridden)
- [x] Suggestions generation (top accepted path->value pairs)
- [x] Analytics acceptanceRate & suggestions surfaced
- [x] Request body size limit & PDF page cap
// --- UI / Dashboard ---
- [x] Minimal analytics dashboard HTML (/dashboard) w/ auto-refresh

// --- New completions (Carrier + Pediatric + DME Linkage) ---
- [x] Expanded preauth rules (Cigna 95811, Humana 95782/95783, Tricare 95811, UHC 95810) + tests
- [x] Pediatric CPT prioritization (95782/95783 outrank 95810 when explicitly ordered) + test
- [x] Carrier catalog further expansion (Scan, Alignment, P3, Intermountain, UMR, TriWest, HPN variants)
- [x] Secondary insurance tightening (precision restored after carrier expansion)
- [x] DME prerequisite linkage (titration + DME issues -> verify_dme_prerequisites) + tests
- [x] Risk scoring factor extension (dme_prereq)
- [x] Concurrency guard + rate limiting integration reflected in risk controls
// --- New completions (Frontend UI Modernization Oct 1, 2025) ---
- [x] React multi-page refactor (Referral, Analytics, Legacy UI routes)
- [x] Mantine AppShell layout (Header + Sidebar components)
- [x] Collapsible sidebar with localStorage persistence & centered nav
- [x] Active nav styling + soft brand highlight
- [x] Scrollbar restyle (brand accent, thin) dark/light aware
- [x] Theme reset & simplification (minimal tokens)
- [x] Dual color schemes (dark/light) + glare-reduced light palette
- [x] Paper/Panel elevation & shadow tuning
- [x] Raw JSON collapsible viewer (expand/collapse + enlarged area)
- [x] CollapsibleJson reusable component (centered controls)
- [x] Expand button visibility upgrade (icons + variant) in Result panel
- [x] Sidebar collapsed icon vertical/horizontal centering
- [x] Centered collapse controls & improved readability for long JSON
- [x] Placeholder panel surface & contrast adjustments
// --- Checklist UX Enhancements (Oct 1, 2025) ---
- [x] Checklist cards: flex wrap layout (removed internal scroll container)
- [x] Per-card collapse/expand toggle (default expanded)
- [x] LocalStorage persistence of collapsed state across reloads
- [x] Printable View section collapsible with chevron + .txt download
- [x] Archive toggle (optimistic update) + Show Archived filter functioning
- [x] Category override segmented control + note editing retained after collapse
- [x] Actions badges wrap (no overlap) and responsive layout
- [x] Collapsed state hides tracking/actions/error blocks (summary only)

---
## 2. In Progress / Monitoring
- [~] Secondary insurance monitoring (expand labeled sample; watch for drift)
- [x] Confidence transparency test (assert `confidenceDetail` shape)
// (moved to Completed)
- [~] Expand authorizationNotes richness (more granular policy rationale + structured categories)
- [~] Confidence scoring recalibration after new fields (post-weight audit pending)
// (moved to Completed)
// (moved to Completed)

---
## 3. Immediate Next (Sprint Candidate)
1. [x] Multi-page patient PDF support (overflow handling)
2. [x] Expand carriers catalog with status-specific pre-auth rules (broaden dataset)

---
## 4. Short-Term Backlog
// (all moved to Completed)
- [ ] Confidence weight audit (post new factors) (next)
- [ ] Expand labeled secondary insurance sample (monitor drift)
- [ ] Additional carrier policy rationale enrichment (fine-grained plan notes)
- [ ] AuthorizationNotes rationale granularity (sub-tags)
- [ ] Prepare ML confidence calibration dataset (export accepted feedback corrections)
- [ ] Persist user-selected color scheme (localStorage) (UI)
- [ ] Copy / Download buttons for Raw JSON (UI)
- [ ] Full-screen modal view for JSON (UI convenience)
- [ ] Accessibility pass (focus rings, contrast ratios) (UI A11y)
- [ ] Storybook stories for Section / StatCard / CollapsibleJson
- [ ] Lazy-load Analytics & Legacy routes (bundle size)
- [ ] Error boundary component + fallback UI

---
## 5. Longer-Term / Strategic
- [ ] Confidence model ML calibration (beyond heuristic stacking)
- [ ] Document version diffing (track changes across uploads)
- [ ] Feedback loop refinement (apply corrections to improve heuristics / future ML)
- [ ] Analytics dashboard (throughput, error classes, action frequencies)
- [ ] Multi-language / locale adaptation (future regulatory markets)
- [~] Structured export (FHIR mapping experiment) (initial Bundle + DiagnosticReport done; expand resources)
 - [ ] Document version diffing (structural + field change audit) (promote soon)
 - [ ] Feedback auto-application heuristic (semi-automatic rule tuning)

---
## 6. Quality & Testing Enhancements
- [x] Snapshot baseline for extraction JSON (contract tests)
- [x] PDF smoke hashing (ensure no unintended layout shifts)
// (moved to Completed)
- [ ] Regression test: ambiguous multi-CPT with forced fallback
// (moved to Completed)

---
## 7. Technical Debt / Hygiene
- [x] Centralize regex patterns in a constants module
- [x] Logging standardization (levels + correlation IDs)
- [~] Error taxonomy (user vs system vs external OCR) (classification helper present; response mapping pending)
- [x] Rate-limit / concurrency guard around OCR calls (basic + semaphore implemented)
- [x] Normalize date parsing (single util with confidence rating)
- [ ] Migrate inline style objects to theme-driven styles (reduce scattered CSS-in-JS)
- [ ] Audit unused tokens / CSS classes after theme reset

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
Core extraction: Stable (pediatric prioritization + DME linkage + expanded preauth)
PDF: Stable (markers + multi-page + layout hash)
Tests: 66 passing (all green) (performance & precision harnesses intact)
Biggest near-term risks: Confidence weight drift, secondary insurance sample expansion, upcoming ML calibration groundwork

---
(End of checklist)
