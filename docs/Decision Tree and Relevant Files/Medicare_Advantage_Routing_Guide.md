# Medicare Advantage Routing Guide
## Decision Logic for MA Plan Identification and Routing
### Version 1.0 -- February 2026

---

## Purpose

This guide walks through the mental process of identifying and routing Medicare Advantage plans. It's designed to:
- Document the decision steps that experienced staff do automatically
- Provide clear paths when information is incomplete
- Include fallbacks for when you can't get a clear answer

---

## Key Principle: Certainty Levels

Not all MA plans are equally easy to identify. This guide uses certainty levels:

| Level | Meaning | Action |
|-------|---------|--------|
| [GREEN] **Clear** | Can determine from card/Availity immediately | Proceed with routing |
| [YELLOW] **Unclear** | Need additional verification | Follow verification steps |
| [RED] **Unknown** | Can't determine without calling | Call payer, document findings |

---

## STEP 1: IDENTIFY THE CARRIER

**Look at:** Card, referral, Availity response

| If You See... | Carrier | Certainty |
|---------------|---------|-----------|
| "Humana" anywhere | Humana | [GREEN] Clear |
| "UnitedHealthcare" or "UHC" | UHC | [GREEN] Clear |
| "Aetna" | Aetna | [GREEN] Clear |
| "Cigna" | Cigna | [GREEN] Clear |
| "Anthem" or BCBS logo + "Medicare" | BCBS MA | [YELLOW] Unclear (which type?) |
| Unfamiliar name + "Medicare Advantage" | Unknown MA | [RED] Unknown |

### Can't Identify Carrier?
```
FALLBACK:
1. Check Availity -- may route to correct payer
2. Look for network logos (UHC, Humana, etc.)
3. If still unclear -> Call number on card
4. Document what you learn for future reference
```

---

## STEP 2: CHECK NETWORK STATUS FIRST

Before spending time on routing, verify we're in-network.

### Known OON Medicare Advantage Plans

| Plan | Status | Action |
|------|--------|--------|
| Cigna Medicare | [X] OON | Stop -- cannot accept |
| Humana (P3 IPA) | [X] OON | Stop -- cannot accept |
| Humana (Intermountain IPA) | [X] OON | Stop -- cannot accept |
| Anthem Mediblue (P3 network) | [X] OON | Stop -- cannot accept |
| Anthem Mediblue (Caremore network) | [X] OON | Stop -- cannot accept |
| Anthem Mediblue (Optum network) | [OK] In-network | Continue |

### Can't Determine Network Status?
```
FALLBACK:
1. Check Availity for network status
2. If Availity unclear -> Call payer
3. Ask specifically: "Is [our facility] in-network for this plan?"
4. Get reference number for the answer
```

---

## STEP 3: DETERMINE MA SUB-TYPE (PPO vs HMO)

**Why it matters:** HMO plans typically require PCP referral; PPO plans don't.

### How to Identify

| Source | What to Look For |
|--------|------------------|
| **Card** | Usually says "PPO" or "HMO" |
| **Availity** | Plan name often includes type |
| **Benefits check** | May indicate referral requirement |

### PPO vs HMO Implications

| Type | Referral Required? | Who Handles It? |
|------|-------------------|-----------------|
| PPO | [X] Usually no | N/A |
| HMO | [OK] Usually yes | PCP submits (not us) |

### Can't Determine PPO vs HMO?
```
FALLBACK:
1. Assume HMO rules apply (more restrictive)
2. Check benefits for referral requirement
3. If referral shows as required -> Verify PCP has submitted
4. If still unclear -> Call payer to confirm plan type
```

---

## STEP 4: IDENTIFY IPA (If Applicable)

**Why it matters:** IPAs change which portal/criteria to use.

### Common IPAs

| IPA | How to Identify | Impact |
|-----|-----------------|--------|
| **Optum** | Availity shows "Optum" during benefits | Different portal (Curo), different rates |
| **P3 Health Partners** | Card or Availity shows P3 | [X] OON |
| **Intermountain** | Card or Availity shows Intermountain | [X] OON |
| **Caremore** | Card or Availity shows Caremore | [X] OON (for Anthem Mediblue) |
| **No IPA** | Nothing listed in Availity IPA field | Use standard carrier workflow |

### [!] IPA Identification Challenges

```
KNOWN ISSUES:
|-- IPAs are often MISLABELED on referrals
|-- Availity may show IPA that's actually a clinic, not a network
|-- Card may not clearly indicate IPA
+-- Some IPAs only visible during benefits check
```

### Can't Determine IPA?
```
FALLBACK:
1. Check Availity benefits -- IPA usually shows here
2. If Availity shows an unfamiliar "IPA" -> May be a clinic, not network
3. Call to verify if unclear
4. Ask: "Is this plan managed by an IPA? Which one?"
5. If no IPA mentioned anywhere -> Assume standard carrier workflow
```

---

## STEP 5: ROUTE TO CORRECT WORKFLOW

Once you have: **Carrier + Network Status + Plan Type + IPA**

### Humana Medicare Advantage

| Sub-Type | HST Auth | In-Lab Auth | Portal | Criteria File |
|----------|----------|-------------|--------|---------------|
| PPO | [X] No | [OK] Yes | Availity | Humana_Clinical_Criteria.md |
| HMO (No IPA) | Referral | [OK] Yes | Availity | Humana_Clinical_Criteria.md |
| HMO (Optum) | [X] No | [OK] Yes | **Curo** | Humana_Clinical_Criteria.md (Optum section) |
| HMO (P3) | -- | -- | -- | [X] OON |
| HMO (Intermountain) | -- | -- | -- | [X] OON |

**Referral Note:** For HMO plans, PCP must submit referral -- we cannot submit it.

---

### UHC Medicare Advantage

| Sub-Type | HST Auth | In-Lab Auth | Portal | Criteria File |
|----------|----------|-------------|--------|---------------|
| Direct PPO | [X] No | [X] No | uhcprovider.com | UHC_Clinical_Criteria.md |
| Direct HMO | [X] No | [X] No | uhcprovider.com | UHC_Clinical_Criteria.md |
| Optum PPO | [X] No | [OK] Yes | **Curo** | UHC_Clinical_Criteria.md (Optum section) |
| Optum HMO | [X] No | [OK] Yes | **Curo** | UHC_Clinical_Criteria.md (Optum section) |

**Key Points:**
- UHC Direct = No auth needed (submit anyway for reference)
- Optum-managed = Auth required via Curo
- HMO = PCP must submit referral
- [!] Optum often mislabeled -- verify plan type

---

### Aetna Medicare Advantage

| Sub-Type | HST Auth | In-Lab Auth | Portal | Criteria File |
|----------|----------|-------------|--------|---------------|
| All Aetna MA | [X] No | [OK] Yes | Availity | Evicore_Clinical_Criteria.md |

**Key Points:**
- No referral required (unlike Commercial)
- Same auth pattern as Commercial
- Simpler than Humana/UHC (no IPA complexity)

---

### Cigna Medicare Advantage

| Sub-Type | Status |
|----------|--------|
| All Cigna Medicare | [X] **OON -- Cannot Accept** |

---

### BCBS Medicare Advantage (Anthem Mediblue)

| Network | Status | Criteria File |
|---------|--------|---------------|
| Optum network | [OK] In-network | Follow Optum workflow |
| P3 network | [X] OON | Cannot accept |
| Caremore network | [X] OON | Cannot accept |

**Identification Challenge:** Must determine which network group
```
FALLBACK:
1. Check Availity for network indication
2. If unclear -> Call Anthem
3. Ask: "Which network is this Mediblue plan in -- Optum, P3, or Caremore?"
4. Only Optum = in-network for us
```

---

## STEP 6: GENERATE OUTPUT

After routing, your output should include:

### What You Know (Confirmed)

| Field | Value |
|-------|-------|
| Carrier | [Humana / UHC / Aetna / BCBS] |
| Plan Type | [PPO / HMO] |
| IPA | [Optum / None / Unknown] |
| Network Status | [In-network / OON] |
| HST Auth Required | [Yes / No] |
| In-Lab Auth Required | [Yes / No] |
| Portal | [Availity / Curo / uhcprovider.com] |
| Referral Required | [Yes - PCP / No] |
| Criteria File | [filename] |

### What's Unknown (Needs Verification)

| Unknown Item | Verification Method |
|--------------|---------------------|
| [List anything you couldn't determine] | [How to verify] |

### Flags Generated

| Flag | Reason |
|------|--------|
| [Any applicable flags] | [Why triggered] |

---

## COMMON SCENARIOS

### Scenario 1: Clear and Easy [GREEN]
```
Card says: "Humana Medicare PPO"
Availity shows: Humana, PPO, no IPA

-> Clear routing
-> HST: No auth
-> In-Lab: Auth via Availity
-> No referral needed
-> Use Humana_Clinical_Criteria.md
```

### Scenario 2: IPA Confusion [YELLOW]
```
Referral says: "UHC Medicare"
Availity shows: Optum IPA

-> [!] Optum changes everything
-> Use Curo (not uhcprovider.com)
-> Auth IS required for in-lab
-> Verify benefits via providers.optumcaremw.com
-> Use UHC_Clinical_Criteria.md (Optum section)
```

### Scenario 3: Unknown IPA Status [RED]
```
Card says: "Humana Medicare HMO"
Availity shows: IPA field has unfamiliar name

-> Could be real IPA or just a clinic
-> FALLBACK: Call Humana
-> Ask: "Is this plan managed by an IPA? Is it Optum, P3, or standard Humana?"
-> Route based on answer
-> Document for future reference
```

### Scenario 4: Can't Determine Anything [RED]
```
Unfamiliar card, unclear info, Availity not helpful

-> FALLBACK: Call number on card
-> Gather: Carrier, plan type, IPA, auth requirements
-> Ask: "Is [facility] in-network?"
-> Document everything
-> Add to system if new payer
```

---

## FALLBACK SUMMARY

| Situation | Fallback Action |
|-----------|-----------------|
| Can't identify carrier | Check Availity -> Call card number |
| Can't determine network status | Check Availity -> Call payer |
| Can't determine PPO vs HMO | Assume HMO (more restrictive) -> Verify |
| Can't identify IPA | Check Availity benefits -> Call if unclear |
| IPA looks unfamiliar | May be clinic, not network -> Call to verify |
| Nothing works | Call card number, document everything |

---

## REFERENCE FILES

| Carrier | Criteria File | Workflow File |
|---------|---------------|---------------|
| Humana MA | Humana_Clinical_Criteria.md | NonBCBS_Payer_Knowledge_Base Section 7 |
| UHC MA | UHC_Clinical_Criteria.md | NonBCBS_Payer_Knowledge_Base Section 6 |
| Aetna MA | Evicore_Clinical_Criteria.md | NonBCBS_Payer_Knowledge_Base Section 4 |
| BCBS MA | Varies by network | BCBS_Complete_Payer_Knowledge_Base |

---

## DECISION TREE FLAGS

### FLAG_MA_IPA_VERIFY
- **Trigger:** MA plan with unclear IPA status
- **Action:** Call to verify IPA before proceeding
- **Severity:** Medium

### FLAG_MA_OON
- **Trigger:** MA plan identified as out-of-network
- **Action:** Cannot accept -- inform patient
- **Severity:** High
- **Blocking:** Yes

### FLAG_MA_OPTUM_ROUTING
- **Trigger:** Optum IPA identified
- **Action:** Use Curo portal, Optum rates, different workflow
- **Severity:** High (wrong portal = wasted time)

### FLAG_MA_HMO_REFERRAL
- **Trigger:** MA HMO plan identified
- **Action:** Verify PCP has submitted referral
- **Severity:** Medium

---

*Document for MEDOCR v0.17*
*Guide: Medicare Advantage Routing*
*Version 1.0 -- February 2026*
