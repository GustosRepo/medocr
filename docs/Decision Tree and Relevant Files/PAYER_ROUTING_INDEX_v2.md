# Payer Clinical Criteria Index
## MEDOCR Routing Guide
### Version 2.0 -- February 2026

---

## [!] VERSION 2.0 CHANGES

**VA and HPN Medicaid Corrections:**
- VA now routes to NonBCBS_Payer_Knowledge_Base (Section 11) -- NOT No_Auth
- HPN Medicaid now routes to NonBCBS_Payer_Knowledge_Base (Section 8.2) -- NOT No_Auth

These were incorrectly routed in v1.0.

---

## File Structure

Each payer (or payer group) has its own clinical criteria file:

```
payer_criteria/
|-- Carelon_Clinical_Criteria.md      # BCBS Carelon plans (submit to portal)
|                                     # + Anthem Medicaid (criteria only, submit via Availity/Fax)
|-- Evicore_Clinical_Criteria.md      # Cigna, Aetna
|-- Sierra_HPN_Clinical_Criteria.md   # Sierra, HPN, HPN Medicaid, UMR via Sierra
|-- UHC_Clinical_Criteria.md          # UHC Commercial, Medicare, UMR via UHC
|-- Medicare_FFS_Clinical_Criteria.md # Original Medicare
|-- Nevada_Medicaid_FFS_Clinical_Criteria.md
|-- NonBCBS_Payer_Knowledge_Base.md   # VA Section 11, Anthem Medicaid Section 13, Silversummit Section 14, etc.
|-- No_Auth_Payers_Clinical_Criteria.md  # ChampVA, Silversummit, Molina, Caresource, LV Firefighters
+-- [Future: Humana, Tricare when criteria provided]
```

**Key Distinction:**
- **Criteria files** = What clinical documentation is needed for approval
- **Workflow files** = How/where to submit authorization

---

## Payer -> File Routing

| Payer Identified | Load File | Notes |
|------------------|-----------|-------|
| **BCBS Carelon Plans** | Carelon_Clinical_Criteria.md | Letter-in-ID plans |
| BCBS IL (letter-in-ID) | Carelon_Clinical_Criteria.md | |
| BCBS TX (letter-in-ID) | Carelon_Clinical_Criteria.md | |
| BCBS CA | Carelon_Clinical_Criteria.md | Most prefixes |
| BCBS VA | Carelon_Clinical_Criteria.md | |
| BCBS AL | Carelon_Clinical_Criteria.md | |
| Premera BCBS | Carelon_Clinical_Criteria.md | |
| Regence BCBS | Carelon_Clinical_Criteria.md | Call only |
| Independence BCBS | Carelon_Clinical_Criteria.md | |
| **Anthem Medicaid** | **Carelon_Clinical_Criteria.md** | [!] Criteria only -- submit via Availity/Fax per NonBCBS KB Section 13 |
| Cigna | Evicore_Clinical_Criteria.md | |
| Cigna Commercial | Evicore_Clinical_Criteria.md | |
| Aetna | Evicore_Clinical_Criteria.md | |
| Aetna Commercial | Evicore_Clinical_Criteria.md | |
| Aetna Medicare | Evicore_Clinical_Criteria.md | |
| Meritain | Evicore_Clinical_Criteria.md | [!] Special workflow |
| Meritain Health | Evicore_Clinical_Criteria.md | [!] Special workflow |
| Sierra | Sierra_HPN_Clinical_Criteria.md | |
| Sierra Health | Sierra_HPN_Clinical_Criteria.md | |
| Sierra Health and Life | Sierra_HPN_Clinical_Criteria.md | |
| HPN | Sierra_HPN_Clinical_Criteria.md | |
| Health Plan of Nevada | Sierra_HPN_Clinical_Criteria.md | |
| **HPN Medicaid** | **Sierra_HPN_Clinical_Criteria.md** | [!] Submit via portal, 100% covered |
| UMR (via Sierra) | Sierra_HPN_Clinical_Criteria.md | |
| UHC | UHC_Clinical_Criteria.md | |
| United Healthcare | UHC_Clinical_Criteria.md | |
| UHC Commercial | UHC_Clinical_Criteria.md | |
| UHC Medicare | UHC_Clinical_Criteria.md | |
| UMR (via UHC) | UHC_Clinical_Criteria.md | |
| Medicare | Medicare_FFS_Clinical_Criteria.md | |
| Medicare FFS | Medicare_FFS_Clinical_Criteria.md | |
| Original Medicare | Medicare_FFS_Clinical_Criteria.md | |
| Nevada Medicaid | Nevada_Medicaid_FFS_Clinical_Criteria.md | |
| Nevada Medicaid FFS | Nevada_Medicaid_FFS_Clinical_Criteria.md | |
| **VA** | **NonBCBS_Payer_Knowledge_Base (Section 11)** | [!] Referral = Auth |
| ChampVA | No_Auth_Payers_Clinical_Criteria.md | |
| Silversummit | No_Auth_Payers_Clinical_Criteria.md | |
| Molina | No_Auth_Payers_Clinical_Criteria.md | |
| Molina Medicaid | No_Auth_Payers_Clinical_Criteria.md | |
| Caresource | No_Auth_Payers_Clinical_Criteria.md | |
| Las Vegas Firefighters | No_Auth_Payers_Clinical_Criteria.md | |

---

## [!] SPECIAL ROUTING: VA

**VA is NOT a "no auth" payer.**

```
IF payer == "VA"
   auth_type = "REFERRAL_IS_AUTH"
   
   WORKFLOW:
   1. Patient arrives WITH referral from VA
   2. The referral IS the authorization
   3. a deg CRITICAL: Must schedule within 1 WEEK
      -> If not scheduled in time -> VA cancels the referral/auth
   4. 100% covered -- no patient cost
   5. HST Code: G0399
   
   ROUTING:
   -> Load NonBCBS_Payer_Knowledge_Base.md (Section 11)
   -> Do NOT load No_Auth_Payers_Clinical_Criteria.md
```

---

## [!] SPECIAL ROUTING: HPN Medicaid

**HPN Medicaid is NOT a "no auth" payer.**

```
IF payer == "HPN Medicaid" OR (payer == "HPN" AND plan_type == "Medicaid")
   auth_required = true
   submission_portal = "provider.healthplanofnevada.com"
   
   WORKFLOW:
   1. Same as HPN Commercial -- submit ALL codes through portal
   2. Don't call to verify requirements -- just submit
   3. Can proceed with submission even if notes not yet received
   4. HST Code: 95806 (unless primary uses G0399)
   5. Cost: 100% covered (Medicaid rule)
   
   ROUTING:
   -> Load Sierra_HPN_Clinical_Criteria.md
   -> Do NOT load No_Auth_Payers_Clinical_Criteria.md
```

---

## [!] SPECIAL ROUTING: Anthem Medicaid

**Anthem Medicaid uses Carelon CRITERIA but submits via Availity/Fax (NOT to Carelon portal)**

```
IF payer == "Anthem Medicaid" OR (payer == "Anthem" AND plan_type == "Medicaid")
   
   # Clinical criteria for approval likelihood
   clinical_criteria = "Carelon_Clinical_Criteria.md"
   
   # But workflow/submission follows NonBCBS KB Section 13
   workflow_document = "NonBCBS_Payer_Knowledge_Base.md#section-13"
   
   HST WORKFLOW:
   1. No auth required for HST (G0399)
   2. Schedule directly
   
   IN-LAB WORKFLOW (PSG/Titration):
   1. Auth required
   2. Submit via Availity (preferred) OR Fax
   3. Do NOT submit to Carelon portal
   4. Use Carelon criteria to assess approval likelihood
   5. Cost: 100% covered (Medicaid rule)
   
   ROUTING:
   -> Load Carelon_Clinical_Criteria.md (for clinical review)
   -> Follow NonBCBS_Payer_Knowledge_Base workflow (for submission)
```

---

## UMR Network Detection

UMR requires network identification to route correctly:

```
IF payer == "UMR"
   CHECK benefits/network affiliation
   IF network == "Sierra" OR network == "HPN"
      LOAD Sierra_HPN_Clinical_Criteria.md
   ELSE IF network == "UHC" OR network == "United"
      LOAD UHC_Clinical_Criteria.md
   ELSE
      FLAG_UMR_NETWORK_UNKNOWN
```

---

## Meritain Detection (Aetna Subsidiary) [!]

Meritain plans follow Evicore clinical criteria but have a **different operational workflow**:

```
IF payer == "Meritain" OR (payer == "Aetna" AND elig_returns_meritain)
   FLAG_MERITAIN_WORKFLOW
   
   WORKFLOW:
   1. CALL for benefits (no portal lookup)
   2. Ask if auth required during call
   3. If auth required -> Submit via meritain.mednecessity.com
   
   // Do NOT use standard Aetna/Evicore portal submission
```

**Also Note:** Some Aetna plans require dual submission (Evicore + Availity). See Evicore_Clinical_Criteria.md for details.

---

## Strictness Hierarchy

When in doubt about which criteria to apply:

| Rank | Criteria Level | Payers |
|------|----------------|--------|
| 1 | STRICTEST | Evicore (Cigna, Aetna) |
| 2 | MODERATE | UHC |
| 3 | PROCESS-STRICT | Nevada Medicaid FFS |
| 4 | LENIENT | Sierra/HPN (including HPN Medicaid) |
| 5 | REFERRAL-BASED | VA |
| 6 | NO REVIEW | ChampVA, Anthem/Silversummit/Molina/Caresource Medicaid, LV Firefighters |

---

## System Integration Logic

```python
def get_payer_criteria(payer_name: str, network: str = None, plan_type: str = None) -> dict:
    """
    Returns the appropriate criteria file and any workflow flags.
    
    v2.0 Updates:
    - VA now returns referral-based workflow (not no-auth)
    - HPN Medicaid now routes to Sierra/HPN (not no-auth)
    - Anthem Medicaid now routes to Carelon (not no-auth)
    - Added BCBS Carelon routing
    """
    
    # Normalize payer name
    payer = payer_name.lower().strip()
    
    result = {
        'criteria_file': None,
        'flags': [],
        'auth_type': 'standard'
    }
    
    # ==========================================
    # VA - SPECIAL: Referral = Auth
    # ==========================================
    if payer == 'va' or payer == 'veterans affairs':
        result['criteria_file'] = 'NonBCBS_Payer_Knowledge_Base.md#section-11'
        result['auth_type'] = 'referral_is_auth'
        result['flags'].append('FLAG_VA_REFERRAL_REQUIRED')
        result['flags'].append('FLAG_VA_1_WEEK_SCHEDULING_WINDOW')
        return result
    
    # ==========================================
    # Anthem Medicaid - Uses Carelon CRITERIA but submits via Availity/Fax
    # ==========================================
    if 'anthem' in payer and 'medicaid' in payer:
        result['criteria_file'] = 'Carelon_Clinical_Criteria.md'  # For clinical review
        result['workflow_file'] = 'NonBCBS_Payer_Knowledge_Base.md#section-13'  # For submission
        result['flags'].append('FLAG_ANTHEM_MEDICAID_AVAILITY_OR_FAX')
        result['flags'].append('FLAG_HST_NO_AUTH_INLAB_AUTH')
        result['flags'].append('FLAG_100_PERCENT_COVERED')
        result['submission_method'] = 'availity_or_fax'  # NOT Carelon portal
        return result
    
    # ==========================================
    # HPN Medicaid - Routes to Sierra/HPN (NOT no-auth)
    # ==========================================
    if 'hpn' in payer and 'medicaid' in payer:
        result['criteria_file'] = 'Sierra_HPN_Clinical_Criteria.md'
        result['flags'].append('FLAG_HPN_MEDICAID_SUBMIT_VIA_PORTAL')
        result['flags'].append('FLAG_100_PERCENT_COVERED')
        return result
    
    if 'health plan of nevada' in payer and plan_type and 'medicaid' in plan_type.lower():
        result['criteria_file'] = 'Sierra_HPN_Clinical_Criteria.md'
        result['flags'].append('FLAG_HPN_MEDICAID_SUBMIT_VIA_PORTAL')
        result['flags'].append('FLAG_100_PERCENT_COVERED')
        return result
    
    # ==========================================
    # BCBS Carelon Plans (letter-in-ID)
    # ==========================================
    bcbs_carelon_affiliates = ['bcbs il', 'bcbs tx', 'bcbs ca', 'bcbs va', 'bcbs al',
                               'premera', 'regence', 'independence', 'highmark']
    if any(affiliate in payer for affiliate in bcbs_carelon_affiliates):
        # Check if letter-in-ID (Carelon indicator)
        result['criteria_file'] = 'Carelon_Clinical_Criteria.md'
        result['flags'].append('FLAG_CHECK_LETTER_IN_ID')
        return result
    
    # ==========================================
    # Meritain (Aetna subsidiary) - special workflow
    # ==========================================
    if 'meritain' in payer:
        result['criteria_file'] = 'Evicore_Clinical_Criteria.md'
        result['flags'].append('FLAG_MERITAIN_WORKFLOW')
        return result
    
    # ==========================================
    # Aetna - uses Evicore but may need dual submission
    # ==========================================
    if 'aetna' in payer:
        result['criteria_file'] = 'Evicore_Clinical_Criteria.md'
        result['flags'].append('FLAG_AETNA_CHECK_DUAL_SUBMISSION')
        return result
    
    # ==========================================
    # Cigna - straightforward Evicore
    # ==========================================
    if 'cigna' in payer:
        result['criteria_file'] = 'Evicore_Clinical_Criteria.md'
        return result
    
    # ==========================================
    # UMR - check network
    # ==========================================
    if 'umr' in payer:
        if network and any(x in network.lower() for x in ['sierra', 'hpn']):
            result['criteria_file'] = 'Sierra_HPN_Clinical_Criteria.md'
        else:
            result['criteria_file'] = 'UHC_Clinical_Criteria.md'  # Default UMR to UHC
        return result
    
    # ==========================================
    # Sierra/HPN (Commercial)
    # ==========================================
    if any(x in payer for x in ['sierra', 'hpn', 'health plan of nevada']):
        result['criteria_file'] = 'Sierra_HPN_Clinical_Criteria.md'
        return result
    
    # ==========================================
    # UHC
    # ==========================================
    if any(x in payer for x in ['uhc', 'united']):
        result['criteria_file'] = 'UHC_Clinical_Criteria.md'
        return result
    
    # ==========================================
    # Medicare FFS
    # ==========================================
    if 'medicare' in payer and 'medicaid' not in payer:
        if 'advantage' not in payer:  # FFS only
            result['criteria_file'] = 'Medicare_FFS_Clinical_Criteria.md'
            return result
    
    # ==========================================
    # Nevada Medicaid FFS
    # ==========================================
    if 'nevada' in payer and 'medicaid' in payer:
        result['criteria_file'] = 'Nevada_Medicaid_FFS_Clinical_Criteria.md'
        return result
    
    # ==========================================
    # TRUE No-auth payers (NOT VA, NOT HPN Medicaid, NOT Anthem Medicaid)
    # ==========================================
    no_auth = ['champva', 'silversummit', 'molina', 'caresource', 'firefighter']
    if any(x in payer for x in no_auth):
        result['criteria_file'] = 'No_Auth_Payers_Clinical_Criteria.md'
        result['auth_type'] = 'none'
        return result
    
    # ==========================================
    # Default to Carelon (most BCBS) for unknown payers
    # ==========================================
    result['criteria_file'] = 'Carelon_Clinical_Criteria.md'
    result['flags'].append('FLAG_UNKNOWN_PAYER_USING_DEFAULT')
    return result
```

---

## File Schema

All criteria files follow this structure:

```markdown
# [Payer Name] Clinical Criteria

## Payers Covered
- List of payer names/variants

## KEY CHARACTERISTIC
- Brief summary of this payer's approach

## AUTHORIZATION
- Table of auth requirements by test type

## [TEST TYPE] CRITERIA
- HST, PSG, Titration, Split sections

## DECISION TREE FLAGS
- Specific flags this payer triggers

## QUICK REFERENCE
- Summary table
```

---

## Quick Reference: Auth Types by Payer

| Payer | Auth Type | Key Workflow |
|-------|-----------|--------------|
| VA | **Referral = Auth** | Receive referral from VA, schedule within 1 week |
| HPN Medicaid | **Portal Submission** | Submit via provider.healthplanofnevada.com |
| ChampVA | None | Schedule directly |
| Anthem Medicaid | None | Schedule directly |
| Silversummit | None | Schedule directly |
| Molina | None* | Submit anyway for compliance |
| Caresource | None | Schedule directly |
| LV Firefighters | None | Schedule directly |

---

*Index for MEDOCR v0.16.6*
