# Molina Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payers Covered
- Molina Medicaid
- Molina Marketplace (rare)

---

## KEY CHARACTERISTIC: NO AUTH -- SUBMIT AS FORMALITY

Molina does not require authorization, but we **submit in-lab requests through Availity anyway** as a formality.

---

## AUTHORIZATION STATUS

| Test | Auth Required | Submit Anyway |
|------|---------------|---------------|
| HST (G0399) | [X] No | [X] No |
| PSG (95810) | [X] No | [OK] Yes (Availity) |
| Titration (95811) | [X] No | [OK] Yes (Availity) |
| Split Night | [X] No | [OK] Yes (Availity) |

---

## CLINICAL CRITERIA

### Not Applicable

Since no authorization is required, there is no clinical review process.
- No symptom requirements enforced
- No comorbidity thresholds
- No documentation review

---

## COST

### Molina Medicaid
```
Patient cost: $0 (100% covered)
```

### Molina Marketplace
```
Patient cost: Check benefits
```

---

## WHY SUBMIT IF NO AUTH REQUIRED?

```
REASONS TO SUBMIT ANYWAY:
|-- Guidelines change semi-frequently
|-- Submission provides confirmation/reference number
|-- Protects against future retroactive issues
|-- Minimal effort through Availity
+-- Better safe than sorry
```

---

## WORKFLOW

### HST
```
1. Verify eligibility/benefits on Availity
2. No submission needed
3. Schedule directly
4. Bill normally
```

### In-Lab (PSG/Titration/Split)
```
1. Verify eligibility/benefits on Availity
2. Submit via Availity (as formality)
   +-- No auth required, but get confirmation number
3. Schedule patient
4. Bill normally
```

---

## HST CODE

**G0399**

---

## REFERRAL REQUIREMENT

### Molina Medicaid
**Never required**

### Molina Marketplace
**Check benefits** -- requirement uncertain (rare plan)

---

## PORTAL

| Portal | URL | Used For |
|--------|-----|----------|
| Availity | availity.com | Eligibility, benefits, in-lab submission |

---

## DECISION TREE FLAGS

### FLAG_MOLINA_SUBMIT_ANYWAY
- **Trigger:** Molina patient needs in-lab testing
- **Action:** Submit via Availity even though no auth required
- **Severity:** Low (formality, not requirement)

---

## QUICK REFERENCE

| Field | Molina Medicaid | Molina Marketplace |
|-------|-----------------|-------------------|
| Auth Required | [X] No | [X] No |
| Submit In-Lab | [OK] Yes (formality) | [OK] Yes (formality) |
| HST Code | G0399 | G0399 |
| Cost | 100% covered | Check benefits |
| Referral | Never | Check benefits |
| Portal | Availity | Availity |
| Pain Level | [GREEN] Easy | [GREEN] Easy |

---

*Document for MEDOCR v0.16.6*
*Payer: Molina (Medicaid + Marketplace)*
*Version 1.0 -- February 2026*
