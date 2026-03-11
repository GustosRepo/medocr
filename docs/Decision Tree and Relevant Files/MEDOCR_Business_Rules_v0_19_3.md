# MEDOCR Business Rules & Assumptions v0.19.3
### Clinical Rules, Payer Exceptions, Operational Thresholds
### February 27, 2026

---

## 1. Core Operating Assumptions

**The system is a pre-processor, not a final authority.** Every output requires human review. "READY_TO_SCHEDULE" means "we found no problems" -- not "this is verified correct." Insurance verification, patient callbacks, and auth submissions are still done by staff using the system's output as a starting point.

**OCR/LLM provides structured data; the tree applies rules.** The LLM runs locally (Ollama, HIPAA compliant). It extracts fields from the PDF. The decision tree then applies deterministic rules and JSON lookups to those fields. The LLM does not make clinical or administrative decisions.

**Every referral gets processed.** Missing data triggers PENDING status with a re-entry point, not rejection. Even referrals with no order and no insurance get a clinical pre-assessment so that when the missing information arrives, the system resumes where it left off.

**Payer-specific rules override general rules.** When a payer has a specific requirement (e.g., NV Medicaid requires a questionnaire, VA treats referral as auth), that overrides the default behavior. All payer-specific rules are in `payer_criteria_map.json` and the 21 per-payer clinical criteria files.

**Payer identification is sequential: name first, then format, then signals.** M1C first checks the payer name against `insurance.json`. If recognized, it loads the payer's JSON and criteria files, then validates the member ID format against that payer's rules, then gathers plan type signals. If the payer name is NOT recognized (OCR garbled, unknown carrier), M1C checks whether the member ID format alone can identify the payer (e.g., 3-letter alpha prefix = BCBS, MBI pattern = Medicare FFS, H-prefix = Humana). Format-derived identification gets `FLAG_PAYER_FROM_FORMAT` — lower confidence than name match. If neither name nor format identify the payer, it falls back to Carelon baseline with `FLAG_UNKNOWN_PAYER`.

**Format validation requires a member ID to exist.** If the payer is identified but no member ID was extracted from the referral, format validation is skipped and `ALERT_MISSING_MEMBER_ID` fires. Processing continues to signals.

---

## 2. Clinical Rules

### Contraindication Hierarchy

The most critical clinical design decision: **Supplemental oxygen (O2) is the ONLY hard stop for HST.** All other comorbidities generate FLAG_PSG_RECOMMENDED but do NOT remove HST from scope. This matches real-world practice where patients with COPD, CHF, or even opioid use often successfully complete home sleep tests.

| Condition | Effect on HST | Effect on PSG | Flag Generated |
|-----------|---------------|---------------|----------------|
| Home O2 (supplemental oxygen) | **REMOVED** (hard block) | Available | REMOVE_HST + FLAG_PSG_RECOMMENDED |
| Homebound + O2 | Cannot test at all | Cannot test at all | **STOP_CANNOT_TEST** |
| Homebound without O2 | HST required (can't come to lab) | Not available | (none -- HST is the only option) |
| COPD | Available | Available | FLAG_PSG_RECOMMENDED |
| CHF / heart failure | Available | Available | FLAG_PSG_RECOMMENDED |
| Opioid/opiate use | Available | Available | FLAG_PSG_RECOMMENDED |
| BMI > 50 / morbid obesity | Available | Available | FLAG_PSG_RECOMMENDED |
| Neuromuscular disease | Available | Available | FLAG_PSG_RECOMMENDED |
| Central sleep apnea | Available | Available | FLAG_PSG_RECOMMENDED |
| Age < 2 | Cannot test | Cannot test | **STOP_AGE** |
| Age 2-5 | Not available | 95782/95783 only | (pediatric codes auto-selected) |
| Age 6-17 | Not available | 95810/95811 (adult codes) | FLAG_PEDIATRIC_NO_HST |
| Age 18+ | Available | Available | (all options) |

### Age Transition Rules (v0.19.3)

Two types of age-based stops exist:

**Hard stop (under 2, birthday > 2 months away):** STOP_CANNOT_TEST → FINAL_STOPPED. No processing occurs.

**Soft stop (approaching 2, birthday within 2 months):** PENDING_AGE_ELIGIBLE. The file is processed completely through the entire pipeline (insurance identification, clinical review, auth readiness) with pediatric parameters pre-set (codes 95782/95783, HST NOT allowed). Scheduling is BLOCKED until the birthday. On the birthday, automatic re-entry triggers at M6_START to regenerate output with scheduling unblocked. No reprocessing is needed because codes and criteria were pre-set during initial processing.

**Missing patient name does not skip age calculation.** If the patient name cannot be extracted from the referral but DOB is present, the system still calculates age and applies pediatric code selection. The `ALERT_MISSING_PATIENT_NAME` flag fires and carries forward, but age-dependent logic is not bypassed. Missing DOB does correctly skip age calculation (you cannot calculate age without a birth date).

### Clinical Sufficiency (2-of-5 Criteria)

Most payers require at least 2 of these 5 criteria for authorization:

1. Excessive daytime sleepiness (ESS > 10)
2. Habitual snoring or witnessed gasping/choking
3. Treatment-resistant hypertension (3+ medications)
4. Obesity (BMI > 30 or neck circumference > 17" male / 16" female)
5. Craniofacial or airway abnormalities

Four sufficiency pathways: (A) Observed apneas by bed partner -> sufficient regardless, (B) 2-of-5 -> sufficient, (C) Cardiovascular history + 1 symptom -> sufficient, (D) Unexplained condition (right heart failure, polycythemia, sleep arrhythmia, pulmonary HTN) -> sufficient.

If insufficient: FLAG_INSUFFICIENT_CLINICAL. For NV Medicaid FFS only: FLAG_CALL_FOR_QUESTIONNAIRE to call the patient and administer ESS/STOP-BANG by phone.

### Titration Prerequisites

A titration study (95811) requires a prior positive diagnostic study showing sleep apnea. The system validates:

- **Existence:** Prior diagnostic results must be on file. Prior PAP/CPAP mentioned without a study = FLAG_REQUEST_PRIOR_STUDY.
- **Source confidence:** Own facility results = highest. External with report = accepted. Patient verbal claim = lowest (flag for verification).
- **Recency:** 5-year absolute maximum (older = reject). 1-year aging threshold (older than 1yr but within 5yr = FLAG_PRIOR_STUDY_AGING). Thresholds configurable in `facility_config.json`.
- **Repeat titration:** Path A (pressure adjustment -- prior titration exists, need new one) vs Path B (first titration -- diagnostic exists, no prior titration).

### Split Night Criteria

Split night study evaluated when both diagnostic (95810) and titration (95811) are in scope:

- AHI threshold: >= 20 events/hour during diagnostic portion (configurable in `facility_config.json`)
- Minimum titration time: >= 3 hours remaining after diagnostic portion
- Distance factor: patient must be LOCAL (service area cities in `facility_config.json`) -- split night is inefficient if patient traveled far and needs to return for a separate titration anyway
- Prior PAP: if patient has prior PAP history, split is more appropriate (they'll likely need titration)
- Payer coverage: some payers don't cover split night -- removed in M3 before reaching M4
- **Cash payment gate:** Cash/pending patients selecting split night must pass through the payment gate (M4_SPLIT_PAY) which routes them to the cash cost comparison section ($650 split night vs $1,250 for two separate nights). There is no bypass around this gate.

### ICD-10 Coding Principles

- Literal codes on the document (doctor wrote "G47.33") are always accepted after validation against master list
- Tier A (curated) covers ~80% of referrals with fast keyword matching
- Tier B (full ICD-10) only runs when Tier A has no match -- slower but catches long-tail codes
- Unspecified codes (e.g., G47.9) are acceptable when the category is clear but specific detail isn't
- Description-only (no matching code) is acceptable -- carries the clinical text forward
- All codes validated against current-year CMS master list. Retired codes flagged.

---

## 3. Payer-Specific Exceptions

### Hard-Coded Exceptions (Not General Rules)

| Payer | Exception | Why |
|-------|-----------|-----|
| **NV Medicaid FFS** | NEVER allows HST. Always requires PSG. If HST ordered -> requires new Rx. ONLY payer requiring sleep questionnaire. | State Medicaid policy. |
| **VA** | Referral = authorization. No separate auth process. Must schedule within 7 days of referral receipt. | Federal VA policy. |
| **Medicare FFS** | No auth for in-lab (PSG, titration). HST requires auth from Palmetto/CGS MAC. | CMS policy. |
| **UMR** | Charge at HPN rates ($334.04 HST). Actual reimbursement ~$900 for HST. Special billing rules. | Contractual arrangement. |
| **Aetna** | Dual submission check: If Evicore says "no auth required" -> also check Availity. Both must confirm. | Aetna-specific verification requirement. |
| **Meritain Health** | Call Meritain first before any portal submission. Phone-first workflow. | Meritain processing requirement. |
| **Anthem Medicaid** | Uses Carelon criteria but submits via Availity/fax (not Carelon portal). | State Medicaid Anthem variant. |

### HST Code Resolution (G0399 vs 95806)

When final test = HST, the CPT code depends on the payer:
- Medicare and payers following CMS coding -> G0399
- Most commercial payers -> 95806
- Cash / pending insurance -> always 95806 (G0399 is payer-specific)
- Detailed rules in `HST_Code_Resolution_Logic.md` and `payer_criteria_map.json`

### BCBS Complexity

BCBS is not one payer -- it's 36 independent state plans sharing a brand. Every BCBS referral runs the full 4-step routing hierarchy regardless of plan type signals:

1. **TPA Check** -- Is Quantum Health or Benesys/Union managing this plan? If yes, different auth rules.
2. **Known Prefix** -- Look up 3-letter prefix in `bcbs_prefix_database.json` (19,511 prefixes). Verified -> use exact rules. Unverified -> use rules + FLAG_VERIFY_AUTH. New -> FLAG_NEW_PREFIX.
3. **Plan Type** -- Determine FEP/retirement/Medicaid/supplement/MA/standard. Each has different auth handling.
4. **Carelon Fallback** -- If still unresolved, use Carelon as the baseline auth handler.

Plan type can be discovered at ANY step. The system doesn't assume plan type from card text -- it gathers signals and makes a working determination that manual verification confirms or corrects.

---

## 4. Operational Thresholds

All numeric thresholds are configurable in `facility_config.json` rather than hardcoded:

| Parameter | Default | Used In | Meaning |
|-----------|---------|---------|---------|
| `anticipated_service_date_offset_days` | 21 | M1B | Age calculated at this many days from today (not today's date) |
| `age_transition_alert_window_days` | 60 | M1B | Alert if patient will cross age boundary (2, 6, 18, 65) within this window |
| `duplicate_check_window_days` | 30 | M1A | Flag if same patient + physician + test exists in system within this window |
| `signature_stale_threshold_days` | 365 | M1E | Signature older than this = FLAG_SIGNATURE_STALE |
| `signature_aging_threshold_days` | 180 | M1E | Signature older than this (but within stale) = INFO_SIGNATURE_AGING |
| `prior_study_absolute_max_years` | 5 | M2B | Prior study older than this = rejected |
| `prior_study_aging_threshold_years` | 1 | M2B | Prior study older than this (within max) = FLAG_PRIOR_STUDY_AGING |
| `split_night_ahi_threshold` | 20 | M4 | AHI >= this during diagnostic portion -> eligible for split titration |
| `split_night_minimum_titration_hours` | 3 | M4 | Must have >= this many hours remaining after diagnostic for titration |
| `va_scheduling_window_days` | 7 | Payer | VA referrals must be scheduled within this window |

---

## 5. Scope Rules

**Scope defines the ceiling.** The physician's order determines the maximum set of tests available. The system can only narrow scope -- never expand it.

| Order Language | Scope | Meaning |
|----------------|-------|---------|
| "Evaluate and treat" / "Complete sleep study" | FULL | All codes available: HST, PSG, split, titration |
| "Diagnostic only" / "Polysomnogram" | DIAGNOSTIC | PSG and HST only (no titration unless split) |
| "Home sleep test" | HST_LOCKED | HST only |
| "Titration" / "CPAP study" | TITRATION_LOCKED | 95811 only (requires prior positive diagnostic) |
| No order present | UNKNOWN | PENDING_ORDER -- pre-assessment runs, full scope assumed when order arrives |
| Ambiguous language | FLAG | FLAG_AMBIGUOUS_ORDER -- human review determines scope |

**Scope contraction path:** FULL -> remove tests patient can't do (contraindications) -> remove tests payer won't cover (M3) -> tiebreaker if multiple remain (M4).

**Scope expansion is NEVER automatic.** If insurance covers PSG but not HST, and the order says "home sleep test" (HST_LOCKED), the system generates PENDING_NEW_ORDER -- it does not upgrade to PSG without physician consent.

---

## 6. COB (Coordination of Benefits) Rules

When 2+ insurance plans detected, the system runs NAIC determination in this order:

**Federal overrides (checked first):**
- Medicaid is ALWAYS secondary/tertiary (last payer)
- Tricare is secondary to employer-sponsored plans
- FEHB (Federal Employee) follows standard NAIC rules

**NAIC D1-D6 (checked in order):**
- D1: Patient's own plan is primary over plan where patient is a dependent
- D2: Active employee plan is primary over COBRA/retired plan
- D3: Custody rules for dependent children (custodial parent's plan, then custodial step-parent, then non-custodial parent)
- D4: Birthday rule -- parent whose birthday falls earlier in the calendar year has primary plan (NOT older parent)
- D5: Longer continuous coverage = primary
- D6: Fallback -- existing primary/secondary designation continues

**After determination:** If both payers are INN, run each through M3+ individually. If primary is OON, standard OON stop applies (secondary being INN does NOT override). If secondary is OON but primary is INN, process under primary with OON secondary noted in output.

---

## 7. Flag Design Principles

- **Every flag has a human action.** No flag exists just to say "something happened." Each one tells the staff member exactly what to do.
- **Severity is meaningful.** STOP = nothing else can happen until resolved. PENDING = waiting for specific info with a re-entry point. FLAG = attention needed but processing continues. ALERT = informational, carried to scheduling. INFO = FYI.
- **Deduplication at output.** If M2C removes HST for pediatric and M3 removes HST for NV Medicaid, the output shows one REMOVE_HST flag with both reasons listed.
- **Flags never contradict.** A STOP flag cannot coexist with READY_TO_SCHEDULE. The highest-severity flag determines status.

---

## 8. Data Assumptions

- **Re-entry preserves all prior work.** When a PENDING referral gets its missing data, the system resumes at the documented re-entry module -- it does not re-process from scratch. M1 data carries through M2 re-entry; M2 data carries through M3 re-entry.
- **Rerun compares old vs new output.** When a processed referral gets updated information (insurance change, new notes), the system re-runs from the affected module and flags any differences in the output (different test, different auth status, new flags).
- **Filename contains manual classification.** Files are pre-labeled during intake with suffixes (_INCOMPLETE, _95810, etc.) that provide routing hints.
- **OCR/LLM provides structured JSON.** The decision tree receives already-extracted fields, not raw text.
- **One referral = one primary patient.** Multi-patient documents are split in M1A before processing.
- **Insurance cards are present or not.** The system doesn't OCR insurance cards separately -- card data is part of the referral document or manually entered.
- **NPI format is 10 digits.** Anything else is treated as missing and triggers name-based lookup.
- **Phone is required for scheduling.** No phone number = ALERT_MISSING_PATIENT_CONTACT (not a stop, but scheduling staff need it).
- **Cash pay bypasses all insurance logic.** M3 and M5 are skipped entirely. Test selection happens at facility cash rates from `insurance_allowables.json` Self Pay entry.
