# HST Code Resolution Logic
## Design Decision Documentation
### Version 1.0 -- February 2026

---

## Summary

**Problem:** Multiple HST codes exist (G0399, 95806, 95800, 95801) and different payers require different codes. Orders may come in with any of these codes, or none at all.

**Solution:** Normalize all HST references to plain text during intake, then resolve to the correct CPT code based on payer.

---

## The Flow

```
STAGE 1: ORDER INTAKE
|
|-- OCR/LLM detects any HST-related code or language:
|   |-- G0399
|   |-- 95806
|   |-- 95800
|   |-- 95801
|   |-- "home sleep test"
|   |-- "HSAT"
|   |-- "portable sleep study"
|   +-- Any similar variation
|
+-- NORMALIZE TO: "Home Sleep Study" (plain text)
    +-- Do NOT lock in a CPT code at this stage

STAGE 2: PROCESS THROUGH SYSTEM
|
|-- Patient data extracted
|-- Insurance identified
|-- Clinical sufficiency checked
+-- HST remains as "Home Sleep Study" (text)

STAGE 3: CPT CODE RESOLUTION (After Insurance Known)
|
|-- Look up payer in HST Code Routing Table
|
|-- Assign correct code:
|   |-- G0399 payers -> G0399
|   |-- 95806 payers -> 95806
|   +-- Special cases handled
|
+-- OUTPUT: Final CPT code for billing/auth
```

---

## Why This Design?

| Issue | How This Solves It |
|-------|-------------------|
| Order has wrong code for payer | Doesn't matter -- we pick the right one |
| Order has no code at all | We determine it from payer |
| cpt_keywords.json overlap | No conflict -- all HST keywords -> "Home Sleep Study" |
| Staff doesn't know which code | System handles it automatically |

---

## HST Code Routing Table

### G0399 Payers
- BCBS (all affiliates)
- Aetna
- UHC
- Humana
- Tricare
- VA
- ChampVA
- GEHA
- First Health Network
- Anthem Medicaid
- Silversummit
- Molina
- Caresource

### 95806 Payers
- Cigna
- Medicare (FFS)
- Sierra Health / HPN
- Workers' Comp (DOL)
- Multiplan
- PHCS

### Special Cases
| Payer | HST Code | Notes |
|-------|----------|-------|
| Nevada Medicaid (FFS) | N/A | HST not allowed |
| EBMS | Call to verify | Depends on parent network |
| UMR | 95806 or G0399 | Depends on UMR variant (standard vs UHC) |

---

## Implementation Notes

### In cpt_keywords.json
All HST-related keywords should map to a generic "HST" identifier, not a specific code:

```json
{
  "HST": {
    "keywords": ["home sleep test", "hst", "hsat", "portable sleep study", "home sleep apnea test"],
    "resolve_by": "payer_lookup"
  }
}
```

### In Decision Tree
- Part 1.7 (Order Analysis): Identify test TYPE, not code
- Part 1.4 (Insurance): Determine payer
- Final Output: Resolve TYPE -> CODE using payer lookup

---

## Audit Status

**Issue:** cpt_keywords.json HST keyword overlap (both G0399 and 95806 had same keywords)

**Status:** [OK] RESOLVED BY DESIGN

The overlap is no longer a problem because:
1. Keywords identify the TEST TYPE ("Home Sleep Study")
2. The specific CODE is determined by payer, not keywords
3. No ambiguity in the system

---

*Document for MEDOCR v0.17*
*Design Decision: HST Code Resolution*
*Version 1.0 -- February 2026*
