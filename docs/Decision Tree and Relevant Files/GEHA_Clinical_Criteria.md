# GEHA Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- GEHA (Government Employees Health Association)

---

## KEY CHARACTERISTIC: HST NO AUTH -- IN-LAB CALL REQUIRED

GEHA is a UMR subsidiary using UHC network and allowables.

---

## AUTHORIZATION STATUS

| Test | Auth Required | Method |
|------|---------------|--------|
| HST (G0399) | [X] No | -- |
| PSG (95810) | [OK] Yes | Call GEHA |
| Titration (95811) | [OK] Yes | Call GEHA |
| Split Night | [OK] Yes | Call GEHA |

---

## ID FORMAT

**Starts with "G" followed by numbers**

Example: G123456789

---

## COST

### As Primary Insurance
```
Patient cost: Deductible + coinsurance (check benefits)
```

### As Secondary to Medicare
```
Patient cost: $0 (100% covered)
Auth required: [X] No (for any codes)
```

### As Secondary to Other Plans
```
Auth still required for in-lab
```

---

## CLINICAL CRITERIA

### Not Documented

GEHA does not publish specific clinical criteria for sleep studies.
Standard medical necessity documentation should suffice.

---

## WORKFLOW

### HST
```
1. Verify eligibility
2. No auth required
3. Schedule directly
4. Bill with G0399
```

### In-Lab (PSG/Titration/Split)
```
1. Verify eligibility
2. Call GEHA directly for authorization
   +-- No portal submission available
3. Document auth reference number
4. Schedule patient
5. Bill normally
```

### Secondary to Medicare
```
1. Verify Medicare paid first
2. No auth required (any codes)
3. 100% covered after Medicare
4. Bill GEHA as secondary
```

---

## HST CODE

**G0399** (uses UHC network)

---

## ALLOWABLES

**UHC allowables** (not UMR allowables)

---

## REFERRAL REQUIREMENT

**Never required**

---

## [!] MISLABELING WARNING

```
GEHA is sometimes mislabeled as UMR.
|-- GEHA is a subsidiary of UMR
|-- But uses UHC network, not UMR
+-- Verify actual payer before processing
```

---

## DECISION TREE FLAGS

### FLAG_GEHA_CALL_FOR_AUTH
- **Trigger:** GEHA patient needs in-lab testing
- **Action:** Call GEHA directly for authorization (no portal)
- **Severity:** Medium

### FLAG_GEHA_MEDICARE_SECONDARY
- **Trigger:** GEHA secondary to Medicare
- **Action:** No auth required, 100% covered
- **Severity:** Low (simplifies workflow)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | GEHA |
| HST Auth | [X] No |
| In-Lab Auth | [OK] Yes (call) |
| HST Code | G0399 |
| Network | UHC |
| Allowables | UHC |
| Referral | Never |
| Pain Level | [YELLOW] Medium |

---

*Document for MEDOCR v0.17*
*Payer: GEHA*
*Version 1.0 -- February 2026*
