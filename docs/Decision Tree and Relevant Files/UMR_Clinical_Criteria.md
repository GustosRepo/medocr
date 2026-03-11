# UMR Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- UMR (all plan types)

---

## [!] CRITICAL: UMR HAS TWO DISTINCT PATHS

UMR routes through **different networks** with **different rules**:

| Network | HST Code | Criteria | Portal |
|---------|----------|----------|--------|
| UMR via Sierra/HPN | 95806 | Ultra-lenient | provider.healthplanofnevada.com |
| UMR via UHC | G0399 | UHC guidelines | uhcprovider.com |

**You MUST identify the network during benefits verification.**

---

## NETWORK IDENTIFICATION

### How to Determine Network

```
DURING BENEFITS VERIFICATION:
|-- Check network affiliation
|-- Look for "Sierra" or "HPN" indicators
|-- Look for "UHC" or "United" indicators
+-- If unclear -> Default to UHC (safer/stricter)
```

### Identification Clues

| Indicator | Network |
|-----------|---------|
| Benefits show Sierra network | UMR via Sierra |
| Benefits show HPN network | UMR via Sierra |
| Benefits show UHC/United network | UMR via UHC |
| Portal redirects to Sierra | UMR via Sierra |
| Portal redirects to UHC | UMR via UHC |

---

## UMR VIA SIERRA/HPN NETWORK

### KEY CHARACTERISTIC: ULTRA-LENIENT

**Even more relaxed than base Sierra/HPN.**
- Essentially a rubber stamp
- No real clinical documentation requirements
- Just submit and get approved

### Authorization Requirements

| Test | Auth Required | Clinical Needed | Units |
|------|---------------|-----------------|-------|
| HST (95806) | [OK] Yes | None | 2 |
| PSG (95810) | [OK] Yes | None | 2 |
| Titration (95811) | [OK] Yes | None | 2 |
| Split Night | [OK] Yes | None | 2 |
| Pediatric (95782) | [OK] Yes | None | 2 |

### What to Submit

```
ADULTS:
|-- HST (95806) -- 2 units
|-- PSG (95810) -- 2 units
+-- Titration (95811) -- 2 units

PEDIATRICS:
+-- Pediatric PSG (95782) -- 2 units
```

### Workflow

```
1. Verify benefits at provider.umr.com
2. Confirm Sierra/HPN network
3. Submit ALL codes through provider.healthplanofnevada.com
4. Request 2 units for each code
5. Approval is essentially automatic
```

### Portal

| Portal | URL | Used For |
|--------|-----|----------|
| UMR Benefits | provider.umr.com | Eligibility/benefits verification |
| Sierra/HPN Auth | provider.healthplanofnevada.com | Auth submission |

### HST Code
**95806** (Sierra code)

### Referral
**None required**

### [!] NURSE NOTES QUALITY WARNING

**The main risk with UMR via Sierra submissions:**

```
PROBLEM: Nurse notes that don't make sense
RESULT:  Authorization gets VOIDED
ACTION:  Must resubmit

PREVENTION:
|-- Review nurse notes before submission
|-- Ensure notes are coherent and relevant
|-- Flag any notes that seem incomplete or contradictory
+-- Better to fix notes upfront than resubmit
```

---

## UMR VIA UHC NETWORK

### KEY CHARACTERISTIC: MODERATE (UHC GUIDELINES)

Follows standard UHC clinical criteria.

### Authorization Requirements

| Test | Auth Required | Notes Required |
|------|---------------|----------------|
| HST (G0399) | a No | N/A |
| PSG (95810) | [OK] Yes | **ALWAYS** |
| Titration (95811) | [OK] Yes | **ALWAYS** |
| Split Night | [OK] Yes | **ALWAYS** |

### Clinical Criteria

**See UHC_Clinical_Criteria.md for full details.**

Summary:
- HST allowed for uncomplicated adults
- PSG required for: CHF, COPD, chronic opioids, neuromuscular disease, stroke, BMI >50, home oxygen, pediatrics
- Failed/inconclusive HSAT -> PSG (never repeat HSAT)

### Workflow

```
1. Verify benefits at provider.umr.com
2. Confirm UHC network
3. HST: No auth needed -> Schedule
4. In-lab: Submit auth via uhcprovider.com
   +-- MUST include clinical notes (always)
5. If portal issues -> Call UHC
```

### Portal

| Portal | URL | Used For |
|--------|-----|----------|
| UMR Benefits | provider.umr.com | Eligibility/benefits verification |
| UHC Provider | uhcprovider.com | Auth submission |

### HST Code
**G0399** (UHC code)

### Referral
**Check benefits** -- may vary by plan type

---

## [!] "(UM ONLY)" DESIGNATION

### What It Means

If eligibility shows **(UM Only)** when checking through Sierra portal:

```
(UM Only) = Authorization-only policy
|-- Sierra/HPN portal handles AUTH ONLY
|-- Benefits are NOT through Sierra/HPN
|-- You need the UMR ID to obtain benefits
+-- Do NOT quote Sierra/HPN benefits to patient
```

### Workflow for (UM Only)

```
1. Eligibility shows "(UM Only)" on Sierra portal
2. Find the UMR member ID (may be different from Sierra ID)
3. Check benefits via provider.umr.com (NOT Sierra portal)
4. Submit AUTH through Sierra portal (provider.healthplanofnevada.com)
5. Bill using UMR information
```

---

## DECISION TREE FLAGS

### FLAG_UMR_NETWORK_UNKNOWN [!]
- **Trigger:** UMR plan identified but network unclear
- **Action:** Call to verify network, default to UHC if unable to determine
- **Severity:** High (wrong workflow if missed)

### FLAG_UMR_SIERRA_NETWORK
- **Trigger:** UMR via Sierra/HPN network confirmed
- **Action:** Use Sierra portal, ultra-lenient criteria, submit all codes
- **Severity:** Low (informational)

### FLAG_UMR_UHC_NETWORK
- **Trigger:** UMR via UHC network confirmed
- **Action:** Use UHC portal, apply UHC clinical criteria
- **Severity:** Low (informational)

### FLAG_UMR_UM_ONLY
- **Trigger:** "(UM Only)" designation on eligibility
- **Action:** Auth through Sierra, benefits through UMR portal
- **Severity:** High (wrong benefits if missed)

### FLAG_UMR_NOTE_QUALITY
- **Trigger:** Nurse notes appear incomplete or contradictory (Sierra network)
- **Action:** Review and correct notes before submission
- **Severity:** Medium (resubmission required if missed)

---

## QUICK REFERENCE

| Network | HST Code | HST Auth | In-Lab Auth | Portal | Strictness |
|---------|----------|----------|-------------|--------|------------|
| Sierra/HPN | 95806 | [OK] Yes | [OK] Yes | provider.healthplanofnevada.com | Ultra-lenient |
| UHC | G0399 | a No | [OK] Yes | uhcprovider.com | Moderate |

### Decision Flow

```
UMR Plan Identified
       |
       v
Check Network Affiliation
       |
       |-- Sierra/HPN Network
       |   +-- HST: 95806
       |   +-- Auth: All codes via Sierra portal
       |   +-- Criteria: Rubber stamp
       |
       +-- UHC Network (or Unknown)
           +-- HST: G0399
           +-- Auth: In-lab via UHC portal
           +-- Criteria: UHC guidelines
```

---

*Document for MEDOCR v0.16.6*
*Payer: UMR (All Networks)*
*Version 1.0 -- February 2026*
