# MEDOCR: BCBS Complete Payer Knowledge Base
## All Affiliates, Rules, Tools, and Workflows -- Locked & Confirmed
**Version:** v0.14 Prep * **Date:** February 2026 * **Status:** COMPLETE

---

## Table of Contents

1. [Decision Hierarchy](#1-decision-hierarchy)
2. [Universal BCBS Rules](#2-universal-bcbs-rules)
3. [TPA Layer (Overrides All)](#3-tpa-layer)
4. [Affiliate Profiles (18 Affiliates)](#4-affiliate-profiles)
5. [Auth Handlers & Tools Reference](#5-auth-handlers--tools-reference)
6. [ID Format Intelligence](#6-id-format-intelligence)
7. [Feedback Loop Architecture](#7-feedback-loop-architecture)

---

## 1. Decision Hierarchy

Every BCBS referral follows this cascade -- in this exact order:

```
Step 0: TPA CHECK
        Is this a Quantum Health, Benesys/Union, or other TPA plan?
        -> YES: Use TPA-specific process (Section 3). STOP.
        -> NO: Continue.

Step 1: KNOWN PREFIX
        Is this prefix in our database with known rules?
        -> YES: Start with what we last knew to be true. Continue to verify.
        -> NO: Fall through to Step 2.

Step 2: UNIVERSAL BCBS RULES
        Apply rules that work across ALL affiliates:
        * Letter in ID body -> Carelon first -> Availity chat second -> affiliate fallback
        * Medicare Supplement Plan A--N -> No auth after Medicare
        -> If resolved: Done.
        -> If not fully resolved: Fall through to Step 3.

Step 3: AFFILIATE-SPECIFIC DEFAULTS
        Use the affiliate's known patterns as the fallback.
        -> If affiliate unknown: Call payer (number on card).
```

**Key Principle:** Known data first, then general patterns fill the gaps.

---

## 2. Universal BCBS Rules

These apply to ALL BCBS affiliates unless a specific prefix or affiliate rule overrides them.

### 2.1 Letter-in-ID Rule

```
Member ID body (after prefix) contains a letter?
  -> YES: Auth is through Carelon. Submit directly to Carelon.
         If benefits don't pull up in Carelon -> verify via Availity chat.
         Availity chat typically available for these IDs.
  -> NO:  Auth requirement is UNKNOWN. Must verify through affiliate-specific process.
         Availity chat does NOT work for all-numeric IDs.
```

**Important:** This is a SOFT signal. Some all-numeric IDs still go through Carelon. The letter is a strong indicator, not an absolute gate.

### 2.2 Medicare Supplement Rule

```
Benefits say Plan A through Plan N?
  -> TRUE Medicare Supplement -> No authorization required after Medicare.
  -> DOES NOT apply to retirement plans (verified through other means).
```

### 2.3 UM Fallback Number

```
Anthem UM Phone: 800-336-7767
  -> Global last resort fallback number.
  -> NOT the primary call for any affiliate.
  -> Only used when specifically indicated by prefix notes ("through UM Department")
    or when all other options exhausted.
```

---

## 3. TPA Layer

TPAs override normal affiliate workflows when identified. Check for these FIRST.

### 3.1 Quantum Health

| Field | Value |
|-------|-------|
| **What** | TPA for specific employer-offered plans |
| **Scope** | Can appear on any affiliate, usually 1-2 prefixes per affiliate |
| **Auth Required** | No auth required |
| **Can still submit** | Yes -- portal will approve an authorization for documentation |
| **Portal** | https://www.ccbyqh.com/#/ |
| **Phone** | (800) 247-8956 |
| **Workflow** | Submit through portal for response, or call directly (time/workload dependent) |

### 3.2 Union / Benesys Plans

**Identification:** Prefix/card/group name indicates union plan.

**Benefit/Eligibility Tools (determine which handler + if auth needed):**

| Tool | Portal | Status |
|------|--------|--------|
| **Benesys** | https://benesys-prod.webspyglass.com/logonE.jsp | Active |
| **Zenith** | https://www.zenithadm.com/ProviderServices/ProviderLogin.cfm | Active (outdated portal) |

**Note:** "White card ID" -- can find member ID through Benesys with alternate ID by adding prefix into BCBS Eligibility.

**Auth Handlers (auth required ALL codes when routed through these):**

| Handler | Submission | Portal/Link |
|---------|-----------|-------------|
| **ICM** (Innovative Care Mgmt) | Upload form or fax | https://innovativecare.files.com/u/file-upload |
| **NHS** (Nevada Health Solutions) | Portal or fax | https://nhs.acuitynxt.com/providerportal/ |
| **Telligen** | Portal | https://myqualitrac.com |

**Workflow:**
1. Check spreadsheet/known prefix first -- some are already known as ICM, NHS, etc.
2. If unknown -> Benesys or Zenith confirms auth requirements + which handler
3. If auth required -> submit through designated handler
4. Plans rarely change handlers once assigned
5. **Rare exception:** occasionally a union plan has no auth at all (Benesys/Zenith confirms)

---

## 4. Affiliate Profiles

### 4.1 BCBS IL / BCBS TX [OK]

**Rules are identical between IL and TX. Only phone numbers differ.**

| Field | BCBS IL | BCBS TX |
|-------|---------|---------|
| **Auth dept phone** | 800-572-3089 | 800-441-9188 |

**Workflow:**

```
1. Identify as IL or TX (prefix lookup from spreadsheet OR card says state)

2. Check member ID body format:

   LETTER IN BODY:
   -> Auth IS required (known immediately)
   -> Submit directly to Carelon
   -> If benefits don't pull up -> verify via Availity chat
   -> All codes through Carelon (Carelon determines CPT-level rules)

   NO LETTER (all numeric):
   -> Auth requirement UNKNOWN
   -> Call provider services IVR to determine if auth required
   -> If auth required -> call auth department:
     * IL: 800-572-3089
     * TX: 800-441-9188
   -> If auth not required -> proceed to schedule
   -> Availity chat NOT available for these IDs
```

**Not applicable to IL/TX:**
- UM number (800-336-7767) -- not part of standard workflow
- G0399 workaround -- applies to other affiliates
- ID suffix manipulation (00/01/02) -- not an IL/TX issue

---

### 4.2 BCBS CA (Anthem) [OK]

**Workflow:**

```
1. Universal letter-in-ID rule applies:
   LETTER IN BODY -> Carelon -> Availity chat if benefits don't pull up

2. For plans NOT resolved by universal rules:
   -> HST: No auth required
   -> In-lab: Call to verify if auth required
     * Get reference number to protect us (even if told no auth)
   -> If auth required for in-lab: Fax BCBS CA authorization form
     * No phone submission for in-lab auth
```

**Key details:**
- Chat: Yes (58 of 101 prefixes) -- high chat availability
- Has its own auth fax form (BCBS CA specific)
- Reference number approach -- always get confirmation for protection
- G0399 workaround applies to CA (see Section 5.4)

---

### 4.3 Horizon BCBS NJ [OK]

**Workflow:**

```
-> No auth required (all codes, all prefixes)
-> Verify via Horizon prior auth search tool
-> Print confirmation from tool as documentation
```

**Key details:**
- **Prior auth search tool:** https://www.horizonblue.com/providers/resources/provider-self-service-tools/prior-authorization-search
- Enter CPT code + member info -> confirms no auth -> print
- Chat: No
- **ID identifier:** "HZN" in the prefix/ID = Horizon plan (e.g., NJX3HZN, NSJ3HZN)
- Simple "keep the link handy" payer

---

### 4.4 BCBS FEP (Federal Employee Program) [OK]

**Workflow:**

```
-> Prefix: R (single character -- unique among BCBS)
-> HST: No auth
-> In-lab: Auth required -> fax FEP auth form to BCBS Federal
-> Medicare primary: No auth required, 100% covered after Medicare
```

**Key details:**
- Phone: 800-727-4060
- Has its own FEP auth form
- Letter-in-ID universal rule: N/A (single letter prefix)
- Consistent rules -- FEP doesn't vary

---

### 4.5 BCBS SC [OK]

**Workflow:**

```
-> No auth required (all codes, all prefixes)
-> Verify via Cohere Health portal
-> Submit member info -> print confirmation of no auth
```

**Key details:**
- **Cohere Health portal:** https://login.coherehealth.com/
- Old phone process (800-868-2510) -- obsolete, keep as fallback
- Chat: No
- Quantum Health handles some prefixes (still no auth)
- Old IVR was painful but now replaced by Cohere portal

---

### 4.6 BCBS FL [OK]

**Workflow:**

```
-> Auth ALWAYS required -- ALL codes, ALL prefixes
-> No portal options -- everything is phone/fax
-> Call for benefits: 800-955-5692
-> Auth through CareCentrix: (855) 243-3326
-> Fax clinicals to CareCentrix: (855) 243-3335
```

**Key details:**
- Chat: No
- No shortcuts -- always a phone call payer
- Painful but predictable

---

### 4.7 BCBS MI [OK]

**Workflow:**

```
-> Typically no auth (all prefixes so far)
-> Quick phone calls (not a pain payer)
-> Code lookup PDF available
-> Potentially Availity for submissions (still exploring)
```

**Key details:**
- **Code lookup PDF:** https://authorizations.bcbsm.com/index.shtml
- Availity may provide instant response -- still learning their tools
- Chat: No
- May evolve as more online tools are discovered

---

### 4.8 Premera BCBS [OK]

**Workflow:**

```
-> Step 1: Check Availity (Premera payer space) -- verify if auth required for member's group
-> Step 2: If auth required -> submit through Carelon via Availity
-> HST/in-lab rules vary by member group -- Availity determines
```

**Key details:**
- Availity is the single source of truth -- no need to pre-guess CPT rules
- **Avoid phone** -- extremely long hold times
- Chat: No (practically)
- Covers Alaska plans too
- **Carelon portal troubleshooting (Premera-specific):** Premera IDs consistently have trouble pulling up in Carelon. Try variations:
  - As-is
  - Drop the alpha prefix
  - Drop the suffix
  - Add suffix (00, 01, 02)
  - Try just the 9 numeric digits
  - This happens consistently with Premera, not other affiliates

---

### 4.9 CareFirst BCBS [OK]

**Workflow:**

```
-> Step 1: Check free tool (precert/preauth page)
-> Step 2: If needed, log into provider portal to determine/submit
-> Step 3: If still nothing -> fall back to universal BCBS procedures
```

**Key details:**
- **Precert/preauth page:** https://provider.carefirst.com/providers/medical/out-of-area-precertification-preauthorization.page
- **Provider portal login:** https://providerlogin.carefirst.com (Anthem OAuth)
- Chat: No (mostly)
- **BCBS VA is separate from CareFirst** -- do not treat as same payer

---

### 4.10 BCBS HI / HMSA [OK]

**Workflow:**

```
-> Always call HMSA to verify if any testing billed in last 5 years
-> No testing in 5 years -> no auth
-> Testing billed in 5 years -> auth required -> fax authorization form
-> Medicare supplement: picks up deductible and coinsurance
```

**Key details:**
- **Unique 5-year lookback rule** -- only affiliate with this
- Must call HMSA to verify billing history
- 4-character prefixes (XLRR, XLXR, HFPF, XLER, XLPR)
- Chat: No

---

### 4.11 BCBS MA [OK]

**Workflow:**

```
-> Primarily Carelon -- auth through Carelon for most prefixes
-> Letter-in-ID rule applies, but even without the letter, auth still tends to go through Carelon
-> A few no-auth prefixes exist (rare)
-> Medicare supplement: picks up deductible & coinsurance, no auth
```

**Key details:**
- Mostly a Carelon plan regardless of ID format
- Chat: No

---

### 4.12 Regence BCBS [OK]

**Workflow:**

```
-> Step 1: Check Carelon portal -- it will tell you auth is needed but you must call
-> Step 2: If patient not in Carelon -> call Regence directly
          MUST SELECT MENTAL HEALTH OPTION (otherwise routes incorrectly)
-> Step 3: Submit auth over the phone -- no portal submission available
-> HST: typically no auth
-> In-lab: auth required, phone submission only
```

**Key details:**
- **Uses the mental health benefit** -- must select mental health when calling
- **Up to 4 HOUR hold times** -- worst of all affiliates
- Cannot use Carelon portal to submit -- call only
- Chat: No
- Covers: Oregon, Idaho, Utah, Washington
- One Quantum Health prefix (no auth)

---

### 4.13 BCBS KC [OK]

**Workflow:**

```
-> Auth requirement UNCERTAIN -- process has changed
-> CALL REQUIRED for ALL codes to determine and submit
-> Portal (bluekc.com) NOT usable for out-of-state providers
-> Phone system does not allow hold -- forces callback request that never comes
-> Must keep calling until you reach someone
-> Need group number and suffix from member card
```

**Key details:**
- No portal access for out-of-state providers
- No hold queue, no callback
- Nightmare payer for phone access
- Chat: No

---

### 4.14 BCBS MN [OK]

**Workflow:**

```
-> No auth (all prefixes so far)
-> Phone calls not bad (similar to BCBS MI)
-> Availity available
-> Online prior auth lookup tool available
```

**Key details:**
- **Prior auth lookup tool:** https://www.bluecrossmn.com/providers/medical-management/prior-authorization-lookup-tool
- Chat: No

---

### 4.15 Highmark BCBS [OK]

**Workflow:**

```
-> Letter in ID -> universal rule -> Carelon
-> No letter in ID -> typical Highmark pattern:
  * HST: generally no auth
  * In-lab: auth required -> fax Highmark auth form
  * Call to confirm auth requirements first
```

**Key details:**
- Phone: 800-452-8507 (or 800-547-3627)
- Fax: 888-236-6321
- Chat: No
- Based in Pennsylvania

---

### 4.16 BCBS AL [OK]

**Workflow:**

```
-> Letter in ID -> Carelon (universal rule)
-> No letter -> call to verify (not a bad phone experience)
-> Mostly no auth based on existing data
```

**Key details:**
- Chat: No
- **Watch for:** HST sometimes not covered when comorbidity (prefix KIU), G0399 sometimes not covered (prefix KYI)

---

### 4.17 BCBS VA [OK]

**Workflow:**

```
-> Letter in ID -> Carelon (universal rule)
-> Primarily Carelon for auth
-> Chat: Yes -- Availity chat works well for VA
-> Medicare supplement: no auth
```

**Key details:**
- High chat availability
- Anthem state
- **Separate from CareFirst** (even though geographically close)

---

### 4.18 BCBS NV (Anthem) [OK] -- HOME STATE

**Workflow:**

```
-> Universal BCBS process applies
-> Known prefix first -> letter-in-ID/Carelon -> chat -> affiliate fallback
-> No single default pattern -- trial and error, prefix-by-prefix
-> Chat: Yes on most prefixes -- Availity chat works well for NV
```

**Key details:**
- Most complex affiliate due to volume and variety
- Chat availability highest among affiliates (20 of 32)
- **Known exceptions (documented per-prefix):**
  - Union plans (ICM, NHS, Benesys) -- see TPA section
  - Caremore network -- OON issues, only in-network with Optum Anthem Mediblue
  - VirtuOx redirect (prefix UMQ) -- Complete Sleep Program, can't auth directly
  - Anthem Medicaid (prefix VNV) -- fax form to Anthem Medicaid
  - Ameriben (prefix N2G) -- separate entity
  - Special fax forms for some Electrical Workers prefixes
- **BlueHPN:** AIM/Carelon (documented under NV exceptions, not standalone)
- **Anthem Mediblue:** Medicare HMO, 3 network groups (Optum, P3, Caremore) -- only in-network with Optum

---

### 4.19 Independence BCBS [OK]

**Workflow:**

```
-> Primarily Carelon -- all documented prefixes point to AIM/Carelon
-> Universal letter-in-ID rule likely applies
-> Still building data (7 of 296 prefixes documented)
```

**Key details:**
- Chat: No
- Based in Philadelphia/Pennsylvania region
- All known prefixes route through Carelon

---

### 4.20 Wellmark BCBS [OK]

**Workflow:**

```
-> Submit through Availity -> routes to Wellmark's out-of-area code check lookup tool
-> Tool tells you what needs auth per code
-> General pattern: HST no auth, in-lab auth required
-> If auth required -> fax form to 515-376-9104
```

**Key details:**
- Availity is the entry point -- it routes you to Wellmark's tool automatically
- Chat: No
- Covers Iowa/South Dakota
- Only 5 of 763 prefixes documented, but tool handles verification

---

### 4.20 Wellmark BCBS [OK]

**Workflow:**

```
-> HST: No auth
-> In-lab: Auth required -> fax form to 515-376-9104
-> Verify through Availity -> routes to Wellmark's out-of-area code check lookup tool
```

**Key details:**
- Chat: No
- Covers Iowa / South Dakota
- One prefix (BTZ) notes letter of medical necessity needed for HST

---

### 4.21 BCBS Nebraska [OK]

**Workflow:**

```
-> Submit through Availity -> routes to out-of-state provider form
-> Fill form and complete submission online
-> Email confirmation received
-> No auth required (so far)
```

**Key details:**
- Chat: No
- Online form process -- no phone needed

---

## 5. Auth Handlers & Tools Reference

### 5.1 Carelon (formerly AIM)

| Field | Value |
|-------|-------|
| **Portal** | https://providerportal.carelon.com |
| **Changed from AIM** | March 2023 |
| **Used by** | IL, TX, CA, MA, VA, NV, AL, Highmark (letter-in-ID), Premera, Regence (call only), Independence |
| **Submission** | Portal for most; phone call for Regence |
| **Premera quirk** | IDs often don't pull up -- try variations (drop prefix, drop suffix, add 00/01/02, just 9 digits) |

### 5.2 Availity

| Field | Value |
|-------|-------|
| **Platform** | https://www.availity.com |
| **Chat function** | Provider portal chat -- bypasses phone calls |
| **Works for** | Multiple payers (not just BCBS) |
| **BCBS chat available** | Letter-in-ID plans primarily; high availability for NV, VA, CA |
| **Chat NOT available** | All-numeric IDs; Regence; FL; KC; most Highmark |
| **Premera payer space** | Check auth requirements for member group; submit through Carelon via Availity |

### 5.3 CareCentrix

| Field | Value |
|-------|-------|
| **Used by** | BCBS FL only |
| **Auth phone** | (855) 243-3326 |
| **Fax clinicals** | (855) 243-3335 |
| **All codes** | Auth required for everything |

### 5.4 G0399 Workaround (Specific Affiliates Only)

**Does NOT apply to IL/TX.**

```
If Carelon portal doesn't let you use code G0399:
-> Submit as 95810 instead
-> When they deny the in-lab study
-> Drop to G0399 to bypass

If portal says "NotReviewed" -> truly no auth required
If portal says "Authorized" -> authorization is required
```

### 5.5 Affiliate-Specific Portals

| Affiliate | Tool | URL |
|-----------|------|-----|
| Horizon BCBS NJ | Prior Auth Search | https://www.horizonblue.com/providers/resources/provider-self-service-tools/prior-authorization-search |
| BCBS SC | Cohere Health | https://login.coherehealth.com/ |
| CareFirst | Precert/Preauth Info | https://provider.carefirst.com/providers/medical/out-of-area-precertification-preauthorization.page |
| CareFirst | Provider Portal | https://providerlogin.carefirst.com |
| BCBS MI | Code Lookup PDF | https://authorizations.bcbsm.com/index.shtml |
| BCBS MN | Prior Auth Lookup | https://www.bluecrossmn.com/providers/medical-management/prior-authorization-lookup-tool |
| BCBS KC | BlueKC (blocked OOS) | https://www.bluekc.com |
| Wellmark | Code check (via Availity) | Routed through Availity submission |

---

## 6. ID Format Intelligence

### 6.1 Format Classifications

| Format | Pattern | Signal | Chat Available | Example |
|--------|---------|--------|---------------|---------|
| **Format B** (letter in body) | `ABC123A12345` | Likely Carelon | [OK] Yes | Auth through Carelon, verify via chat |
| **Format A** (all numeric) | `ABC123456789` | NOT Carelon typically | a No | Call to verify, affiliate-specific process |
| **Format FEP** | `R123456789` | FEP | a No | Single-letter prefix, consistent rules |
| **Horizon** | Contains "HZN" | Horizon NJ | a No | Use Horizon search tool |
| **Long/unusual** | 4+ char prefix | Often union/special | Varies | Check spreadsheet, may be union plan |

### 6.2 Format as Soft Signal

The ID format is a SOFT indicator, not a hard gate:
- Some all-numeric IDs still go through Carelon
- The letter is a strong indicator but not absolute
- System should flag mismatches as warnings, not blocks

### 6.3 Affiliate Identification

- **Primary method:** Prefix lookup from spreadsheet database
- **Secondary method:** Card states the affiliate (e.g., "BCBS Illinois" on card)
- **OCR will likely NOT identify the state** unless it recognizes the member ID card format
- **Database management is the primary identification method** -- prefix spreadsheet has the Anthem-documented payer

---

## 7. Feedback Loop Architecture

### 7.1 Five Feedback Event Types

| Event | Trigger | Timing | Effect |
|-------|---------|--------|--------|
| `CONFIRM` | Staff confirms a presumed/likely result | Batched | Escalates confidence toward VERIFIED |
| `CORRECT` | Staff corrects a wrong result | Batched | Updates prefix with correct rules |
| `NEW_PREFIX` | Staff enters rules for unknown prefix | Batched | Creates new prefix entry |
| `IMMEDIATE_OVERRIDE` | Staff overrides a VERIFIED rule that changed | **Instant** | Updates prefix immediately |
| `CASCADE_OVERRIDE` | Staff applies same change to all matching prefixes | Batched + approval | Updates multiple prefixes + affiliate defaults |

### 7.2 Confidence Escalation

```
NEW prefix (no data)                           -> UNVERIFIED
  + 1 staff correction                         -> LIKELY
  + 2 confirmations from different patients     -> VERIFIED
  + 1 contradiction                            -> CONFLICT (flag for review)
```

### 7.3 Immediate Override

Available on ALL results including VERIFIED. For when a guideline changes and you know it right now:
- Instantly updates the JSON
- Logs the change with reason
- Option to cascade to all matching prefixes (goes through batch + approval)
- Current referral re-evaluated with new rules

### 7.4 LLM Processing

Ollama processes accumulated feedback:
- Applies confirmations and corrections
- Detects patterns across prefixes
- Flags conflicts
- Proposes affiliate default updates
- All proposed changes go through human review before committing

---

## 8. Phone Numbers Quick Reference

| Affiliate | Auth Department | Benefits/Provider Line | Other |
|-----------|----------------|----------------------|-------|
| BCBS IL | 800-572-3089 | Provider IVR | |
| BCBS TX | 800-441-9188 | Provider IVR | |
| BCBS CA | Fax form (no phone) | | |
| BCBS FL | CareCentrix: (855) 243-3326 | 800-955-5692 | Fax: (855) 243-3335 |
| BCBS FEP | Fax form | 800-727-4060 | |
| BCBS SC | N/A (no auth) | 800-868-2510 (old) | Cohere portal now |
| BCBS MI | | | Code lookup online |
| BCBS HI | Fax form | Call HMSA | |
| BCBS KC | Call only | Call only | No hold queue |
| Highmark | Fax: 888-236-6321 | 800-452-8507 | |
| Regence | Call Carelon directly | Select mental health | Up to 4hr hold |
| Wellmark | Fax: 515-376-9104 | Via Availity | |
| Anthem UM | | 800-336-7767 | Global last resort |
| Quantum Health | | (800) 247-8956 | Portal: ccbyqh.com |

---

## 9. Optimization Strategy

**Goal: Minimize phone calls. Every call avoided saves 30 minutes to 4 hours.**

**Priority order for verification:**
1. Known prefix in database -> use existing rules
2. Carelon portal -> check if patient pulls up
3. Availity chat -> instant response for letter-in-ID plans
4. Affiliate-specific online tool (Horizon, Cohere, BCBS MI, BCBS MN, CareFirst)
5. Availity submission -> some affiliates (Premera, Highmark)
6. Phone call -> last resort

**Worst phone experiences (avoid if possible):**
1. [RED] Regence -- up to 4 hours
2. [RED] BCBS KC -- no hold queue, forced callback that never comes
3.  Premera -- extremely long hold times
4.  BCBS FL -- always required, no alternatives

**Best phone experiences:**
1. [GREEN] BCBS MI -- quick calls
2. [GREEN] BCBS MN -- not bad
3. [GREEN] BCBS AL -- not bad
4. [GREEN] BCBS IL/TX -- automated IVR, typically easy

---

*Document Status: COMPLETE -- All 21 BCBS affiliates locked and confirmed.*
*Next: Non-BCBS payer profiles (Aetna, UHC, Prominence, and others)*
