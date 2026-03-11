# MEDOCR: Non-BCBS Payer Knowledge Base
## Authorization Workflows for All Non-BCBS Payers
**Version:** v0.15 * **Date:** February 2026 * **Status:** COMPLETE

---

## Table of Contents

1. [Universal Rules (All Payers)](#1-universal-rules-all-payers)
2. [HST Code Routing Table](#2-hst-code-routing-table)
3. [OON / Not Accepted Plans](#3-oon--not-accepted-plans)
4. [Aetna](#4-aetna)
5. [Cigna](#5-cigna)
6. [UnitedHealthcare (UHC)](#6-unitedhealthcare-uhc)
7. [Humana](#7-humana)
8. [Sierra Health / Health Plan of Nevada](#8-sierra-health--health-plan-of-nevada)
9. [Nevada Medicaid (FFS)](#9-nevada-medicaid-ffs)
10. [Tricare](#10-tricare)
11. [VA](#11-va)
12. [Workers' Comp (DOL)](#12-workers-comp-dol)
13. [Anthem Medicaid](#13-anthem-medicaid)
14. [Silversummit](#14-silversummit)
15. [Molina](#15-molina)
16. [Caresource Medicaid](#16-caresource-medicaid)
17. [UMR](#17-umr)
18. [ChampVA](#18-champva)
19. [EBMS](#19-ebms)
20. [GEHA](#20-geha)
21. [Las Vegas Firefighters](#21-las-vegas-firefighters)
22. [Multiplan / PHCS / First Health Network](#22-multiplan--phcs--first-health-network)
23. [Portal Quick Reference](#23-portal-quick-reference)

---

## 1. Universal Rules (All Payers)

These apply across ALL payers, not just BCBS.

### 1.1 When in Doubt, Call
If any payer's rules are unclear, auth requirement is uncertain, or the plan doesn't match known patterns -- **call the payer.** This is the universal fallback for every payer.

### 1.2 Medicare Supplement Rule
True Medicare Supplement plans (Plan A through Plan N) -> No authorization required after Medicare. This applies regardless of the underlying carrier (BCBS, Aetna, UHC, Cigna, etc.). Does NOT apply to Medicare Advantage or retirement plans.

### 1.3 Referral vs. Authorization
Some payers separate these into two distinct processes:
- **Referral:** PCP approval to see a specialist (may be required for HMO plans)
- **Authorization:** Payer approval for a specific procedure/test
- A plan may require one, both, or neither
- Check benefits to determine which applies

### 1.4 Universal Medicaid Rule
**All Medicaid plans:** 100% covered for approved charges (no patient cost)

Applies to:
- Nevada Medicaid (FFS)
- Anthem Medicaid
- Silversummit Medicaid
- Molina Medicaid
- HPN Medicaid
- Caresource Medicaid

### 1.5 Chart Notes Rule
If chart notes are missing -> request them upfront (universal rule). However, some payers allow submission to proceed while waiting for notes.

---

## 2. HST Code Routing Table

**Routing Rule:** Use primary insurance's code. (~1% exception may use secondary's code)

| Payer | HST Code | Notes |
|-------|----------|-------|
| **G0399 Payers** | | |
| BCBS (all affiliates) | G0399 | |
| Aetna | G0399 | |
| UHC | G0399 | |
| Humana | G0399 | |
| Tricare | G0399 | |
| VA | G0399 | |
| ChampVA | G0399 | |
| GEHA | G0399 | UHC network |
| Las Vegas Firefighters | G0399 | UHC allowables |
| First Health Network | G0399 | |
| Anthem Medicaid | G0399 | |
| Silversummit Medicaid | G0399 | |
| Silversummit Ambetter | G0399 | |
| Molina Medicaid | G0399 | |
| Molina Marketplace | G0399 | |
| Caresource Medicaid | G0399 | |
| **95806 Payers** | | |
| Cigna | 95806 | |
| Medicare (FFS) | 95806 | |
| Sierra Health / HPN | 95806 | Unless primary uses G0399 |
| Workers' Comp (DOL) | 95806 | |
| Multiplan | 95806 | |
| PHCS | 95806 | |
| **Special Rules** | | |
| Nevada Medicaid (FFS) | N/A as primary | Never allows HST as primary. As secondary, follows primary's code. |
| EBMS | Depends on parent network | TPA -- varies by underlying plan |
| UMR | 95806 (standard) / G0399 (UHC plans) | See UMR section for details |
| **Not Accepted** | | |
| Prominence | -- | OON |
| Motor Vehicle / PI | -- | Doesn't apply to industry |

---

## 3. OON / Not Accepted Plans

| Payer | Reason |
|-------|--------|
| Culinary Health Fund | OON |
| P3 Health Partners | OON |
| Intermountain Healthcare | OON |
| ApolloCare | OON |
| Select Health Plans | OON |
| Scan Health Plans | OON |
| Alignment Health Plans | OON |
| Prominence | OON |
| WellCare by Allwell Silversummit | OON |
| Cigna Medicare | OON |
| Kaiser Permanente | OON |
| Medi-Cal | OON |
| Motor Vehicle / PI | N/A -- doesn't apply to industry |

---

## 4. Aetna

### 4.1 Aetna Commercial [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST (95806/G0399)** | a No auth |
| **In-lab (95810/95811)** | [OK] Auth required -> Availity |
| **HST Code** | G0399 |
| **Referral** | Check benefits -- if needed -> Availity (PCP NPI + Facility NPI only) |
| **Notes** | Only if requested |

**Workflow:**
```
1. Check benefits via Availity -> determines if PCP REFERRAL is needed
   (Auth requirement is already known -- see table above)

2. If PCP referral required:
   -> Submit ALL codes through Availity referral tool
   -> Use PCP NPI + Facility NPI ONLY
   -> Do NOT use specialist/reading physician NPI

3. If auth required (in-lab):
   -> Submit through Availity

4. Notes: Not required. Only submit if specifically requested.
```

---

### 4.2 Aetna Medicare [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required -> Availity |
| **HST Code** | G0399 |
| **Referral** | Not needed |

**Differences from Commercial:**
- No PCP referral needed
- Auth pattern same as commercial

---

### 4.3 Aetna Supplement [OK] LOCKED

Universal Medicare Supplement rule applies: No auth after Medicare pays.

**Portal:** myproviderhq.com

---

## 5. Cigna

### 5.1 Cigna Commercial [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required -> Evicore portal |
| **HST Code** | 95806 |
| **Referral** | Never required |
| **Clinical notes** | Sometimes requested |
| **Pain level** | [GREEN] Easy |

**Portals:**
| Portal | URL | Used For |
|--------|-----|----------|
| Cigna Provider | CignaforHCP.com | Benefits verification (Commercial) |
| Evicore | evicore.com | In-lab auth submission |
| Cigna Supplement | myproviderhq.com | Benefits for Supplement plans |

**ID Formats:**
| Type | Pattern | Notes |
|------|---------|-------|
| Commercial | Standard Cigna ID | -- |
| Supplement | Different format (TBD) | ID alone identifies supplement; capture specific pattern later |

**Special cases:**
- **Cigna Medicare:** Out of network -- N/A
- **One Commercial plan OON** (possibly Local Access Plus): Self-identifies during benefits verification
- **Cigna Supplement Plans (A-N):** Identifiable by ID format OR card says "Medicare Supplement" -> No auth after Medicare pays (universal rule)
- **TPA-managed Cigna:** Portal indicates during verification -> Call the provided number -> Auth may or may not be required

**Workflow:**
```
1. Check ID format / card:
   -> Supplement ID or card says "Medicare Supplement"? 
     -> Use myproviderhq.com for benefits 
     -> No auth needed (universal rule)
   -> Standard Commercial? -> Continue below

2. Verify benefits via CignaforHCP.com
   -> Confirms network status (catches OON plan if applicable)
   -> If TPA-managed -> call number provided

3. If standard in-network Commercial:
   -> HST: No auth, proceed to schedule
   -> In-lab: Submit auth via Evicore portal
      -> Notes: Attach if requested

4. Auth approved -> Schedule
```

---

### 5.2 Cigna Medicare [OK] LOCKED

**Status:** Out of Network -- N/A

---

### 5.3 Cigna Supplement [OK] LOCKED

Universal Medicare Supplement rule applies: No auth after Medicare pays.

**Portal:** myproviderhq.com
**ID Format:** Different from standard Cigna (TBD -- capture pattern when example available)

---

## 6. UnitedHealthcare (UHC)

### 6.1 UHC Commercial [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required -> uhcprovider.com |
| **HST Code** | G0399 |
| **Referral** | Never required |
| **Clinical notes** | Always required with auth |
| **Fallback** | Call if portal doesn't work (patient not found, redirects, etc.) |
| **Pain level** | [GREEN] Easy |

**Special variant -- Surest:**
- Location-based variable copays (by ZIP code)
- Must call or message to get accurate copay info
- Auth rules same as standard Commercial

---

### 6.2 UHC Medicare [OK] LOCKED

**Two paths -- determined by contract name, card info, or during verification (no ID difference):**

| | UHC Direct-Managed | Optum-Managed |
|---|---|---|
| **HST** | a No auth | a No auth |
| **In-lab** | a No auth (get printout) | [OK] Auth required -> Curo |
| **Referral (HMO)** | Required -> uhcprovider.com | Required -> Curo |
| **Portal** | uhcprovider.com | curo.optum.com |
| **Benefits** | uhcprovider.com | Availity + confirm in providers.optumcaremw.com |
| **Allowables** | UHC | Optum (not Humana) |
| **Pain level** | [GREEN] Easy | [YELLOW] Medium (3 portals) |

**Optum-managed workflow:**
- Check **both** uhcprovider.com AND Curo to determine referral requirements and accurate PCP info
- Benefits -> providers.optumcaremw.com
- In-lab auth -> Curo

---

### 6.3 Portals

| Portal | URL | Used For |
|--------|-----|----------|
| UHC Provider | uhcprovider.com | Commercial auth/benefits, UHC-direct Medicare |
| Curo | curo.optum.com/login | Optum-managed Medicare auth/referrals |
| Optum Care | providers.optumcaremw.com | Optum-managed Medicare benefits |

---

## 7. Humana

### 7.1 Humana Commercial [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth (historically) |
| **In-lab** | [OK] Auth required -> Availity |
| **HST Code** | G0399 |
| **Referral** | Check via Availity |
| **Verification** | Availity -- instant response, confirms requirements |
| **Pain level** | [GREEN] Easy (rare plan) |

---

### 7.2 Humana Medicare [OK] LOCKED

**PPO Plans:**
| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required -> Availity |
| **Referral** | Not required |
| **Network** | [OK] Accept all |

**HMO Plans -- Fork by IPA:**

| IPA | HST | In-lab | Referral | Benefits | Network |
|-----|-----|--------|----------|----------|---------|
| **None / Standard** | Referral required -> Availity | Auth required -> Availity | Via Availity | Availity | [OK] Accept |
| **Optum** | a No referral | Auth required -> Curo | Not required for HST | Availity + confirm in Optum portal (Optum rates) | [OK] Accept |
| **P3 Health Partners** | -- | -- | -- | -- | a OON |
| **Intermountain Healthcare** | -- | -- | -- | -- | a OON |

**IPA Identification:**
- Availity shows IPA during benefits check
- Card sometimes shows IPA
- If Availity shows an IPA, may need to call to verify (some "IPAs" are just clinics/facilities)
- No IPA listed on Availity = no IPA

**Pain level:** [YELLOW] Medium (IPA routing adds complexity)

---

### 7.3 Humana Supplement [OK] LOCKED

Universal Medicare Supplement rule applies: No auth after Medicare pays.

---

## 8. Sierra Health / Health Plan of Nevada

### 8.1 Sierra Health and Life / HPN [OK] LOCKED

**Ownership:** Both managed under UHC umbrella (separate insurance, UHC-owned)

| Plan Type | Sierra Health and Life | Health Plan of Nevada (HPN) |
|-----------|------------------------|----------------------------|
| **Commercial/Employer** | [OK] Yes | [OK] Yes |
| **Medicaid** | a No | [OK] Yes |

| Field | Value |
|-------|-------|
| **HST** | Submit through portal (all codes) |
| **In-lab** | Submit through portal (all codes) |
| **HST Code** | 95806 (unless primary uses G0399) |
| **Clinical notes** | Not required upfront -- can submit without them |
| **Portal** | provider.healthplanofnevada.com |
| **Pain level** | [GREEN] Easy |

**Workflow:**
```
1. If chart notes missing -> request them (universal rule)
2. Submit ALL codes through provider.healthplanofnevada.com
   -> Don't call to verify requirements -- just submit
   -> Can proceed with submission even if notes not yet received
3. HST code: 95806 unless primary insurance uses G0399
```

---

### 8.2 HPN Medicaid [OK] LOCKED

Same workflow as HPN Commercial -- submit all codes through portal.
**Cost:** 100% covered (Medicaid rule)

---

## 9. Nevada Medicaid (FFS)

### Nevada Medicaid (FFS) [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST as Primary** | a NEVER allowed -- always PSG |
| **HST as Secondary** | [OK] Allowed -- follows primary's code |
| **In-lab (PSG)** | [OK] Auth required |
| **Portal** | medicaid.nv.gov/HCP/... |
| **Cost** | 100% covered (Medicaid rule) |
| **Pain level** | [YELLOW] Medium (easy submission, but extremely particular) |

**Required with submission:**
- Sleep questionnaire from patient -- must be included

**Rx Rule:**
- If Medicaid is primary AND not a replacement -> Need new Rx if provider ordered HST only

**Workflow:**
```
1. Medicaid primary? 
   -> HST NOT allowed -- must be PSG
   -> If Rx says HST only -> request new Rx for PSG

2. Obtain sleep questionnaire from patient

3. Submit PSG auth via medicaid.nv.gov portal
   -> Include sleep questionnaire
   -> Be thorough -- they are extremely particular

4. If Medicaid is SECONDARY:
   -> HST allowed -- follows primary's code
```

---

## 10. Tricare

### Tricare [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | Varies by plan -- use code lookup tool |
| **In-lab** | Varies by plan -- use code lookup tool |
| **HST Code** | G0399 |
| **Benefits/Eligibility** | Availity |
| **Auth/Referral submission** | Tricare directly (via Availity payer space -> redirects to Tricare) |
| **Pain level** | [YELLOW] Medium (lookup easy, but auth/referral painful when required) |

**ID Formats:**
| Format | Verifiable? |
|--------|-------------|
| Sponsor's SSN (9 digits) | [OK] Yes |
| Member's DBN (11 digits) | [OK] Yes |
| DOD number (10 digits) | a No -- cannot verify |

**Secondary Rule:**
- Tricare is always secondary if patient has other insurance (except Medicaid)
- Order: Other insurance -> Tricare -> Medicaid
- When Tricare is secondary: No auth/referral required

**Workflow (Standard Tricare):**
```
1. Check ID format:
   -> 10-digit DOD? Cannot verify -- need SSN or DBN
   
2. Verify eligibility via Availity -> note plan name

3. Use Availity's Tricare code lookup tool
   -> Enter plan name + code
   -> Tool indicates if auth/referral required
   
4. If auth/referral required:
   -> Go to Tricare payer space in Availity
   -> Redirects to Tricare's system
   -> Submit directly through Tricare (painful)
```

**Tricare for Life (Exception):**
```
-> Always secondary to Medicare
-> Must CALL to verify eligibility
-> If eligible: 100% covered after Medicare, no auth any codes
```

---

## 11. VA

### VA [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | Referral = Auth (received from VA) |
| **In-lab** | Referral = Auth (received from VA) |
| **HST Code** | G0399 |
| **Cost to patient** | 100% covered |
| **Pain level** | [GREEN] Very easy (just time-sensitive) |

**Unique workflow:**
```
1. Receive referral from VA (this IS the authorization)
2. Must schedule patient within 1 WEEK
   -> If not scheduled in time -> VA cancels the referral/auth
3. 100% covered -- no patient cost
```

**Key constraint:** Time-sensitive -- 1 week scheduling window

---

## 12. Workers' Comp (DOL)

### Workers' Comp (DOL) [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | a No auth |
| **HST Code** | 95806 |
| **Cost to patient** | 100% covered |
| **Portal** | owcpconnect.dol.gov |
| **Pain level** | [GREEN] Easy |

**Accepted DOL Programs:**
| Program | Code | Frequency |
|---------|------|-----------|
| Federal Employees' Compensation | DFEC | Rare |
| Energy Employees Occupational Illness | DEEOIC | [OK] Most common (Atomic Workers, Electrical Workers) |
| Coal Mine Workers' Compensation | DCMWC | Rare |
| Longshore and Harbor Workers' | DLHWC | Rare |

**Identification clues in notes:**
- "White card"
- "Test site"
- "NV test site"
- Any atomic/energy worker references

**Workflow:**
```
1. Identify DOL coverage (notes clues or patient mention)
2. Verify ID via owcpconnect.dol.gov portal
3. If covered under DOL program:
   -> No auth required (any codes)
   -> 100% covered
   -> Do NOT bother with commercial -- use DOL only
```

---

## 13. Anthem Medicaid

### Anthem Medicaid [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required |
| **HST Code** | G0399 |
| **Referral** | Never required |
| **Auth submission** | Availity (preferred) or Fax (number on form) |
| **Cost** | 100% covered (Medicaid rule) |
| **Pain level** | [YELLOW] Medium |

---

## 14. Silversummit

### 14.1 Silversummit Medicaid [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required |
| **HST Code** | G0399 |
| **Referral** | Never required |
| **Auth submission** | Silversummit portal (Availity may work in future) |
| **Portal** | provider.silversummithealthplan.com |
| **Cost** | 100% covered (Medicaid rule) |
| **Pain level** | [YELLOW] Medium |

**Note:** In-lab titrations almost never approved -- still submit and try.

---

### 14.2 Silversummit Ambetter (Marketplace) [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required |
| **HST Code** | G0399 |
| **Referral** | Check benefits -- varies |
| **Auth submission** | Silversummit portal (same as Medicaid) |
| **Portal** | provider.silversummithealthplan.com |
| **Pain level** | [YELLOW] Medium |

---

## 15. Molina

### 15.1 Molina Medicaid [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | a No auth (but submit via Availity for confirmation) |
| **HST Code** | G0399 |
| **Referral** | Never required |
| **Auth submission** | Availity (for confirmation) |
| **Cost** | 100% covered (Medicaid rule) |
| **Pain level** | [GREEN] Easy |

**Note:** Guidelines change semi-frequently -- always submit through Availity to get confirmation even though currently no auth required.

---

### 15.2 Molina Marketplace [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | a No auth (submit via Availity for confirmation) |
| **HST Code** | G0399 |
| **Referral** | Check benefits -- may be required (uncertain) |
| **Auth submission** | Availity (same as Molina Medicaid) |
| **Pain level** | [GREEN] Easy |

**Note:** Rare plan -- same workflow as Molina Medicaid, but referral requirement uncertain. Check benefits.

---

## 16. Caresource Medicaid

### Caresource Medicaid [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | a No auth |
| **HST Code** | G0399 |
| **Referral** | Never required |
| **Cost** | 100% covered (Medicaid rule) |
| **Pain level** | [GREEN] Easy |

**Verification workflow (new plan):**
```
1. Verify benefits on Availity
2. Confirm referring physician in-network: findadoctor.caresource.com
3. Use procedure code lookup tool to confirm no auth: 
   caresource.com/nv/providers/provider-portal/prior-authorization/medicaid/
```

**Note:** Brand new plan -- verify referring physician network status.

---

## 17. UMR

### UMR -- Multiple Workflows [OK] LOCKED

**Benefits/Eligibility Portal:** provider.umr.com

---

### 17.1 Standard UMR Plans
| Field | Value |
|-------|-------|
| **HST** | Submit through HPN/Sierra portal |
| **In-lab** | Submit through HPN/Sierra portal |
| **HST Code** | 95806 |
| **Allowables** | UMR allowables |
| **Portal** | provider.healthplanofnevada.com |
| **Pain level** | [GREEN] Easy |

---

### 17.2 Clark County Self Funded
| Field | Value |
|-------|-------|
| **Plans** | 100/0 or 80/20 |
| **HST** | Submit through HPN |
| **In-lab** | Submit through HPN |
| **HST Code** | 95806 |
| **Allowables** | UMR allowables |
| **Pain level** | [GREEN] Easy |

**[!] Note:** Portal quotes benefits incorrectly -- always 80/20, never 90/10.

---

### 17.3 MGM Direct
| Field | Value |
|-------|-------|
| **HST** | Submit through HPN |
| **In-lab** | Submit through HPN |
| **HST Code** | 95806 |
| **Cost** | 100/0 -- no out of pocket cost to patient |
| **Pain level** | [GREEN] Easy |

---

### 17.4 UMR UHC Plans
| Field | Value |
|-------|-------|
| **HST** | Verify via UMR portal, call if unable |
| **In-lab** | Verify via UMR portal, call if unable |
| **HST Code** | G0399 |
| **Allowables** | UHC allowables (not UMR) |
| **Pain level** | [RED] Hard |

**Note:** Only UMR variant that uses G0399 and UHC allowables.

---

### 17.5 Teachers Health Trust
| Field | Value |
|-------|-------|
| **HST** | a No auth, no submission needed |
| **In-lab** | a No auth, no submission needed |
| **HST Cost** | Deductible 80/20 |
| **In-lab Cost** | Always $75 copay |
| **Pain level** | [GREEN] Easy |

---

## 18. ChampVA

### ChampVA [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | a No auth |
| **HST Code** | G0399 |
| **Referral** | Never required |
| **Pain level** | [RED] Hard (4+ hour phone waits) |

**Cost:**
- Primary: 75/25 after $50 deductible
- Secondary: 100% covered

**Coordination of Benefits:**
- Always secondary to other insurance
- Exception: Primary to Medicaid (if Medicaid present, ChampVA goes first)

**ID Format:** Patient's SSN

**Verification:** EHR (building) or call -- phone wait times exceed 4 hours on average (worst of any payer)

---

## 19. EBMS

### EBMS [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | Call to verify -- varies by plan |
| **In-lab** | Call to verify -- varies by plan |
| **HST Code** | Depends on parent network (EBMS is a TPA) |
| **Referral** | Call to verify |
| **Verification** | Call only -- need card for phone number |
| **Pain level** | [YELLOW] Medium (phone wait varies) |

**Note:** EBMS is a third party administrator -- rules depend on the parent network. Always need the card to call for benefits and authorization requirements.

---

## 20. GEHA

### GEHA [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth |
| **In-lab** | [OK] Auth required |
| **HST Code** | G0399 (UHC network) |
| **Allowables** | UHC allowables |
| **Referral** | Never required |
| **Auth submission** | Call GEHA directly |
| **Pain level** | [YELLOW] Medium |

**ID Format:** Starts with "G" followed by numbers

**Cost:**
- Primary: Deductible + coinsurance
- Secondary to Medicare: 100% covered, no auth required
- Secondary to other plans: Auth still required

**Note:** Subsidiary of UMR -- sometimes mislabeled. Uses UHC network and allowables.

---

## 21. Las Vegas Firefighters

### Las Vegas Firefighters [OK] LOCKED

| Field | Value |
|-------|-------|
| **HST** | a No auth (confirm by calling) |
| **In-lab** | a No auth (confirm by calling) |
| **HST Code** | G0399 |
| **Allowables** | UHC allowables |
| **Referral** | Never required |
| **Benefits** | Vary -- check each time |
| **Portal** | uhss.umr.com (UMR) |
| **Verification** | Call to confirm auth requirements every time |
| **Pain level** | [YELLOW] Medium |

**Note:** Even though no auth required, must call to confirm each time. Benefits vary by patient.

---

## 22. Multiplan / PHCS / First Health Network

### Multiplan / PHCS / First Health [OK] LOCKED

| Network | HST Code |
|---------|----------|
| Multiplan | 95806 |
| PHCS | 95806 |
| First Health | G0399 |

| Field | Value |
|-------|-------|
| **HST** | Call to verify -- varies by plan |
| **In-lab** | Call to verify -- varies by plan |
| **Allowables** | Respective network allowables |
| **Verification** | Call IBA directly (not the network) |
| **Pain level** | [YELLOW] Medium |

**Note:** These are IBA (Independent Benefit Administrator) plans. Cards are always random/obscure -- almost always need the physical card to get the correct contact number. Contact the IBA, not the network directly, for auth/benefits.

---

## 23. Portal Quick Reference

| Payer | Portal URL | Used For |
|-------|------------|----------|
| **Aetna** | Availity | Auth, benefits, referrals |
| **Aetna Supplement** | myproviderhq.com | Supplement benefits |
| **Cigna** | CignaforHCP.com | Benefits verification |
| **Cigna Auth** | evicore.com | In-lab auth submission |
| **Cigna Supplement** | myproviderhq.com | Supplement benefits |
| **UHC** | uhcprovider.com | Commercial + UHC-direct Medicare |
| **UHC Optum** | curo.optum.com/login | Optum-managed Medicare auth |
| **UHC Optum Benefits** | providers.optumcaremw.com | Optum-managed benefits |
| **Humana** | Availity | Auth, benefits |
| **Sierra/HPN** | provider.healthplanofnevada.com | All submissions |
| **Nevada Medicaid** | medicaid.nv.gov/HCP/... | PSG auth |
| **Tricare** | Availity -> Tricare redirect | Auth/referral |
| **DOL Workers' Comp** | owcpconnect.dol.gov | ID verification |
| **Silversummit** | provider.silversummithealthplan.com | Auth submission |
| **Caresource** | findadoctor.caresource.com | Provider lookup |
| **Caresource Auth** | caresource.com/.../prior-authorization/medicaid/ | Code lookup |
| **UMR** | provider.umr.com | Eligibility/benefits |
| **UMR Standard Auth** | provider.healthplanofnevada.com | Auth submission |
| **Las Vegas Firefighters** | uhss.umr.com | Benefits |

---

*Document Status: COMPLETE -- All payers locked and confirmed.*
*Version: v0.15 * February 2026*
*Next: Build JSON files for decision tree implementation*
