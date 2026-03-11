# Sierra Health / HPN Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payers Covered
- Sierra Health and Life
- Health Plan of Nevada (HPN) -- Commercial
- Health Plan of Nevada (HPN) -- Medicaid
- UMR (when processed through Sierra/HPN network)

---

## KEY CHARACTERISTIC: LENIENT

Sierra/HPN is the **most lenient** payer for clinical criteria.
- HST: No clinical justification needed
- PSG: Comorbidity alone IS sufficient (no symptoms required)
- Titration: Just document patient has apnea

---

## HST CRITERIA

### Requirements
```
REQUIRED: None -- just submit through portal
```

### Approval
- Automatic upon submission
- No clinical documentation required
- No symptoms required
- No questionnaire required

### Submission
- Portal: provider.healthplanofnevada.com
- Units: Request 2 units
- Notes: Not required

---

## PSG CRITERIA

### Requirements
```
REQUIRED: Brief justification for in-lab testing
ACCEPTABLE: Comorbidity alone OR symptoms alone
```

### Key Difference from Evicore
**Comorbidity WITHOUT symptoms IS enough for PSG approval.**

### Acceptable Justifications (ANY ONE)
- COPD
- CHF
- Obesity (any BMI threshold)
- Chronic opioid use
- Neuromuscular disease
- Home oxygen use
- Severe insomnia
- Any documented sleep symptom
- HST failure/inconclusive
- Patient cannot use home equipment

### Submission
- Portal: provider.healthplanofnevada.com
- Units: Request 2 units
- Notes: Include brief justification (1-2 sentences sufficient)

### Example Justifications
- "Patient has COPD, in-lab monitoring required"
- "BMI 42, home testing not appropriate"
- "Patient on chronic opioids"
- "Prior HST inconclusive"

---

## TITRATION CRITERIA

### Requirements
```
REQUIRED: Document patient has sleep apnea
REQUIRED: Prior positive diagnostic on file
```

### Approval
- Prior AHI showing OSA diagnosis
- No specific AHI threshold documented
- No compliance requirements for initial titration

### Submission
- Portal: provider.healthplanofnevada.com
- Units: Request 2 units
- Notes: Reference prior diagnostic results

---

## SPLIT NIGHT CRITERIA

### Requirements
- Same as PSG OR Titration -- either path qualifies
- Brief justification (comorbid/symptom) OR prior positive AHI
- No specific AHI threshold during study required

---

## UMR VIA SIERRA NETWORK

### Identification
- UMR plan processed through Sierra/HPN portal
- Benefits check shows Sierra network

### Criteria
```
SAME AS SIERRA -- Very lenient
- Submit ALL relevant codes
- Request 2 units each
- Basically a formality
```

### Workflow
- Submit through provider.healthplanofnevada.com
- Minimal scrutiny on clinical documentation
- Request all codes that might apply

---

## [!] CRITICAL: "(UM ONLY)" PLANS

### What It Means
If eligibility shows **(UM Only)** -- this is **NOT** a Sierra or HPN plan!

```
(UM Only) = Authorization-only policy for UMR
|-- Sierra/HPN portal handles AUTH ONLY
|-- Benefits are NOT through Sierra/HPN
|-- You need to find the UMR ID to obtain benefits
+-- Do NOT quote Sierra/HPN benefits to patient
```

### Workflow for (UM Only)
```
1. Eligibility shows "(UM Only)"
2. Find the UMR member ID (may be different from Sierra ID)
3. Check benefits via provider.umr.com (NOT Sierra portal)
4. Submit AUTH through Sierra portal (provider.healthplanofnevada.com)
5. Bill using UMR information
```

---

## [!] DUAL COVERAGE WARNING

### Common Scenario
Many patients are covered by **multiple plans** that all use this portal for authorization.

### Why This Happens
- Sierra, HPN, and various UMR plans share the same auth portal
- Employers may offer multiple plan options
- Family members may have different plans

### What To Do
```
IF patient has multiple plans using this portal:
|-- Submit authorization for BOTH plans
|-- Verify benefits for EACH plan separately
+-- Determine primary vs secondary using standard COB rules
```

---

## PEDIATRIC HANDLING

### Standard Codes Apply
- Age < 6: Use 95782 (Pediatric PSG)
- Age >= 6: Use 95810 (Adult PSG)
- Same lenient criteria as adult -- comorbidity OR symptom sufficient

---

## REFERRAL REQUIREMENT

**None.** Sierra/HPN does not require PCP referral for any plan type.

---

## WORKFLOW SUMMARY

```
HST:
|-- Submit through portal
|-- No justification needed
|-- Request 2 units
+-- APPROVE

PSG:
|-- Submit through portal
|-- Include brief justification (comorbid OR symptom)
|-- Request 2 units
+-- APPROVE (if any justification present)

TITRATION:
|-- Submit through portal
|-- Reference prior positive AHI
|-- Request 2 units
+-- APPROVE (if prior diagnostic exists)
```

---

## DECISION TREE FLAGS

### FLAG_SIERRA_UM_ONLY [!]
- **Trigger:** Eligibility shows "(UM Only)" designation
- **Action:** This is UMR, not Sierra/HPN. Find UMR ID for benefits. Auth only through this portal.
- **Severity:** High (wrong benefits will be quoted if missed)

### FLAG_SIERRA_DUAL_COVERAGE
- **Trigger:** Patient has multiple plans using Sierra/HPN portal
- **Action:** Submit auth for both plans, verify benefits separately
- **Severity:** Medium (may miss secondary coverage)

### FLAG_SIERRA_PSG_NEEDS_JUSTIFICATION
- **Trigger:** PSG requested, no comorbidity or symptom documented
- **Action:** Add brief justification before submission
- **Severity:** Low (easy to resolve)

### FLAG_SIERRA_TIT_NO_PRIOR
- **Trigger:** Titration requested, no prior diagnostic on file
- **Action:** Need diagnostic first or obtain prior results

---

## WHY WE DEFAULT TO HST FOR SIERRA

Strategic reasoning:
1. HST requires ZERO justification -- just submit
2. PSG requires documentation (even if minimal)
3. Path of least resistance = HST first
4. If HST fails -> PSG justification is automatic ("prior HST inconclusive")

---

## QUICK REFERENCE

| Test | Auth Required | Clinical Needed | Units | Referral |
|------|---------------|-----------------|-------|----------|
| HST | Yes (portal) | None | 2 | None |
| PSG | Yes (portal) | Any comorbid OR symptom | 2 | None |
| Titration | Yes (portal) | Prior positive AHI | 2 | None |
| Split | Yes (portal) | PSG criteria OR Tit criteria | 2 | None |
| Pediatric (<6) | Yes (portal) | Same as adult | 2 | None |

### Key Differences from Evicore
| Evicore | Sierra/HPN |
|---------|------------|
| Symptoms + Comorbidity for PSG | Comorbidity alone OR Symptom alone |
| Strict documentation requirements | Minimal -- 1-2 sentence justification |
| Form-based questionnaire helpful | Notes alone sufficient |

---

*Document for MEDOCR v0.16.5*
*Payer: Sierra Health / HPN*
*Last Updated: February 2026*
