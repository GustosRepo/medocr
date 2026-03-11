# MEDOCR Glossary v0.19.3
### February 27, 2026

---

## Clinical Terms

| Term | Meaning |
|------|---------|
| **PSG** | Polysomnography -- in-lab overnight sleep study. Gold standard. CPT 95810. |
| **HST / HSAT** | Home Sleep Test. Portable device, patient sleeps at home. CPT 95806 (or G0399 for Medicare). |
| **Titration** | PAP titration -- calibrates CPAP pressure. In-lab only. CPT 95811. Requires prior positive diagnostic. |
| **Split Night** | Diagnostic + titration in one night. If AHI >= 20 in first 2hrs with >= 3hrs remaining -> titrate. CPT 95810+95811. |
| **CPAP / PAP** | Continuous Positive Airway Pressure -- treatment device for sleep apnea. |
| **AHI** | Apnea-Hypopnea Index -- severity score. >=5 mild, >=15 moderate, >=30 severe. Split night threshold: >= 20. |
| **ESS** | Epworth Sleepiness Scale -- questionnaire. Score >10 = excessive daytime sleepiness. |
| **STOP-BANG** | OSA risk screener: Snoring, Tired, Observed apnea, Pressure (HTN), BMI>35, Age>50, Neck>40cm, Gender. |
| **OSA** | Obstructive Sleep Apnea. |
| **CSA** | Central Sleep Apnea -- brain fails to signal breathing. Soft recommendation for PSG over HST. |
| **EDS** | Excessive Daytime Sleepiness. |
| **O2** | Supplemental oxygen -- the ONLY hard stop for HST. |
| **Comorbidity** | Co-existing condition (COPD, CHF, obesity, etc.) that may affect test selection. |
| **Contraindication** | Condition making a test inappropriate. Hard stop = cannot test. Soft = recommend different test but can proceed. |
| **NPI** | National Provider Identifier -- unique 10-digit physician/facility ID. |
| **NPPES** | National Plan & Provider Enumeration System -- CMS NPI registry (nppes.cms.hhs.gov). |
| **ICD-10** | Diagnostic codes (e.g., G47.33 = OSA). Current year: FY2026, 5,193 codes (sleep-relevant chapters). |
| **CPT** | Procedure codes (e.g., 95810 = PSG, 95806 = HST). |
| **PPE** | Personal Protective Equipment -- bloodborne/airborne/contact precautions from infectious disease ICD codes. |

---

## Insurance & Administrative Terms

| Term | Meaning |
|------|---------|
| **Auth / Prior Auth** | Prior Authorization -- insurance pre-approval before performing a test. |
| **COB** | Coordination of Benefits -- determines primary vs secondary with 2+ insurance plans. |
| **NAIC** | National Association of Insurance Commissioners -- publishes D1-D6 COB determination rules. |
| **OON / INN** | Out of Network / In Network. OON = hard stop; we don't accept the payer. |
| **BCBS** | Blue Cross Blue Shield -- 36 independent state plans. Same name, different rules per state. |
| **Prefix** | BCBS 3-letter alpha code on member ID -> specific state plan, plan type, auth rules. 19,511 known prefixes. |
| **MA / Medicare Advantage** | Medicare Part C -- private plan replacing FFS. Different auth requirements than original Medicare. |
| **MBI** | Medicare Beneficiary Identifier -- 11-character ID with specific pattern (replaced HICN). |
| **Supplement / Medigap** | Secondary insurance covering Medicare gaps. No auth needed. |
| **FFS** | Fee For Service -- traditional Medicare (Part A/B). No auth for in-lab; HST requires MAC auth. |
| **Evicore** | Third-party auth company for Aetna, Cigna, Anthem. Portal: evicore.com. |
| **Carelon** | Behavioral health auth manager for Anthem Medicaid and some BCBS plans. |
| **Availity** | Multi-payer portal for benefits and auth. Backup verification for some payers. |
| **UMR** | TPA for employer self-funded plans. Uses UHC network. Special billing: charge HPN rates, reimburse ~$900 HST. |
| **TPA** | Third Party Administrator -- manages benefits for self-funded employer plans. |
| **G0399** | Medicare-specific HCPCS code for HST. Some payers use G0399 instead of 95806. |

---

## System Terms

| Term | Meaning |
|------|---------|
| **OCR** | Optical Character Recognition -- scanned PDF -> machine-readable text. |
| **LLM** | Large Language Model -- extracts structured data from OCR text. Local Ollama (HIPAA compliant). |
| **NLP** | Natural Language Processing -- 5 context sub-modules (negation, family/personal, temporal, medication, language). |
| **Decision Tree** | 521 nodes, 32 sections. Processes extracted data through M1->M6 to produce final output. |
| **Scope** | CPT codes the physician's order allows. Types: FULL, DIAGNOSTIC, HST_LOCKED, TITRATION_LOCKED. |
| **Criteria File** | Payer-specific auth requirements document. 21 files, referenced by `payer_criteria_map.json`. |
| **Re-entry Point** | When PENDING, the exact module to resume when missing info arrives. All prior work preserved. |
| **Rerun** | Re-processing after new info (updated insurance, new order, additional notes). |
| **Validation Path** | M1E document type: A = e-signed referral, B = wet-ink order, C = chart notes only. |
| **OCR Exclusion Filter** | `facility_config.json` mechanism preventing facility's own data from being extracted as provider data. |
| **Format-Derived Payer** | Payer identified from member ID format (not name). Lower confidence. Flagged with `FLAG_PAYER_FROM_FORMAT`. |
| **3-Layer Chain** | Payer resolution: `payer_router.json` → `payer_[id].json` → `criteria_[id].json`. Every payer resolves through all 3 layers. |
| **Soft Stop** | Processing completes fully but scheduling is blocked. Used for PENDING_AGE_ELIGIBLE (approaching-2 birthday). |
| **REENTRY_RE_AGE2** | Automatic date-triggered re-entry point. Fires on patient's 2nd birthday → M6_START to regenerate output with scheduling unblocked. |

---

## Flag Severity Tiers

| Tier | Label | Prefix | Meaning | Action |
|------|-------|--------|---------|--------|
| 1 | **STOP** | `STOP_` | Hard block. Cannot proceed. | Resolve before processing continues. |
| 2 | **PENDING** | `PENDING_` | Missing info. Processing paused. | Has re-entry point for when info arrives. |
| 3 | **FLAG** | `FLAG_` | Problem found, processing continues. | Human review during scheduling. |
| 4 | **ALERT** | `ALERT_` | Informational, carried to scheduling. | Note for scheduler (PPE, safety, language). |
| 5 | **INFO** | `INFO_` | FYI only. | Awareness, no action needed. |

---

## Final Status Labels

| Status | Meaning | Next Step |
|--------|---------|-----------|
| **READY_TO_SCHEDULE** | All clear, no auth needed. | Schedule patient. |
| **READY_FOR_AUTH** | Auth package assembled. | Submit via specified portal/method. |
| **PENDING_ORDER** | No physician order. Pre-assessment done. | Request order. Re-enter M2B. |
| **PENDING_INSURANCE** | No insurance info. Clinical done. | Get insurance. Re-enter M1C. |
| **PENDING_NEW_ORDER** | Order doesn't match coverage. | Request new order. Re-enter M2B. |
| **PENDING_PRIOR_RESULTS** | Titration but no prior diagnostic. | Request prior study. Re-enter M2B. |
| **PENDING_AGE_ELIGIBLE** | Patient approaching 2nd birthday (within 2 months). Fully processed, scheduling blocked until birthday. | Wait for birthday. Auto re-entry via REENTRY_RE_AGE2 → M6_START. |
| **STOPPED** | Hard stop (OON, underage, homebound+O2). | Resolve or reject referral. |
| **DO_NOT_ACCEPT** | Payer on do-not-accept list. | Return referral to physician. |

---

## CPT Codes

| Code | Test | Age | In-Lab | Notes |
|------|------|-----|--------|-------|
| **95806** | HST | 18+ | No | Standard home sleep test. |
| **G0399** | HST (Medicare) | 18+ | No | Same test, Medicare/CMS coding. |
| **95810** | PSG | 6+ | Yes | Diagnostic in-lab overnight. |
| **95811** | Titration | 6+ | Yes | CPAP calibration. Needs prior positive diagnostic. |
| **95782** | Pediatric PSG | 2-5 | Yes | Required for ages 2-5. |
| **95783** | Pediatric Titration | 2-5 | Yes | Required for ages 2-5. |

---

## Module Map

| Module | Name | Purpose |
|--------|------|---------|
| **M1A** | File Intake & OCR | Filename parsing, OCR, confidence scoring, duplicate detection |
| **M1B** | Patient Validation | Name, DOB, age calculation (even if name missing), age transition alerts, approaching-2 soft stop, contact extraction, payment type |
| **M1C** | Insurance ID | Sequential: payer identification (by name or format derivation) → format validation (or ALERT_MISSING_MEMBER_ID) → plan type signals |
| **M1D** | COB | Coordination of Benefits with 2+ plans |
| **M1E** | Provider & Notes | Physician validation, signature/credential check, document classification, PPE scan |
| **ICD** | ICD Code Generation | Tier A (curated keyword) + Tier B (full ICD-10 LLM) codification |
| **NLP** | Context Processing | Negation, family/personal, temporal, medication, language barrier |
| **M2A** | Order Scope | Physician order -> CPT scope determination |
| **M2B** | Prior Results | Prior study validation: existence, source, recency |
| **M2C** | Contraindications | Hard stops, HST blocks, soft recommendations, pediatric restrictions |
| **M2D** | Clinical Sufficiency | 2-of-5 criteria, questionnaire triggers |
| **M3** | Insurance Scope | Criteria file lookup, coverage check, CPT defaulting |
| **M4** | Test Selection | 5-tier tiebreaker, split night evaluation |
| **M5** | Auth Readiness | Criteria comparison, auth package assembly |
| **M6** | Output | HST code resolution, flag dedup, cost estimate, final object |
| **BCBS** | BCBS Routing | 4-step: TPA -> prefix -> plan type -> Carelon fallback |
| **Payer** | Payer Routing | Non-BCBS payer -> criteria file mapping |
| **MA** | Medicare Advantage | MA identification and routing |
