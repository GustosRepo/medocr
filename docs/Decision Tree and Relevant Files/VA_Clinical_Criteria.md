# VA (Veterans Affairs) Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- VA (Veterans Affairs)

---

## KEY CHARACTERISTIC: REFERRAL = AUTHORIZATION

VA does not require a separate authorization process.
**The referral from VA IS the authorization.**

---

## AUTHORIZATION STATUS

| Test | Auth Required | Process |
|------|---------------|---------|
| HST (G0399) | [X] No | Referral = Auth |
| PSG (95810) | [X] No | Referral = Auth |
| Titration (95811) | [X] No | Referral = Auth |
| Split Night | [X] No | Referral = Auth |

---

## [!] CRITICAL: 1-WEEK SCHEDULING WINDOW

```
CONSTRAINT:
|-- Patient must be scheduled within 1 WEEK of referral
|-- If not scheduled in time -> VA CANCELS the referral/auth
+-- This is a hard deadline -- no extensions
```

**Do not let VA referrals sit. Schedule immediately.**

---

## CLINICAL CRITERIA

### Not Applicable

Since referral = authorization, there is no clinical review process on our end.
- No symptom requirements enforced
- No comorbidity thresholds
- No documentation review
- VA has already approved the testing via their referral

---

## COST

```
Patient cost: $0 (100% covered)
```

---

## WORKFLOW

```
1. Receive referral from VA
   +-- This IS the authorization
2. [!] Schedule patient within 1 WEEK
   +-- If not scheduled in time -> Referral cancelled
3. Perform study
4. Bill VA
5. 100% covered -- no patient cost
```

---

## HST CODE

**G0399**

---

## REFERRAL REQUIREMENT

**Referral required** -- but VA provides it (we don't submit one).

The referral from VA serves as both the referral and the authorization.

---

## DECISION TREE FLAGS

### FLAG_VA_SCHEDULE_IMMEDIATELY [!]
- **Trigger:** VA patient with referral
- **Action:** Schedule within 1 week or auth expires
- **Severity:** High (time-sensitive)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | VA (Veterans Affairs) |
| Auth Required | [X] No (referral = auth) |
| HST Code | G0399 |
| Cost | 100% covered |
| Time Constraint | **1 week to schedule** |
| Pain Level | [GREEN] Easy (but time-sensitive) |

---

*Document for MEDOCR v0.16.6*
*Payer: VA (Veterans Affairs)*
*Version 1.0 -- February 2026*
