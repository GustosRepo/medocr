# Las Vegas Firefighters Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- Las Vegas Firefighters (Union Plan)

---

## KEY CHARACTERISTIC: NO AUTH -- BUT MUST CALL

Las Vegas Firefighters does not require authorization, but **you must call to verify** due to inconsistent information.

---

## AUTHORIZATION STATUS

| Test | Auth Required |
|------|---------------|
| HST (G0399) | [X] No |
| PSG (95810) | [X] No |
| Titration (95811) | [X] No |
| Split Night | [X] No |

---

## [!] CRITICAL: MUST CALL

```
WARNING:
|-- Information is inconsistent between sources
|-- Portal/card information may not be reliable
|-- Phone is the ONLY reliable verification method
+-- Do NOT trust online information alone
```

**Always call to verify before scheduling.**

---

## CLINICAL CRITERIA

### Not Applicable

Since no authorization is required, there is no clinical review process.
- No symptom requirements enforced
- No comorbidity thresholds
- No documentation review

---

## WORKFLOW

```
1. CALL the plan to verify
   +-- Do NOT rely on portal or card information
   +-- Information is frequently inconsistent
2. Document what you're told during the call
3. Schedule based on phone verification
4. Perform study
5. Bill normally
```

---

## HST CODE

**G0399**

---

## REFERRAL REQUIREMENT

**Verify by phone** -- do not assume

---

## WHY CALL?

```
KNOWN ISSUES:
|-- Inconsistent information between sources
|-- Card information may be outdated
|-- Portal may show incorrect data
|-- Benefits may vary by member
+-- Only reliable source is live phone verification
```

---

## DECISION TREE FLAGS

### FLAG_FIREFIGHTERS_CALL_REQUIRED [!]
- **Trigger:** Las Vegas Firefighters plan identified
- **Action:** Must call to verify -- do not trust online info
- **Severity:** Medium (inconsistent information requires phone verification)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | Las Vegas Firefighters (Union) |
| Auth Required | [X] No |
| HST Code | G0399 |
| Verification Method | **Phone call required** |
| Referral | Verify by phone |
| Pain Level | [YELLOW] Medium (due to call requirement) |

---

## VERIFICATION CHECKLIST

- [ ] Called plan to verify benefits
- [ ] Documented phone verification details
- [ ] Confirmed no authorization required
- [ ] Confirmed referral requirement (if any)

---

*Document for MEDOCR v0.16.6*
*Payer: Las Vegas Firefighters*
*Version 1.0 -- February 2026*
