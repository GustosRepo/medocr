# Workers' Compensation (DOL) Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- Department of Labor (DOL) Workers' Compensation Programs

---

## KEY CHARACTERISTIC: NO AUTH -- 100% COVERED

Workers' Comp DOL is one of the simplest payers -- no authorization required for any codes, 100% covered.

---

## AUTHORIZATION STATUS

| Test | Auth Required |
|------|---------------|
| HST (95806) | [X] No |
| PSG (95810) | [X] No |
| Titration (95811) | [X] No |
| Split Night | [X] No |

---

## ACCEPTED DOL PROGRAMS

| Program | Code | Frequency |
|---------|------|-----------|
| Federal Employees' Compensation | DFEC | Rare |
| Energy Employees Occupational Illness | DEEOIC | [OK] **Most common** |
| Coal Mine Workers' Compensation | DCMWC | Rare |
| Longshore and Harbor Workers' | DLHWC | Rare |

**Most common:** DEEOIC (Atomic Workers, Electrical Workers, NV Test Site workers)

---

## IDENTIFICATION CLUES

Look for these in chart notes or patient comments:
- "White card"
- "Test site"
- "NV test site"
- Any atomic/energy worker references
- Department of Labor mention

---

## CLINICAL CRITERIA

### Not Applicable

Since no authorization is required, there is no clinical review process.
- No symptom requirements enforced
- No comorbidity thresholds
- No documentation review

---

## COST

```
Patient cost: $0 (100% covered)
```

---

## WORKFLOW

```
1. Identify DOL coverage
   |-- Check notes for clues (white card, test site, etc.)
   |-- Patient may mention DOL coverage
   +-- Look for DOL program codes

2. Verify ID via DOL portal
   +-- owcpconnect.dol.gov

3. If covered under DOL program:
   |-- No auth required (any codes)
   |-- 100% covered
   +-- Do NOT bother with commercial insurance -- use DOL only
```

---

## HST CODE

**95806**

---

## REFERRAL REQUIREMENT

**None required**

---

## PORTAL

| Portal | URL | Used For |
|--------|-----|----------|
| OWCP Connect | owcpconnect.dol.gov | ID verification |

---

## [!] IMPORTANT: DOL TAKES PRIORITY

```
If patient has BOTH commercial insurance AND DOL coverage:
|-- Use DOL only
|-- Do NOT submit to commercial
|-- DOL covers 100%
+-- Commercial insurance is irrelevant
```

---

## DECISION TREE FLAGS

### FLAG_DOL_IDENTIFIED
- **Trigger:** DOL coverage identified
- **Action:** Use DOL workflow, skip commercial insurance
- **Severity:** Low (simplifies workflow)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | Workers' Comp (DOL) |
| Auth Required | [X] No |
| HST Code | 95806 |
| Cost | 100% covered |
| Referral | None |
| Verification Portal | owcpconnect.dol.gov |
| Pain Level | [GREEN] Easy |

---

*Document for MEDOCR v0.17*
*Payer: Workers' Compensation (DOL)*
*Version 1.0 -- February 2026*
