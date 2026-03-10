# Knowledge Base Audit — 87 files, v0.19.3

**Date:** March 9, 2026  
**Verdict:** Solid foundation with ~14 issues to fix before production

---

## CRITICAL (3) — Must fix before implementation

| # | Issue | Why it matters |
|---|-------|----------------|
| 1 | **28 PLACEHOLDERs in facility_config.json** | OCR will confuse the facility's own phone/fax/NPI with referring provider data on every faxed referral. Can't go live without real values. |
| 2 | **4 payer_router IDs missing from payer_criteria_map** — `bcbs_non_carelon`, `uhc_medicare_direct`, `uhc_medicare_optum`, `uhc_surest` | Patients routed to these payer IDs will crash or silently have no criteria data. The payer JSON files exist but the criteria map doesn't know about them. |
| 3 | **4 flags referenced but undefined in catalog** — `FLAG_MERITAIN_CALL_FIRST`, `FLAG_NV_MEDICAID_NO_HST`, `FLAG_UMR_CHECK_NETWORK`, `FLAG_OON_AUTO` | Code fires these flags but they have no severity tier, no human action text, no dedup rules. M6 flag aggregation can't process them. |

---

## MODERATE (5) — Should fix

| # | Issue |
|---|-------|
| 4 | **VA criteria file exists but isn't wired** — `VA_Clinical_Criteria.md` is on disk but `payer_criteria_map.json` has `criteria_file: null` for VA. |
| 5 | **Prominence contract expired Oct 2025** — still in accepted list, still has rates, still routable. Should be moved to `doNotAccept` or at minimum flagged. |
| 6 | **Teachers Health Trust → ChampVA routing** — THT has unique rules ($75 copay, 80/20 HST, no auth) that are NOT ChampVA behavior. Wrong payer_id mapping. |
| 7 | **HPN Medicaid has no dedicated payer JSON** — it shares Sierra/HPN config but has unique rules (G0399 code, 100% coverage). These exceptions need a home. |
| 8 | **9 payers missing from eligibility_combinations.json** — Meritain, VA, ChampVA, Workers Comp, EBMS, Multiplan/PHCS, First Health, Anthem Medicaid, Carelon. Staff get no guidance on what fields to gather for eligibility verification. |

---

## MINOR (6) — Cleanup items

| # | Issue |
|---|-------|
| 9 | **2 orphan MD files** — `UMR_Clinical_Criteria.md` and `VA_Clinical_Criteria.md` exist but are unreferenced. |
| 10 | **2 phantom rate entries** — Coventry and HealthSmart have allowable rates but zero presence in router, map, or insurance.json. Dead data. |
| 11 | **Duplicate flag pair** — `FLAG_NEEDS_PRIOR_RESULTS` and `FLAG_NEED_PRIOR_RESULTS` both exist (one aliased). Should consolidate. |
| 12 | **`FLAG_UHC_SUREST_DETECTED`** uses `FLAG_` prefix but is tier 4 (ALERT). Naming inconsistency. |
| 13 | **insurance.json has lowercase duplicates** at top of accepted array (`"medicare"`, `"aetna"`, `"uhc"`) that duplicate proper-cased entries below. |
| 14 | **Caresource and Surest missing from insurance.json accepted list** despite full system presence in router + map + payer JSONs. |

---

## What's GOOD

- All **48 JSON files parse cleanly** — no syntax errors
- **105 flags** with proper 5-tier severity distribution (10 STOP / 9 PENDING / 49 FLAG / 29 ALERT / 8 INFO)
- **19,511 BCBS prefixes** with verified/unverified tracking
- **Clinical criteria:** All 10 sampled MD files follow consistent templates with proper auth/CPT/submission structure
- **NV Medicaid "NO HST" rule** verified consistent across 3 independent sources (criteria file, business rules, cpt_selector)
- **Contraindications:** O2-only hard HST stop verified. Pediatric age tiers match docs perfectly
- **Decision tree:** 1,395 lines, 25 sections, master data source index, section-level annotations — well-organized
- **Self-pay rates** match across facility_config.json and insurance_allowables.json ($250/$600/$650/$1200)
- **All 10 operational thresholds** have sensible defaults and are properly configurable
- **Signature/credential validation** is thorough — 5 tiers with supervising physician nuance
- **ICD-10:** 84 curated codes + 5,193 master codes. G47.33 present. Annual update script included
- **Spanish-language OCR keywords** included for sleep study terms — smart for Las Vegas
