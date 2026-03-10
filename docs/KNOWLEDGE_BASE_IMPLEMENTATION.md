# Knowledge Base Implementation Plan

**Date:** March 9, 2026  
**Approach:** 3-layer hybrid (LLM-enriched extraction + deterministic rules + LLM-assisted NLP)

---

## Current State

The existing pipeline is essentially Module 1A — plus partial raw extraction of M1B/M1C/M1E fields:

```
PDF → OCR → LLM extracts fields → Verify → Save JSON → Download packet
```

It extracts patient name, DOB, provider, phone, fax, NPI, CPT codes, insurance name/ID. No logic runs on the extracted data.

## What the Knowledge Base Adds

The knowledge base is the **brain that acts on the extracted data**. It takes extraction output and produces:

1. **Flags** — "this referral has problems X, Y, Z, here's what staff should do"
2. **Test selection** — "based on order + insurance + clinical, the test is 95810"
3. **Auth readiness** — "ready to submit" or "missing X, call for Y"
4. **Cost estimate** — "$334.04 (HPN rate for HST)"
5. **Status** — `READY_TO_SCHEDULE` / `READY_FOR_AUTH` / `PENDING_*` / `STOPPED`

---

## Architecture: 3 Layers (Not a Monolithic Rules Engine)

A monolithic post-extraction engine that replicates all 25 mermaid tree sections would be ~3,000+ lines of if/else code — redundant with what the LLM already handles during extraction. Instead:

### Layer 1 — Enrich the LLM Extraction (modify existing prompts)

Feed knowledge base context into the existing LLM extraction prompts so it extracts **better** with almost zero new code:

| KB File in Prompt | What It Improves |
|---|---|
| `insurance.json` accepted list | LLM matches OCR-garbled "Untied Healthcar" → "United Healthcare" during extraction, not after |
| `cpt_keywords.json` | LLM catches sleep study codes it currently misses |
| `signature_patterns.json` credential tiers | LLM flags "NP needs supervising" during extraction |
| `facility_config.json` exclusion filter | LLM stops confusing the facility's own fax number with the provider's |

This replaces most of M1B, M1C name-matching, and M1E with prompt engineering — something the pipeline already does.

### Layer 2 — Lightweight Deterministic Engine (new, ~500-800 lines)

The parts that MUST be exact code, not LLM:

| Logic | Why It Can't Be LLM | KB Files Consumed |
|---|---|---|
| Age calculation (DOB → service date offset) | Math | `facility_config.json` |
| Payer routing chain (router → payer JSON → criteria) | Exact JSON lookup | `payer_router.json` → `payer_*.json` → `criteria_*.json` |
| BCBS prefix lookup (19,511 entries) | Too large for context | `bcbs_prefix_database.json` |
| Contraindication checks | Clinical safety — must be deterministic | `contraindications.json` |
| CPT scope narrowing (M2A → M3) | Insurance coverage = binary yes/no | `payer_criteria_map.json`, `cpt_selector_FIXED.json` |
| Test selection tiebreaker (M4) | Ordered priority rules | `insurance_allowables.json` |
| Cost estimate | Arithmetic from allowables table | `insurance_allowables.json` |
| Flag generation + severity sort | Catalog lookup | `flags_catalog_tree_v0_19_3.json` |

### Layer 3 — LLM Assist for Fuzzy Tasks (optional, uses existing Ollama)

Only two things in the tree actually benefit from LLM intelligence:

1. **ICD-10 Tier B** — semantic matching of clinical text to 5,193 codes (e.g., "restless legs" → G25.81). Tier A (84 curated codes, keyword match) handles 80% deterministically. Tier B is the long tail.
2. **NLP context** — negation detection ("no snoring"), family vs personal ("father had apnea"), temporal ("resolved after surgery"). This is what LLMs are good at.

---

## Comparison

| | Monolithic Rules Engine | 3-Layer Hybrid |
|---|---|---|
| **New code** | ~3,000+ lines | ~500-800 lines |
| **OCR garbling** | Breaks exact-match payer lookup | LLM handles fuzzy matching natively |
| **Build time** | Weeks (25 sections) | Days (enrich prompts + small engine) |
| **Leverages existing LLM** | Not at all — parallel system | Fully — it's already running |
| **Clinical safety** | Deterministic ✓ | Deterministic for rules, LLM only for NLP ✓ |
| **Testable** | Yes but massive test surface | Small deterministic core, easy to unit test |

---

## File Structure

```
backend/
  rules/                ← Layer 2 lives here (directory already exists)
    payerRouter.js       ← insurance.json → payer chain → criteria lookup
    ageCalc.js           ← DOB → age at service date, pediatric code selection
    contraCheck.js       ← contraindications.json → scope narrowing
    testSelector.js      ← M3+M4 tiebreaker, split night eval
    flagEngine.js        ← catalog lookup, severity sort, dedup
    costEstimate.js      ← allowables table lookup
  llmService.js          ← Layer 1: enrich existing prompts with KB context
  server.js              ← after extraction, pipe result through rules/
```

---

## JSON Files — Load Order & Mapping

All 17 core JSON files load at startup. `facility_config.json` loads FIRST (OCR exclusion filter must be active before any document processing).

| # | File | Records | Layer | Modules |
|---|------|---------|-------|---------|
| 1 | `facility_config.json` | 5 sections + 10 params | L1 + L2 | All |
| 2 | `insurance.json` | 99 carriers | L1 | Payer ID |
| 3 | `payer_criteria_map.json` | 27 payers | L2 | Coverage, auth |
| 4 | `insurance_allowables.json` | 34 payers + Self Pay, 112 rates | L2 | Cost, tiebreaker |
| 5 | `eligibility_combinations.json` | 21 payers, 75 combos | L2 | Field validation |
| 6 | `bcbs_prefix_database.json` | 19,511 prefixes | L2 | BCBS routing |
| 7 | `filename_classification.json` | 14 patterns | L1 | File intake |
| 8 | `referral_keywords.json` | ~106 phrases | L1 + L2 | Order scope |
| 9 | `signature_patterns.json` | ~50 patterns | L1 | Provider validation |
| 10 | `provider_databank.json` | Schema (grows with usage) | L2 | NPI cache |
| 11 | `contraindications.json` | 15 clinical rules | L2 | Scope narrowing |
| 12 | `flags_catalog_tree_v0_19_3.json` | 105 flags | L2 | Flag aggregation |
| 13 | `icd10_curated.json` | 84 codes | L2 | ICD Tier A |
| 14 | `icd10_master_fy2026.json` | 5,193 codes | L3 | ICD Tier B |
| 15 | `cpt_selector_FIXED.json` | 6 rule categories | L2 | CPT selection |
| 16 | `cpt_keywords.json` | 21 CPT→keyword maps | L1 | OCR extraction |
| 17 | `convert_icd10_master.py` | Script | N/A | Annual maintenance |

---

## Integration Point

The current result JSON already extracts most input fields that the rules engine needs:

| Extracted Field | Feeds |
|---|---|
| `patient.first`, `patient.last`, `patient.dob` | Age calculation, pediatric code selection |
| `insurance.name`, `insurance.memberId` | Payer identification, routing chain |
| `provider.name`, `provider.npi`, `provider.phone` | Provider validation, NPI lookup |
| `clinical.cptCodes` | Order scope determination |
| OCR raw text | ICD generation, NLP context |

After extraction completes, the result pipes through the Layer 2 rules engine which enriches it with flags, test selection, auth status, cost estimate, and final status.

---

## Implementation Order

1. **Copy KB JSON files** into `backend/data/kb/` (or similar)
2. **Layer 1** — Enrich LLM prompts with `insurance.json`, `cpt_keywords.json`, `signature_patterns.json`, `facility_config.json` exclusion filter
3. **Layer 2** — Build deterministic rules in order:
   - `payerRouter.js` (payer identification → criteria chain)
   - `ageCalc.js` (age at service date, pediatric routing)
   - `contraCheck.js` (scope narrowing from contraindications)
   - `testSelector.js` (M3 coverage check + M4 tiebreaker)
   - `flagEngine.js` (catalog lookup, severity sort, dedup)
   - `costEstimate.js` (allowables table arithmetic)
4. **Layer 3** (optional) — ICD-10 Tier B semantic matching + NLP context via Ollama
5. **Frontend** — Display flags (severity-colored list), test recommendation, auth status badge, cost estimate alongside existing extracted data
6. **Wire into pipeline** — After extraction + verification, run `rules/` engine, merge output into result JSON

---

## Prerequisites (from Audit)

Before building, the client must provide:

- **28 facility_config.json values** — real facility NPI, phone, fax, address, physician names (Critical #1)
- **Fix 4 missing payer_criteria_map entries** — bcbs_non_carelon, uhc_medicare_direct, uhc_medicare_optum, uhc_surest (Critical #2)
- **Add 4 missing flags to catalog** — FLAG_MERITAIN_CALL_FIRST, FLAG_NV_MEDICAID_NO_HST, FLAG_UMR_CHECK_NETWORK, FLAG_OON_AUTO (Critical #3)
