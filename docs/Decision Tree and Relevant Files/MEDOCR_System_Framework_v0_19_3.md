# MEDOCR System Framework v0.19.3
### Comprehensive Architecture for LLM-Driven Medical Referral Processing
### February 27, 2026

---

## 1. Core Philosophy

The system is a **problem detector, not a correctness confirmer.** It flags issues that need human attention and tells the user exactly what action to take. "No flags" means "we didn't find problems," not "this is verified correct." True validation happens during manual insurance verification after the tree completes.

**Key Principles:**
- Human review is always final -- system output is a filter and recommendation
- JSON-driven rules -- business logic lives in configuration files, not hardcoded
- Payer-specific handling -- different insurers have different requirements
- Graceful degradation -- missing data triggers recovery paths (PENDING), not failures (STOP)
- Transparency -- flags explain why a decision was made, not just what it is
- Scope never expands -- the physician's order defines the ceiling; the system only narrows

---

## 2. System Architecture

### Processing Pipeline

Every referral flows through 6 modules in sequence. M1 validates the raw data. M2 performs clinical assessment. M3 checks insurance coverage. M4 selects the test. M5 prepares authorization. M6 produces the final output.

```
FILE RECEIVED
    |
    ?
MODULE 1: DATA EXTRACTION & VALIDATION
    M1A: File Intake & OCR --? M1B: Patient --? M1C: Insurance --? M1D: COB --? M1E: Provider/Notes
    |                                                                              |
    ?                                                                              ?
    |-- ICD Code Generation (Tier A curated + Tier B full ICD-10)                 |
    +-- NLP Context Processing (negation, family/personal, temporal, meds, lang)--+
    |
    ?
MODULE 2: CLINICAL ASSESSMENT
    M2A: Order Scope --? M2B: Prior Results --? M2C: Contraindications --? M2D: Clinical Sufficiency
    |
    ?
MODULE 3: INSURANCE SCOPE
    Criteria file lookup --? Coverage check per CPT --? Default-down/up if needed
    |
    ?
MODULE 4: TEST SELECTION
    5-tier tiebreaker --? Split night evaluation gate --? Final test selected
    |
    ?
MODULE 5: AUTH READINESS
    Supplement? (no auth) --? Cash? (no auth) --? Criteria comparison --? Auth package build
    |
    ?
MODULE 6: OUTPUT
    HST code resolution --? Flag aggregation + dedup --? Cost estimate --? Final output object
```

### Special Routing (Called from M1C)

Three payer-routing sub-systems handle complex insurance identification:

- **BCBS Routing** -- 4-step hierarchy: TPA check -> known prefix lookup (19,511 prefixes) -> plan type determination -> Carelon fallback
- **Payer Routing Index** -- Maps each non-BCBS payer to criteria file, portal, submission method
- **Medicare Advantage Routing** -- Identifies MA plans from MBI format/card signals, routes to appropriate criteria

### Cash and PENDING Short Circuits

Not every referral runs all 6 modules:

- **Cash patients:** M1A->M1B->M1E->ICD/NLP->M2A->M2B->M2C->M2D->**M4 (skip M3+M5)** ->M6. No insurance modules needed.
- **PENDING_ORDER:** M1 completes fully. M2C/M2D run as pre-assessment. Processing pauses. When order arrives -> re-enter at M2B with all M1 data preserved.
- **PENDING_INSURANCE:** M1A+M1B+M1E complete. M2 runs fully. Processing pauses. When insurance arrives -> re-enter at M1C with all clinical data preserved.

### Re-entry and Rerun Logic

**Re-entry** handles PENDING referrals: when missing information arrives (insurance card, new order, prior study results), processing re-enters at the specific module documented in the PENDING flag. All prior work is preserved -- M1 data carries forward through M2 re-entry, M2 data carries forward through M3 re-entry, etc.

**Rerun** handles updated referrals: when a previously-processed referral gets new information (insurance change, additional notes, corrected DOB), the system re-processes from the affected module forward. It compares the new output against the previous output and flags any changes (different test selected, different auth status, new flags generated). Both are wrappers around the main pipeline and can be built last during implementation.

---

## 3. Data Flow Between Modules

Each module receives the cumulative output of all prior modules and adds its own fields:

| Module | Receives | Produces |
|--------|----------|----------|
| **M1A** | Raw PDF filename | OCR text, document type, routing path, confidence score |
| **M1B** | OCR-extracted patient fields | Validated name/DOB, calculated age, age alerts (including PENDING_AGE_ELIGIBLE soft stop), contact info, payment type |
| **M1C** | OCR-extracted insurance fields | Identified payer (by name or format derivation), plan type signals, ID format validation (or ALERT_MISSING_MEMBER_ID), criteria file reference |
| **M1D** | Insurance data from M1C | Primary/secondary determination (if multiple plans), COB resolution |
| **M1E** | OCR-extracted provider/notes fields | Validated physician (name/NPI/credentials), document classification (Path A/B/C), notes quality, PPE alerts |
| **ICD** | Clinical text from notes | ICD-10 codes (Tier 1: specific, Tier 2: unspecified, Tier 3: description-only) |
| **NLP** | All clinical text | Context-filtered symptoms, comorbidities, medication flags, resolved conditions, language barriers |
| **M2A** | Order text, ICD codes | CPT scope (which tests are allowed), physician preference |
| **M2B** | Scope from M2A | Prior study validation (exists? recent? from where?) |
| **M2C** | Scope + comorbidities | Contraindication results (hard stops, HST blocks, soft recommendations, pediatric restrictions) |
| **M2D** | All clinical data | Sufficiency determination (sufficient / insufficient / call for questionnaire) |
| **M3** | Scope from M2 + payer from M1C | Insurance-approved CPT list, auth requirements, coverage conflicts |
| **M4** | Approved CPTs from M3 | Selected test, split night evaluation, tiebreaker reasoning |
| **M5** | Selected test + payer | Auth readiness status, complete submission package |
| **M6** | Everything above | Final output object with all fields, deduplicated flags, cost estimate, status |

---

## 4. Module Details

### Module 1A -- File Intake & OCR

The entry point. Parses the manually-labeled filename using `filename_classification.json` to determine routing (SIMPLIFIED paths for _INCOMPLETE/_MSLT/_MWT vs FULL_OCR for standard referrals). Runs OCR, scores confidence (95%+ = high, 85-89% = marginal, <85% = flag for review). Checks for multi-page documents that may need splitting/merging. Runs duplicate detection against existing referrals using the `duplicate_check_window_days` from `facility_config.json`. Applies OCR exclusion filter (also from `facility_config.json`) to prevent facility's own phone/fax/NPI/address from contaminating extracted provider fields.

### Module 1B -- Patient Validation

Extracts and validates patient name, DOB, phone, email, address. If name is missing, an alert fires but DOB/age validation still runs (age-dependent code selection must not be bypassed). Calculates age at anticipated service date (not today -- uses `anticipated_service_date_offset_days` from `facility_config.json`, default 21 days). Generates age alerts when patient will cross a clinical boundary (turning 2, 6, 10, 18) within the `age_transition_alert_window_days`. Two types of under-2 handling: hard stop (birthday > 2 months away → STOP_CANNOT_TEST) and soft stop (birthday within 2 months → PENDING_AGE_ELIGIBLE: file processes completely with pediatric codes pre-set, scheduling blocked until birthday, automatic re-entry on birthday via REENTRY_RE_AGE2 → M6_START). Determines payment type: insured vs cash vs pending insurance.

### Module 1C -- Insurance ID & Plan Type

Sequential flow: identify payer → validate format → gather signals. First identifies the payer from OCR-extracted insurance card data against `insurance.json`. If recognized, loads payer JSON and criteria file via the 3-layer chain (`payer_router.json` → `payer_[id].json` → `criteria_[id].json`). If payer name is NOT recognized, runs ID format analysis against `eligibility_combinations.json` to attempt payer derivation from format patterns (3-letter alpha prefix = BCBS, MBI pattern = Medicare, H-prefix = Humana, etc.). Format-derived identification gets `FLAG_PAYER_FROM_FORMAT` (lower confidence). If neither name nor format identify the payer, falls back to Carelon baseline with `FLAG_UNKNOWN_PAYER`. After payer identification (by either method), validates member ID format against that payer's specific rules. If no member ID was extracted, format validation is skipped with `ALERT_MISSING_MEMBER_ID`. Then gathers plan type signals (card text, ID format results, member age, BCBS retirement plans) -- these are working assumptions, not confirmations. Routes BCBS plans to the 4-step BCBS hierarchy.

### Module 1D -- COB (Coordination of Benefits)

Activates when 2+ insurance plans are detected. Runs NAIC D1-D6 rules in order: D1 (patient vs dependent), D2 (active vs COBRA/retired), D3 (custody rules for dependents), D4 (birthday rule -- earlier birthday month = primary), D5 (longer coverage = primary), D6 (fallback -- existing primary continues). Federal overrides applied first: Medicaid always last, Tricare secondary to employer plans. When auto-resolution succeeds, runs both payers through M3+ individually. When it fails, FLAG_COB_MANUAL for human resolution.

### Module 1E -- Provider & Chart Notes

The most complex M1 sub-module. Validates referring physician: name extraction, NPI format check, NPI lookup cascade (check `provider_databank.json` first -> NPPES API -> manual flag), credential validation using `signature_patterns.json` (MD/DO independent, NP/PA need supervising, MA/RN cannot order, student needs attending). Checks signature presence, type (electronic patterns from `signature_patterns.json`), and freshness (future date = STOP, >1yr = stale, 6-12mo = aging). Classifies document: Path A (e-signed referral), Path B (wet-ink order), Path C (chart notes only). Evaluates notes quality (checkbox-only, single-page, unsigned = flags). Runs PPE scan using ICD codes to flag infectious disease precautions. Includes supervising physician workaround for OON cases (facility's INN supervising MD listed on auth instead of OON referring MD).

### ICD Code Generation

Three-tier codification running after M1E: (1) Literal codes -- doctor wrote "G47.33" on the document, validated against current-year master list. (2) Tier A -- `icd10_curated.json` (84 sleep-relevant codes), fast keyword matching, covers ~80% of referrals. (3) Tier B -- `icd10_master_fy2026.json` (5,193 codes (sleep-relevant chapters)), LLM semantic matching for long-tail codes ("restless legs" -> G25.81, "bruxism" -> G47.63). Each code classified: specific (G47.33), unspecified (G47.9 -- category clear but detail isn't), or description-only (no matching code found).

### NLP Context Processing (5 Sub-Modules)

Adds clinical context that raw extraction misses: (1) **Negation detection** -- "no snoring," "denies apnea" -> symptom is ABSENT, not present. (2) **Family vs personal** -- "father had sleep apnea" -> family history, doesn't count toward patient's symptoms. (3) **Temporal context** -- "apnea resolved after surgery," "discontinued CPAP 2020" -> STATUS tags (RESOLVED, ACTIVE, DISCONTINUED, PRIOR_STUDY). (4) **Medication relevance** -- identifies opioids (FLAG_PSG_RECOMMENDED), BP meds (HTN comorbidity), sleep/psych meds (CPAP context). (5) **Language barrier** -- "interpreter needed," "Spanish-speaking" -> ALERT_LANGUAGE_BARRIER.

### Module 2A -- Order Scope

Reads the physician's order text and determines which tests are on the table. Checkbox orders: maps specific checkbox labels to CPT scope (e.g., "Complete Sleep Study" -> FULL, "Home Sleep Test" -> HST_LOCKED). Text orders: interprets language using `referral_keywords.json` ("evaluate and treat" -> FULL scope, "diagnostic only" -> PSG/HST, "titration" -> 95811 only). No order present: scope = UNKNOWN, flag PENDING_ORDER, pre-assessment mode runs M2B-M2D anyway.

### Module 2B -- Prior Results Validation

When titration or repeat study is in scope, validates prior diagnostic results: Do they exist? From what source (own facility = highest confidence, external with report = accepted, patient verbal claim = lowest)? Are they recent enough (5-year absolute max from `facility_config.json`, 1-year aging flag)? Prior PAP mentioned but no study = FLAG_REQUEST_PRIOR_STUDY.

### Module 2C -- Contraindications

All rules from `contraindications.json`. Hard stops: homebound + O2 = STOP_CANNOT_TEST, age < 2 = STOP_AGE. HST hard block: home O2 (the ONLY one). Soft recommendations: COPD, CHF, opioids, BMI>50, neuromuscular disease, central apnea -> FLAG_PSG_RECOMMENDED but HST remains available. Pediatric restrictions: 2-5 = 95782/95783 only (no HST), 6-17 = adult codes (no HST), 18+ = all available. Titration prerequisites: prior positive diagnostic required, 5yr max, 1yr aging flag.

### Module 2D -- Clinical Sufficiency

Evaluates whether extracted clinical data meets the 2-of-5 criteria threshold: (1) EDS/ESS>10, (2) snoring/gasping, (3) treatment-resistant HTN, (4) obesity (BMI>30 or neck >17M/16F), (5) craniofacial/airway abnormalities. Four sufficiency pathways: A (observed apneas), B (2-of-5), C (cardiovascular + 1 symptom), D (unexplained condition). NV Medicaid FFS is the ONLY payer requiring a sleep questionnaire -- all others: `questionnaire_required: false` in `payer_criteria_map.json`.

### Module 3 -- Insurance Scope

For each CPT in scope from M2, checks whether this payer covers it (criteria file lookup from `payer_criteria_map.json`). If not covered, attempts CPT defaulting: default-DOWN (PSG->HST if insurance covers HST and clinically safe) or default-UP (HST->PSG, generates PENDING_NEW_ORDER requiring physician approval because scope cannot expand without physician consent). Best-interest logic: when PSG not covered but HST is, and no contraindications, default to HST to avoid cash-pay for PSG.

### Module 4 -- Test Selection

When multiple tests survive M3, 5-tier tiebreaker: (1) physician preference, (2) payer preference, (3) clinical indicators, (4) contraindications remove options, (5) patient best interest (cost from `insurance_allowables.json`). Split night evaluation gate: when both diagnostic + titration in scope, evaluates distance (local cities from `facility_config.json`), prior PAP history, payer coverage, and clinical complexity before recommending split vs separate studies.

### Module 5 -- Auth Readiness

Supplements -> READY_TO_SCHEDULE (no auth). Cash -> READY_TO_SCHEDULE. Otherwise: compares extracted clinical data against criteria file requirements for this payer + CPT. Builds complete auth submission package: CPT codes, ICD-10 codes, patient demographics, clinical notes, physician info (NPI, name, credentials, address, phone, fax), facility info (from `facility_config.json`), prior auth number if extension, submission method + portal URL (from `payer_criteria_map.json`).

### Module 6 -- Output

Final assembly. HST code resolution: insured -> G0399 or 95806 per payer mapping; cash/pending -> always 95806. Flag aggregation: collects all flags from all modules, sorts STOP > PENDING > FLAG > ALERT > INFO, deduplicates (if multiple flags remove same CPT, consolidates into single flag with all reasons). Cost estimate from `insurance_allowables.json`. Produces final output object with all fields: patient, insurance, provider, clinical, ICD codes, order, test, split evaluation, CPT, auth, auth package, COB, cost estimate, flags, actions, patient safety alerts, PPE alerts, language alert, CPAP context, notes quality, re-entry point, and status.

---

## 5. JSON Architecture

The system uses 17 JSON data files organized into 4 tiers:

**Tier 1 -- Core Configuration (load at startup, used everywhere):**
`facility_config.json`, `insurance.json`, `payer_criteria_map.json`, `insurance_allowables.json`

**Tier 2 -- Validation Rules (load at startup, used in specific modules):**
`eligibility_combinations.json`, `bcbs_prefix_database.json`, `filename_classification.json`, `referral_keywords.json`, `signature_patterns.json`, `contraindications.json`, `cpt_selector_FIXED.json`

**Tier 3 -- Lookup Data (load at startup, may be large):**
`icd10_curated.json`, `icd10_master_fy2026.json`, `cpt_keywords.json`, `flags_catalog_tree_v0_19_3.json`

**Tier 4 -- Learning/Maintenance:**
`provider_databank.json` (grows with usage), `convert_icd10_master.py` (annual script)

Every module section in both the Visual Tree and the Mermaid Tree has a `DATA SOURCES` annotation listing exactly which files it needs. Follow those annotations during implementation.

---

## 6. Output Format

The final output object (M6_OUTPUT) contains these field groups:

- **Patient:** name, DOB, age, age_alerts, phone, email, address, alt_contact
- **Insurance:** payer, ID, plan_type, criteria -- OR payment = CASH / PENDING_INSURANCE
- **Provider:** ordering (NPI, name, credentials, contact), supervising (if applicable)
- **Clinical:** symptoms, comorbidities, medication_flags, resolved_conditions
- **ICD Codes:** Tier 1 (specific) + Tier 2 (unspecified) + Tier 3 (descriptions)
- **Order:** scope, physician_preference -- OR PENDING_ORDER with pre-assessment
- **Test:** selected_test, submitted_codes
- **Split:** split_favored, split_reason (if evaluated)
- **CPT:** final_code, HST_resolution
- **Auth:** required?, method, portal, status -- OR N/A for cash/pending
- **Auth Package:** complete submission data (if insured)
- **COB:** results for each payer, primary/secondary, rule applied (if multi-payer)
- **Cost Estimate:** payer-specific from `insurance_allowables.json` + UMR rules
- **Flags:** deduplicated, severity-sorted, with human action text
- **Safety Alerts:** seizures, PTSD, violence, incontinence, communication needs
- **PPE Alerts:** bloodborne/airborne/contact with specific precaution type
- **Language Alert:** interpreter needed?
- **CPAP Context:** all PAP info carried through for assessment
- **Notes Quality:** good / poor / unsigned
- **Re-entry Point:** if PENDING status
- **Status:** READY_TO_SCHEDULE / READY_FOR_AUTH / PENDING_* / STOPPED / DO_NOT_ACCEPT
