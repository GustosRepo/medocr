# MEDOCR: BCBS Three-Tier Lookup + Feedback Loop Architecture
## Addendum to BCBS JSON Schema Design
**Version:** v0.14 Prep * **Date:** February 2026

---

## 1. The Three-Tier Lookup

Instead of a binary "prefix found / not found," every BCBS member ID gets a presumptive answer through a cascading lookup:

```
Tier 1: EXACT PREFIX MATCH     -> Highest confidence -> "Verified"
Tier 2: AFFILIATE DEFAULT      -> Medium confidence  -> "Presumed (affiliate pattern)"
Tier 3: GLOBAL BCBS DEFAULT    -> Lowest confidence  -> "Presumed (general BCBS)"
```

**Every tier produces a usable answer.** The difference is the confidence tag attached to it, which determines whether the referral needs staff sign-off before proceeding.

### How It Works in the Decision Tree

```
Part 1.4: Payer = BCBS -> Extract prefix from member ID
          
Part 1.8A: Look up auth rules:
          
     +--- Tier 1: bcbs_prefix_rules.json["prefixes"][prefix]
     |         Found + verified=true?  -> Use rules. Confidence: VERIFIED
     |         Found + verified=false? -> Use rules. Confidence: LIKELY
     |
     |--- Tier 2: bcbs_prefix_rules.json["affiliate_defaults"][affiliate]
     |         Affiliate identified?   -> Use defaults. Confidence: PRESUMED_AFFILIATE
     |
     +--- Tier 3: bcbs_prefix_rules.json["_default"]
                  Always available     -> Use fallback. Confidence: PRESUMED_GENERAL
```

The affiliate is derived from the `insurance_name` on the member's card (which OCR captures in Part 1.4). So even if prefix "ZZQ" isn't in our database, if the card says "BCBS IL" we can apply BCBS IL's most common pattern.

---

## 2. Affiliate Defaults

Each BCBS affiliate gets a default rule set based on what your team sees most often from that affiliate. Here's the structure with your examples built in:

```json
{
  "affiliate_defaults": {

    "BCBS IL": {
      "most_common_pattern": "MIXED",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": "LIKELY_REQUIRED",
        "95811": "LIKELY_REQUIRED"
      },
      "default_auth_method": "phone_or_carelon",
      "known_variations": [
        "NO_AUTH -- no auth any codes",
        "PHONE -- 95810/95811 call (800)572-3089 or (800)441-9188",
        "CARELON -- all codes through Carelon portal"
      ],
      "resolution_action": "VERIFY_WHICH_VARIANT",
      "resolution_note": "BCBS IL has 3 common patterns. Check prefix or call plan to determine which applies.",
      "auth_phone_options": ["800-572-3089", "800-441-9188"],
      "portal_url": "https://www.bcbsil.com/",
      "stats": {
        "total_known_prefixes": 59,
        "no_auth_count": 20,
        "aim_carelon_count": 25,
        "partial_inlab_count": 14
      }
    },

    "Premera BCBS": {
      "most_common_pattern": "PARTIAL_INLAB_CARELON",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": true,
        "95811": true
      },
      "default_auth_method": "carelon",
      "hst_note": "HST typically no auth -- PRINT CONFIRMATION from portal",
      "hst_action": "PRINT_HST_CONFIRMATION",
      "known_variations": [
        "Standard: No auth HST (print confirmation), in-lab through Carelon",
        "Some prefixes: Referral through premera.com required"
      ],
      "resolution_action": "PROCEED_WITH_DEFAULT",
      "resolution_note": "Most Premera prefixes follow this pattern. Flag if result seems unexpected.",
      "portal_url": "https://www.premera.com/",
      "stats": {
        "total_known_prefixes": 11,
        "no_auth_hst_count": 8,
        "carelon_inlab_count": 9,
        "referral_required_count": 2
      }
    },

    "BCBS TX": {
      "most_common_pattern": "PARTIAL_INLAB_PHONE",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": true,
        "95811": true
      },
      "default_auth_method": "phone",
      "auth_phone_options": ["800-441-9188", "800-572-3089"],
      "known_variations": [
        "PHONE -- 95810/95811 auth call (800)441-9188",
        "PHONE -- 95810/95811 call (800)572-3089",
        "AIM -- some prefixes route through AIM portal",
        "G0399 sometimes noted as no auth separately"
      ],
      "resolution_action": "CALL_PRIMARY_NUMBER",
      "resolution_note": "Default to (800)441-9188 for in-lab auth. HST typically no auth.",
      "portal_url": "https://www.bcbstx.com/",
      "stats": {
        "total_known_prefixes": 42,
        "no_auth_count": 5,
        "phone_auth_count": 28,
        "aim_count": 9
      }
    },

    "BCBS CA": {
      "most_common_pattern": "AIM_PORTAL",
      "default_auth_required": {
        "95806": true,
        "G0399": true,
        "95810": true,
        "95811": true
      },
      "default_auth_method": "aim_portal",
      "known_variations": [
        "AIM PORTAL -- majority of prefixes",
        "NO AUTH -- some prefixes, often with '?' uncertainty",
        "FAX FORM -- a few prefixes require BCBS CA auth form"
      ],
      "resolution_action": "USE_AIM_PORTAL",
      "resolution_note": "Most BCBS CA prefixes go through AIM. Safe default.",
      "portal_chat": true,
      "portal_url": "https://www.anthem.com/ca",
      "stats": {
        "total_known_prefixes": 101,
        "aim_count": 68,
        "no_auth_count": 22,
        "fax_form_count": 5,
        "other_count": 6
      }
    },

    "BCBS NV": {
      "most_common_pattern": "AIM_PORTAL",
      "default_auth_required": {
        "95806": true,
        "G0399": true,
        "95810": true,
        "95811": true
      },
      "default_auth_method": "aim_portal",
      "known_variations": [
        "AIM PORTAL -- most prefixes",
        "SPECIAL FORM -- some union/group plans (Electrical Workers) use Innovative Care Mgmt",
        "CARELON -- some prefixes, Caremore network complications",
        "NEVADA HEALTH SOLUTIONS -- a few prefixes"
      ],
      "resolution_action": "USE_AIM_PORTAL",
      "resolution_note": "Check for union/group plans which may have special auth processes.",
      "portal_chat": true,
      "portal_url": "https://providers.anthem.com/nevada-provider/home",
      "stats": {
        "total_known_prefixes": 32,
        "aim_count": 18,
        "special_process_count": 8,
        "carelon_count": 4,
        "other_count": 2
      }
    },

    "Regence BCBS": {
      "most_common_pattern": "MIXED_CARELON_NO_AUTH",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": "LIKELY_REQUIRED",
        "95811": "LIKELY_REQUIRED"
      },
      "default_auth_method": "carelon",
      "known_variations": [
        "NO AUTH -- several prefixes confirmed no auth",
        "CARELON -- in-lab through Carelon",
        "AIM PORTAL -- some prefixes (with 'Call AIM' note)"
      ],
      "resolution_action": "VERIFY_WHICH_VARIANT",
      "portal_url": "https://www.regence.com/home",
      "states": ["Oregon", "Idaho", "Utah", "Washington"],
      "stats": {
        "total_known_prefixes": 17,
        "no_auth_count": 7,
        "carelon_count": 5,
        "aim_count": 5
      }
    },

    "Highmark BCBS": {
      "most_common_pattern": "PARTIAL_INLAB_FORM",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": true,
        "95811": true
      },
      "default_auth_method": "fax_form",
      "auth_fax": "888-236-6321",
      "known_variations": [
        "FAX FORM -- Highmark outpatient form faxed to NaviNet",
        "PHONE -- 95810/95811 auth required (800)547-3627"
      ],
      "resolution_action": "FAX_HIGHMARK_FORM",
      "portal_url": "https://www.highmarkbcbs.com/home/",
      "stats": {
        "total_known_prefixes": 8,
        "fax_form_count": 5,
        "phone_count": 3
      }
    },

    "Horizon BCBS NJ": {
      "most_common_pattern": "NO_AUTH",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": false,
        "95811": false
      },
      "default_auth_method": null,
      "resolution_action": "PROCEED_WITH_DEFAULT",
      "resolution_note": "Most Horizon NJ prefixes show no auth. Safe default.",
      "portal_url": "https://www.horizonblue.com/",
      "stats": {
        "total_known_prefixes": 8,
        "no_auth_count": 6,
        "other_count": 2
      }
    },

    "BCBS FEP": {
      "most_common_pattern": "PARTIAL_INLAB_FAX",
      "default_auth_required": {
        "95806": false,
        "G0399": false,
        "95810": true,
        "95811": true
      },
      "default_auth_method": "fax_to_bcbs_federal",
      "auth_phone": "800-727-4060",
      "known_variations": [
        "Standard: Auth for in-lab, fax to BCBS Federal"
      ],
      "resolution_action": "PROCEED_WITH_DEFAULT",
      "resolution_note": "FEP is consistent. Single-character prefix 'R'.",
      "special_notes": ["Federal Employee Program -- prefix is single letter 'R'"]
    },

    "_unknown_affiliate": {
      "most_common_pattern": "UNKNOWN",
      "default_auth_required": {
        "95806": "VERIFY",
        "G0399": "VERIFY",
        "95810": "VERIFY",
        "95811": "VERIFY"
      },
      "default_auth_method": null,
      "resolution_action": "CALL_PAYER_TO_VERIFY",
      "resolution_note": "Affiliate not recognized. Call BCBS number on member card."
    }
  }
}
```

---

## 3. Confidence Levels & Staff Workflow

Each lookup result carries a confidence level that maps to a specific staff action:

| Confidence | Source | Staff Action | Can Auto-Proceed? |
|------------|--------|-------------|-------------------|
| `VERIFIED` | Tier 1, verified=true | Trust the result | [OK] Yes |
| `LIKELY` | Tier 1, verified=false (had "?" in spreadsheet) | Glance-review, likely correct | [OK] Yes, with banner |
| `PRESUMED_AFFILIATE` | Tier 2, affiliate default | Review before proceeding | [!] Needs approval |
| `PRESUMED_GENERAL` | Tier 3, global BCBS default | Must verify manually | a No, blocked until verified |

### What the UI Shows

**VERIFIED result:**
```
Auth Status: NOT REQUIRED (HST)  [OK]
Source: BCBS IL prefix "ADE" -- verified 2025
```

**PRESUMED_AFFILIATE result:**
```
Auth Status: LIKELY NOT REQUIRED (HST)  [!] PRESUMED
Source: BCBS IL affiliate default -- prefix "QZZ" not in database
Pattern: BCBS IL most commonly = no auth HST, in-lab varies
+-------------------------------------------------a"
| [!] UNVERIFIED PREFIX                            |
| This prefix hasn't been verified yet.           |
| Proceeding with BCBS IL default rules.          |
|                                                 |
| [[OK] Confirm Correct]  [a Correct This]          |
+-------------------------------------------------+
```

**PRESUMED_GENERAL result:**
```
Auth Status: UNKNOWN  [STOP] VERIFY REQUIRED
Source: Prefix "QZZ" not found, affiliate unknown
+-------------------------------------------------a"
| [STOP] UNVERIFIED -- MANUAL CHECK REQUIRED           |
| Could not determine auth rules for this prefix. |
| Call BCBS at number on member card.              |
|                                                 |
| After verifying, enter rules:                   |
| Auth Required? [Yes/No]  Method: [________]     |
| [ Save & Add to Database]                      |
+-------------------------------------------------+
```

---

## 4. The Feedback Loop Architecture

This is where it gets powerful. Every human interaction with unverified prefixes becomes training data that improves the JSON files automatically.

### 4.1 Feedback Events

There are four types of feedback the system captures:

| Event | Trigger | Data Captured |
|-------|---------|--------------|
| `CONFIRM` | Staff clicks "Confirm Correct" on a presumed result | prefix, affiliate, auth rules (as presumed), timestamp, user |
| `CORRECT` | Staff clicks "Correct This" and enters actual rules | prefix, affiliate, old rules, new rules, timestamp, user |
| `NEW_PREFIX` | Staff enters rules for a totally unknown prefix | prefix, affiliate, auth rules, method, phone, timestamp, user |
| `VERIFY_EXISTING` | Staff re-verifies a previously verified prefix | prefix, old rules, confirmed/updated rules, timestamp, user |

### 4.2 Feedback Data Structure

```json
{
  "_metadata": {
    "description": "Feedback log for BCBS prefix rule corrections and confirmations",
    "created": "2026-02-06"
  },

  "feedback_log": [
    {
      "id": "fb_001",
      "timestamp": "2026-02-10T14:32:00Z",
      "event_type": "CORRECT",
      "user": "staff_jane",
      "prefix": "QZZ",
      "affiliate": "BCBS IL",
      "patient_reference": "REF-2026-0452",

      "presumed_rules": {
        "source": "affiliate_default",
        "confidence": "PRESUMED_AFFILIATE",
        "auth_required": { "95806": false, "95810": "LIKELY_REQUIRED" },
        "auth_method": "phone_or_carelon"
      },

      "actual_rules": {
        "auth_required": { "95806": false, "G0399": false, "95810": true, "95811": true },
        "auth_method": "carelon",
        "auth_phone": null,
        "notes": "Staff confirmed: all in-lab through Carelon, no auth HST"
      },

      "applied_to_json": false,
      "applied_timestamp": null
    },
    {
      "id": "fb_002",
      "timestamp": "2026-02-11T09:15:00Z",
      "event_type": "CONFIRM",
      "user": "staff_mike",
      "prefix": "PAS",
      "affiliate": "BCBS IL",
      "patient_reference": "REF-2026-0461",

      "presumed_rules": {
        "source": "prefix_match",
        "confidence": "LIKELY",
        "auth_required": { "95806": true, "95810": true },
        "auth_method": "aim_portal"
      },

      "actual_rules": null,
      "confirmation_note": "Confirmed AIM portal auth for all codes",

      "applied_to_json": false,
      "applied_timestamp": null
    }
  ]
}
```

### 4.3 The LLM Feedback Processor

Here's where Ollama comes in. Rather than writing rigid scripts to process feedback, the LLM can interpret natural-language corrections and apply them intelligently.

**The feedback processing pipeline:**

```
Step 1: COLLECT    -> Feedback events accumulate in feedback_log.json
Step 2: REVIEW     -> Periodically (daily, or on-demand), process pending feedback
Step 3: LLM APPLY  -> Ollama reads feedback + current JSON + applies changes
Step 4: VALIDATE   -> Human reviews proposed changes before they go live
Step 5: COMMIT     -> Approved changes update bcbs_prefix_rules.json
```

**Why use the LLM for this instead of simple scripts:**

- Staff corrections are often natural language: "actually this one goes through Carelon not AIM"
- The LLM can detect PATTERNS across feedback: "3 different QZ* prefixes for BCBS IL all came back as Carelon -> maybe update the BCBS IL affiliate default"
- The LLM can flag CONFLICTS: "Staff Jane said no auth but Staff Mike said AIM -- needs resolution"
- The LLM can update affiliate-level stats: if 5 new BCBS IL prefixes are confirmed as Carelon, the affiliate `stats` and `most_common_pattern` should shift

**Prompt template for the LLM feedback processor:**

```
You are the MEDOCR data maintenance assistant. You have two inputs:

1. CURRENT DATA: The current bcbs_prefix_rules.json file
2. PENDING FEEDBACK: New feedback events from staff

Your job:
- For each CONFIRM event: Set the prefix's verified=true, verified_year=2026
- For each CORRECT event: Update the prefix entry with the actual_rules provided
- For each NEW_PREFIX event: Create a new prefix entry from the provided data
- After all individual updates, recalculate affiliate_defaults.stats counts
- If a pattern shift is detected (e.g., an affiliate's most_common_pattern should change),
  flag it for human review

Output: The updated JSON with a changelog summary.

RULES:
- Never delete existing verified entries
- If a correction contradicts a previously verified entry, FLAG it -- don't auto-overwrite
- Track the feedback source for audit trail
- Confidence escalation: 1 CONFIRM -> LIKELY, 2+ CONFIRMs from different patients -> VERIFIED
```

### 4.4 Confidence Escalation Rules

Feedback accumulates confidence over time:

```
NEW prefix (no data)                          -> UNVERIFIED
  + 1 staff correction (single encounter)     -> LIKELY
  + 2 staff confirmations (different patients) -> VERIFIED
  + 1 contradiction                            -> CONFLICT (flag for review)

PRESUMED_AFFILIATE prefix
  + 1 staff CONFIRM                            -> LIKELY
  + 1 staff CORRECT (different from default)   -> LIKELY (with corrected rules)
  + 2 staff CONFIRMs                           -> VERIFIED

LIKELY prefix
  + 1 more CONFIRM                             -> VERIFIED
  + 1 CORRECT (contradicts)                    -> CONFLICT
```

### 4.5 Affiliate Default Learning

The LLM can also update affiliate defaults based on accumulated feedback:

```
Current: BCBS IL most_common_pattern = "MIXED"
         stats: { no_auth: 20, aim_carelon: 25, partial_inlab: 14 }

After 10 new prefix feedbacks:
  - 7 came back as Carelon
  - 2 came back as no auth
  - 1 came back as phone auth

Updated stats: { no_auth: 22, aim_carelon: 32, partial_inlab: 15 }

LLM observes: Carelon is now dominant (46% of known prefixes)
LLM proposes: Change most_common_pattern to "AIM_CARELON"
              and update default_auth_method to "carelon"

-> Flagged for human approval before applying
```

---

## 5. File Structure (Updated)

```
json/
|-- auth_requirements.json          a+ All payers (non-BCBS + BCBS fallback)
|-- bcbs_prefix_rules.json          a+ Three-tier BCBS lookup
|     |-- _metadata                    Version, counts, source
|     |-- _default                     Tier 3: Global BCBS fallback
|     |-- affiliate_defaults           Tier 2: Per-affiliate patterns
|     |     |-- "BCBS IL"
|     |     |-- "Premera BCBS"
|     |     |-- "BCBS TX"
|     |     +-- ... (~30 affiliates)
|     +-- prefixes                     Tier 1: Exact prefix entries
|           |-- "A6Z"
|           |-- "AEV"
|           +-- ... (~647 entries)
|-- bcbs_feedback_log.json          a+ Pending feedback events
+-- bcbs_feedback_archive.json      a+ Applied feedback (audit trail)
```

---

## 6. Decision Tree Update: Part 1.8A (Revised)

```
Part 1.8A: Auth Required?
  |
  |-- payer != BCBS
  |     -> auth_requirements.json[payer].auth_required[cpt_final]
  |     -> Confidence: VERIFIED (all non-BCBS payers are manually maintained)
  |
  +-- payer == BCBS
        -> Extract prefix from member_id (first 3 chars)
        -> Identify affiliate from insurance_name (OCR/Part 1.4)
        |
        |-- Tier 1: prefix in bcbs_prefix_rules.prefixes?
        |     |-- YES + verified=true    -> Use rules. VERIFIED.
        |     +-- YES + verified=false   -> Use rules. LIKELY.
        |               +-- Attach: "[!] Prefix rules not fully verified"
        |
        |-- Tier 2: affiliate in bcbs_prefix_rules.affiliate_defaults?
        |     +-- YES -> Use affiliate defaults. PRESUMED_AFFILIATE.
        |               |-- resolution_action = "PROCEED_WITH_DEFAULT"?
        |               |     -> Proceed but flag for end-of-process approval
        |               +-- resolution_action = "VERIFY_WHICH_VARIANT"?
        |                     -> Flag: multiple variants exist, staff should verify
        |
        +-- Tier 3: _default
              -> PRESUMED_GENERAL. Flag: CALL_PAYER_TO_VERIFY
              -> Cannot auto-proceed. BLOCKED until staff verifies.
        |
        
   Attach feedback prompt to output:
   [[OK] Confirm] [a Correct] [" Add Notes]
        |
        
   On staff response -> Write to bcbs_feedback_log.json
```

---

## 7. Output Examples with Feedback Prompts

### Example 1: Verified Prefix (No Feedback Needed)

```
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
MODULE 1 OUTPUT:
  CPT Final:        95806 (HST)
  Payer:            BCBS IL -- Prefix ADE
  Auth Status:      [OK] NOT REQUIRED
  Auth Source:       Verified prefix rule (2025)
  Confidence:       ########## VERIFIED
  Ready Status:     [OK] READY
  Next Action:      Schedule patient for HST
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
```

### Example 2: Affiliate Default (Feedback Requested)

```
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
MODULE 1 OUTPUT:
  CPT Final:        95810 (PSG In-Lab)
  Payer:            Premera BCBS -- Prefix XYZ
  Auth Status:      [!] REQUIRED (Presumed -- Carelon)
  Auth Source:      Premera BCBS affiliate default
  Confidence:       ######---- PRESUMED_AFFILIATE
  Ready Status:     [!] PENDING APPROVAL
  Next Action:      Submit auth via Carelon (presumed)

  +---------------------------------------------a"
  | [!]  PREFIX NOT VERIFIED                     |
  | Using Premera BCBS default rules.           |
  | Most Premera = no auth HST, Carelon in-lab  |
  |                                             |
  | [[OK] Confirm]  [a Correct]  [" Notes]       |
  +---------------------------------------------+
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
```

### Example 3: Unknown Everything (Blocked)

```
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
MODULE 1 OUTPUT:
  CPT Final:        95806 (HST) -- tentative
  Payer:            BCBS -- Prefix ZQX
  Auth Status:      [STOP] UNKNOWN -- VERIFY REQUIRED
  Auth Source:      No prefix or affiliate match
  Confidence:       ##-------- PRESUMED_GENERAL
  Ready Status:     [STOP] BLOCKED
  Next Action:      Call BCBS at number on member card

  +---------------------------------------------a"
  | [STOP]  MANUAL VERIFICATION REQUIRED            |
  | Prefix ZQX not in database.                 |
  | Affiliate could not be determined.          |
  |                                             |
  | After calling, enter auth rules:            |
  | Affiliate:  [____________]                  |
  | HST Auth?:  [Yes / No]                      |
  | Lab Auth?:  [Yes / No]                      |
  | Method:     [AIM / Phone / Fax / None]      |
  | Phone:      [____________]                  |
  |                                             |
  | [ Save to Database]                        |
  +---------------------------------------------+
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
```

---

## 8. LLM Feedback Processing Flow

### Nightly Batch (or On-Demand)

```
+------------------a"     +------------------a"     +------------------a"
|  Feedback Log    |----->|  Ollama LLM      |----->|  Proposed        |
|  (pending items) |     |  Processor       |     |  Changes         |
+------------------+     +------------------+     +------------------+
                                                          |
                                                          v
                                                  +------------------a"
                                                  |  Human Review    |
                                                  |  Dashboard       |
                                                  +------------------+
                                                          |
                                                    +-----+-----a"
                                                    v           v
                                              [Approve]   [Reject/Edit]
                                                    |           |
                                                    v           v
                                            +------------a"  +--------a"
                                            | Update JSON |  | Return |
                                            | + Archive   |  | to LLM |
                                            +------------+  +--------+
```

### What the LLM Does During Processing

```
INPUT:
  - bcbs_prefix_rules.json (current)
  - bcbs_feedback_log.json (pending events)

OPERATIONS:
  1. Group feedback by prefix
  2. For each prefix:
     a. CONFIRM events -> increment confirmation_count
        - If count >= 2 different patients -> set verified=true
     b. CORRECT events -> propose rule update
        - Compare to current rules
        - If conflict with verified data -> FLAG, don't overwrite
     c. NEW_PREFIX events -> propose new entry
        - Match to nearest affiliate
        - Set verified=false, confidence=LIKELY

  3. Recalculate affiliate_defaults.stats
     - Count by auth_category for each affiliate
     - If dominant pattern shifted -> propose default update

  4. Detect cross-prefix patterns
     - "5 new prefixes starting with QZ all confirmed as Carelon"
     - Propose: "QZ* prefixes for BCBS IL may default to Carelon"

OUTPUT:
  - Updated bcbs_prefix_rules.json (proposed)
  - Changelog with reasoning
  - Conflicts/flags for human review
  - Affiliate default updates (if any)
```

### Sample LLM Changelog Output

```
a*a*a* BCBS Prefix Rules Update -- 2026-02-15 a*a*a*

APPLIED (3 changes):
  [OK] Prefix QZZ (BCBS IL): NEW -> Carelon all in-lab, no auth HST
     Source: Staff correction fb_001 (Jane, REF-2026-0452)

  [OK] Prefix PAS (BCBS IL): LIKELY -> VERIFIED
     Source: 2 confirmations (fb_002 Mike, fb_007 Jane) across 2 patients

  [OK] Prefix WQR (Premera): NEW -> Carelon in-lab, confirmed HST no auth
     Source: Staff new entry fb_004 (Mike, REF-2026-0488)

AFFILIATE UPDATES (1 proposed):
  [!] BCBS IL stats updated:
     aim_carelon_count: 25 -> 27
     Carelon now 39% of known prefixes (was 36%)
     most_common_pattern remains "MIXED" (no change needed yet)

FLAGS (1 conflict):
  [STOP] Prefix ADE (BCBS IL):
     Currently: VERIFIED as "Auth: AIM Portal" (2025)
     New feedback fb_009: Staff says "no auth any codes"
     -> CONFLICT: Verified entry contradicts new feedback
     -> Requires manual resolution

STATS:
  Pending feedback processed: 9
  Applied: 3 prefix updates
  Escalated to VERIFIED: 1
  New prefixes added: 2
  Conflicts flagged: 1
  Affiliate defaults updated: 0 (1 proposed, needs approval)
a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
```

---

## 9. Implementation Priority

| Phase | What | Effort |
|-------|------|--------|
| **Phase 1** | Build `bcbs_prefix_rules.json` with Tiers 1-3, convert spreadsheet | This session |
| **Phase 2** | Build affiliate defaults from spreadsheet pattern analysis | This session |
| **Phase 3** | Add confidence levels to Part 1.8 decision tree output | Next session |
| **Phase 4** | Build `bcbs_feedback_log.json` schema + UI feedback buttons | With frontend |
| **Phase 5** | Build LLM feedback processor (Ollama prompt + script) | After Phase 4 |
| **Phase 6** | Human review dashboard for approving changes | After Phase 5 |

---

## 10. Key Design Decisions to Confirm

1. **Confidence threshold for auto-proceed:** Should PRESUMED_AFFILIATE auto-proceed (with flag) or block? I've set it as "needs approval" -- your call.

2. **Feedback granularity:** Log per-referral (every time a prefix is used) or only on corrections/new entries?

3. **LLM processing frequency:** Nightly batch, on-demand, or real-time per correction?

4. **Affiliate default authority:** When the LLM proposes an affiliate default change, how many confirmations should be required before auto-applying?

5. **Conflict resolution:** When verified data conflicts with new feedback, who resolves -- you, any staff member, or designated admin only?
