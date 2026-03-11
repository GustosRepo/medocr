# Evicore Sleep Clinical Criteria Summary
## For MEDOCR Decision Tree Integration
### Version 1.0 (Effective February 1, 2021)

---

## UNIVERSAL PRINCIPLES (Apply to ALL Payers)

### Principle 1: Symptoms Required for ALL Testing
**A comorbidity alone is NEVER enough.**

All sleep testing requires documented symptoms of sleep apnea. Comorbidities upgrade the test type, but you must ALWAYS have the base clinical picture first.

```
HST  = Symptoms + Clinical Eval
PSG  = Symptoms + Clinical Eval + Comorbidity (or HST failure)
```

### Principle 2: Questionnaire = Documentation, Not a Form
**You don't need to submit an actual questionnaire form.**

If the chart notes answer the relevant questions (ESS score, STOP-BANG elements, snoring, witnessed apnea, daytime sleepiness, etc.), that satisfies the "questionnaire" requirement. The documentation just needs to contain the clinical information - the format doesn't matter.

**Acceptable:**
- Completed questionnaire form
- Chart notes documenting: "Patient reports loud snoring, witnessed apneas, ESS score 14, BMI 32, hypertension" (this answers STOP-BANG/Berlin)
- H&P with sleep symptoms documented

**Not acceptable:**
- Just "patient referred for sleep study" with no clinical detail

---

## Payers Using These Criteria
- Cigna (via Evicore)
- Aetna (via Evicore) -- **See Aetna-specific exceptions below**
- Other payers contracting with Evicore for sleep auth

---

## AETNA-SPECIFIC EXCEPTIONS [!]

### Referral Requirement (Aetna HMO Plans)
Some Aetna plans (typically HMO) require **PCP referral** before any sleep testing can be performed. Services cannot be rendered without this referral for applicable plans.

**How to Check:**
1. Verify benefits via Availity
2. Benefits will indicate if PCP referral is required

**If Referral Required:**
```
Submit via Availity Referral Tool:
|-- Use PCP NPI + Facility NPI ONLY
|-- Do NOT use specialist/reading physician NPI
+-- Submit for ALL codes (HST and in-lab)
```

**Critical:** Even if authorization is not required for HST, the referral may still be required. Check both.

---

### Dual Submission Requirement
Some Aetna plans are "outlier plans" that require authorization through **BOTH** systems:

```
Step 1: Submit through Evicore
        |-- If Evicore says "No Auth Required" -> ALSO submit in Availity
        +-- If Evicore accepts -> You're done
        
Step 2: If Evicore returns "No Auth"
        +-- Submit in Availity anyway (some plans only route through Availity)
```

**Why:** Certain Aetna plan configurations don't route to Evicore properly. If it's not required via Availity either, the submission will simply come back as "not required."

### Meritain Plans (Aetna-Owned)
Some plans identified as "Aetna" are actually **Meritain Health** plans (Aetna subsidiary).

**How to Identify:**
- ID card may say "Meritain" or show Meritain logo
- Eligibility check may return Meritain
- Sometimes only discovered during benefits call

**Meritain Workflow:**
```
Step 1: CALL for benefit information (no portal lookup)
Step 2: During call, ask if authorization is required
        |-- If NO auth required -> Proceed to scheduling
        +-- If YES auth required -> Submit via Meritain portal
        
Meritain Auth Portal: https://meritain.mednecessity.com/
```

**Key Points:**
- Meritain requires PHONE CALL for benefits (not portal-based)
- Auth submission IS portal-based when required
- Don't assume Aetna portal/process works for Meritain plans

---

## 1. GENERAL REQUIREMENTS (All Tests)

### Clinical Evaluation Required
- Current comprehensive clinical evaluation within **60 days**
- OR meaningful contact (call/email) by established patient (H&P within 90 days)

### Documentation Must Include

**History elements:**
- Symptoms present >4 weeks, not from respiratory infection
- Witnessed apnea, gasping, choking
- Falls asleep during meetings, driving, at stoplights
- Daytime tiredness, excessive caffeine use
- Loud, erratic, variable snoring
- Frequent night awakenings
- Morning headaches, attention/memory issues
- Drowsy driving or crash history
- Prior OSA diagnosis and treatment response

**Physical exam elements:**
- Cardiopulmonary evaluation
- Obesity level / neck circumference
- Macroglossia, tonsillar hypertrophy, nasal polyps, septal deviation
- Elongated/enlarged uvula, narrow/high arched palate
- Retrognathia or micrognathia

### Sleep Questionnaire OR Equivalent Documentation in Notes
One of the following (or equivalent info documented in chart notes):
- Epworth Sleepiness Scale (or ESS score in notes)
- Berlin Questionnaire (or notes answering Berlin questions)
- STOP-BANG Questionnaire (or notes with STOP-BANG elements)
- Insomnia Severity Index

**You do NOT need to submit an actual questionnaire form.**
Chart notes satisfy this if they document:
- Snoring (loud, habitual)
- Witnessed apneas/gasping/choking
- Daytime sleepiness/fatigue
- BMI/neck circumference
- Hypertension
- ESS score (if mentioned)

**Acceptable proxies:**
- Witnessed apnea by bed partner
- Previous confirmed OSA diagnosis
- H&P elements that permit STOP-BANG/Berlin calculation

---

## 2. OSA DIAGNOSIS CRITERIA

### Positive OSA Defined As:
**Option A:** AHI/RDI/REI >= 15 events/hour

**Option B:** AHI/RDI/REI >= 5 and < 15 events/hour WITH one of:
- Symptoms: sleepiness, nonrestorative sleep, fatigue, insomnia
- Awakening with breath holding, gasping, choking
- Bed partner reports snoring/breathing interruptions
- Hypertension
- Mood disorder
- Cognitive dysfunction
- Coronary artery disease
- CHF
- Atrial fibrillation
- Type 2 diabetes
- Stroke

---

## 3. HOME SLEEP TESTING (HST) CRITERIA

### Approved When ALL THREE Met:

**1. High pre-test probability of moderate-to-severe OSA:**
- Validated questionnaire positive, OR
- Excessive daytime sleepiness + 2 of 3:
  - Habitual loud snoring
  - Witnessed apnea/gasping/choking
  - Diagnosed hypertension

**2. Patient can use equipment:**
- Has mobility, dexterity, cognitive ability
- Can follow instructions safely at home

**3. No comorbid conditions requiring PSG** (see PSG section)

### HST Also Approved For:
- Post-surgical assessment (moderate-severe OSA surgery)
- Post-oral appliance trial
- Post-positional therapy assessment

---

## 4. IN-LAB PSG CRITERIA

### CRITICAL: PSG Requires HST Criteria PLUS Comorbidities

**PSG is NOT a separate pathway.** Patient must meet:
1. ALL HST requirements (questionnaire, symptoms, clinical eval), AND
2. ONE of the comorbid conditions below (or HST failure)

### PSG Approved When HST Criteria Met PLUS ANY of:

**A. HST Cannot Be Done:**
- Low pre-test probability of OSA (still need questionnaire/symptoms)
- Patient lacks mobility/dexterity/cognitive ability
- HST was negative, inconclusive, or technically inadequate

**B. Comorbid Conditions Present (in addition to HST criteria):**

| Condition | Criteria |
|-----------|----------|
| **Morbid Obesity** | BMI >= 45 OR Obesity Hypoventilation (BMI >= 30 + PCO2 >= 45 or bicarb >= 27) |
| **Pulmonary Disease** | Nocturnal O2 use OR PO2 < 60 OR PCO2 > 45 OR FEV1 <= 69% predicted |
| **Neuromuscular** | Parkinson's, stroke with residua, active epilepsy, myotonic dystrophy, ALS |
| **CHF** | Moderate-severe with pulmonary congestion OR LVEF < 45% |
| **Pulmonary HTN** | mPAP >= 25 on cath OR TRV >= 2.9 m/s on echo |
| **Severe Insomnia** | ISI >= 22 |
| **Chronic Opioid Use** | Daily high-potency opioids (Methadone, Suboxone, Dilaudid) |
| **Pediatric** | Age < 18 years |
| **BiPAP/ASV Needed** | CPAP tried and failed/not tolerated |
| **Sleep-related Hypoxemia** | SpO2 <= 88% for >= 5 consecutive minutes without events |
| **Failed AutoPAP** | >30 days use with AHI > 5 (with symptoms) or > 15 (regardless) |
| **Central Sleep Apnea** | Centrals > 50% of total AND central index >= 5/hr |
| **Treatment-Emergent CSA** | OSA treated, centrals emerge |

---

## 5. SPLIT NIGHT STUDY CRITERIA

### Technical Requirements (Both):
1. AHI >= 15/hour during >= 2 hours of diagnostic recording
2. >= 3 hours available for PAP titration

### When Split Not Achievable:
- First night = Diagnostic PSG (95810)
- Second night = PAP Titration (95811)

---

## 6. TITRATION STUDY CRITERIA

### Initial Titration (After Diagnostic HST or PSG):
- Same comorbidity indications as PSG determine attended vs unattended APAP
- If no comorbidities, can do unattended APAP trial first

### Repeat Titration Approved When:
- Weight gain >= 10% with symptom return
- Weight loss (BMI drops 10% or below 30) with pressure intolerance
- Insufficient response despite treatment
- Symptoms return after initial good response
- PAP download shows AHI > 5 with symptoms OR > 15 regardless
- Must demonstrate compliance: >70% nights, 4+ hrs/night with continued symptoms

### NOT Approved For:
- Efficacy assessment without recurrent/changed symptoms
- Simply to get new PAP equipment

---

## 7. REPEAT DIAGNOSTIC TESTING CRITERIA

### Repeat HST or PSG Approved When:
- BMI decreases 10% or falls below 30 (to discontinue PAP)
- After surgical treatment for moderate-severe OSA
- After oral appliance trial
- After positional therapy
- Prior test was inadequate/inconclusive

### NOT Approved For:
- Routine reassessment without weight loss or intervention
- To supply new equipment

---

## 8. PEDIATRIC CRITERIA (Age <= 17)

### HST NOT Approved
- Home/portable studies investigational in children
- PSG is gold standard

### PSG Approved For:
- Sleep-related breathing disorders
- Narcolepsy/hypersomnia (with MSLT)
- Central hypoventilation syndrome
- Nocturnal seizures
- REM behavior disorder
- Post-adenotonsillectomy with residual symptoms
- Periodic limb movement disorder

### CPT Codes:
- Age < 6: Use 95782
- Age >= 6: Use 95810

### Habitual Snoring + Any Of:
- Restless/disturbed sleep
- Behavioral/learning disorders, hyperactivity, ADHD
- Unexplained enuresis
- Frequent awakenings
- Failure to thrive
- Witnessed apnea
- Labored breathing during sleep
- Morning headaches
- Hypertension
- Under/overweight
- Secondary enuresis
- Excessive daytime sleepiness
- Polycythemia
- Cor pulmonale
- Tonsillar hypertrophy
- Adenoidal facies

---

## 9. DECISION TREE INTEGRATION

### Key Principle: Symptoms First, Comorbidities Upgrade
- ALL tests require symptoms of sleep apnea documented
- Comorbidities alone are NEVER sufficient
- "Questionnaire" = symptoms documented (form not required)

### For HST Authorization:
```
CHECK: Sleep symptoms documented in notes?
       (snoring, witnessed apnea, EDS, etc.)
|-- NO -> DENY (need symptom documentation)
+-- YES -> CHECK: High pre-test probability?
    |-- NO -> May need PSG instead (but still need symptoms)
    +-- YES -> CHECK: Any PSG-requiring comorbidities?
        |-- YES -> Route to PSG (symptoms already confirmed)
        +-- NO -> CHECK: Can patient use equipment?
            |-- NO -> Route to PSG
            +-- YES -> APPROVE HST
```

### For PSG Authorization:
```
CHECK: Sleep symptoms documented in notes?
|-- NO -> DENY (comorbidity alone is NOT enough)
+-- YES -> CHECK: Any comorbidity from list OR HST failed?
    |-- YES -> APPROVE PSG
    +-- NO -> Route to HST first (no PSG justification)
```

### For Titration Authorization:
```
CHECK: Valid diagnostic on file?
|-- NO -> DENY (need diagnostic first)
+-- YES -> CHECK: AHI meets criteria (>=15 or >=5 with symptoms/comorbids)?
    |-- NO -> DENY
    +-- YES -> CHECK: Comorbidities requiring attended titration?
        |-- YES -> APPROVE attended (95811)
        +-- NO -> APPROVE unattended APAP trial first
```

---

## 10. KEY THRESHOLDS SUMMARY

| Metric | Value | Meaning |
|--------|-------|---------|
| AHI >= 15 | Moderate OSA | Qualifies for treatment |
| AHI >= 5 < 15 + symptoms | Mild OSA | Qualifies if symptoms/comorbids |
| AHI >= 15 in 2 hours | Split eligible | Can do split night |
| BMI >= 45 | Morbid obesity | Requires PSG |
| BMI >= 30 + PCO2 >= 45 | OHS | Requires PSG |
| ISI >= 22 | Severe insomnia | Requires PSG |
| LVEF < 45% | Moderate-severe CHF | Requires PSG |
| FEV1 <= 69% | Moderate-severe COPD | Requires PSG |
| Age < 18 | Pediatric | Requires PSG (no HST) |
| Compliance | >70% nights, 4+ hrs | Required for repeat titration |

---

*Document generated from: evicore_sleep_final_v10_eff020121_pub100920.pdf*
*Effective: February 1, 2021*
*For MEDOCR v0.16.5 integration*
