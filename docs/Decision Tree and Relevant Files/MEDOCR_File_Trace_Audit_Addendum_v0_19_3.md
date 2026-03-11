# MEDOCR Decision Tree — File-Trace Audit Addendum
## v0.19.3 | February 27, 2026
### Covers: Findings #11-#13 (post v0.19.2 trace)
### Status: ALL 6 FINDINGS FIXED in `MEDOCR_Unified_Decision_Tree_v0_19_3.mermaid`

---

## CHANGES APPLIED (1,365 → 1,394 lines)

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| #11 Split payment bypass | 🔴 CRITICAL | Removed duplicate `M4_SPLIT_SELECT_SPLIT → M4_SPLIT_RETURN` (line 901). Only path now: `→ M4_SPLIT_PAY` payment gate. |
| #12 M1C parallel fork | 🟡 STRUCTURAL | Replaced parallel fork with sequential flow. Payer ID first, then format validation. Unknown payers get format analysis loop before falling back to Carelon baseline. Format terminals now route to `M1C_SIGNALS` (was `M1C_COB_CHK`). |
| #13 Approaching-2 no block | 🟡 MODERATE | Added `M1B_AGE2_SOFT` node: PENDING_AGE_ELIGIBLE status, scheduling blocked until birthday. Pre-sets pediatric codes (95782/95783). Re-entry via `REENTRY_RE_AGE2 → M6_START`. |
| #14 Missing name skips age | 🟡 MODERATE | Changed `M1B_F_NAME → M1B_DOB` (was `→ M1B_PAY`). DOB/age validation now runs even when patient name is missing. |
| #15 Format no-ID path | 🔵 MINOR | Added `M1C_FMT_NO_ID` branch: when member ID is absent, sets `ALERT_MISSING_MEMBER_ID` and continues to `M1C_SIGNALS`. |
| #16 Aetna label clarification | 🔵 MINOR | Updated `M1C_FMT_AETNA_AMB` label: Intermountain OON stop is a benefits-verification-time determination, not an automated branch. |

**New nodes added:** `M1C_FMT_ANALYZE`, `M1C_FMT_DERIVED`, `M1B_AGE2_SOFT`, `REENTRY_RE_AGE2`, `M1C_FMT_NO_ID`

---

## 🔴 FINDING 11: M4_SPLIT_SELECT_SPLIT Duplicate Arrow Bypasses Payment Gate

**Location:** Lines 897 and 901 (v0.19.2)

**What happened:** `M4_SPLIT_SELECT_SPLIT` had two outbound arrows:
```
Line 897: M4_SPLIT_SELECT_SPLIT --> M4_SPLIT_PAY{"payment_type?"}   ← correct
Line 901: M4_SPLIT_SELECT_SPLIT --> M4_SPLIT_RETURN                 ← bypass
```

**Impact:** Cash split-night patients could bypass `M4_SPLIT_PAY` entirely, skipping the cost comparison path (`M4_SPLIT_CASH_CASH_ENTRY → $650 vs $1,250`). This undermined the entire Finding #6 fix from v0.19.2. For insured patients, the duplicate was redundant but still bypassed payment gate logging.

**Fix:** Removed line 901. Only path from `M4_SPLIT_SELECT_SPLIT` is now `→ M4_SPLIT_PAY`, which correctly routes:
- INSURED → `M4_SPLIT_RETURN` (pediatric conversion)
- CASH/PENDING → `M4_SPLIT_CASH_CASH_ENTRY` (cost comparison)

---

## 🟡 FINDING 12: M1C Parallel Fork — Payer ID and Format Validation Run Simultaneously

**Location:** Lines 195 and 1235 (v0.19.2)

**What happened:** `M1C_INS` forked into two simultaneous paths:
```
Line 195:  M1C_INS → M1C_EXTRACT     (payer identification)
Line 1235: M1C_INS → M1C_FMT_ID_START (format validation)
```

Both converged at `M1C_COB_CHK`, so no data was lost. But format validation is payer-specific (Tricare checks digit count, UHC checks W-prefix, etc.), meaning you need to know the payer before you can validate the format. Running them in parallel creates an implicit dependency that a developer could easily miss.

Additionally, when the payer name is NOT in insurance.json, format analysis of the member ID can sometimes *reveal* the payer (3-letter alpha prefix = BCBS, MBI format = Medicare, etc.). The parallel architecture had no way to feed format-derived payer identity back into the lookup.

**Fix — Sequential with Format Analysis Loop:**

**Path A: Payer known by name**
```
M1C_EXTRACT → M1C_KNOWN(Yes) → M1C_PAYER_ID → M1C_FMT_ID_START
  → validate format → M1C_SIGNALS → plan type → routing → COB
```

**Path B: Payer unknown → format analysis**
```
M1C_EXTRACT → M1C_KNOWN(No) → M1C_FMT_ANALYZE
  → (pattern matches) → M1C_FMT_DERIVED → M1C_FMT_ID_START
    → validate format → M1C_SIGNALS → plan type → routing → COB
  → (unrecognizable) → M1C_UNKNOWN → M1C_NO_GUESS → M1C_BCBS_CHK → routing → COB
```

**Key changes:**
- Removed: `M1C_INS → M1C_FMT_ID_START` (parallel fork)
- Added: `M1C_FMT_ANALYZE` node (ID format reveals payer?)
- Added: `M1C_FMT_DERIVED` node (payer derived from format, FLAG_PAYER_FROM_FORMAT)
- Changed: `M1C_PAYER_ID → M1C_FMT_ID_START` (was → M1C_SIGNALS)
- Changed: All 16 format terminals now → `M1C_SIGNALS` (was → `M1C_COB_CHK`)
- No loops: format analysis is one-shot. If it identifies the payer, proceed to validation. If not, fall back to unknown.

---

## 🟡 FINDING 13: Approaching-2 Processes Entire Pipeline With No Scheduling Block

**Location:** M1B lines 122, 136 (v0.19.2)

**What happened:** A patient approaching their 2nd birthday (within 2 months) triggered `M1B_ALERT_2` which said "Currently cannot test, Will become eligible on [date]" — but then flowed directly to `M1B_PAY` and processed the entire pipeline (insurance, clinical, coverage, auth, M6 output) with no scheduling block. The file could reach `READY_TO_SCHEDULE` for a patient who literally cannot be tested yet.

**Two scenarios — hard stop and soft stop:**

| Scenario | Age | Birthday | Correct Behavior |
|----------|-----|----------|-----------------|
| **Hard stop** | Under 2, birthday far | > 2 months away | `STOP_CANNOT_TEST → FINAL_STOPPED` (already correct) |
| **Soft stop** | Under 2, birthday close | Within 2 months | Process file completely but BLOCK scheduling until birthday |

**Fix:**

1. **Updated `M1B_ALERT_2`** to pre-set pediatric parameters:
   - `Pediatric = true`
   - `Codes: 95782 / 95783`
   - `HST NOT allowed`
   
   These are pre-set so the rest of the pipeline processes with the correct codes for when the child will actually be tested (age 2-5 rules).

2. **Inserted `M1B_AGE2_SOFT`** between `M1B_ALERT_2` and `M1B_PAY`:
   - Status: `PENDING_AGE_ELIGIBLE`
   - Action: Process file completely (insurance, clinical, auth readiness)
   - Block: Scheduling blocked until [birthday]
   - M6 output: PENDING_AGE_ELIGIBLE (not READY_TO_SCHEDULE)

3. **Added `REENTRY_RE_AGE2`** to re-entry dispatcher:
   - Trigger: Birthday reached (automatic date trigger)
   - Target: `M6_START` (regenerate output with scheduling unblocked)
   - No reprocessing needed — codes and criteria already pre-set

**Flow comparison:**

v0.19.2 (broken):
```
M1B_ALERT_2 → M1B_PAY → ... → M6 → READY_TO_SCHEDULE (can't test!)
```

v0.19.3 (fixed):
```
M1B_ALERT_2 → M1B_AGE2_SOFT → M1B_PAY → ... → M6 → PENDING_AGE_ELIGIBLE (blocked)
  [birthday] → REENTRY_RE_AGE2 → M6_START → READY_TO_SCHEDULE (can test!)
```

---

## UPDATED PATH COMPLETENESS

### ✅ NEW PATHS VERIFIED

| Path | Route | Terminal |
|------|-------|---------|
| Cash split night (via payment gate) | ... → M4_SPLIT_SELECT_SPLIT → M4_SPLIT_PAY → CASH → M4_SPLIT_CASH_CASH_ENTRY → cost comparison → M4_PED_CHK → ... | FINAL_DONE |
| Unknown payer → format reveals BCBS | M1C_KNOWN(No) → M1C_FMT_ANALYZE(Yes) → M1C_FMT_DERIVED → M1C_FMT_ID_START → BCBS format → M1C_SIGNALS → ... → BCBS tree | FINAL_DONE |
| Unknown payer → format reveals nothing | M1C_KNOWN(No) → M1C_FMT_ANALYZE(No) → M1C_UNKNOWN → M1C_NO_GUESS → Carelon baseline | FINAL_DONE |
| Approaching 2 (soft stop) | M1B_ALERT_2 → M1B_AGE2_SOFT → M1B_PAY → full pipeline → M6 | PENDING_AGE_ELIGIBLE |
| Approaching 2 (re-entry) | REENTRY_RE_AGE2 → M6_START → regenerate output | READY_TO_SCHEDULE |
| Under 2 (hard stop) | M1B_STOP_AGE → FINAL_STOPPED | FINAL_STOPPED (unchanged) |
| Missing name, DOB present (age 4) | M1B_F_NAME → M1B_DOB → M1B_AGE_CALC → age 2-5 → 95782 | FINAL_DONE (correct ped code) |
| Partial insurance (no member ID) | M1C_FMT_FORMAT_CHK → M1C_FMT_NO_ID → M1C_SIGNALS | Continues with alert |

---

## 🟡 FINDING 14: Missing Patient Name Bypasses DOB/Age Validation

**Location:** Line 135 (v0.19.2) — `M1B_F_NAME → M1B_PAY`

**What happened:** When the patient name was missing, `M1B_F_NAME` routed directly to `M1B_PAY`, completely skipping `M1B_DOB → M1B_AGE_CALC → M1B_AGE_ALERTS`. Age was never calculated. Pediatric flag never set. A 3-year-old with a missing name would get adult codes (95810) instead of pediatric codes (95782) in M4.

**Why it matters:** Name and DOB are independent OCR fields. A referral can have DOB without a name (e.g., name field illegible, DOB field clear). Age-based code selection is critical — wrong codes mean claim denial.

**Fix:** Changed `M1B_F_NAME → M1B_DOB` so DOB is still checked and age is still calculated even when the name is missing. The missing-name alert still fires and carries forward.

**Contrast with M1B_F_DOB:** Missing DOB correctly routes to `M1B_PAY` because you literally cannot calculate age without a birth date. No fix needed there.

---

## 🔵 FINDING 15: Format Validation Has No "Member ID Absent" Path

**Location:** `M1C_FMT_FORMAT_CHK` (line 242)

**What happened:** When a patient had partial insurance (payer identified but no member ID), format validation received an empty/null value. No branch handled this case — the empty string would fall through without matching any payer-specific format rules.

**Fix:** Added `M1C_FMT_NO_ID` branch: "No member ID extracted" → `ALERT_MISSING_MEMBER_ID` → `M1C_SIGNALS`. Processing continues with the alert flag carried forward.

---

## 🔵 FINDING 16: Aetna Intermountain STOP_OON Described But Not Wired

**Location:** `M1C_FMT_AETNA_AMB` (line 249)

**What happened:** Node label said "If Intermountain → STOP_OON" implying an automated stop branch, but the only arrow went to `M1C_SIGNALS`. A developer reading the label might expect a branch that doesn't exist.

**Fix:** Updated label to clarify: "Determination happens during manual benefits verification. If Intermountain confirmed → OON stop applied by human at rerun stage." No wiring change needed — the automated path correctly continues to signals, and the human resolves during verification.

---

## CUMULATIVE FINDING SUMMARY (v0.19.2 + v0.19.3)

| # | Severity | Finding | Version Fixed |
|---|----------|---------|---------------|
| 1 | 🔴 CRITICAL | BCBS 4-step tree disconnected | v0.19.2 |
| 2 | 🔴 CRITICAL | BCBS exit bypasses COB | v0.19.2 |
| 3 | 🔴 CRITICAL | Payer Routing disconnected | v0.19.2 |
| 4 | 🔴 CRITICAL | MA Routing disconnected | v0.19.2 |
| 5 | 🟡 MODERATE | VirtuOx STOP continues pipeline | v0.19.2 |
| 6 | 🟡 MODERATE | Cash patients skip M4 | v0.19.2 |
| 7 | 🟡 MODERATE | PENDING_INSURANCE false flag | v0.19.2 |
| 8 | 🔵 MINOR | M1B_CASH label mismatch | v0.19.2 |
| 9 | 🔵 MINOR | Redundant double connection | v0.19.2 |
| 10 | 🔵 MINOR | Wrong module reference (M1D) | v0.19.2 |
| 11 | 🔴 CRITICAL | Split payment gate bypass | **v0.19.3** |
| 12 | 🟡 STRUCTURAL | M1C parallel fork → sequential | **v0.19.3** |
| 13 | 🟡 MODERATE | Approaching-2 no scheduling block | **v0.19.3** |
| 14 | 🟡 MODERATE | Missing name skips age validation | **v0.19.3** |
| 15 | 🔵 MINOR | Format validation no-ID path missing | **v0.19.3** |
| 16 | 🔵 MINOR | Aetna Intermountain label misleading | **v0.19.3** |

**Total: 16 findings, all resolved. 0 known issues remaining.**
