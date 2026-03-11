# Medicare Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payers Covered
- Original Medicare (Fee-for-Service)
- Medicare FFS

**Note:** Medicare Advantage plans follow their parent company's rules (UHC, Humana, Aetna, etc.)

---

## KEY CHARACTERISTIC: NO AUTH -- BILLING RULES ONLY

Medicare does NOT require prior authorization for sleep studies.
However, billing rules determine whether claims will be paid.

---

## AUTHORIZATION

```
HST:     a No authorization required
PSG:     a No authorization required  
Titration: a No authorization required
Split:   a No authorization required
```

---

## CRITICAL BILLING REQUIREMENT

### AFib-Only Rule

**Medicare will deny claims if the ONLY diagnoses are:**
```
G47.30 (Sleep apnea, unspecified) + I48.91 (Atrial fibrillation)
```

**This combination alone is INSUFFICIENT for billing.**

### Why This Matters
- Cardiologists often refer for sleep study due to AFib
- AFib alone is not considered sufficient medical necessity
- Need at least ONE additional symptom or comorbidity

### What Makes It Billable
Add ANY of these to G47.30 + I48.91:
- R06.83 (Snoring)
- R06.81 (Apnea)
- R40.0 (Somnolence/EDS)
- E66.x (Obesity)
- I10 (Hypertension)
- Any other sleep symptom
- Any relevant comorbidity

### Examples
```
a DENY:  G47.30, I48.91
[OK] ALLOW: G47.30, I48.91, R06.83 (added snoring)
[OK] ALLOW: G47.30, I48.91, E66.9 (added obesity)
[OK] ALLOW: G47.30, I48.91, I10 (added hypertension)
```

---

## DECISION TREE INTEGRATION

### Detection Logic
```
IF payer == "Medicare" OR payer == "Medicare FFS"
   AND icd_codes contains G47.30
   AND icd_codes contains I48.91
   AND icd_codes.length == 2  (only these two codes)
THEN
   FLAG_MEDICARE_AFIB_ONLY
   Message: "Medicare requires additional symptom beyond AFib for billing"
```

### Resolution
- Review chart notes for additional symptoms
- Add appropriate ICD-10 code (snoring, EDS, obesity, HTN, etc.)
- If truly no other symptoms -> may need to request additional documentation

---

## HST CODE

```
HST Code: 95806 (not G0399)
```

Medicare FFS uses 95806 for home sleep testing.

---

## COVERAGE CRITERIA (LCD/NCD)

While no auth is required, Medicare does have coverage criteria that affect payment:

### Sleep Testing Covered When
- Symptoms of OSA are present
- Clinical evaluation completed
- Testing ordered by treating physician

### OSA Diagnosis Criteria (for treatment coverage)
- AHI >= 15, OR
- AHI >= 5 with symptoms (EDS, impaired cognition, mood disorder, insomnia, HTN, IHD, stroke)

---

## WORKFLOW SUMMARY

```
1. Check ICD codes
   +-- G47.30 + I48.91 only? -> FLAG_MEDICARE_AFIB_ONLY
   +-- Other symptoms present? -> Proceed

2. No authorization needed -- schedule directly

3. Bill with appropriate ICD codes (ensure not AFib-only)
```

---

## DECISION TREE FLAGS

### FLAG_MEDICARE_AFIB_ONLY
- **Trigger:** Medicare patient with only G47.30 + I48.91
- **Action:** Add additional symptom/ICD code before scheduling
- **Severity:** Medium (claim will deny if not resolved)
- **Resolution:** Review notes for snoring, EDS, obesity, HTN, etc.

---

## QUICK REFERENCE

| Test | Auth Required | Billing Requirement | HST Code |
|------|---------------|---------------------|----------|
| HST | No | Not AFib-only | 95806 |
| PSG | No | Not AFib-only | 95810 |
| Titration | No | Prior positive + not AFib-only | 95811 |
| Split | No | Not AFib-only | 95811 |

---

*Document for MEDOCR v0.16.5*
*Payer: Medicare FFS*
