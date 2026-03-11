# Unknown / Unidentified Insurance Protocol
## For MEDOCR Decision Tree Integration
### Version 1.1 -- February 2026

---

## Purpose

This protocol applies when:
- Insurance payer cannot be identified
- Insurance is not in our system
- Insurance is rare or unusual
- Card/information is unclear

---

## KEY PRINCIPLE: PROCESS FIRST, VERIFY LATER

Unknown payers **do not block processing**. The system:
1. Processes the document normally (extracts all clinical data)
2. Checks clinical sufficiency against **Carelon baseline criteria**
3. Outputs a **conditional readiness status**
4. Flags for verification call

---

## CLINICAL SUFFICIENCY BASELINE

**Carelon criteria serve as the industry baseline** for clinical sufficiency.

When a payer has no specific criteria file, use Carelon as the standard:

```
UNKNOWN PAYER PROCESSING:
|
|-- Extract all clinical data from documents
|
|-- Check against Carelon baseline criteria:
|   |-- Symptoms documented? (EDS, snoring, witnessed apneas, etc.)
|   |-- At least 2 of 5 symptom criteria met?
|   |-- Contraindications present? (route HST -> PSG)
|   +-- AHI thresholds for titration?
|
+-- OUTPUT (conditional):
    |
    |-- MEETS CARELON BASELINE
    |   +-- "If auth required -> likely meets criteria"
    |
    +-- DOES NOT MEET CARELON BASELINE
        +-- "If auth required -> more information likely needed"
```

---

## CONDITIONAL OUTPUT EXAMPLES

| Clinical Data Present | Carelon Check | Output |
|----------------------|---------------|--------|
| ESS 12, BMI 34, snoring, witnessed apneas | [OK] Meets baseline | "If auth required -> likely meets criteria" |
| Notes only say "sleep study requested" | [X] Missing symptoms | "If auth required -> more information likely needed" |
| Obesity + hypertension documented | [X] Comorbids only, no symptoms | "If auth required -> more information likely needed" |
| EDS, loud snoring, gasping at night | [OK] Meets baseline | "If auth required -> likely meets criteria" |

---

## UNIVERSAL RULE

**When in doubt, CALL.**

This is the universal fallback for any payer whose rules are unclear, auth requirements are uncertain, or the plan doesn't match known patterns.

---

## WORKFLOW: UNKNOWN PAYER

```
1. PROCESS DOCUMENT
   +-- Extract clinical data normally
   +-- Don't stop because payer is unknown

2. CHECK CLINICAL SUFFICIENCY
   +-- Compare against Carelon baseline
   +-- Generate conditional readiness output

3. FLAG FOR VERIFICATION
   +-- FLAG_UNKNOWN_PAYER
   +-- Must call to verify auth requirements

4. CALL TO VERIFY
   +-- Use number on card
   +-- Determine: auth required? HST code? Submission method?

5. FINAL OUTPUT
   +-- Combine: auth requirement + clinical readiness
   +-- Ready to schedule OR action needed
```

---

## IDENTIFICATION CHECKLIST

Before calling, attempt to identify the payer:

### Step 1: Check the Card
```
Look for:
|-- Payer name
|-- Network logos (BCBS, UHC, Cigna, Aetna, etc.)
|-- TPA indicators (EBMS, Meritain, etc.)
|-- Phone numbers (different numbers for different purposes)
|-- Member ID format
+-- Group number
```

### Step 2: Search Our Systems
```
Check:
|-- insurance.json accepted list
|-- Payer routing index
|-- NonBCBS Knowledge Base
|-- BCBS prefix database
+-- Previous encounters with similar cards
```

### Step 3: Check Availity
```
If standard payer not identified:
|-- Try eligibility lookup in Availity
|-- May route to correct payer
+-- Note what Availity returns
```

---

## VERIFICATION CALL

### Information to Gather
```
1. Use the main phone number on the card
   +-- Usually on back of card

2. During the call, document:
   |-- Who is the actual payer?
   |-- What network do they use?
   |-- Is authorization required?
   |-- For which codes?
   |-- What is the HST code (G0399 or 95806)?
   |-- How to submit auth if required?
   |-- What are the benefits?
   +-- Any special requirements?

3. Document ALL information received

4. Add to our system for future reference
```

---

## COMBINING RESULTS

After verification call, combine auth status with clinical readiness:

| Auth Required? | Clinical Readiness | Final Status |
|----------------|-------------------|--------------|
| No | -- | [OK] Ready to schedule |
| Yes | Likely meets criteria | [OK] Ready for auth submission |
| Yes | More info likely needed | [!] Request additional documentation |

---

## MINIMUM INFORMATION NEEDED

Before scheduling, you MUST have:

| Field | Required? | Notes |
|-------|-----------|-------|
| Payer name | [OK] Yes | Who are we billing? |
| Auth required? | [OK] Yes | For each code type |
| HST code | [OK] Yes | G0399 or 95806 |
| Benefits | [OK] Yes | Patient responsibility |
| Network status | [OK] Yes | In-network or OON |
| How to submit auth | If applicable | Portal, phone, fax? |

---

## FLAG SYSTEM

### FLAG_UNKNOWN_PAYER [!]
- **Trigger:** Payer not found in system
- **Action:** Call using number on card, document findings
- **Severity:** Medium (does not block clinical processing)
- **Blocking:** Yes for scheduling (until auth requirements verified)

### FLAG_CLINICAL_BASELINE_MET
- **Trigger:** Unknown payer + clinical data meets Carelon baseline
- **Action:** Note "If auth required -> likely meets criteria"
- **Severity:** Info

### FLAG_CLINICAL_BASELINE_NOT_MET
- **Trigger:** Unknown payer + clinical data does NOT meet Carelon baseline
- **Action:** Note "If auth required -> more information likely needed"
- **Severity:** Medium

### FLAG_ADD_TO_SYSTEM
- **Trigger:** New payer information collected
- **Action:** Add payer to insurance.json and create criteria file
- **Severity:** Low (administrative)

---

## COMMON SCENARIOS

### Scenario 1: Unusual Card with Network Logo
```
Card shows unfamiliar name BUT has BCBS/UHC/Cigna logo

Action:
|-- Likely an IBA/TPA using that network
|-- Call the number on the card (not the network)
|-- Ask if they use standard network rules
+-- Document any differences
```

### Scenario 2: Self-Funded Employer Plan
```
Card shows employer name, not insurance company

Action:
|-- This is likely a self-funded plan
|-- May use TPA (EBMS, Meritain, etc.)
|-- May use a network (Multiplan, PHCS, etc.)
|-- Call to determine actual handler
+-- Rules set by employer, not network
```

### Scenario 3: No Card / Verbal Insurance Info
```
Patient provides insurance name verbally, no card

Action:
|-- Ask patient to provide card/ID number
|-- Cannot proceed without verifiable information
|-- FLAG_INSURANCE_UNVERIFIED
+-- Schedule tentatively, verify before service
```

### Scenario 4: Out-of-State Plan
```
Insurance from another state we don't typically see

Action:
|-- Check if it's a BCBS plan (use prefix lookup)
|-- Check if we're in their network
|-- Call to verify auth requirements
+-- May need to confirm we're accepted as OOS provider
```

---

## DOCUMENTATION REQUIREMENTS

When adding a new payer, document:

```markdown
## [Payer Name] Clinical Criteria
### Version 1.0 -- [Date]

## Source
- Date verified: [date]
- Verified by: [name]
- Phone number called: [number]
- Representative name: [if obtained]

## Authorization Status
| Test | Auth Required | Method |
|------|---------------|--------|
| HST | [Yes/No/Call] | [Portal/Phone/Fax/N/A] |
| PSG | [Yes/No/Call] | [Portal/Phone/Fax/N/A] |
| Titration | [Yes/No/Call] | [Portal/Phone/Fax/N/A] |

## HST Code
[G0399 or 95806]

## Network
[Network name if applicable]

## Clinical Criteria
[Carelon baseline OR specific criteria if provided]

## Special Requirements
[Any unique requirements]

## Notes
[Anything else relevant]
```

---

## QUICK REFERENCE

| Situation | Action |
|-----------|--------|
| Unknown payer | Process clinicals -> check baseline -> call to verify auth |
| Meets Carelon baseline | "If auth required -> likely meets criteria" |
| Does not meet baseline | "If auth required -> more info likely needed" |
| No card | Request card from patient |
| Network logo but unknown name | Call card number, not network |
| Self-funded plan | Call to find TPA/handler |
| Out-of-state | Verify network status + auth rules |

---

## ESCALATION

If unable to identify payer or get clear information:

```
1. Escalate to supervisor
2. Contact patient for additional information
3. Consider scheduling as self-pay pending verification
4. Document all attempts made
```

---

*Document for MEDOCR v0.17*
*Protocol: Unknown / Unidentified Insurance*
*Version 1.1 -- February 2026*
