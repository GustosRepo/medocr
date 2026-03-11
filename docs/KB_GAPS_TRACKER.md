# Knowledge Base Gaps Tracker

**Created:** March 11, 2026  
**Source:** `docs/Decision Tree and Relevant Files/` (90 files total)  
**Status:** 52 JSON data files ✅ loaded → 38 non-JSON files audited below

---

## Summary

| Category | Files | Status |
|----------|-------|--------|
| JSON data files | 52 | ✅ All in `backend/data/kb/` |
| No-auth / must-call payer MDs | 12 | ✅ No action needed — rules in payer JSONs |
| System/reference docs | 6 | ✅ Pure documentation |
| Misc (filelist, mermaid, html) | 3 | ✅ Reference only |
| Fallback protocol | 1 | ✅ Handled by `criteria_universal_baseline_v1_0.json` |
| **Unimplemented logic** | **16** | **✅ ALL 16 GAPS COMPLETE — ~7,246 lines of business rules fully encoded** |

---

## CRITICAL — Highest Impact Gaps

### 1. Carelon Clinical Criteria (NO criteria JSON exists)
- **Source:** `Carelon_Clinical_Criteria.md` (377 lines)
- **Impact:** Used by ALL BCBS-Carelon plans — highest volume payer group
- **What's missing:**
  - 2-of-5 symptom requirement for HST qualification
  - 15 HST contraindications (COPD, CHF, CSA, O2, pediatric, opioids, etc.)
  - PSG/titration criteria
  - Cardiovascular+1 pathway, unexplained conditions pathway
  - Follow-up HST rules
  - BCBS affiliate submission routing (Carelon portal vs Availity)
- **Action:** Create `criteria_carelon_v1_0.json` from this markdown
- **Status:** ✅ Complete — `backend/data/kb/criteria_carelon_v1_0.json` created (15 sections, 18 HST contraindications, 7 APAP contraindications, 28 thresholds, keyword arrays for OCR matching). Payer criteria map updated for Carelon + Anthem Medicaid.

### 2. BCBS Complete Payer Knowledge Base
- **Source:** `BCBS_Complete_Payer_Knowledge_Base (1).md` (759 lines)
- **Impact:** BCBS is the highest-volume payer. Current `bcbsRouter.js` only does prefix lookup.
- **What's missing:**
  - 4-step decision hierarchy (TPA check → known prefix → universal rules → affiliate defaults)
  - TPA detection logic (Quantum Health, Benesys/Union plans with ICM/NHS/Telligen handlers)
  - 18 BCBS affiliate profiles with per-state phone numbers, portal URLs, workflows
  - Letter-in-ID → Carelon rule
  - Medicare Supplement detection
- **Action:** Enhance `bcbsRouter.js` with TPA detection + affiliate profiles + 4-step hierarchy
- **Status:** ✅ Complete — `bcbsRouter.js` rewritten with 4-step decision hierarchy. Created `bcbs_routing_rules.json` (22 affiliate profiles, TPA rules, universal rules, auth handler tools). Added `getBcbsRoutingRules()` to kbLoader.js. Fixed prefix extraction to handle alphanumeric prefixes (5,413 entries had digits).

### 3. BCBS ID Format Classification
- **Source:** `BCBS_IDFormat_ImmediateOverride.md` (551 lines)
- **Impact:** ID format determines routing signal + available verification tools
- **What's missing:**
  - Format A: all-numeric → not Carelon, chat doesn't work
  - Format B: alpha-numeric → likely Carelon, chat works
  - Format C: extended numeric
  - Format FEP: R-prefix → Federal Employee Program
  - Format-tier interaction as confidence modifier
- **Action:** Add ID format regex classification to `bcbsRouter.js`
- **Status:** ✅ Complete — `classifyIdFormat()` function added with FORMAT_A/B/C/FEP/UNKNOWN. Format-vs-prefix mismatch detection. ID format signals in routing output.

### 4. BCBS Three-Tier Fallback Cascade
- **Source:** `BCBS_ThreeTier_Feedback_Architecture (1).md` (761 lines)
- **Impact:** Currently prefix lookup is binary (found/not-found). Should be 3-tier.
- **What's missing:**
  - Tier 1: exact prefix (verified)
  - Tier 2: affiliate defaults with stats ("59 known prefixes, 20 no-auth, 25 Carelon")
  - Tier 3: global BCBS default
  - Affiliate default objects with `most_common_pattern`, `default_auth_required`, `known_variations`
  - Feedback loop for prefix verification
- **Action:** Implement 3-tier cascade in `bcbsRouter.js`
- **Status:** ✅ Complete — 3-tier cascade: Tier 1 (exact prefix, VERIFIED/LIKELY), Tier 2 (affiliate defaults, PRESUMED_AFFILIATE), Tier 3 (global fallback, PRESUMED_GENERAL). Universal rules layer (letter-in-ID Carelon, Medicare Supplement). Confidence levels in all outputs.

---

## HIGH — Important Gaps

### 5. UHC Clinical Criteria Completeness Check
- **Source:** `UHC_Clinical_Criteria.md` (890 lines — largest criteria file)
- **Impact:** UHC is high-volume. `criteria_uhc_v2_2.json` exists but may not capture all 890 lines.
- **What's missing (verify):**
  - 4-path routing (Commercial / Medicare Direct / Medicare Optum / Surest)
  - Optum 3-portal submission workflow
  - Surest variable copay by ZIP
  - HST contraindications (CHF NYHA III-IV/LVEF≤40%, COPD FEV1<60%, opioid>3mo, BMI>50, home O2)
  - "Never authorize second HSAT" rule
- **Action:** Audit `criteria_uhc_v2_2.json` against MD, fill gaps
- **Status:** ✅ Complete — Full audit performed against 890-line source. Added: `plan_type_routing` (5 paths: commercial, medicare_direct, medicare_optum, surest, subsidiaries with auth rules, portals, referral requirements, Optum 3-portal workflow, Surest copay warning). Added `surgical_criteria` (UPPP/MO/MMA + HNS Inspire adult + HNS adolescent Down syndrome). Added `not_medically_necessary` lists (devices, procedures, testing). Fixed OSA `severe.ahi_min` 30→31 (>30 not ≥30). Expanded `no_repeat_hsat` from 2 to all 5 plan types. Added 4 PSG indications (PLMD, RLS, parasomnia/RBD, narcolepsy) + PSG exclusions. Expanded thresholds with HNS-specific values (BMI, AHI, central%, ESS).

### 6. NonBCBS Payer Knowledge Base (master reference)
- **Source:** `NonBCBS_Payer_Knowledge_Base_v015.md` (855 lines)
- **Impact:** Universal cross-payer rules not in individual payer JSONs
- **What's missing:**
  - Sections 1-3: universal rules (call when in doubt, Medicare Supplement rule, Medicaid $0 rule)
  - Per-payer operational workflows, portal URLs, phone numbers
  - Edge cases and exceptions not in individual payer JSONs
- **Action:** Extract universal rules into a shared JSON, cross-check per-payer details
- **Status:** ✅ Complete — Created `nonbcbs_operational_rules.json` with: 5 universal rules (call-fallback, Medicare Supplement detection keywords, referral-vs-auth distinction, Medicaid 100%, chart notes). HST code routing table (g0399/95806 payer lists + special rules). 13 OON plans. Per-payer operational supplements for all 18 non-BCBS payers with workflows, cost models, detection heuristics, edge cases, portal URLs. UMR 5 sub-variants with cost models. Portal directory (19 entries). Added `getNonBcbsOperationalRules()` to kbLoader.js and registered in startup validation.

### 7. Evicore Criteria — Aetna Exceptions
- **Source:** `Evicore_Clinical_Criteria.md` (377 lines)
- **Impact:** Aetna/Cigna via Evicore is high-volume
- **What's missing (beyond `criteria_evicore_v2_1.json`):**
  - Aetna HMO referral requirement
  - Dual-submission rule (Evicore + Availity)
  - Meritain sub-plan detection and routing
- **Action:** Add Aetna-specific workflow rules to criteria JSON or payer JSONs
- **Status:** ✅ Complete — Updated `payer_aetna.json` v1.0→v1.1 with: Meritain detailed workflow object (phone-first benefits, portal URL `meritain.mednecessity.com`, detection heuristics for ID card/eligibility), expanded referral object (NPI rule: PCP+Facility only, scope: ALL codes, critical note about referral vs auth independence), expanded dual-submission reason, added FLAG_AETNA_MERITAIN flag, populated plan_types array. Evicore criteria JSON (`criteria_evicore_v2_1.json`) confirmed comprehensive — all 10 clinical sections fully encoded with keyword arrays.

---

## MEDIUM — Should Be Addressed

### 8. Business Rules — Titration & Scope
- **Source:** `MEDOCR_Business_Rules_v0_19_3.md` (213 lines)
- **What's missing:**
  - Titration prerequisites: 5yr max from diagnostic study, 1yr aging rule
  - Scope management rules
  - COB determination rules
  - Contraindication hierarchy details beyond `contraindications.json`
- **Status:** ✅ Complete — Created `business_rules.json` with: clinical sufficiency criteria (5 criteria, 4 pathways: observed apneas, 2-of-5, cardiovascular+1, unexplained condition + keyword arrays), split night criteria (5 decision factors: AHI≥20, ≥3hrs titration, locality, prior PAP, cash payment gate with $650/$1250 costs), scope rules (order language mapping: FULL/DIAGNOSTIC/HST_LOCKED/TITRATION_LOCKED/UNKNOWN with trigger keywords, contraction path, expansion blocking), COB rules (NAIC D1-D6 determination order, federal overrides, multi-payer OON handling), age transition rules (hard/soft stops, PENDING_AGE_ELIGIBLE, auto re-entry), payer identification sequence (name→format→fallback), flag design principles (5-tier severity hierarchy). Note: titration prerequisites and contraindication hierarchy were already in `contraindications.json`. Added `getBusinessRules()` to kbLoader.js.

### 9. Medicare Advantage Routing Guide
- **Source:** `Medicare_Advantage_Routing_Guide.md` (353 lines)
- **What's missing:**
  - MA plan identification flowchart
  - Known OON MA plans (Cigna Medicare, Humana P3/Intermountain, Anthem Mediblue P3/Caremore)
  - PPO vs HMO determination logic
  - Certainty levels and fallback protocols
- **Status:** ✅ Complete — Created `ma_routing_rules.json` with: 6-step routing flowchart (carrier ID → OON check → plan type → IPA detection → carrier routing → output), 5 known OON MA plans with blocking flags, PPO/HMO determination with fallback-to-HMO-when-unknown, IPA identification with challenge notes (mislabeling, clinic-not-network), 5 carrier routing tables (Humana 5 sub-types, UHC 4 sub-types, Aetna all, Cigna all OON, BCBS Anthem Mediblue 3 networks), 3 certainty levels (GREEN/YELLOW/RED), 4 MA-specific flags. Added `getMaRoutingRules()` to kbLoader.js.

### 10. Humana — Sub-Plan Routing
- **Source:** `Humana_Clinical_Criteria.md` (371 lines)
- **What's missing (beyond `criteria_humana_v1_1.json`):**
  - Optum IPA routing
  - P3/Intermountain → OON detection
  - EDS+1 symptom requirement specifics
- **Status:** ✅ Complete — Updated `payer_humana.json` v1.0→v1.1 with: `plan_type_routing` (7 plan types: commercial, medicare_ppo, medicare_hmo_no_ipa, medicare_hmo_optum, medicare_hmo_p3, medicare_hmo_intermountain, supplement with auth/referral/portal per type), IPA detection object (Availity-based, verification note for clinic-not-network mislabeling), added FLAG_HUMANA_MISSION_CRITICAL (airline pilot, bus driver, military, truck driver → PSG required) and FLAG_HUMANA_HST_CONTRAINDICATION. Updated criteria_file reference to v1_1. Criteria JSON (`criteria_humana_v1_1.json`) confirmed comprehensive — EDS+1 symptom requirement, 10 HST contraindications, mission critical occupations, MSLT/MWT criteria, repeat testing rules all fully encoded.

### 11. Silversummit Clinical Criteria (NO criteria JSON)
- **Source:** `Silversummit_Clinical_Criteria.md` (309 lines)
- **What's missing:**
  - Uses Carelon baseline criteria conservatively
  - Titration almost never approved for Medicaid
  - Ambetter referral requirement variations
- **Action:** Create `criteria_silversummit_v1_0.json`
- **Status:** ✅ Complete — `backend/data/kb/criteria_silversummit_v1_0.json` created. Inherits clinical criteria from Carelon. Includes auth status, titration warning, Ambetter referral flag, submission routing. Payer criteria map updated.

### 12. UMR Clinical Criteria (NO criteria JSON)
- **Source:** `UMR_Clinical_Criteria.md` (256 lines)
- **What's missing:**
  - Dual-path: UMR-via-Sierra (ultra-lenient, 95806, HPN portal) vs UMR-via-UHC (strict, G0399, UHC portal)
  - Network identification determines which path
- **Action:** Create `criteria_umr_v1_0.json` with dual-path logic
- **Status:** ✅ Complete — `backend/data/kb/criteria_umr_v1_0.json` created. Dual-path (Sierra/HPN ultra-lenient vs UHC moderate), network identification, (UM Only) designation, 5 flags, nurse notes warning. Payer criteria map updated.

### 13. Tricare Plan-Type Routing
- **Source:** `Tricare_Clinical_Criteria.md` (258 lines)
- **What's missing (beyond `criteria_tricare_v1_1.json`):**
  - Prime (Active Duty) → referral + pre-auth
  - Prime (non-AD) → referral + pre-auth
  - Select/TFL → no referral, no pre-auth
  - TFL secondary to Medicare → $0, no auth
- **Status:** ✅ Complete — `payer_tricare.json` v1.0→v1.1: Added plan_type_routing (8 plan types with auth/referral/verification/pain_level/workflow per type), regional_contractors (East/West/Overseas), id_format (SSN 9-digit, DBN 11-digit), identification_tips (6 clues), verification_challenges, FLAG_TRICARE_SELECT_NO_AUTH. criteria_tricare_v1_1.json already comprehensive (no changes needed).

---

## LOW — Nice to Have

### 14. Payer Routing Index V2 Corrections
- **Source:** `PAYER_ROUTING_INDEX_v2.md` (413 lines)
- **What:** ~50 payer name variant → criteria file mappings, V2 corrections
- **Status:** ✅ Complete — `payer_criteria_map.json` v0.18.5→v0.19.0: Updated all criteria_file references from .md to JSON versions (Evicore→criteria_evicore_v2_1.json, UHC→criteria_uhc_v2_2.json, Humana→criteria_humana_v1_1.json, Sierra/HPN→criteria_sierra_hpn_v1_1.json, Medicare FFS→criteria_medicare_ffs_v1_1.json, Nevada Medicaid→criteria_nevada_medicaid_v1_1.json, Tricare→criteria_tricare_v1_1.json), fixed Silversummit strictness 1→6 (NO_REVIEW), enriched Tricare entry with flags/plan_types/suggested_actions, added payer_aliases section (53 name variants→31 canonical payers).

### 15. HST Code Resolution Logic
- **Source:** `HST_Code_Resolution_Logic.md` (135 lines)
- **What:** 3-stage normalization pattern, G0399 vs 95806 per-payer table
- **Status:** ✅ Complete — Already fully encoded: nonbcbs_operational_rules.json has master hst_code_routing table (G0399 payers, 95806 payers, special rules), payer_criteria_map.json has per-payer hst_code field (31 payers), testSelector.js implements 3-stage resolution via payerAwareHomeCodes. Source MD is a design document — no additional KB data needed.

### 16. Unknown Insurance Protocol
- **Source:** `Unknown_Insurance_Protocol.md` (328 lines)
- **What:** Fallback protocol — likely already handled by universal baseline
- **Status:** ✅ Complete — `unknown_payer_protocol.json` created: 5-step workflow (process first, verify later), identification checklist (card/system/Availity), verification call script (8 information items), minimum scheduling requirements (6 fields), result combining matrix, 4 common scenarios (unusual card, self-funded, no card, out-of-state), 5 flags (FLAG_UNKNOWN_PAYER, FLAG_CLINICAL_BASELINE_MET/NOT_MET, FLAG_ADD_TO_SYSTEM, FLAG_INSURANCE_UNVERIFIED), escalation protocol, new payer documentation template. Registered in kbLoader.js with getUnknownPayerProtocol() + startup validation.

---

## No Action Needed (22 files)

### No-Auth / Must-Call Payers (12 MDs)
These just say "no auth" or "call payer" — already in payer JSONs:
- ✅ Caresource, ChampVA, EBMS, First Health, GEHA, LV Firefighters
- ✅ Medicare FFS, Molina, Multiplan/PHCS, VA, Workers Comp

### System/Reference Docs (6 MDs)
- ✅ MEDOCR_START_HERE — navigation index
- ✅ MEDOCR_Glossary — term definitions
- ✅ MEDOCR_Developer_Handoff — implementation guide
- ✅ MEDOCR_File_Trace_Audit_Addendum — audit history
- ✅ MEDOCR_System_Framework — architecture overview

### Misc (3 files)
- ✅ filelist.txt, .mermaid diagram, .html visualization

---

## 3 Payers Need New Criteria JSONs

| Payer | Source Lines | Criteria JSON | Priority |
|-------|-------------|---------------|----------|
| **Carelon** | 377 | ✅ `criteria_carelon_v1_0.json` | CRITICAL |
| **Silversummit** | 309 | ✅ `criteria_silversummit_v1_0.json` | MEDIUM |
| **UMR** | 256 | ✅ `criteria_umr_v1_0.json` | MEDIUM |

---

## Recommended Implementation Order

1. **Carelon criteria JSON** — highest volume payer group, 0 structured rules today
2. **BCBS routing stack** — TPA detection + ID format + 3-tier cascade (items 2-4)
3. **Missing criteria JSONs** — Silversummit, UMR (items 11-12)
4. **Evicore Aetna exceptions** — workflow traps for high-volume payer (item 7)
5. **UHC completeness audit** — verify JSON covers 890-line source (item 5)
6. **NonBCBS universal rules** — cross-payer logic extraction (item 6)
7. **MA routing + Humana + Tricare** — sub-plan routing (items 9-10, 13)
8. **Business rules + titration** — scope/prerequisite logic (item 8)
9. **Low-priority items** — routing index, HST resolution, unknown protocol (items 14-16)
