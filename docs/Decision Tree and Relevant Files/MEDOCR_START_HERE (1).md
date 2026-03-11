# MEDOCR v0.19.3 -- START HERE
### February 27, 2026

---

## Reading Order

1. **This document** -- file inventory and reading order
2. **`MEDOCR_Glossary_v0_19_3.md`** -- Terms, acronyms, flag types. Skim this first so the rest makes sense.
3. **`MEDOCR_Developer_Handoff_v0_19_3.md`** -- Architecture, file descriptions, node ID conventions, key design decisions, implementation order. Your primary implementation guide.
4. **`MEDOCR_System_Framework_v0_19_3.md`** -- How the 6 modules connect, what each does, data flow between them.
5. **`MEDOCR_Business_Rules_v0_19_3.md`** -- Clinical rules, payer exceptions, operational thresholds. The "why" behind tree decisions.
6. **`MEDOCR_Visual_Decision_Tree_v0_19_3.html`** -- Open in a browser. The tree rendered with diagrams and notes. Every section has a blue data source box telling you which JSON files to load.
7. **`MEDOCR_Unified_Decision_Tree_v0_19_3.mermaid`** -- Raw mermaid source. Master data source index at top. This is what you convert to code.

---

## Complete File Inventory

### Documentation (5 files)

| File | Purpose |
|------|---------|
| `MEDOCR_START_HERE.md` | This file |
| `MEDOCR_Glossary_v0_19_3.md` | Terms, acronyms, flags, status labels, CPT codes, module map |
| `MEDOCR_Developer_Handoff_v0_19_3.md` | Implementation guide: architecture, files, conventions, design decisions |
| `MEDOCR_System_Framework_v0_19_3.md` | System architecture: pipeline, modules, data flow, JSON tiers |
| `MEDOCR_Business_Rules_v0_19_3.md` | Clinical rules, payer exceptions, thresholds, scope rules, COB |

### Decision Trees (2 files)

| File | Purpose |
|------|---------|
| `MEDOCR_Visual_Decision_Tree_v0_19_3.html` | Human-readable: 22 sections, 33 diagrams, 14 data source boxes |
| `MEDOCR_Unified_Decision_Tree_v0_19_3.mermaid` | Code-convertible: 1,394 lines, section-level data source comments |

### JSON Data Files (17 files)

| File | Records |
|------|---------|
| `facility_config.json` | 5 sections + 10 operational parameters |
| `insurance.json` | 99 carriers |
| `payer_criteria_map.json` | 27 payers |
| `insurance_allowables.json` | 34 payers + Self Pay, 112 rates |
| `eligibility_combinations.json` | 21 payers, 75 combos |
| `bcbs_prefix_database.json` | 19,511 BCBS prefixes |
| `filename_classification.json` | 14 filename patterns |
| `referral_keywords.json` | ~80 phrases, 6 categories |
| `signature_patterns.json` | ~50 patterns, 5 categories |
| `provider_databank.json` | Schema (grows with usage) |
| `contraindications.json` | 15 clinical rules |
| `flags_catalog_tree_v0_19_3.json` | 105 flags |
| `icd10_curated.json` | 84 codes |
| `icd10_master_fy2026.json` | 5,193 codes (sleep-relevant chapters) |
| `cpt_selector_FIXED.json` | 6 rule categories |
| `cpt_keywords.json` | CPT->keyword map |
| `convert_icd10_master.py` | Annual ICD update script |

### Payer JSON Files (23 files)

Individual payer configuration files (`payer_*.json`) and criteria files (`criteria_*.json`). Loaded via the 3-layer chain: `payer_router.json` → `payer_[id].json` → `criteria_[id].json`.

### Clinical Criteria Files (21 files)

One per payer. 20 named `*_Clinical_Criteria.md` plus `Unknown_Insurance_Protocol.md`. Referenced by `payer_criteria_map.json`.

### Knowledge Base Files (7 files)

`BCBS_Complete_Payer_Knowledge_Base.md`, `BCBS_IDFormat_ImmediateOverride.md`, `BCBS_ThreeTier_Feedback_Architecture.md`, `NonBCBS_Payer_Knowledge_Base_v015.md`, `PAYER_ROUTING_INDEX_v2.md`, `Medicare_Advantage_Routing_Guide.md`, `HST_Code_Resolution_Logic.md`

### Audit Files (2 files)

| File | Purpose |
|------|---------|
| `MEDOCR_File_Trace_Audit_Addendum_v0_19_3.md` | 16 findings across all audits, all resolved. 46 paths traced. |
| `MEDOCR_Audit_Report_v0_19_0.md` | Original v0.19.0 audit baseline |

---

## First Steps

1. Read the Glossary, Handoff, Framework, and Business Rules
2. Open the Visual Tree in a browser -- scan the blue data source boxes
3. Fill in `facility_config.json` PLACEHOLDERs with actual facility data
4. Load all 17 JSON files at startup (`facility_config.json` FIRST -- its OCR exclusion filter must be active before any document processing)
5. Convert the mermaid tree to code module by module: M1A -> M1B -> M1C -> M1D -> M1E -> ICD/NLP -> M2A -> M2B -> M2C -> M2D -> M3 -> M4 -> M5 -> M6

---

## Quick Stats

- 1,394 lines across 32 sections in the unified decision tree
- 105 unique flags across 5 severity tiers
- 17 JSON data files (all built and populated)
- 23 payer JSON files (router + individual payer + criteria)
- 21 per-payer clinical criteria markdown files
- 7 knowledge base reference files
- 16 audit findings identified and resolved across v0.19.0 → v0.19.3
- 1 future-build remaining: `fax_templates.json` (auth form generator -- not blocking)

---

## What Changed in v0.19.3 (vs v0.19.1)

Six findings fixed from comprehensive file-trace audits (46 paths traced):

1. **Split night payment gate bypass** (CRITICAL) -- Cash patients can no longer skip the cost comparison gate in M4
2. **M1C payer/format parallel fork** (STRUCTURAL) -- Payer identification and format validation are now sequential, not parallel. Unknown payers get format-analysis-based derivation.
3. **Approaching-2 scheduling block** (MODERATE) -- Patients within 2 months of 2nd birthday now get a soft stop (PENDING_AGE_ELIGIBLE) instead of passing through unblocked
4. **Missing name skips age** (MODERATE) -- Missing patient name no longer bypasses DOB/age validation
5. **Format validation no-ID path** (MINOR) -- Added explicit handling for when payer is identified but member ID is absent
6. **Aetna Intermountain label** (MINOR) -- Clarified that OON determination is manual, not automated

Three new flags added to `flags_catalog_tree_v0_19_3.json`: `PENDING_AGE_ELIGIBLE`, `FLAG_PAYER_FROM_FORMAT`, `ALERT_MISSING_MEMBER_ID`.
