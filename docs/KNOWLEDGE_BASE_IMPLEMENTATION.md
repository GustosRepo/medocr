# Knowledge Base Implementation Plan

**Date:** March 10, 2026 (revised)  
**Approach:** 3-layer hybrid (LLM-enriched extraction + deterministic rules + LLM-assisted NLP)

---

## What Already Exists (~12,500 lines)

The current codebase has substantial rules infrastructure that this plan **extends**, not replaces:

### Regex Pre-Extraction Engine — `backend/rules/` (5,140 lines)

| File | Lines | What It Does |
|---|---|---|
| `index.js` | 2,799 | Master orchestrator: runs all detectors on OCR text, builds pre-extraction result with provider, member ID, carrier, CPT, ICD, phone/fax, address, DOB |
| `patient.js` | 551 | Name detection (multi-format), DOB parsing, phone number extraction |
| `address.js` | 230 | Street/city/state/zip detection with label awareness |
| `carriers.js` | 153 | Carrier synonym matching from `carriers_catalog.json`, policy decorations (accepted/DNA/sunset/auto-flag) |
| `cpt.js` | 198 | CPT code detection with intent classification (ordered/requested/mentioned), titration evidence, pediatric prioritization |
| `icd.js` | 217 | ICD-10 detection with label context, keyword inference, enrichment (chronic, severity, notes) |
| `context_guard.js` | 147 | Fax line detection, provider line detection, header line filtering |
| `dme.js` | 65 | DME equipment detection |
| `date.js` | 89 | Date of service, referral date parsing |
| `normalize.js` | 67 | OCR page normalization |
| `patterns.js` | 85 | Shared regex patterns |
| `selectBest.js` | 164 | Multi-candidate field selection with scoring |
| `reportBuilder.js` | 204 | Extraction report formatting |

### Rule Engine — `backend/rules/utils/ruleEngine.js` (637 lines)

Singleton class that loads JSON rules from `backend/rules/data/` at startup:
- **94 carrier JSON files** — each with synonyms, member ID regex patterns + scores, label matching, section preferences, validation rules
- **5 CPT category files** — codes with keywords, ICD requirements, conflict detection
- **5 ICD category files** — codes with keyword inference, primary/secondary rules
- **1 credential file** — provider credential patterns
- Provides `scoreCandidate()`, `scoreCptCandidate()`, `scoreIcdCandidate()`, `classifyPhone()`, `identifyTemplate()`

### Clinical Normalization — `backend/rules/utils/clinicalNormalization.js` (296 lines)

- Levenshtein deduplication of OCR-noisy clinical notes
- Falls history detection, opioid medication detection, oxygen/caretaker flags
- Pediatric description detection, prior study evidence, CPAP titration context

### Decision Tree — `backend/decisionTree.js` (592 lines)

5-level validation pipeline already wired into `server.js`:
1. **Completeness** — patient name, DOB, contact (dynamic field path resolution)
2. **Insurance** — carrier name, member ID, auth indicators
3. **Clinical** — diagnosis, referral reason, urgent keywords
4. **Provider** — name, NPI, contact info
5. **Demographics** — address, city, state, zip

Routes to: `READY_TO_SCHEDULE` / `INSURANCE_VERIFICATION` / `AUTHORIZATION_REQUEST` / `PROVIDER_FOLLOWUP` / `MANUAL_REVIEW`

### Other Utilities (1,629 lines)

| File | Lines | Purpose |
|---|---|---|
| `utils/ruleEngine.js` | 637 | Universal pattern scoring engine (see above) |
| `utils/clinicalNormalization.js` | 296 | Note dedup + clinical flag helpers |
| `utils/icd10Validator.js` | 248 | ICD-10 format validation |
| `utils/cptValidator.js` | 175 | CPT format validation |
| `utils/ocrCorrector.js` | 196 | OCR correction application |
| `utils/configLoader.js` | 53 | JSON config loader with transform/default |
| `utils/phone.js` | 25 | NANP phone validation |

### Rule Data Files — `backend/rules/data/`

| Directory | Files | Content |
|---|---|---|
| `carriers/` | 94 | Carrier-specific member ID patterns, synonyms, labels, validation |
| `cpt/` | 5 | CPT code catalogs by category (HST, in-lab, MSLT, titration, pediatric) |
| `icd/` | 5 | ICD-10 code catalogs with keywords and enrichment |
| `credentials/` | 1 | Provider credential patterns |
| Root JSONs | 7 | `insurance_policies.json`, `carriers_catalog.json`, `cpt_catalog.json`, `icd_catalog.json`, `icd_alerts.json`, `icd_keywords.json`, `icd_enrichment.json` |

---

## What the Client's Knowledge Base Adds (87 files, v0.19.3)

The client's KB from `/Decision Tree and Relevant Files/` fills gaps the existing system doesn't cover:

1. **Flags** — 105-flag catalog with 5 severity tiers + human action text (the existing system has no formal flag catalog)
2. **Payer criteria chains** — insurance → specific rules per payer (auth requirements, allowed CPTs, submission info)
3. **Test selection** — "based on order + insurance + clinical, the test is 95810" (existing CPT detection finds what's on the page, but doesn't select the *right* test)
4. **BCBS prefix routing** — 19,511 member ID prefix → plan mappings (existing BCBS carrier matching is synonym-only)
5. **Cost estimates** — per-payer allowable rates for each test type (not in existing system at all)
6. **Auth readiness** — "ready to submit" vs "missing X, call for Y" (existing decision tree routes but doesn't produce staff instructions)
7. **Contraindications** — clinical safety rules (O2-dependent → no HST, pediatric age tiers)

### What It Does NOT Need to Duplicate

| Capability | Already Handled By | KB Should NOT Rebuild |
|---|---|---|
| Carrier name matching | `carriers.js` + 94 carrier JSONs | ✓ Already fuzzy-matches OCR-garbled names |
| Member ID pattern scoring | `ruleEngine.js` + carrier JSONs | ✓ Already scores candidates per carrier |
| CPT code detection | `cpt.js` + 5 CPT category files | ✓ Already finds codes with intent classification |
| ICD-10 keyword extraction | `icd.js` + enrichment JSONs | ✓ Already does labeled + global + keyword inference |
| Clinical note dedup | `clinicalNormalization.js` | ✓ Already Levenshtein-deduplicates |
| Basic routing | `decisionTree.js` (5-level) | ✓ Already routes to 5 outcomes |
| Provider credential detection | `ruleEngine.detectCredential()` | ✓ Already identifies MD/DO/NP/PA-C |

---

## Architecture: 3 Layers

### Layer 1 — Enrich LLM Extraction (modify existing prompts)

Feed KB context into existing LLM prompts so extraction is **better** with minimal new code:

| KB File in Prompt | What It Improves |
|---|---|
| `insurance.json` accepted list | LLM matches OCR-garbled "Untied Healthcar" → "United Healthcare" during extraction, not after |
| `cpt_keywords.json` | LLM catches sleep study codes it currently misses |
| `signature_patterns.json` credential tiers | LLM flags "NP needs supervising" during extraction |
| `facility_config.json` exclusion filter | LLM stops confusing the facility's own fax number with the provider's |

### Layer 2 — Extend Existing Rules with KB Data (new modules, ~400-600 lines)

The existing `rules/` infrastructure handles detection. These new modules handle **decision logic** that runs after extraction:

| New Module | Lines (est.) | What It Does | KB Files Consumed | Extends |
|---|---|---|---|---|
| `payerCriteria.js` | ~120 | Maps detected carrier → payer criteria chain → auth requirements, CPT coverage, submission info | `payer_router.json`, `payer_criteria_map.json`, `payer_*.json`, `criteria_*.md` | `carriers.js` output |
| `bcbsRouter.js` | ~60 | BCBS member ID prefix → specific plan routing | `bcbs_prefix_database.json` | `ruleEngine.scoreCandidate()` |
| `testSelector.js` | ~80 | Given ordered CPT + insurance coverage + clinical context → recommended test code | `cpt_selector_FIXED.json`, `contraindications.json` | `cpt.js` output |
| `flagEngine.js` | ~100 | Evaluates all extraction fields against 105-flag catalog, severity sort, dedup | `flags_catalog_tree_v0_19_3.json` | `clinicalNormalization.js` |
| `costEstimate.js` | ~50 | Payer + test code → allowable rate + patient responsibility | `insurance_allowables.json` | `payerCriteria.js` output |
| `ageCalc.js` | ~30 | DOB → age at service date, pediatric tier (< 6 / 6-17 / 18+) | `facility_config.json` | — |

**Total:** ~440 lines of new logic

These modules don't replace anything — they consume the output of existing detectors and add decision intelligence.

### Layer 2 Integration Point — Extend `decisionTree.js`

The existing decision tree produces routing (5 outcomes). The KB integration **adds a 6th pass** after the existing 5 levels:

```
Level 1: Completeness Check    ← existing
Level 2: Insurance Check       ← existing
Level 3: Clinical Check        ← existing
Level 4: Provider Check        ← existing
Level 5: Demographics Check    ← existing
Level 6: KB Assessment (NEW)   ← runs payerCriteria + testSelector + flagEngine + costEstimate
```

The Level 6 output enriches the result JSON with:

```json
{
  "kbAssessment": {
    "flags": [
      { "id": "FLAG_MISSING_AUTH", "severity": 1, "action": "Submit PA to UHC portal", "tier": "STOP" }
    ],
    "testRecommendation": { "code": "95810", "reason": "In-lab PSG per UHC criteria" },
    "authStatus": "PENDING_PRIOR_AUTH",
    "costEstimate": { "allowable": 334.04, "patientResp": 0, "payer": "HPN" },
    "finalStatus": "READY_FOR_AUTH"
  }
}
```

### Layer 3 — LLM Assist for Fuzzy Tasks (optional, uses existing Ollama)

Only two things benefit from LLM intelligence beyond what exists:

1. **ICD-10 Tier B** — semantic matching of clinical text to 5,193 codes (e.g., "restless legs" → G25.81). The existing `icd.js` handles Tier A (keyword/regex, ~84 curated codes, covers ~80% of cases). Tier B is the long tail.
2. **NLP context** — negation detection ("no snoring"), family vs personal ("father had apnea"), temporal ("resolved after surgery").

---

## Mapping: Existing ↔ Client KB ↔ New Modules

The naming mismatch between the existing 94 carrier JSONs and the client's KB files needs a reconciliation layer:

| Existing System | Client KB | Bridge Needed |
|---|---|---|
| 94 files in `rules/data/carriers/` (e.g., `aetna.json`) | `insurance.json` (99 carriers) + `payer_router.json` (27 payers) | `payerCriteria.js` maps `carriers.js` output carrier name → KB `payer_router.json` payer_id |
| `carriers_catalog.json` (synonym patterns) | `insurance.json` (accepted/doNotAccept lists) | Merge — existing synonyms are more OCR-tuned; KB accepted list is authoritative |
| `insurance_policies.json` (sunset, auto_flag) | `payer_criteria_map.json` (auth, coverage) | Different concerns — policies = acceptance status, criteria = clinical rules. Both load |
| 5 CPT category files | `cpt_selector_FIXED.json` (6 rule categories) | KB adds insurance-specific CPT coverage rules on top of existing detection |
| 5 ICD category files + enrichment | `icd10_curated.json` (84) + `icd10_master_fy2026.json` (5,193) | KB curated list supplements existing catalog; master list feeds Layer 3 |
| `clinicalNormalization.js` safety helpers | `contraindications.json` (15 clinical rules) | New `testSelector.js` uses KB contraindications; existing helpers feed `flagEngine.js` |
| No equivalent | `flags_catalog_tree_v0_19_3.json` (105 flags) | **Entirely new** — `flagEngine.js` |
| No equivalent | `insurance_allowables.json` (34 payers, 112 rates) | **Entirely new** — `costEstimate.js` |
| No equivalent | `bcbs_prefix_database.json` (19,511 prefixes) | **Entirely new** — `bcbsRouter.js` |

---

## JSON Files — Load Order & Mapping

All 17 core KB files load at startup into `backend/data/kb/`. The existing `rules/data/` files continue loading independently.

| # | File | Records | Layer | New Module |
|---|------|---------|-------|------------|
| 1 | `facility_config.json` | 5 sections + 10 params | L1 + L2 | `ageCalc.js`, LLM prompt exclusion |
| 2 | `insurance.json` | 99 carriers | L1 | LLM prompt (accepted list) |
| 3 | `payer_router.json` | 27 payer mappings | L2 | `payerCriteria.js` |
| 4 | `payer_criteria_map.json` | 27 payers → criteria files | L2 | `payerCriteria.js` |
| 5 | `insurance_allowables.json` | 34 payers, 112 rates | L2 | `costEstimate.js` |
| 6 | `eligibility_combinations.json` | 21 payers, 75 combos | L2 | `payerCriteria.js` |
| 7 | `bcbs_prefix_database.json` | 19,511 prefixes | L2 | `bcbsRouter.js` |
| 8 | `filename_classification.json` | 14 patterns | L1 | File intake enrichment |
| 9 | `referral_keywords.json` | ~106 phrases | L1 + L2 | Order scope |
| 10 | `signature_patterns.json` | ~50 patterns | L1 | LLM prompt (credential tiers) |
| 11 | `contraindications.json` | 15 clinical rules | L2 | `testSelector.js` |
| 12 | `flags_catalog_tree_v0_19_3.json` | 105 flags | L2 | `flagEngine.js` |
| 13 | `icd10_curated.json` | 84 codes | L2 | Supplements existing `icd.js` catalog |
| 14 | `icd10_master_fy2026.json` | 5,193 codes | L3 | ICD Tier B (LLM semantic match) |
| 15 | `cpt_selector_FIXED.json` | 6 rule categories | L2 | `testSelector.js` |
| 16 | `cpt_keywords.json` | 21 CPT→keyword maps | L1 | LLM prompt enrichment |
| 17 | `convert_icd10_master.py` | Script | N/A | Annual ICD code maintenance |

---

## Integration Points — Existing Pipeline

The current pipeline and where KB fits:

```
PDF Upload
  ↓
PDF Trim (pageSelector.js)
  ↓
OCR (ocr_service, port 8000)
  ↓
┌─────────────────────────────────────────┐
│ Regex Pre-Extraction (rules/index.js)   │  ← EXISTING: detects carriers, CPTs,
│   → carriers.js, cpt.js, icd.js, etc.  │    ICDs, names, phones, addresses
│   → ruleEngine.js scores candidates     │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ Text LLM Extraction (qwen2.5:14b)      │  ← LAYER 1: inject KB context into
│   → textLlmExtractor.js                │    prompts (insurance list, CPT
│                                         │    keywords, facility exclusion)
└─────────────────────────────────────────┘
  ↓
VLM Verification (qwen2.5vl:7b)
  ↓
┌─────────────────────────────────────────┐
│ Decision Tree (decisionTree.js)         │  ← EXISTING: 5-level validation
│   Levels 1-5: completeness, insurance,  │    Routes to 5 outcomes
│   clinical, provider, demographics      │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ KB Assessment — NEW Level 6             │  ← LAYER 2: runs after extraction
│   → payerCriteria.js (payer chain)      │
│   → bcbsRouter.js (prefix lookup)       │
│   → testSelector.js (recommend test)    │
│   → flagEngine.js (105-flag catalog)    │
│   → costEstimate.js (allowable rates)   │
│   → ageCalc.js (pediatric tiers)        │
└─────────────────────────────────────────┘
  ↓
Save Enriched Result JSON → Download Packet
```

### Extracted Fields That Feed Layer 2

| Extracted Field | Source | Feeds |
|---|---|---|
| `carrier` name + status | `carriers.js` + `ruleEngine` | `payerCriteria.js` → payer routing chain |
| `memberId` | `rules/index.js` member ID detection | `bcbsRouter.js` (prefix extraction) |
| `cptCodes` + intent | `cpt.js` (with ordered/requested/mentioned) | `testSelector.js` |
| `icdCodes` + enrichment | `icd.js` (with chronic, severity) | `flagEngine.js`, Layer 3 |
| `patient.dob` | `patient.js` or LLM | `ageCalc.js` → pediatric tier |
| `provider.credential` | `ruleEngine.detectCredential()` | `flagEngine.js` (supervision flags) |
| Clinical notes (raw) | OCR text | `flagEngine.js` (via `clinicalNormalization.js` helpers) |

---

## Implementation Order

### Phase 1 — Data Setup (1 hour)
1. Copy 17 KB JSON files into `backend/data/kb/`
2. Extend `configLoader.js` to support `kb/` directory path
3. Verify all files parse cleanly at startup

### Phase 2 — Layer 1: Prompt Enrichment (half day)
4. Inject `insurance.json` accepted carrier list into text LLM prompt (~5 lines)
5. Inject `cpt_keywords.json` CPT→keyword mapping into prompt (~5 lines)
6. Add `facility_config.json` phone/fax exclusion to prompt (~5 lines)
7. Add `signature_patterns.json` credential tier context to prompt (~5 lines)

### Phase 3 — Layer 2: KB Assessment Modules ✅ COMPLETE
8. ✅ `ageCalc.js` — age calculation + pediatric tier classification (backend/rules/kb/ageCalc.js)
9. ✅ `payerCriteria.js` — carrier name → payer_router → payer file → auth/coverage/flags (backend/rules/kb/payerCriteria.js)
10. ✅ `bcbsRouter.js` — BCBS alpha prefix lookup in 19,511 entries (backend/rules/kb/bcbsRouter.js)
11. ✅ `testSelector.js` — age + payer + contraindications → recommended CPT (backend/rules/kb/testSelector.js)
12. ✅ `costEstimate.js` — payer + CPT → allowable rate from insurance_allowables.json (backend/rules/kb/costEstimate.js)
13. ✅ `flagEngine.js` — aggregate, deduplicate, enrich, sort all flags from all modules (backend/rules/kb/flagEngine.js)
14. ✅ Wired all modules into `decisionTree.js` as Level 6 (checkKbAssessment method), outputs kbAssessment object

### Phase 4 — Frontend Display ✅ COMPLETE
15. ✅ `KbAssessmentPanel.jsx` — full panel with flags (severity-colored rows with icons), test recommendation, payer/auth, cost estimate, BCBS routing, submission guidance, alt CPTs
16. ✅ Wired into `ReferralPage.jsx` Details view (renders when `doc.routing.kbAssessment` exists)
17. ✅ Added KB status badge to `ChecklistPage.jsx` route badges (STOP/PENDING/FLAG/CLEAR with tooltip showing flagSummary)

### Phase 5 — Layer 3: ICD Tier B ✅ COMPLETE
19. ✅ Added `getIcd10Master()` to `kbLoader.js` — loads 5,193 codes from `icd10_master_fy2026.json`
20. ✅ Built `icdMatcher.js` (`backend/rules/kb/icdMatcher.js`) — 3-tier ICD matching engine:
    - **Tier A**: Keyword-based matching against `icd10_curated.json` (~85 codes). Inverted index, specificity-ranked.
    - **Tier B**: LLM semantic matching via Ollama `qwen2.5:14b`. Heuristic category selection → compact code block → structured JSON prompt. 15s timeout, graceful fallback.
    - **NLP Context**: Sentence-boundary-aware negation detection ("denies", "no history of"), family-vs-personal ("family history of"), temporal qualifiers ("previous", "resolved").
21. ✅ Wired `assessIcd()` into `checkKbAssessment()` in `decisionTree.js` — ICD flags aggregate into flag engine, ICD codes exposed in `kbAssessment.icd`
22. ✅ Made `evaluate()` async to support Tier B LLM calls. Updated both callers (`server.js`, `dualEngineProcessor.js`).
23. ✅ Validated: Tier A matches G47.33 (OSA), G47.10 (hypersomnia), R40.0 (somnolence), I10 (hypertension), R06.83 (snoring). NLP correctly detects negation, family history, past temporal context.

---

## Prerequisites (from Audit)

Before building, the client must provide:

- **28 facility_config.json values** — real facility NPI, phone, fax, address, physician names (Critical #1) — **AWAITING CLIENT DATA** (see section below)
- ✅ **Fix 4 missing payer_criteria_map entries** — added `BCBS Non-Carelon`, `UHC Medicare Direct`, `UHC Medicare Optum`, `UHC Surest` (31 payers total now)
- ✅ **Add 8 missing flags to catalog** — added `FLAG_MERITAIN_CALL_FIRST`, `FLAG_NV_MEDICAID_NO_HST`, `FLAG_UMR_CHECK_NETWORK`, `FLAG_OON_AUTO` + 4 payer-file orphans (`FLAG_BCBS_UNVERIFIED_PREFIX`, `FLAG_OPTUM_MISLABELED_REFERRAL`, `FLAG_OPTUM_WRONG_PORTAL`, `FLAG_SUREST_COPAY_CALL`) — 113 flags total now

---

## CLIENT ACTION REQUIRED — facility_config.json

The file `backend/data/kb/facility_config.json` has **28 PLACEHOLDER values** that must be filled in with the real sleep lab's identity. This is NOT extracted from referrals — it's your client's own facility info (like setting up an EMR). The OCR exclusion filter uses these to avoid confusing the facility's own phone/fax/NPI with the referring provider's.

**Tell your client you need:**

### Facility Identity (10 values)
| # | Field | What to Ask For |
|---|-------|-----------------|
| 1 | Facility legal name | "What is the legal business name on your NPI registration?" |
| 2 | DBA name | "Do you operate under a different name (DBA)? If same, leave blank." |
| 3 | Facility NPI | "What is your 10-digit facility NPI?" |
| 4 | Tax ID / EIN | "What is your facility Tax ID or EIN?" |
| 5 | Taxonomy code | "What is your facility taxonomy code?" |
| 6 | Street address | "What is the facility street address?" (city=Las Vegas, state=NV already set) |
| 7 | ZIP code | "What is the facility ZIP code?" |
| 8 | Main phone | "What is the main office phone number?" |
| 9 | Main fax | "What is the facility fax number?" |
| 10 | Email | "What is the facility email for auth correspondence?" |

### Supervising Physician (3 values)
| # | Field | What to Ask For |
|---|-------|-----------------|
| 11 | First name | "Who is the supervising sleep medicine physician?" |
| 12 | Last name | (same) |
| 13 | NPI | "What is the supervising physician's 10-digit NPI?" |

### Interpreting Physician (3 values)
| # | Field | What to Ask For |
|---|-------|-----------------|
| 14 | First name | "Who is the interpreting physician (if different from supervising)?" |
| 15 | Last name | (same) |
| 16 | NPI | "What is the interpreting physician's NPI?" |

### Auto-Derived (12 values — we fill these automatically)
Items 17-28 are the OCR exclusion filter arrays (phone numbers, fax numbers, NPIs, addresses, entity names). Once the client provides items 1-16 above, we populate the exclusion filter automatically — no extra input needed.

### Why This Matters
Without real facility data:
- The system confuses the facility's own fax number with the referring provider's fax
- Auth submissions would have placeholder NPIs and addresses
- Cost estimates reference the wrong entity
- The OCR exclusion filter doesn't filter anything
