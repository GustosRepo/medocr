# Caresource Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- Caresource Medicaid

---

## KEY CHARACTERISTIC: NO AUTH -- PROCESS REQUIREMENTS

Caresource does not require authorization, but has **specific process requirements** before scheduling.

---

## AUTHORIZATION STATUS

| Test | Auth Required |
|------|---------------|
| HST (G0399) | [X] No |
| PSG (95810) | [X] No |
| Titration (95811) | [X] No |
| Split Night | [X] No |

---

## [!] REQUIRED BEFORE SCHEDULING

Even though no auth is required, you must:

```
1. Obtain code printout from benefits verification
2. Verify referring physician network status
   +-- Use: findadoctor.caresource.com
```

**Both items are required documentation before scheduling.**

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
Patient cost: $0 (100% covered -- Medicaid rule)
```

---

## WORKFLOW

```
1. Verify benefits on Availity
2. Obtain code printout (REQUIRED)
3. Verify referring physician network status:
   +-- Go to: findadoctor.caresource.com
   +-- Confirm referring MD is in-network
4. Schedule patient
5. Perform study
6. Bill normally
7. 100% covered -- no patient cost
```

---

## HST CODE

**G0399**

---

## REFERRAL REQUIREMENT

**Never required**

---

## PORTALS

| Portal | URL | Used For |
|--------|-----|----------|
| Availity | availity.com | Benefits verification |
| Caresource Provider Search | findadoctor.caresource.com | Referring MD network status |

---

## DECISION TREE FLAGS

### FLAG_CARESOURCE_PROCESS_REQS
- **Trigger:** Caresource patient identified
- **Action:** Obtain code printout + verify referring MD network status before scheduling
- **Severity:** Medium (required documentation)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | Caresource Medicaid |
| Auth Required | [X] No |
| HST Code | G0399 |
| Cost | 100% covered |
| Referral | Never |
| Required Before Scheduling | Code printout + referring MD network check |
| Pain Level | [GREEN] Easy |

---

## CHECKLIST BEFORE SCHEDULING

- [ ] Benefits verified on Availity
- [ ] Code printout obtained
- [ ] Referring physician network status confirmed at findadoctor.caresource.com

---

*Document for MEDOCR v0.16.6*
*Payer: Caresource Medicaid*
*Version 1.0 -- February 2026*
