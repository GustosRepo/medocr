# ChampVA Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- ChampVA (Civilian Health and Medical Program of the Department of Veterans Affairs)

---

## KEY CHARACTERISTIC: TRUE NO-AUTH

ChampVA is the **simplest payer** -- no authorization required for any codes.
Just verify eligibility and schedule.

---

## AUTHORIZATION STATUS

| Test | Auth Required |
|------|---------------|
| HST (G0399) | a No |
| PSG (95810) | a No |
| Titration (95811) | a No |
| Split Night | a No |

---

## CLINICAL CRITERIA

### Not Applicable

Since no authorization is required, there is no clinical review process.
- No symptom requirements enforced
- No comorbidity thresholds
- No documentation review

### Standard Medical Necessity Still Applies

While no auth needed, standard medical documentation should exist:
- Reason for testing documented
- Appropriate ICD-10 codes
- Proper order from treating physician

---

## COST

```
Patient cost: $0 (100% covered)
```

---

## WORKFLOW

```
1. Verify eligibility and benefits
2. Schedule directly
3. Perform study
4. Bill ChampVA
5. 100% covered -- no patient cost
```

**That's it. No special process requirements.**

---

## HST CODE

**G0399**

---

## REFERRAL REQUIREMENT

**None required**

---

## WHAT IS CHAMPVA?

ChampVA is a health benefits program for:
- Spouses and children of veterans who are permanently and totally disabled
- Surviving spouses and children of veterans who died from service-connected conditions
- Surviving spouses and children of veterans who died on active duty

**Not to be confused with VA** -- ChampVA is for dependents, VA is for veterans.

---

## DECISION TREE FLAGS

**None** -- ChampVA does not generate any flags.

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | ChampVA |
| Auth Required | a No |
| HST Code | G0399 |
| Cost | 100% covered |
| Referral | None |
| Special Requirements | None |
| Pain Level | [GREEN] Very easy |

---

*Document for MEDOCR v0.16.6*
*Payer: ChampVA*
*Version 1.0 -- February 2026*
