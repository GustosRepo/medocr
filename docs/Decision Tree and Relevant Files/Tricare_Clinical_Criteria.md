# Tricare Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payers Covered
- TRICARE Prime (Active Duty Service Members)
- TRICARE Prime (All Other Beneficiaries)
- TRICARE Select
- TRICARE Select Overseas
- TRICARE Reserve Select
- TRICARE Retired Reserve
- TRICARE Young Adult-Select
- TRICARE For Life

---

## KEY CHARACTERISTIC: PLAN TYPE DETERMINES WORKFLOW

Tricare authorization requirements vary significantly by plan type:
- **Prime plans** -> Referral + Pre-auth required (sleep studies = specialty care)
- **Select/TFL/etc** -> No referral, no pre-auth for sleep studies

---

## AUTHORIZATION BY PLAN TYPE

### TRICARE Prime (Active Duty Service Members)

| Requirement | Status | Details |
|-------------|--------|---------|
| **Referral** | [OK] Required | For any care PCM doesn't provide (includes specialty care) |
| **Pre-Auth** | [OK] Required | For all specialty care |
| **Additional** | Fitness-for-duty review may be required for certain care |

**Process:**
- PCM works with regional contractor for referral
- Without referral -> patient pays out of pocket

---

### TRICARE Prime (Non-Active Duty Beneficiaries)

| Requirement | Status | Details |
|-------------|--------|---------|
| **Referral** | [OK] Required | For specialty care and some diagnostic services |
| **Pre-Auth** | [OK] Required | For all specialty care |

**Process:**
- PCM works with regional contractor for referral
- PCM gets referral AND pre-auth at the same time
- Without referral -> point-of-service option (higher cost)

**Special Cases:**
- TRICARE Prime Remote: Work with regional contractor if no assigned PCM
- Overseas: Call TRICARE Overseas Regional Call Center

---

### All Other TRICARE Plans (Select, TFL, etc.)

Applies to:
- TRICARE Select
- TRICARE Select Overseas
- TRICARE Reserve Select
- TRICARE Retired Reserve
- TRICARE Young Adult-Select
- TRICARE For Life

| Requirement | Status | Details |
|-------------|--------|---------|
| **Referral** | [X] Not Required | Only ABA (applied behavioral analysis) requires referral |
| **Pre-Auth** | [X] Not Required | Sleep studies NOT on required list |

**Services that DO require pre-auth (not sleep studies):**
- Adjunctive dental services
- Applied behavior analysis
- Home health services
- Hospice care
- Transplants (all solid organ and stem cell)
- Extended Care Health Option services
- Some Provisional Coverage Program services

**Sleep studies are NOT on this list -> No pre-auth needed**

---

## TRICARE FOR LIFE -- SPECIAL RULES

| Field | Value |
|-------|-------|
| **Coverage** | Always secondary to Medicare |
| **Eligibility Verification** | Must CALL to verify |
| **Auth Required** | [X] No (any codes) |
| **Cost to Patient** | 100% covered after Medicare |

**Workflow:**
```
1. Verify Medicare paid first
2. Call Tricare to verify TFL eligibility (cannot use portal)
3. No auth required for any codes
4. 100% covered after Medicare
```

---

## AUTHORIZATION STATUS SUMMARY

| Plan Type | HST Auth | In-Lab Auth | Referral |
|-----------|----------|-------------|----------|
| Prime (Active Duty) | [OK] Yes | [OK] Yes | [OK] Yes |
| Prime (Other) | [OK] Yes | [OK] Yes | [OK] Yes |
| Select | [X] No | [X] No | [X] No |
| Select Overseas | [X] No | [X] No | [X] No |
| Reserve Select | [X] No | [X] No | [X] No |
| Retired Reserve | [X] No | [X] No | [X] No |
| Young Adult-Select | [X] No | [X] No | [X] No |
| For Life | [X] No | [X] No | [X] No |

---

## HST CODE

**G0399**

---

## VERIFICATION CHALLENGES

```
[!] TRICARE VERIFICATION IS DIFFICULT

1. Cannot verify eligibility with Member ID alone
   +-- Need SSN or DBN (Defense Benefits Number)

2. Portal verification limited
   +-- Tricare For Life: Must CALL to verify

3. Availity workflow is painful
   +-- Redirects to Tricare's own system
   +-- Multiple steps required
```

---

## CLINICAL CRITERIA

### For Plans Requiring Auth (Prime)

Use **Carelon baseline criteria** for clinical sufficiency:
- Symptoms documented (EDS, snoring, witnessed apneas, etc.)
- At least 2 of 5 symptom criteria met
- Contraindications -> route HST to PSG

### For Plans NOT Requiring Auth (Select/TFL)

No clinical review process -- schedule directly after verification.

---

## WORKFLOW

### TRICARE Prime
```
1. Verify eligibility (need SSN or DBN)
2. Confirm plan is Prime (not Select)
3. Patient must get referral from PCM
4. PCM submits for pre-auth through regional contractor
5. Once auth received -> schedule patient
```

### TRICARE Select / Reserve / Retired Reserve / Young Adult
```
1. Verify eligibility via Availity (need SSN or DBN)
2. Confirm plan type
3. No referral needed
4. No pre-auth needed for sleep studies
5. Schedule directly
```

### TRICARE For Life
```
1. Verify Medicare paid first
2. CALL to verify TFL eligibility (portal won't work)
3. No auth required
4. 100% covered after Medicare
5. Schedule directly
```

---

## REGIONAL CONTRACTORS

| Region | Contractor | Notes |
|--------|------------|-------|
| East Region | Humana Military | Check specific requirements |
| West Region | Health Net Federal Services | Check specific requirements |
| Overseas | TRICARE Overseas | Call Regional Call Center |

---

## DECISION TREE FLAGS

### FLAG_TRICARE_PRIME_AUTH [!]
- **Trigger:** TRICARE Prime plan identified
- **Action:** Patient needs referral from PCM + pre-auth for specialty care
- **Severity:** High
- **Blocking:** Yes (until referral/auth obtained)

### FLAG_TRICARE_SELECT_NO_AUTH
- **Trigger:** TRICARE Select/Reserve/YA plan identified
- **Action:** No auth required for sleep studies -- verify and schedule
- **Severity:** Info

### FLAG_TRICARE_FOR_LIFE
- **Trigger:** TRICARE For Life identified
- **Action:** Call to verify, 100% covered after Medicare, no auth
- **Severity:** Low (simplifies workflow)

### FLAG_TRICARE_SSN_REQUIRED [!]
- **Trigger:** TRICARE identified but no SSN/DBN available
- **Action:** Request SSN or DBN from patient to verify eligibility
- **Severity:** High
- **Blocking:** Yes (cannot verify without it)

---

## IDENTIFICATION TIPS

| Clue | Likely Plan |
|------|-------------|
| Active duty military | Prime (Active Duty) |
| Military dependent | Prime or Select (verify) |
| "Retired" on card | Retired Reserve or TFL |
| Medicare primary | TRICARE For Life |
| Reserve/Guard member | Reserve Select |
| Under 26, parent is military | Young Adult-Select |

---

## QUICK REFERENCE

| Plan Type | Auth | Referral | Verification | Pain Level |
|-----------|------|----------|--------------|------------|
| Prime (Active Duty) | [OK] Yes | [OK] Yes | Availity (SSN) | [RED] Hard |
| Prime (Other) | [OK] Yes | [OK] Yes | Availity (SSN) | [RED] Hard |
| Select | [X] No | [X] No | Availity (SSN) | [YELLOW] Medium |
| Reserve Select | [X] No | [X] No | Availity (SSN) | [YELLOW] Medium |
| Retired Reserve | [X] No | [X] No | Availity (SSN) | [YELLOW] Medium |
| Young Adult-Select | [X] No | [X] No | Availity (SSN) | [YELLOW] Medium |
| For Life | [X] No | [X] No | Phone call | [GREEN] Easy |

---

*Document for MEDOCR v0.17*
*Payer: TRICARE (All Plan Types)*
*Version 1.0 -- February 2026*
