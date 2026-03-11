# MEDOCR Developer Handoff v0.19.3
### Prepared for: Gus (Development Team)
### February 27, 2026

---

## What Is This Project?

MEDOCR is a healthcare workflow automation system that processes sleep study referral PDFs. A high-volume sleep lab receives 60-125 faxed referrals per day. Currently, a human manually reads each PDF, extracts patient/insurance/clinical data, identifies problems, determines which test to order, checks insurance requirements, and prepares authorization paperwork. This takes ~25 hours/week.

The decision tree (this deliverable) is the complete clinical and administrative logic that determines: what data to extract, what problems to flag, which test to select, how to handle insurance routing, and what output to produce. It is the "brain" that tells the code what to do with OCR-extracted data.

The system processes locally (HIPAA compliant, no cloud PHI transmission). OCR + LLM runs on local Ollama models. All logic is deterministic rules + JSON lookups -- no AI judgment calls on clinical decisions.

---

## What You're Getting

### Decision Tree (Primary Deliverable)

| File | Purpose |
|------|---------|
| `MEDOCR_Visual_Decision_Tree_v0_19_3.html` | **Human-readable reference.** 22 sections, 33 mermaid diagrams, explanatory notes, 14 data source boxes. Open in any browser. |
| `MEDOCR_Unified_Decision_Tree_v0_19_3.mermaid` | **Code conversion source.** 1,394 lines. Master data source index at top. Section-level data source comments throughout. Feed this to code generation. |

Use the Visual Tree to understand the logic. Use the Mermaid to convert to code. Every module section in both files tells you exactly which JSON files to load.

### JSON Data Files (17 files)

Load at startup in this order (`facility_config.json` FIRST because its OCR exclusion filter must be active before any document processing):

| # | File | Records | Module(s) |
|---|------|---------|-----------|
| 1 | `facility_config.json` | 5 sections + 10 operational params | All modules |
| 2 | `insurance.json` | 99 carriers | M1C |
| 3 | `payer_criteria_map.json` | 27 payers | M1C, M3, M5, M6 |
| 4 | `insurance_allowables.json` | 34 payers + Self Pay, 112 rates | M4, M6 |
| 5 | `eligibility_combinations.json` | 21 payers, 75 combos | M1C |
| 6 | `bcbs_prefix_database.json` | 19,511 prefixes | BCBS routing |
| 7 | `filename_classification.json` | 14 patterns + default | M1A |
| 8 | `referral_keywords.json` | ~80 phrases, 6 categories | M1E, M2A |
| 9 | `signature_patterns.json` | ~50 patterns, 5 categories | M1E |
| 10 | `provider_databank.json` | Schema (grows with usage) | M1E |
| 11 | `contraindications.json` | 2 hard stops, 1 HST block, 6 soft recs, 4 ped tiers | M2C |
| 12 | `flags_catalog_tree_v0_19_3.json` | 105 flags | All modules |
| 13 | `icd10_curated.json` | 84 codes | ICD scan Tier A |
| 14 | `icd10_master_fy2026.json` | 5,193 codes (sleep-relevant chapters) | ICD scan Tier B |
| 15 | `cpt_selector_FIXED.json` | 6 rule categories | M2A, M4 |
| 16 | `cpt_keywords.json` | CPT->keyword map | OCR extraction |
| 17 | `convert_icd10_master.py` | Script | Annual ICD update (not runtime) |

### Per-Payer Clinical Criteria Files (21 files)

Files named `*_Clinical_Criteria.md` -- one per payer. These document what clinical evidence each insurance company requires to authorize a sleep study. Referenced by `payer_criteria_map.json` via the `criteria_file` field. Payers covered: Carelon, Caresource, ChampVA, EBMS, Evicore, First Health Network, GEHA, Humana, LV Firefighters, Medicare FFS, Molina, Multiplan PHCS, Nevada Medicaid FFS, Sierra HPN, Silversummit, Tricare, UHC, UMR, Unknown Insurance Protocol, VA, Workers Comp DOL.

### Knowledge Base & Routing Files (7 files)

| File | Purpose |
|------|---------|
| `BCBS_Complete_Payer_Knowledge_Base.md` | BCBS affiliate details |
| `BCBS_IDFormat_ImmediateOverride.md` | BCBS ID format special rules |
| `BCBS_ThreeTier_Feedback_Architecture.md` | BCBS prefix verification tiers |
| `NonBCBS_Payer_Knowledge_Base_v015.md` | Non-BCBS payer details |
| `PAYER_ROUTING_INDEX_v2.md` | Master payer routing reference |
| `Medicare_Advantage_Routing_Guide.md` | MA plan identification and routing |
| `HST_Code_Resolution_Logic.md` | G0399 vs 95806 resolution rules |

---

## JSON File Details

**`facility_config.json`** -- The most critical config file. Five sections: (1) Facility identity (NPI, name, address, phone, fax) used in M5 auth packages, (2) OCR exclusion filter -- prevents facility's own phone/fax/NPI from being extracted as referring provider data, (3) Supervising/interpreting physicians for OON workaround and auth packages, (4) Service area cities for M4 split night distance check, (5) Operational parameters -- every numeric threshold in the tree (duplicate window, age offset, signature staleness, prior study max, split night AHI threshold, etc.). Contains PLACEHOLDERs for actual facility data -- fill in during setup.

**`insurance.json`** -- Categorized list of insurance carriers: `accepted` (in-network), `oon_auto_flag` (out-of-network), `do_not_accept` (hard stop), notes per carrier. Used in M1C.

**`payer_criteria_map.json`** -- For each of 27 payers: which clinical criteria file to use, whether auth is required per CPT code, submission portal URL, submission method (portal/fax/phone), special rules. The lookup table for M3 and M5.

**`insurance_allowables.json`** -- Contracted rates per payer per CPT. 34 payers, 112 rate entries. Used in M4 (cost tiebreaker) and M6 (cost estimate). Includes UMR special billing and Self Pay rates ($250 HST, $600 PSG, $650 titration, $1,200 pediatric).

**`eligibility_combinations.json`** -- For 21 payers, which combinations of patient fields (member_id + DOB, name + DOB, etc.) the payer's eligibility system accepts. Used in M1C to flag exactly what's missing.

**`bcbs_prefix_database.json`** -- 19,511 BCBS alpha prefixes. Each maps to state plan, plan type, authorization handler, rules, and verified date.

**`filename_classification.json`** -- 14 filename suffix patterns (e.g., `_INCOMPLETE`, `_95810`, `_Chart Notes`) -> routing decisions (SIMPLIFIED vs FULL_OCR), expected study type, validation path. Used by M1A as the very first decision.

**`referral_keywords.json`** -- ~80 keyword phrases across 6 categories: explicit referral, order language, implicit order, test-type mapping, checkbox interpretation, non-referral indicators. Used in M1E document validation and M2A order scope interpretation (e.g., "eval and treat" -> FULL scope).

**`signature_patterns.json`** -- ~50 patterns: e-signature detection (EHR systems, /s/), credential tiers (MD/DO independent, NP/PA need supervising, MA/RN cannot order), signature freshness rules (future=STOP, >1yr=stale, 6-12mo=aging, <6mo=OK), NPI validation cascade (databank -> NPPES -> manual).

**`provider_databank.json`** -- Known referring providers. Schema + empty template that grows automatically with usage. After processing 50 referrals from Dr. Smith, the system knows his NPI, credentials, and OCR spelling variants. Referral #51 validates instantly.

**`contraindications.json`** -- Clinical blocking rules. Key principle: O2 is the ONLY hard HST stop. COPD/CHF/opioids/BMI>50/neuromuscular/central apnea = FLAG_PSG_RECOMMENDED but HST remains available. Also: pediatric age restrictions, titration prerequisites, homebound+O2 = STOP_CANNOT_TEST.

**`flags_catalog_tree_v0_19_3.json`** -- 105 flags with ID, severity tier, description, human action text, source module. Used by M6 for aggregation, deduplication, and severity sorting. Includes 3 new flags added in v0.19.3: `PENDING_AGE_ELIGIBLE` (approaching-2 soft stop), `FLAG_PAYER_FROM_FORMAT` (payer derived from ID format), `ALERT_MISSING_MEMBER_ID` (payer identified but no member ID).

**`icd10_curated.json`** -- 84 sleep-relevant ICD-10 codes with categories, keyword triggers, and scheduling alerts. Tier A: fast keyword match, covers ~80% of referrals.

**`icd10_master_fy2026.json`** -- Full CMS FY2026 ICD-10-CM master list (5,193 codes (sleep-relevant chapters)). Tier B fallback for when curated list has no match.

**`cpt_selector_FIXED.json`** -- CPT codes with age rules, payer-specific variations, hierarchy, and scope logic.

**`cpt_keywords.json`** -- CPT code -> keyword mapping used during OCR extraction.

**`convert_icd10_master.py`** -- Annual maintenance script. Downloads CMS CSV -> generates JSON. Run once/year when CMS publishes (usually October 1).

---

## Node ID Convention (Mermaid Tree)

Every node: `{MODULE_PREFIX}_{NODE_NAME}`

| Prefix | Module | Example |
|--------|--------|---------|
| `M1A_` | File Intake | `M1A_FILE`, `M1A_PARSE` |
| `M1B_` | Patient | `M1B_PAT`, `M1B_AGE_CALC` |
| `M1B_CT_` | Patient Contact | `M1B_CT_PHONE` |
| `M1C_` | Insurance | `M1C_KNOWN`, `M1C_COB_CHK` |
| `M1C_FMT_` | ID Format | `M1C_FMT_ID_START` |
| `COB_` | COB | `COB_COB`, `COB_RESOLVED` |
| `COB_DUAL_` | COB Dual Pipeline | `COB_DUAL_RESULT` |
| `M1E_` | Provider & Notes | `M1E_START`, `M1E_SIG` |
| `M1E_QUAL_` | Notes Quality | `M1E_QUAL_START` |
| `M1E_PPE_` | PPE / ICD Code Gen | `M1E_PPE_EXTRACT` |
| `ICD_` | ICD Scan | `ICD_ICD`, `ICD_FACTS` |
| `NLP_NEG_` | Negation | `NLP_NEG_NEG_START` |
| `NLP_FAM_` | Family/Personal | `NLP_FAM_FAM_START` |
| `NLP_TEMP_` | Temporal | `NLP_TEMP_TEMP_START` |
| `NLP_MED_` | Medication | `NLP_MED_MED_START` |
| `NLP_LANG_` | Language | `NLP_LANG_LANG_START` |
| `M2A_` | Order Scope | `M2A_ORDER` |
| `M2A_HIER_` | CPT Hierarchy | `M2A_HIER_TOP` |
| `M2B_` | Prior Results | `M2B_SCOPE` |
| `M2C_` | Contraindications | `M2C_SCOPE`, `M2C_O2` |
| `M2D_` | Sufficiency | `M2D_SUFF` |
| `M3_` | Insurance Scope | `M3_START`, `M3_DONE` |
| `M4_` | Test Selection | `M4_START`, `M4_FINAL` |
| `M4_SPLIT_` | Split Night | `M4_SPLIT_ENTRY` |
| `M5_` | Auth Readiness | `M5_START` |
| `M6_` | Output | `M6_START`, `M6_OUTPUT` |
| `BCBS_` | BCBS Routing | `BCBS_BCBS`, `BCBS_STEP1` |
| `PAYER_` | Payer Routing | `PAYER_TYPE` |
| `MA_` | Medicare Advantage | `MA_MA` |
| `REENTRY_` | Re-entry Points | `REENTRY_RE_M2B_ORD` |
| `RERUN_` | Rerun Logic | `RERUN_OUTPUT` |

Bridge nodes (no prefix, in cross-module connections): `ENTRY`, `NLP_DISPATCH`, `NLP_COMPLETE`, `COB_CHECK`, `M2D_ORDER_CHK`, `M2D_PAY_ROUTE`, `FINAL_STOPPED`, `FINAL_DONE`

---

## Mermaid Syntax -> Code

| Mermaid | Code Meaning |
|---------|-------------|
| `NODE{...}` | **Decision** -- if/else or switch. Label = the question. |
| `NODE[...]` | **Action** -- execute logic, set values, generate flags. |
| `NODE([...])` | **Terminal** -- start/end of path or module boundary. |
| `A -->|"condition"| B` | **Branch** -- if condition true, go A->B. |
| `A --> B` | **Unconditional** -- always A->B. |
| `style NODE fill:color` | **Visual only** -- red=STOP, yellow=FLAG, green=OK. Ignore in code. |
| `%% DATA SOURCES:` | **Comment** -- lists JSON files needed for that section. |

---

## Key Design Decisions

These are the non-obvious choices baked into the tree that a developer needs to understand:

1. **Scope never expands.** The physician's order defines maximum scope. The system can narrow (remove tests the patient can't do or insurance won't cover) but never adds tests beyond what was ordered.

2. **O2 is the ONLY hard HST stop.** COPD, CHF, opioids, BMI>50, neuromuscular, central apnea -> FLAG_PSG_RECOMMENDED but HST remains available. This matches real-world practice where many of these patients successfully complete HSTs.

3. **OCR exclusion filter is essential.** Every faxed referral contains the facility's own phone/fax/NPI/address in headers, cover sheets, and "Referred To" fields. Without `facility_config.json` filtering, the system confuses facility data with referring provider data on virtually every fax.

4. **provider_databank.json starts empty and learns.** It's a cache that grows automatically. Don't pre-populate it. After processing referrals, it builds itself.

5. **facility_config.json makes the system portable.** A different sleep lab fills in their own config and the tree works unchanged. All hardcoded thresholds (duplicate window, age offset, signature staleness, split night criteria, etc.) are in this one file.

6. **PENDING is not STOPPED.** PENDING referrals have completed as much processing as possible. When missing info arrives, the system re-enters at a specific module (documented in each PENDING flag) and carries forward all prior work.

7. **Cash patients skip insurance modules.** Payment type = CASH -> skip M3 + M5, go directly to M4 for test selection at facility cash rates (from `insurance_allowables.json` Self Pay entry).

8. **COB auto-resolves via NAIC.** When 2+ plans detected, system runs D1-D6 rules automatically. Manual resolution is the fallback only when auto-resolution fails.

9. **BCBS routing is always the full 4-step hierarchy.** No shortcuts. Every BCBS plan: TPA check -> known prefix -> plan type determination -> Carelon fallback. Plan type can be discovered at any step.

10. **The tree is the single source of truth.** The Framework and Business Rules documents explain the "why." The tree is the "what." If there's ever a conflict, the tree wins.

11. **M1C payer identification and format validation are sequential, not parallel.** The tree first identifies the payer (by name from insurance.json, or by ID format pattern if name is unrecognized), then validates the member ID format against that payer's rules, then gathers plan type signals. Unknown payers whose ID format matches a known pattern (e.g., 3-letter alpha prefix = BCBS) get `FLAG_PAYER_FROM_FORMAT` — lower confidence than name match, confirm during verification.

12. **Missing patient name does NOT skip age calculation.** If name is missing but DOB is present, age is still calculated and pediatric codes are still selected correctly. The `ALERT_MISSING_PATIENT_NAME` flag fires and carries forward, but DOB/age validation is not bypassed. (Missing DOB does skip age calculation — you can't calculate age without a birth date.)

13. **Approaching-2 is a soft stop, not a hard stop.** Patients within 2 months of their 2nd birthday get fully processed (insurance, clinical, auth readiness) with pediatric codes pre-set (95782/95783, HST NOT allowed), but scheduling is BLOCKED until the birthday. Status = `PENDING_AGE_ELIGIBLE`. On the birthday, `REENTRY_RE_AGE2` auto-triggers → M6_START to regenerate output with scheduling unblocked. No reprocessing needed.

14. **Split night cash patients must pass through the payment gate.** `M4_SPLIT_SELECT_SPLIT` has exactly ONE outbound arrow → `M4_SPLIT_PAY`, which routes INSURED patients back to M4 and CASH/PENDING patients into the cash cost comparison section ($650 split vs $1,250 separate nights). There is no bypass.

---

## Implementation Order

Build modules in pipeline order. Each module's output feeds the next:

```
M1A (File Intake) -> M1B (Patient) -> M1C (Insurance) -> M1D (COB) -> M1E (Provider/Notes)
    ?
ICD Code Generation + NLP Context Processing
    ?
M2A (Order Scope) -> M2B (Prior Results) -> M2C (Contraindications) -> M2D (Sufficiency)
    ?
M3 (Insurance Scope) -> M4 (Test Selection + Split Night) -> M5 (Auth Readiness) -> M6 (Output)
```

Supporting routing (called from M1C): BCBS Routing, Payer Routing Index, Medicare Advantage Routing.

Re-entry and Rerun logic can be built last -- they're wrappers around the main pipeline.

---

## Future Modules (Not Yet Built)

These are planned but NOT part of this deliverable:

- **Authorization Form Generator** -- Auto-fills payer-specific auth forms from M6 output
- **Scheduling Integration** -- Calendar/EMR integration for READY_TO_SCHEDULE
- **Learning System** -- Staff feedback loop to improve OCR accuracy and flag relevance
- **Batch Processing Dashboard** -- Visual summary of daily referral processing
- **fax_templates.json** -- The only remaining unbuilt JSON file (for auth form auto-generation)
