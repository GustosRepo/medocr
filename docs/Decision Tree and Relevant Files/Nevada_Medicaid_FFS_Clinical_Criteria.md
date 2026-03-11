# Nevada Medicaid FFS Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payers Covered
- Nevada Medicaid Fee-for-Service (FFS) ONLY

**Note:** Medicaid MCOs (Anthem Medicaid, Silversummit, Molina, HPN Medicaid, Caresource) have their own rules -- see separate files.

---

## KEY CHARACTERISTIC: PROCESS-STRICT, CLINICALLY-LENIENT

Nevada Medicaid FFS is:
- **Strict on process** -- must follow exact submission procedures
- **Lenient on clinical** -- not strict about documentation content
- **HST prohibited** -- always requires in-lab PSG

---

## HARD-CODED RULES

### Rule 1: NO HST -- EVER
```
a HST is NEVER allowed for Nevada Medicaid FFS
[OK] Always requires PSG (in-lab)
```

**If HST is ordered -> Need new RX for PSG**

### Rule 2: Questionnaire REQUIRED
```
[OK] Actual questionnaire form required (not just chart notes)
```

Unlike other payers, Nevada Medicaid wants the actual form submitted.

---

## AUTHORIZATION

| Test | Auth Required | Method |
|------|---------------|--------|
| HST | N/A | Not allowed |
| PSG | Yes | Submit to Nevada Medicaid |
| Titration | Yes | Submit to Nevada Medicaid |
| Split | Yes | Submit to Nevada Medicaid |

---

## CLINICAL CRITERIA

### PSG Approval
- **Clinically lenient** -- not strict about specific documentation
- Sleep symptoms helpful but not rigidly enforced
- Focus is on proper submission, not clinical gatekeeping

### Titration Approval
- Prior positive diagnostic
- Standard criteria apply

### What They Care About
1. Proper submission format
2. Questionnaire form included
3. Correct procedure followed

### What They Don't Scrutinize
- Specific symptom thresholds
- Comorbidity requirements
- Detailed clinical justification

---

## DECISION TREE INTEGRATION

### Detection Logic
```
IF payer == "Nevada Medicaid FFS" OR payer == "Nevada Medicaid"
THEN
   IF order_type == HST
      FLAG_NV_MEDICAID_HST_NOT_ALLOWED
      Action: Need new RX for PSG
   
   IF questionnaire_present == false
      FLAG_NV_MEDICAID_QUESTIONNAIRE_REQUIRED
      Action: Obtain questionnaire form
```

---

## WORKFLOW SUMMARY

```
1. Check for HST order
   +-- HST ordered? -> STOP -- Need new RX for PSG

2. Verify questionnaire form
   +-- Missing? -> Request questionnaire from provider

3. Submit PSG auth
   +-- Follow exact submission process

4. Clinical documentation
   +-- Include what's available (not heavily scrutinized)
```

---

## COST INFORMATION

```
Patient cost: $0 (100% covered)
```
Universal Medicaid rule -- no patient responsibility for approved services.

---

## DECISION TREE FLAGS

### FLAG_NV_MEDICAID_HST_NOT_ALLOWED
- **Trigger:** Nevada Medicaid FFS patient with HST order
- **Action:** Contact provider for new RX specifying PSG
- **Severity:** High (cannot proceed with HST)
- **Blocking:** Yes

### FLAG_NV_MEDICAID_QUESTIONNAIRE_REQUIRED
- **Trigger:** Nevada Medicaid FFS without questionnaire form
- **Action:** Request questionnaire from ordering provider
- **Severity:** Medium (required for submission)
- **Blocking:** Yes (for submission)

---

## QUESTIONNAIRE DETAILS

### Acceptable Forms
- Epworth Sleepiness Scale
- STOP-BANG
- Berlin Questionnaire

### Format
- Actual completed form (not just values in chart notes)
- Patient signature helpful
- Provider can complete based on patient interview

---

## QUICK REFERENCE

| Test | Auth Required | Allowed | Special Requirements |
|------|---------------|---------|---------------------|
| HST | N/A | a NO | Never allowed |
| PSG | Yes | [OK] Yes | Questionnaire form required |
| Titration | Yes | [OK] Yes | Prior positive + questionnaire |
| Split | Yes | [OK] Yes | Prior positive + questionnaire |

---

*Document for MEDOCR v0.16.5*
*Payer: Nevada Medicaid FFS*
