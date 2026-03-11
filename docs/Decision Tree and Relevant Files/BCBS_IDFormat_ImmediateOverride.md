# MEDOCR: ID Format Intelligence Layer + Immediate Override
## Architecture Update -- Addendum #2
**Version:** v0.14 Prep * **Date:** February 2026

---

## 1. The Discovery: ID Format as a Routing Signal

The member ID isn't just a lookup key for the prefix -- the **structure of the characters after the prefix** tells you which auth pathway to use and which verification tools are available.

### The Two ID Format Families

**Format A: Prefix + All Numeric**
```
Example:  ADE 123456789
Pattern:  [A-Z]{3} \d{6,}
Signal:   NOT Carelon pathway
Tools:    Manual verification required (call, payer-specific portal)
          Chat functions typically do NOT work for these
```

**Format B: Prefix + Alpha-Numeric Mix**
```
Example:  ADE 123A12345
Pattern:  [A-Z]{3} \d{3}[A-Z]\d{5}   (or similar mixed patterns)
Signal:   Usually Carelon or No Auth
Tools:    Chat functions typically WORK
          Result is usually one of: No Auth Required, or Carelon
```

**Why this matters for the decision tree:**

The ID format tells you TWO things simultaneously:
1. **Which auth pathway is likely** (Carelon vs. phone vs. other)
2. **Which verification tools are available** (chat vs. call vs. portal)

This means Part 1.4 should be parsing the full member ID -- not just extracting the prefix, but also classifying the ID format. That classification then informs both Part 1.8 (auth rules) and the staff's available verification methods.

---

## 2. ID Format Classification Schema

This gets added to `bcbs_prefix_rules.json` as a new top-level section:

```json
{
  "id_format_patterns": {

    "_description": "BCBS member ID format patterns that provide routing signals beyond the prefix. The format of the ID body (characters after the 3-letter prefix) correlates with auth pathways and available verification tools.",

    "FORMAT_A": {
      "name": "Numeric Body",
      "regex": "^[A-Z]{1,5}\\d{6,}$",
      "description": "Prefix followed by all numeric digits (6+ digits)",
      "examples": ["ADE123456789", "PAS1234567890", "R1234567890"],
      "signals": {
        "likely_carelon": false,
        "chat_verification_available": false,
        "typical_auth_pathways": ["phone_call", "payer_portal", "fax_form"],
        "requires_manual_verification": true
      },
      "staff_guidance": "All-numeric IDs typically cannot be verified through chat. Call the payer or use their specific portal/form process.",
      "affiliates_where_observed": ["BCBS TX", "BCBS IL", "BCBS CA", "Highmark BCBS"]
    },

    "FORMAT_B": {
      "name": "Alpha-Numeric Body",
      "regex": "^[A-Z]{1,5}\\d{1,4}[A-Z]\\d{3,}$",
      "description": "Prefix followed by mixed alpha-numeric (letter embedded in digit string)",
      "examples": ["ADE123A12345", "PAS456B78901", "XDJ12C3456"],
      "signals": {
        "likely_carelon": true,
        "chat_verification_available": true,
        "typical_auth_pathways": ["carelon", "no_auth"],
        "requires_manual_verification": false
      },
      "staff_guidance": "Mixed alpha-numeric IDs are usually checkable via chat. Expect either 'No Auth Required' or 'Carelon' as the answer.",
      "affiliates_where_observed": ["BCBS TX", "BCBS IL", "BCBS CA", "BCBS NV", "Regence BCBS"]
    },

    "FORMAT_C": {
      "name": "Extended Numeric",
      "regex": "^[A-Z]{1,5}\\d{10,}$",
      "description": "Prefix followed by unusually long numeric string (10+ digits beyond prefix)",
      "examples": ["ADE12345678901234"],
      "signals": {
        "likely_carelon": false,
        "chat_verification_available": false,
        "typical_auth_pathways": ["phone_call"],
        "requires_manual_verification": true
      },
      "staff_guidance": "Extended numeric IDs are unusual. Likely a special plan. Call to verify.",
      "affiliates_where_observed": []
    },

    "FORMAT_FEP": {
      "name": "Federal Employee Program",
      "regex": "^R\\d{8,}$",
      "description": "Single-letter 'R' prefix followed by digits -- BCBS Federal Employee Program",
      "examples": ["R123456789"],
      "signals": {
        "likely_carelon": false,
        "chat_verification_available": false,
        "typical_auth_pathways": ["fax_to_bcbs_federal"],
        "requires_manual_verification": false
      },
      "staff_guidance": "FEP is consistent: HST no auth, in-lab fax to BCBS Federal.",
      "affiliates_where_observed": ["BCBS FEP"]
    },

    "FORMAT_UNKNOWN": {
      "name": "Unrecognized Format",
      "regex": null,
      "description": "ID format doesn't match any known pattern",
      "signals": {
        "likely_carelon": null,
        "chat_verification_available": null,
        "typical_auth_pathways": ["phone_call"],
        "requires_manual_verification": true
      },
      "staff_guidance": "Unrecognized ID format. Call payer to verify all auth requirements."
    }
  }
}
```

### How Format Interacts with the Three Tiers

The ID format acts as a **modifier** on top of the tier lookup -- it doesn't replace it, it refines it:

```
Tier 1 result (exact prefix, VERIFIED) + Format B
  -> "This prefix is verified as Carelon. ID format confirms: Carelon likely. High confidence."

Tier 1 result (exact prefix, VERIFIED) + Format A
  -> "This prefix is verified as Carelon, BUT ID format suggests non-Carelon path.
     [!] FORMAT MISMATCH -- verify before proceeding."

Tier 2 result (affiliate default) + Format B
  -> "Affiliate default says Carelon. ID format agrees. Proceed with presumed Carelon."

Tier 2 result (affiliate default) + Format A
  -> "Affiliate default says Carelon, but ID format suggests otherwise.
     Recommend: call to verify. Chat will likely not work for this ID."

Tier 3 (unknown) + Format B
  -> "Unknown prefix, but ID format suggests Carelon/no-auth. Try chat first."

Tier 3 (unknown) + Format A
  -> "Unknown prefix, ID format suggests manual path. Call payer."
```

---

## 3. Updated Lookup Flow: Four Signals

Part 1.4 now extracts FOUR pieces of intelligence from a BCBS member ID:

```
Member ID: "ADE123A12345"
            |  |         |
            |  |         +-- Signal 4: ID BODY -> Format B (alpha-numeric)
            |  |                       -> Chat available, likely Carelon
            |  |
            |  +-- Signal 3: FULL ID -> Length/structure anomalies
            |                         -> Normal length, no flags
            |
            +-- Signal 1+2: PREFIX "ADE" -> Tier 1 lookup
                            + AFFILIATE "BCBS IL" from card -> Tier 2 fallback
```

### Updated Part 1.4 Output (Insurance Validation)

```json
{
  "payer": "BCBS IL",
  "member_id": "ADE123A12345",
  "bcbs_data": {
    "prefix": "ADE",
    "prefix_tier": 1,
    "prefix_confidence": "VERIFIED",
    "affiliate": "BCBS IL",
    "id_format": "FORMAT_B",
    "id_format_signals": {
      "likely_carelon": true,
      "chat_verification_available": true,
      "requires_manual_verification": false
    },
    "format_agrees_with_prefix_rules": true
  }
}
```

This enriched output flows into Part 1.8 where the auth determination now has both the prefix rules AND the format intelligence.

---

## 4. Format Mismatch Detection

When the ID format contradicts the prefix rules, that's a signal worth flagging:

| Prefix Rule | ID Format | Agreement | Action |
|-------------|-----------|-----------|--------|
| Carelon | Format B (alpha-numeric) | [OK] Agree | Proceed confidently |
| Carelon | Format A (all numeric) | a Mismatch | Flag: "Prefix says Carelon but ID format suggests otherwise" |
| Phone auth | Format A (all numeric) | [OK] Agree | Proceed, call the number |
| Phone auth | Format B (alpha-numeric) | [!] Soft mismatch | "Prefix says call, but this ID type is usually chat-checkable -- try chat first?" |
| No auth | Either format | [OK] N/A | No auth regardless of format |
| AIM Portal | Format B | [OK] Agree | AIM portal works for these |
| AIM Portal | Format A | [!] Possible | AIM may still work, but verify |

### New Flag

```
FLAG_FORMAT_MISMATCH
  Trigger: ID format signals contradict prefix/affiliate rules
  Severity: WARNING (not blocking)
  Action: "ID format doesn't match expected pattern for this prefix's rules.
           Recommend verifying before proceeding."
```

---

## 5. Immediate Override for Verified Prefixes

You're right that VERIFIED shouldn't mean "locked forever." Guidelines change, plans restructure, Carelon replaces AIM, etc. The periodic batch process handles gradual drift, but you need a **hot override** for when you know right now that a verified rule is wrong.

### Override Types

| Type | When | How | Effect |
|------|------|-----|--------|
| **Periodic batch** | Nightly/weekly | LLM processes accumulated feedback log | Updates LIKELY/UNVERIFIED prefixes, proposes changes to VERIFIED |
| **Immediate override** | Right now, mid-referral | Staff clicks "[!] Override Verified Rule" | Instantly updates the prefix + logs the change |

### Immediate Override Flow

```
Staff is processing referral for prefix "ADE" (VERIFIED as AIM Portal)
Staff knows AIM Portal is WRONG -- guideline changed last week
  
Staff clicks: [[!] Override Verified Rule]
  
UI presents:
  +--------------------------------------------------a"
  | [!] IMMEDIATE OVERRIDE -- Prefix ADE (BCBS IL)     |
  |                                                  |
  | Current verified rule:                           |
  |   Auth: AIM Portal (all codes)                   |
  |   Verified: 2025                                 |
  |                                                  |
  | What changed?                                    |
  | HST (95806/G0399):  [No Auth v]                  |
  | In-Lab (95810/95811): [Carelon v]                |
  | Auth Phone:  [____________]                      |
  |                                                  |
  | Reason: [Guideline changed -- AIM replaced by___] |
  |         [Carelon effective Feb 2026            _] |
  |                                                  |
  | Apply to:                                        |
  | [x] This prefix only (ADE)                         |
  | a All BCBS IL prefixes with same old rule        |
  | a Update BCBS IL affiliate default               |
  |                                                  |
  | [[!] Apply Immediately]  [Cancel]                  |
  +--------------------------------------------------+
  
On submit:
  1. bcbs_prefix_rules.json["prefixes"]["ADE"] updated INSTANTLY
  2. verified_year updated to 2026
  3. Override logged to bcbs_feedback_log.json as event type "IMMEDIATE_OVERRIDE"
  4. If "all same rule" checked -> queue batch update for matching prefixes
  5. If "update affiliate default" checked -> queue for LLM processing + approval
  6. Current referral re-evaluated with new rules
```

### Override Feedback Event

```json
{
  "id": "fb_override_001",
  "timestamp": "2026-02-10T14:32:00Z",
  "event_type": "IMMEDIATE_OVERRIDE",
  "user": "staff_owner",
  "prefix": "ADE",
  "affiliate": "BCBS IL",
  "patient_reference": "REF-2026-0503",

  "previous_rules": {
    "auth_category": "AIM_PORTAL",
    "auth_required": { "95806": true, "G0399": true, "95810": true, "95811": true },
    "auth_method": "aim_portal",
    "verified": true,
    "verified_year": 2025
  },

  "new_rules": {
    "auth_category": "PARTIAL_INLAB_ONLY",
    "auth_required": { "95806": false, "G0399": false, "95810": true, "95811": true },
    "auth_method": "carelon",
    "verified": true,
    "verified_year": 2026
  },

  "reason": "Guideline changed -- AIM replaced by Carelon effective Feb 2026",
  "scope": "this_prefix_only",
  "cascade_requested": false,

  "applied_to_json": true,
  "applied_timestamp": "2026-02-10T14:32:01Z"
}
```

### Cascade Override: "Apply to All Similar"

When a guideline changes for an entire affiliate (e.g., "BCBS IL moved everything from AIM to Carelon"), the override UI lets you check "All BCBS IL prefixes with same old rule." This triggers:

```
1. Find all prefixes where:
   - affiliate = "BCBS IL"
   - auth_method = "aim_portal" (the OLD rule)
   
2. For each matching prefix:
   - Queue an update (NOT instant -- these go through the LLM batch)
   - Mark as "OVERRIDE_PENDING"
   
3. LLM batch processes the cascade:
   - Applies the same rule change to all matching prefixes
   - Flags any that have special notes or exceptions
   - Updates affiliate default stats
   - Outputs changelog for human review

4. Human approves the batch -> all matching prefixes updated
```

This way, you can fix one prefix immediately for the referral in front of you, AND kick off the broader update without having to manually fix every prefix.

---

## 6. Verification Tools Mapping

The ID format intelligence connects to a new concept: **which tools are available for which ID types.** This lives in `payer_verification.json` (which was already marked as NEEDED in the Master Assumptions) but now gets a BCBS-specific section:

```json
{
  "payers": {
    "BCBS": {
      "verification_tools": {

        "chat": {
          "available_for_formats": ["FORMAT_B"],
          "not_available_for_formats": ["FORMAT_A", "FORMAT_C"],
          "typical_outcomes": ["NO_AUTH", "CARELON"],
          "platforms": ["Provider portal chat", "Availity chat"],
          "response_time": "immediate",
          "notes": "Alpha-numeric IDs can usually be checked via chat. Expect a quick answer."
        },

        "phone": {
          "available_for_formats": ["FORMAT_A", "FORMAT_B", "FORMAT_C", "FORMAT_UNKNOWN"],
          "typical_outcomes": ["any"],
          "common_numbers": {
            "BCBS IL": ["800-572-3089", "800-441-9188", "844-462-7812"],
            "BCBS TX": ["800-441-9188", "800-572-3089"],
            "BCBS CA": ["varies by prefix"],
            "Highmark BCBS": ["800-547-3627"],
            "BCBS FEP": ["800-727-4060"]
          },
          "response_time": "5-30 minutes (hold times vary)",
          "notes": "Universal fallback. Required for all-numeric IDs that can't use chat."
        },

        "aim_carelon_portal": {
          "available_for_formats": ["FORMAT_B"],
          "sometimes_available_for": ["FORMAT_A"],
          "platform_url": "https://providerportal.carelon.com",
          "response_time": "immediate to 24 hours",
          "notes": "Submit auth directly. Most effective for alpha-numeric IDs."
        },

        "fax_form": {
          "available_for_formats": ["FORMAT_A", "FORMAT_B"],
          "typical_affiliates": ["Highmark BCBS", "BCBS FEP", "BCBS AZ"],
          "response_time": "24-72 hours",
          "notes": "Some affiliates require specific forms. Check prefix rules for fax number."
        },

        "availity": {
          "available_for_formats": ["FORMAT_A", "FORMAT_B"],
          "platform_url": "https://www.availity.com",
          "typical_affiliates": ["BCBS TN", "Wellmark BCBS"],
          "response_time": "immediate",
          "notes": "Some affiliates route auth through Availity instead of AIM/Carelon."
        },

        "payer_specific_portal": {
          "available_for_formats": ["FORMAT_A", "FORMAT_B"],
          "portals": {
            "BCBS AZ": "https://www.azblue.com",
            "Premera BCBS": "https://www.premera.com"
          },
          "response_time": "varies",
          "notes": "Some affiliates have their own portals. Check prefix rules."
        }
      },

      "tool_selection_logic": {
        "step_1": "Determine ID format (A, B, C, FEP, Unknown)",
        "step_2": "Check prefix rules for specific auth_method",
        "step_3": "If prefix unknown, use ID format to determine available tools",
        "step_4": "Recommend best available tool based on format + affiliate",
        "priority_order": [
          "Use prefix-specific method if verified",
          "Format B -> try chat first (fastest)",
          "Format B -> if chat says Carelon, use Carelon portal",
          "Format A -> check if affiliate has specific portal",
          "Format A -> call the affiliate's auth phone number",
          "Unknown -> call the number on the member card"
        ]
      }
    }
  }
}
```

---

## 7. Revised Complete Lookup Flow

Here's the full picture -- all four signals combined:

```
PART 1.4: BCBS Member ID captured: "ADE123A12345"
  |
  |-- Extract prefix: "ADE"
  |-- Classify format: FORMAT_B (alpha-numeric)
  |-- Identify affiliate: "BCBS IL" (from insurance card)
  |
  v
PART 1.8A: Auth Determination
  |
  |-- TIER 1: Prefix "ADE" found in bcbs_prefix_rules.prefixes?
  |     YES -> Rules say: AIM Portal, all codes
  |     Verified: YES (2025)
  |     Confidence: VERIFIED
  |
  |-- FORMAT CHECK: Does Format B agree with AIM Portal?
  |     AIM Portal + Format B -> [OK] Agreement
  |     (Format B IDs work with AIM/Carelon portals)
  |
  |-- TOOLS AVAILABLE: Format B -> chat available, portal available
  |
  +-- OUTPUT:
        Auth: AIM Portal (all codes)
        Confidence: VERIFIED
        Format: B (alpha-numeric) -- agrees with rules
        Tools: Chat [OK] | Portal [OK] | Phone [OK]
        +---------------------------------a"
        | [[OK] Confirm] [[!] Override]       |
        +---------------------------------+

ALTERNATE SCENARIO: Same prefix "ADE" but ID is "ADE123456789"
  |
  |-- FORMAT CHECK: Format A (all numeric) vs AIM Portal rule
  |     [!] SOFT MISMATCH: All-numeric IDs often don't go through AIM
  |
  +-- OUTPUT:
        Auth: AIM Portal (verified rule) [!] FORMAT MISMATCH
        Confidence: VERIFIED (but flagged)
        Format: A (all numeric) -- unusual for AIM pathway
        Tools: Chat a | Portal [!] | Phone [OK]
        Staff Note: "Verified prefix says AIM, but all-numeric IDs
                     sometimes route differently. Try portal first;
                     if rejected, call (800-572-3089)."
        +---------------------------------a"
        | [[OK] Confirm] [[!] Override]       |
        +---------------------------------+
```

---

## 8. Feedback Loop Summary (All Five Event Types)

| Event Type | Trigger | Applies To | Timing | JSON Updated |
|------------|---------|------------|--------|-------------|
| `CONFIRM` | Staff confirms a presumed/likely result was correct | LIKELY -> VERIFIED escalation | Batched | bcbs_prefix_rules |
| `CORRECT` | Staff corrects a wrong presumed/likely result | New or updated prefix entry | Batched | bcbs_prefix_rules |
| `NEW_PREFIX` | Staff enters rules for unknown prefix | New prefix entry | Batched | bcbs_prefix_rules |
| `IMMEDIATE_OVERRIDE` | Staff overrides a VERIFIED rule that changed | Prefix updated instantly | **Instant** | bcbs_prefix_rules |
| `CASCADE_OVERRIDE` | Staff requests same change for all matching prefixes | Multiple prefixes queued | Batched + approval | bcbs_prefix_rules + affiliate_defaults |

### The LLM's Role in Each

| Event | LLM Role |
|-------|----------|
| `CONFIRM` | Simple: increment count, check if threshold met for VERIFIED escalation |
| `CORRECT` | Moderate: parse correction, update prefix, check for pattern across similar prefixes |
| `NEW_PREFIX` | Moderate: create structured entry from staff input, match to affiliate, set initial confidence |
| `IMMEDIATE_OVERRIDE` | None (bypass): goes straight to JSON. LLM processes the log entry AFTER for pattern detection |
| `CASCADE_OVERRIDE` | Heavy: find all matching prefixes, apply changes, flag exceptions, update affiliate stats, generate changelog |

---

## 9. Updated File Structure

```
json/
|-- auth_requirements.json              a+ All payers (non-BCBS + BCBS fallback)
|-- bcbs_prefix_rules.json              a+ Three-tier lookup + ID format patterns
|     |-- _metadata
|     |-- _default                         Tier 3: Global BCBS fallback
|     |-- id_format_patterns               ID body format classification
|     |     |-- FORMAT_A (numeric)
|     |     |-- FORMAT_B (alpha-numeric)
|     |     |-- FORMAT_C (extended)
|     |     |-- FORMAT_FEP
|     |     +-- FORMAT_UNKNOWN
|     |-- affiliate_defaults               Tier 2: Per-affiliate patterns
|     |     |-- "BCBS IL"
|     |     |-- "Premera BCBS"
|     |     +-- ...
|     +-- prefixes                         Tier 1: Exact prefix entries
|           |-- "ADE"
|           +-- ...
|-- payer_verification.json             a+ Verification tools by payer + format
|     +-- BCBS.verification_tools          Chat/phone/portal availability by format
|-- bcbs_feedback_log.json              a+ Pending feedback (all 5 event types)
+-- bcbs_feedback_archive.json          a+ Applied feedback (audit trail)
```

---

## 10. Design Decisions Updated

Based on your input, here's where we've landed:

| Decision | Resolution |
|----------|-----------|
| VERIFIED prefixes: locked or updatable? | **Updatable via Immediate Override** -- always available, bypasses batch |
| Cascade updates? | **Yes** -- option to apply override to all matching prefixes (batched + approval) |
| ID format as routing signal? | **Yes** -- new classification layer, Format A/B/C/FEP/Unknown |
| Format mismatch handling? | **Soft flag** -- warning, not blocking. Staff decides. |
| Tool availability mapping? | **Yes** -- tied to ID format. Chat only for Format B. |
| Feedback loop for VERIFIED? | **Two paths**: Immediate Override (instant) + periodic batch (for pattern detection) |

### Still Open

1. **Format regex refinement:** I've made initial guesses at the patterns. We should validate these against a sample of your actual member IDs to get the regexes right. Can you share a few anonymized examples of each format type?

2. **Chat platform specifics:** When you say "chat functions" -- is this the BCBS provider portal chat specifically, Availity, or multiple platforms? Need to know which to map into the tools.

3. **Affiliate identification from card:** How reliably does OCR capture the specific BCBS affiliate name (vs. just "BCBS")? This affects Tier 2 fallback reliability.
