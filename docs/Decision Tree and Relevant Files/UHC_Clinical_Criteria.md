# UnitedHealthcare (UHC) Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 2.1 -- February 2026 -- COMPLETE

---

## [!] UHC IS COMPLEX -- MULTIPLE PLAN TYPES WITH DIFFERENT WORKFLOWS

UHC has **at least 4 distinct routing paths** depending on plan type. Identification is critical.

**Sources:**
- UHC Medical Policy 2026T0334RR (Sleep Studies) -- Effective 01/01/2026
- UHC Medical Policy 2026T0525TT (OSA Treatment) -- Effective 01/01/2026
- AASM 2017 Clinical Practice Guidelines (for Optum Medicare)

---

## Payers Covered
- UHC Commercial
- UHC Medicare (Direct-managed)
- UHC Medicare (Optum-managed)
- UHC Surest (variable copay variant)
- UMR (when processed through UHC network -- see separate UMR section)

---

## PLAN TYPE IDENTIFICATION

### How to Identify Plan Type

| Plan Type | How to Identify | Key Difference |
|-----------|-----------------|----------------|
| **Commercial** | Standard UHC card, employer plan | Auth via uhcprovider.com |
| **Medicare Direct** | Benefits check shows UHC-managed | NO auth needed |
| **Medicare Optum** | Benefits check shows Optum-managed, card may indicate | Auth via Curo, 3 portals |
| **Surest** | Card/plan name says "Surest" | Variable copays by ZIP |

**Problem:** No reliable ID format difference between Medicare Direct and Optum-managed. Must check during benefits verification.

---

## CLINICAL CRITERIA COMPARISON -- ALL UHC PLANS

### HST Eligibility (Same Across All Plans)

| Condition | HST Allowed? | Threshold |
|-----------|--------------|-----------|
| Adult uncomplicated | [OK] Yes | Standard eligibility |
| **CHF** | a No -> PSG | NYHA III-IV OR LVEF <=40% |
| **COPD** | a No -> PSG | FEV1 <60% predicted |
| **Chronic opioid use** | a No -> PSG | >3 months duration |
| **Neuromuscular disease** | a No -> PSG | Any progressive condition |
| **Stroke** | a No -> PSG | With persistent sequelae |
| **Morbid obesity** | a No -> PSG | BMI >50 |
| **OHS** | a No -> PSG | Any |
| **Central apnea suspected** | a No -> PSG | Any |
| **Home oxygen** | a No -> PSG | Any (HARD STOP) |
| **Pediatric (<18)** | a No -> PSG | All ages |

### Failed/Inconclusive HSAT -- CRITICAL RULE

| Scenario | UHC Commercial | Optum Medicare |
|----------|----------------|----------------|
| First HSAT negative/inconclusive | -> PSG (no repeat HSAT) | -> PSG (no repeat HSAT) |
| First HSAT technically inadequate | -> PSG (no repeat HSAT) | -> PSG (no repeat HSAT) |
| **NEVER authorize second HSAT** | [OK] Same | [OK] Same |

### OSA Severity Definitions (Same Across All Plans)

| Severity | AHI/RDI |
|----------|---------|
| Mild | >=5 to <15/hr |
| Moderate | >=15 to <=30/hr |
| Severe | >30/hr |

### Repeat Testing Criteria (Same Across All Plans)

| Trigger | Authorized? |
|---------|-------------|
| Weight change >=10% | [OK] Yes |
| New/changed cardiovascular disease | [OK] Yes |
| Persistent symptoms despite compliant PAP | [OK] Yes |
| Routine reassessment (asymptomatic on PAP) | a No |

---

## 1. UHC COMMERCIAL [OK]

### Authorization Requirements
| Test | Auth Required | Portal | Notes Required |
|------|---------------|--------|----------------|
| HST | a No | N/A | N/A |
| PSG (95810) | [OK] Yes | uhcprovider.com | **ALWAYS** |
| Titration (95811) | [OK] Yes | uhcprovider.com | **ALWAYS** |
| Split Night | [OK] Yes | uhcprovider.com | **ALWAYS** |

### Key Points
- **Referral:** Never required for Commercial
- **HST Code:** G0399
- **Notes:** ALWAYS required with auth submission (not "if requested")
- **Fallback:** Call if portal doesn't work (patient not found, redirects, etc.)
- **Pain Level:** [GREEN] Easy

### Portal
| Portal | URL | Used For |
|--------|-----|----------|
| UHC Provider | uhcprovider.com | Auth submission, benefits |

### Workflow
```
1. Verify benefits via uhcprovider.com
2. HST: No auth needed -> Schedule
3. In-lab: Submit auth via uhcprovider.com
   +-- MUST include clinical notes (always, not optional)
4. If portal issues -> Call UHC
```

---

## 2. UHC MEDICARE (DIRECT-MANAGED) [OK]

### Authorization Requirements
| Test | Auth Required | Portal | Notes Required |
|------|---------------|--------|----------------|
| HST | a No | N/A | N/A |
| PSG (95810) | a No | N/A | N/A |
| Titration (95811) | a No | N/A | N/A |
| Split Night | a No | N/A | N/A |

### Key Points
- **NO auth required for ANY test**
- **Submit anyway** to get confirmation for reference
- **HST Code:** G0399
- **Allowables:** UHC rates
- **Pain Level:** [GREEN] Easy

### Referral Requirements
| Plan Type | Referral Required? | Who Submits? | Portal |
|-----------|-------------------|--------------|--------|
| **HMO** | [OK] Yes | **PCP** (not us) | uhcprovider.com |
| **PPO** | a No | N/A | N/A |

**Important:** For HMO plans, the **PCP must submit the referral** through uhcprovider.com -- we cannot submit it on their behalf.

### Workflow
```
1. Identify as UHC Direct-managed (benefits check)
2. Determine HMO vs PPO
3. If HMO -> Ensure PCP has submitted referral via uhcprovider.com
4. No auth needed, but submit anyway for confirmation reference
5. Schedule
```

---

## 3. UHC MEDICARE (OPTUM-MANAGED) [!]

### [!] Common Problem: Mislabeled Referrals
Optum plans often get **mislabeled on referrals** since Optum is an IPA. Verify the plan type carefully.

### Authorization Requirements
| Test | Auth Required | Portal | Notes Required |
|------|---------------|--------|----------------|
| HST | a No | N/A | N/A |
| PSG (95810) | [OK] Yes | **Curo** | **ALWAYS** |
| Titration (95811) | [OK] Yes | **Curo** | **ALWAYS** |
| Split Night | [OK] Yes | **Curo** | **ALWAYS** |

### Key Points
- **Different portal:** Curo (NOT uhcprovider.com)
- **THREE portals involved** -- this is the complexity
- **HST Code:** G0399
- **Allowables:** Optum rates (NOT UHC, NOT Humana)
- **Pain Level:** [YELLOW] Medium (3 portals)
- **Clinical criteria:** TBD -- awaiting guidelines

### Referral Requirements
| Plan Type | Referral Required? | Who Submits? | Portal |
|-----------|-------------------|--------------|--------|
| **HMO** | [OK] Yes | **PCP** (not us) | **Curo** |
| **PPO** | a No | N/A | N/A |

**Important:** For HMO plans, the **PCP must submit the referral** through Curo -- we cannot submit it on their behalf.

### Portals -- ALL THREE MAY BE NEEDED
| Portal | URL | Used For |
|--------|-----|----------|
| UHC Provider | uhcprovider.com | Initial ID, some info |
| Curo | curo.optum.com/login | **Auth submission, HMO referrals** |
| Optum Care | providers.optumcaremw.com | **Benefits verification** |

### Critical Workflow
```
1. Identify as Optum-managed (during benefits check)
   [!] Watch for mislabeled referrals -- Optum is an IPA
2. Determine HMO vs PPO
3. If HMO -> Ensure PCP has submitted referral via Curo
4. Benefits -> providers.optumcaremw.com (NOT uhcprovider.com)
5. HST: No auth needed
6. In-lab: Submit auth via Curo portal
   +-- MUST include clinical notes
```

### [!] Common Mistakes
- Using uhcprovider.com for auth (wrong -- use Curo)
- Getting benefits from uhcprovider.com (wrong -- use Optum portal)
- Quoting UHC allowables (wrong -- Optum has different rates)
- Accepting mislabeled referrals at face value (verify plan type)

---

## 4. UHC SUREST (SPECIAL VARIANT)

### What Is Surest?
- Commercial plan variant with **location-based variable copays**
- Copays change based on where patient lives (ZIP code)
- Portal cannot accurately quote copays

### Authorization Requirements
**Same as UHC Commercial:**
| Test | Auth Required | Portal |
|------|---------------|--------|
| HST | a No | N/A |
| In-lab | [OK] Yes | uhcprovider.com |

### Key Difference -- Copay Verification
```
[!] Portal quotes WRONG copay for Surest
|-- Must CALL or MESSAGE to get accurate copay
|-- Copay varies by patient's ZIP code
+-- Do NOT quote portal copay to patient
```

### Workflow
```
1. Identify Surest (card/plan name)
2. Auth rules same as Commercial
3. For copay: CALL or MESSAGE UHC
   +-- Do NOT use portal copay
4. Quote accurate copay to patient
```

---

## 5. UHC SUBSIDIARIES [!]

### Known Subsidiaries
These plans follow **UHC Commercial guidelines** for authorization:

| Subsidiary | Notes |
|------------|-------|
| **Golden Rule** | Individual/small group plans |
| **Oxford** | Primarily Northeast US |
| **UHSS** (United Health Shared Services) | Employer self-funded admin |
| **Others** | Many more exist |

### Key Points
- Too many subsidiaries to document individually
- **When identified:** Know they exist and follow Commercial rules
- **Authorization:** If required, use same guidelines as Commercial/Surest
- **Portal:** uhcprovider.com (same as Commercial)
- **Clinical criteria:** Same as UHC Commercial (when guidelines obtained)

### Identification
- Card may show subsidiary name
- Benefits check may reveal subsidiary
- If in doubt, treat as UHC Commercial

---

## CLINICAL CRITERIA -- OPTUM MEDICARE (AASM-BASED)

**Source:** AASM 2017 Clinical Practice Guideline + UHC Medical Policy 2026T0334RR
**Note:** Optum Medicare follows AASM guidelines with specific operational thresholds

---

### HST (Home Sleep Apnea Testing) Criteria

**NO AUTH REQUIRED** -- but eligibility criteria still apply for proper test selection

```
ELIGIBLE FOR HST (all must be true):
|-- Adult patient (>=18 years)
|-- Uncomplicated patient (see below)
|-- High pre-test probability of moderate-to-severe OSA:
|   +-- Excessive daytime sleepiness (EDS) PLUS >=2 of:
|       * Habitual loud snoring
|       * Witnessed apnea or gasping/choking
|       * Diagnosed hypertension
+-- No HST contraindications (see below)
```

**"Uncomplicated Patient" = ABSENCE of ALL:**
| Condition | Optum/UHC Threshold |
|-----------|---------------------|
| CHF | NYHA Class III-IV OR LVEF <=40% |
| COPD | FEV1 <60% predicted |
| Chronic opioid use | >3 months duration |
| Neuromuscular disease | Any progressive neuromuscular/neurodegenerative disorder |
| Stroke history | Any documented stroke |
| Morbid obesity | BMI >50 |
| Central sleep apnea | Suspected or documented |
| Severe insomnia | Documented severe insomnia |

**HST Contraindications (-> Route to PSG):**
- Home oxygen use (HARD STOP -- universal)
- Any condition in "complicated patient" list above
- Prior negative/inconclusive/inadequate HST
- Age <18

**Technical Requirements:**
- Minimum 4 hours of adequate oximetry + flow data
- Medicare billing requires 6 hours recording time

---

### PSG (In-Lab Polysomnography) Criteria

**AUTH REQUIRED via Curo portal**

```
PSG INDICATED when ANY of:
|-- HST negative, inconclusive, or technically inadequate
|-- Patient has comorbidities requiring attended monitoring:
|   * CHF (NYHA III-IV or LVEF <=40%)
|   * COPD (FEV1 <60% predicted)
|   * Chronic opioid use (>3 months)
|   * Neuromuscular disease
|   * Stroke history
|   * Suspected hypoventilation/OHS
|   * BMI >50
|   * Suspected central sleep apnea
|-- Pediatric patient (<18 years)
|-- Pre-implant hypoglossal nerve stimulator evaluation
|-- Documented ongoing epileptic seizures with sleep symptoms
+-- Clinical judgment warrants attended monitoring
```

**Clinical Documentation Required:**
- Sleep symptoms documented
- Comorbidity documentation (if claiming PSG due to comorbidity)
- Failed HST documentation (if claiming PSG after HST)

---

### Titration (PAP Titration Study) Criteria

**AUTH REQUIRED via Curo portal**

```
TITRATION INDICATED when:
|-- Documented OSA diagnosis with:
|   * AHI/RDI >=15/hr, OR
|   * AHI/RDI >=5 to <=14 WITH documented:
|       - Excessive daytime sleepiness
|       - Impaired cognition
|       - Mood disorders
|       - Insomnia
|       - Hypertension
|       - Ischemic heart disease
|       - Stroke history
|
|-- In-lab titration specifically required when:
|   * CHF present
|   * Significant COPD/lung disease
|   * Obesity hypoventilation syndrome
|   * Central sleep apnea syndromes
|   * Post-palate surgery (patient doesn't snore)
|   * Split-night protocol planned
|
+-- Re-titration indicated when:
    * Prior titration grade = Adequate or Unacceptable
    * Split-night titration duration <=3 hours
    * CPAP pressure issues documented (too high/too low)
    * Significant weight change (10-20% change)
```

**Titration Quality Grades (AASM):**
| Grade | Criteria |
|-------|----------|
| **Optimal** | RDI <5 for >=15 min including supine REM |
| **Good** | RDI <=10 including supine REM |
| **Adequate** | RDI reduced 75% from baseline OR optimal/good except no supine REM |
| **Unacceptable** | Does not meet above -> **Repeat titration required** |

---

### Split Night Criteria

**AUTH REQUIRED via Curo portal (same as PSG/Titration)**

```
SPLIT NIGHT APPROPRIATE when BOTH:
|-- Moderate-to-severe OSA observed during diagnostic portion:
|   * AHI >=40/hr during >=2 hours -> Split INDICATED (standard)
|   * AHI 20-40/hr during >=2 hours -> Split MAY BE CONSIDERED
|   * AHI <20/hr -> Split NOT recommended
|
+-- At least 3 hours remaining for titration

SUCCESSFUL SPLIT NIGHT requires:
|-- Titration duration >3 hours
|-- Optimal or Good titration grade achieved
|-- Events controlled in both REM and NREM sleep
+-- Supine REM included if possible
```

**If Split Night Fails:**
- Titration <=3 hours -> Full-night titration required
- Adequate/Unacceptable grade -> Full-night titration required

---

### Pediatric Criteria (<18 years)

```
[!] HSAT NOT ALLOWED FOR PEDIATRIC PATIENTS

ALL pediatric testing requires:
|-- In-lab PSG (attended)
|-- Pediatric CPT codes:
|   * Age <6: 95782 (diagnostic), 95783 (titration)
|   * Age 6-17: 95810 (diagnostic), 95811 (titration)
|
+-- Pediatric scoring criteria:
    * Events scored at >=2 respiratory cycles (not 10 sec)
    * Abnormal AHI threshold: >=1/hr (vs >=5 for adults)
    * CO2 monitoring recommended
```

**Pediatric Severity:**
| Severity | Pediatric AHI |
|----------|---------------|
| Normal | <1/hr |
| Mild | >=1 to <5/hr |
| Moderate | >=5 to <10/hr |
| Severe | >=10/hr |

---

### Repeat Testing Criteria

```
REPEAT DIAGNOSTIC indicated when:
|-- Significant weight change (10-20% increase or decrease)
|-- Post-bariatric surgery (wait >=3 months post-recovery)
|-- Treatment failure despite good PAP adherence
|-- New/changed cardiovascular disease:
|   * Worsening hypertension (after >=3 months adherent PAP)
|   * Decompensated heart failure
|   * New atrial fibrillation or AV block
|   * New stroke/TIA
|
+-- Clinical suspicion of new/different sleep disorder

REPEAT DIAGNOSTIC NOT indicated when:
+-- Routine reassessment of asymptomatic patient on PAP
    (just use device data)

POST-TREATMENT TESTING indicated after:
|-- Oral appliance therapy (post-acclimatization)
|-- Upper airway surgery (after healing)
|-- Hypoglossal nerve stimulation (PSG titration required)
+-- Weight loss interventions (wait appropriate interval)
```

---

### OSA Severity Thresholds (Reference)

**Adult:**
| Severity | AHI/RDI |
|----------|---------|
| Normal | <5/hr |
| Mild | >=5 to <15/hr |
| Moderate | >=15 to <=30/hr |
| Severe | >30/hr |

**CMS Positive Test Criteria (for CPAP coverage):**
- AHI/RDI >=15/hr, OR
- AHI/RDI >=5 to <=14 with documented symptoms/comorbidities

---

## CLINICAL CRITERIA -- UHC COMMERCIAL/SUREST/SUBSIDIARIES

**Source:** UHC Medical Policy 2026T0334RR (Sleep Studies) + 2026T0525TT (OSA Treatment)
**Effective:** January 1, 2026
**Applies to:** UHC Commercial, Individual Exchange, Oxford (shared policy)

---

### HST (Home Sleep Apnea Testing) Criteria

**MEDICALLY NECESSARY** for evaluating adults with suspected OSA

```
HST ELIGIBLE when:
|-- Adult patient (>=18 years)
|-- Suspected OSA
+-- No comorbidities requiring PSG (see below)

TECHNICAL REQUIREMENTS:
|-- Minimum 4 hours adequate data
|-- Sensors: nasal pressure + chest/abdominal RIP + oximetry
+-- AUTOTITRATING PAP (APAP) is an option to determine fixed PAP pressure

[!] CRITICAL RULE: DO NOT REPEAT HSAT
|-- If initial HSAT is negative, inconclusive, or technically inadequate
|-- Second HSAT likely to also fail
+-- -> Route directly to attended PSG
```

---

### PSG (In-Lab Polysomnography) Criteria

**MEDICALLY NECESSARY** when ANY of the following:

```
PSG REQUIRED when:
|-- Prior HSAT (within 12 months) is negative, indeterminate, or technically inadequate
|
|-- Patient is <18 years (child/adolescent)
|
|-- Patient has comorbid conditions prohibiting HSAT:
|   * COPD: FEV1 <60% predicted (significant chronic pulmonary disease)
|   * Progressive neuromuscular disease/neurodegenerative disorder:
|       - Parkinson's disease
|       - Myotonic dystrophy
|       - ALS
|       - MS with associated pulmonary disease
|       - Stroke with persistent neurological sequelae
|   * Heart Failure: NYHA Class III-IV OR LVEF <=40%
|   * Morbid Obesity: BMI >50
|   * Obesity Hypoventilation Syndrome (OHS)
|   * Documented ongoing epileptic seizures with sleep symptoms
|   * Chronic opioid use (>3 months)
|
|-- Pre-implant hypoglossal nerve stimulator evaluation (rule out central apnea)
|
+-- Other conditions (after OSA excluded or treated):
    * Periodic Limb Movement Disorder (not associated with SDB)
    * Restless Legs Syndrome not responding to treatment
    * Parasomnia with violent/injurious sleep behavior (suspected RBD)
    * Narcolepsy (after other causes of sleepiness ruled out)
    * Central Sleep Apnea
```

**NOT MEDICALLY NECESSARY for:**
- Circadian Rhythm Disorders
- Depression
- Insomnia

---

### Titration / Split-Night Criteria

**MEDICALLY NECESSARY** when patient meets PSG criteria above:

```
SPLIT-NIGHT STUDY:
|-- Combines diagnostic PSG + PAP titration in single night
|-- Medically necessary when attended PSG criteria are met
+-- If split-night inadequate -> full-night titration required

FULL-NIGHT PAP TITRATION:
|-- When split-night is inadequate or not feasible
+-- AND patient has confirmed OSA diagnosis
```

---

### Repeat Testing Criteria

**MEDICALLY NECESSARY** for repeat PSG/titration when:

```
REPEAT TESTING INDICATED when:
|-- Persistent, recurrent, or NEW symptoms despite:
|   * Documented appropriate current treatment OR
|   * Documented appropriate PAP therapy
|   (Equipment failure, mask fit, pressure leaks, unsuccessful titration,
|    inadequate pressure, nasal congestion have been addressed)
|
+-- Clinically significant weight change (>=10% loss or gain)
    OR changes in cardiovascular disease since last study

REPEAT FOR ORAL APPLIANCE:
+-- Can be done at home unless patient meets attended PSG criteria
```

---

### OSA Severity Thresholds (UHC Definition)

| Severity | AHI/RDI |
|----------|---------|
| Mild | >=5 and <15/hr |
| Moderate | >=15 and <=30/hr |
| Severe | >30/hr |

---

### Surgical Treatment Criteria (UPPP, MO, MMA)

**MEDICALLY NECESSARY** when ALL criteria met:

```
SURGICAL CRITERIA (all required):
|-- Moderate-to-severe OSA: AHI >=15 or RDI >=15 by ATTENDED PSG*
|-- Excessive daytime sleepiness: ESS >10 or validated tool
+-- PAP therapy: No therapeutic efficacy OR patient refusal OR intolerance

ADDITIONAL FOR MMA:
+-- Craniofacial disproportion or deformities with maxillomandibular deficiency

ADDITIONAL FOR MO (Mandibular Osteotomy):
+-- Retrolingual or lower pharyngeal function obstruction

*PSG should be repeated if significant weight change, CV disease changes,
 or persistent/recurrent symptoms since last study
```

---

### Hypoglossal Nerve Stimulation (Inspire) Criteria -- Adults

**MEDICALLY NECESSARY** when ALL criteria met:

```
ADULT HNS CRITERIA (all required):
|-- BMI <=40 kg/m2
|-- AHI >=15 and <=100 by attended PSG
|-- Total AHI <25% for central + mixed apneas
|-- Absence of complete blockage or concentric collapse of soft palate
|   (confirmed by drug-induced sleep endoscopy - DISE)
|-- PAP therapy: No therapeutic efficacy OR patient refusal OR intolerance
+-- Used in accordance with FDA guidelines
```

---

### Hypoglossal Nerve Stimulation -- Adolescents with Down Syndrome

**MEDICALLY NECESSARY** when ALL criteria met:

```
ADOLESCENT DS HNS CRITERIA (all required):
|-- Age 10-18 years with Down syndrome
|-- Severe OSA: AHI >=10 and RDI <=50 events/hour by attended PSG
|-- BMI <95th percentile for age
|-- Total AHI <25% for central + mixed apneas
|-- Prior adenotonsillectomy contraindicated or not effective
|-- Confirmed failure or intolerance of PAP therapy despite compliance attempts
|-- No tracheostomy use during sleep
|-- Absence of complete blockage or concentric collapse of soft palate (DISE)
|-- Individual/caregiver refusal of MMA for non-concentric palatal collapse
+-- Used in accordance with FDA guidelines
```

---

### NOT MEDICALLY NECESSARY (Unproven/Insufficient Evidence)

**Non-Surgical:**
- Devices for positional OSA
- Nasal dilator devices
- Intranasal expiratory resistance valve (e.g., Bongo Rx)
- Oral appliances for Central Sleep Apnea
- Prefabricated oral appliances/devices
- Non-surgical electrical muscular training
- Mandibular vertical repositioning devices (e.g., Slow Wave)
- Morning repositioning devices
- Epigenetic appliances (Homeoblock, DNA appliance)
- Advanced Lightwire Functional (ALF) appliances
- Actigraphy for any sleep disorders

**Surgical:**
- Laser-assisted uvulopalatoplasty (LAUP)
- Lingual suspension/tongue fixation
- Isolated hyoid myotomy
- Stand-alone uvulectomy
- Palatal implants
- Radiofrequency ablation of soft palate/tongue base
- Transoral robotic surgery (TORS)
- Distraction osteogenesis for maxillary expansion (DOME)
- Implantable neurostimulation for Central Sleep Apnea

---

### Pediatric Criteria (<18 years)

```
[!] HSAT NOT ALLOWED FOR PEDIATRIC PATIENTS

ALL pediatric testing requires:
|-- In-lab attended PSG
|-- CPT codes:
|   * Age <6: 95782 (diagnostic), 95783 (titration)
|   * Age 6-17: 95810 (diagnostic), 95811 (titration)
+-- InterQual criteria apply (Sleep Studies Pediatric)
```

---

### Documentation Requirements

**For ALL sleep study reviews:**
- History and physical or sleep medicine consultation
- ESS or equivalent daytime sleepiness assessment
- Prior sleep study results (if applicable)
- Prior treatment attempts and outcomes
- Relevant comorbidities

**For Attended Repeat Testing:**
- All above PLUS reason why repeat study should be performed

---

## REFERRAL REQUIREMENTS SUMMARY

| Plan Type | Referral Required? | Who Submits? | Portal |
|-----------|-------------------|--------------|--------|
| Commercial | a Never | N/A | N/A |
| Surest | a Never | N/A | N/A |
| Medicare Direct PPO | a No | N/A | N/A |
| Medicare Direct HMO | [OK] Yes | **PCP** | uhcprovider.com |
| Medicare Optum PPO | a No | N/A | N/A |
| Medicare Optum HMO | [OK] Yes | **PCP** | Curo |
| Subsidiaries | a Never | N/A | N/A |

**Critical:** For Medicare HMO plans, **WE do not submit the referral** -- the PCP must submit it through the appropriate portal.

---

## HST CODE

```
All UHC Plans: G0399
```

---

## DECISION TREE FLAGS

### FLAG_UHC_NOTES_REQUIRED [!]
- **Trigger:** UHC auth submission without clinical notes
- **Action:** MUST attach notes before submitting
- **Severity:** High (submission will be rejected or delayed)

### FLAG_UHC_OPTUM_ROUTING [!]
- **Trigger:** UHC Medicare identified as Optum-managed
- **Action:** Route to Curo (NOT uhcprovider.com), use Optum benefits portal
- **Severity:** High (wrong portal = wasted time)

### FLAG_UHC_OPTUM_MISLABELED [!]
- **Trigger:** Referral shows UHC but patient is actually Optum IPA
- **Action:** Verify plan type -- Optum often mislabeled since it's an IPA
- **Severity:** High (wrong workflow if not caught)

### FLAG_UHC_HMO_PCP_REFERRAL
- **Trigger:** UHC Medicare HMO plan (Direct or Optum)
- **Action:** PCP must submit referral -- we cannot submit it
- **Severity:** Medium (will delay if PCP hasn't submitted)

### FLAG_UHC_SUREST_COPAY
- **Trigger:** Surest plan identified
- **Action:** Call/message for accurate copay, do NOT use portal copay
- **Severity:** Medium (patient cost quote will be wrong)

### FLAG_UHC_SUBSIDIARY
- **Trigger:** UHC subsidiary identified (Golden Rule, Oxford, UHSS, etc.)
- **Action:** Follow Commercial guidelines, auth via uhcprovider.com
- **Severity:** Info (routing guidance)

---

## QUICK REFERENCE

| Plan Type | HST Auth | In-lab Auth | Notes | Auth Portal | Referral |
|-----------|----------|-------------|-------|-------------|----------|
| Commercial | No | Yes | Always | uhcprovider.com | Never |
| Surest | No | Yes | Always | uhcprovider.com | Never |
| Medicare Direct PPO | No | No* | N/A | N/A | None |
| Medicare Direct HMO | No | No* | N/A | N/A | PCP via uhcprovider |
| Medicare Optum PPO | No | Yes | Always | Curo | None |
| Medicare Optum HMO | No | Yes | Always | Curo | PCP via Curo |
| Subsidiaries | No | Yes | Always | uhcprovider.com | Never |

*Submit anyway to get "not required" confirmation for reference

---

## PORTALS SUMMARY

| Portal | URL | When to Use |
|--------|-----|-------------|
| UHC Provider | uhcprovider.com | Commercial auth, Direct Medicare |
| Curo | curo.optum.com/login | Optum Medicare auth/referrals |
| Optum Care | providers.optumcaremw.com | Optum Medicare benefits |

---

## CLINICAL DECISION FLAGS (Optum Medicare)

### FLAG_OPTUM_HST_CONTRAINDICATED [!]
- **Trigger:** Patient has comorbidity requiring PSG
- **Check:** CHF (NYHA III-IV/LVEF <=40%), COPD (FEV1 <60%), chronic opioids, neuromuscular disease, stroke, BMI >50, central apnea
- **Action:** Route to PSG, not HST
- **Severity:** High

### FLAG_OPTUM_TITRATION_INDICATED
- **Trigger:** Prior positive diagnostic with AHI meeting criteria
- **Check:** AHI >=15, OR AHI 5-14 with symptoms/comorbidities
- **Action:** Authorize titration study
- **Severity:** Info

### FLAG_OPTUM_SPLIT_CANDIDATE
- **Trigger:** Split night may be appropriate
- **Check:** High probability of moderate-severe OSA (AHI >=20-40 expected), patient circumstances favor single night
- **Action:** Consider split night vs full-night diagnostic
- **Severity:** Info

### FLAG_OPTUM_REPEAT_TESTING
- **Trigger:** Repeat testing may be indicated
- **Check:** Weight change >10%, post-surgery, treatment failure, new cardiovascular disease
- **Action:** Evaluate for repeat diagnostic or titration
- **Severity:** Medium

---

## CLINICAL DECISION FLAGS (UHC Commercial/Surest)

### FLAG_UHC_NO_REPEAT_HSAT [STOP]
- **Trigger:** First HSAT was negative, inconclusive, or technically inadequate
- **Check:** Prior HSAT result in past 12 months
- **Action:** DO NOT authorize second HSAT -- route directly to attended PSG
- **Severity:** High (blocking)

### FLAG_UHC_PSG_COMORBIDITY [!]
- **Trigger:** Patient has comorbidity requiring PSG over HSAT
- **Check:** CHF (NYHA III-IV/LVEF <=40%), COPD (FEV1 <60%), chronic opioids (>3mo), neuromuscular disease, stroke, BMI >50, OHS, seizures
- **Action:** Route to PSG, not HST
- **Severity:** High

### FLAG_UHC_SURGICAL_CRITERIA
- **Trigger:** Surgery requested for OSA
- **Check:** AHI >=15 by attended PSG + ESS >10 + PAP failure/refusal/intolerance
- **Action:** Verify all three criteria documented
- **Severity:** High

### FLAG_UHC_HNS_CRITERIA
- **Trigger:** Hypoglossal nerve stimulation requested
- **Check:** BMI <=40 + AHI 15-100 + <25% central/mixed + no concentric collapse + PAP failure + DISE documented
- **Action:** Verify all criteria including DISE results
- **Severity:** High

### FLAG_UHC_WEIGHT_CHANGE_REPEAT
- **Trigger:** Repeat testing requested
- **Check:** >=10% weight change OR cardiovascular disease changes documented
- **Action:** Authorize repeat testing
- **Severity:** Medium

### FLAG_PEDIATRIC_PSG_REQUIRED [STOP]
- **Trigger:** Patient <18 years
- **Action:** MUST use in-lab PSG, HSAT NOT allowed
- **Severity:** High (blocking)

---

## WHAT'S COMPLETE [OK]

| Item | Status | Source |
|------|--------|--------|
| **Optum Medicare clinical criteria** | [OK] Complete | AASM guidelines + UHC 2026T0334RR |
| **UHC Commercial/Surest clinical criteria** | [OK] Complete | UHC 2026T0334RR + 2026T0525TT |
| **Split Night criteria** | [OK] Complete | AASM + UHC policy |
| **Pediatric handling** | [OK] Complete | PSG only, no HSAT |
| **Surgical criteria (UPPP/MMA/MO)** | [OK] Complete | UHC 2026T0525TT |
| **HNS (Inspire) criteria** | [OK] Complete | UHC 2026T0525TT |
| **Repeat testing criteria** | [OK] Complete | UHC 2026T0334RR |

---

*Document for MEDOCR v0.16.5*
*Payer: UnitedHealthcare (All Variants)*
*Status: COMPLETE -- All clinical criteria documented*
*Last Updated: February 2026*
