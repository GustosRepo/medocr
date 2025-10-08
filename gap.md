# Remaining Gaps (October 7, 2025)

## 1. 95811 Auto-Approval Safeguards
- **Goal**: Only allow automated approval of CPT 95811 when diagnostic evidence or compliance issues meet strict criteria.
- **Current State**: We detect CPT 95811 intent and titration keywords, but any positive match can still auto-select 95811.
- **To Do**:
  - Load diagnostic result indicators (e.g., prior PSG results, AHI ≥ 4%) from referral data or structured notes.
  - Ensure compliance issues like “pressure too high/low”, “intolerance” are explicitly captured and validated before approving 95811.
  - If these signals are absent, force the referral into manual review (add dedicated flag/action).

## 2. DME Decision Tree Follow-Up
- **Goal**: When a DME vendor or equipment code is detected, trigger structured decision-tree logic for follow-up actions.
- **Current State**: We flag DME with `review_dme_required` and prerequisite warnings, but no deeper branching logic is applied.
- **To Do**:
  - Define a decision matrix (JSON or code) that maps vendors/issues to explicit next steps.
  - Update the rules engine to evaluate that matrix and push actionable items (e.g., “verify mask fit”, “request compliance download”).
  - Surface those actions distinctly in alerts so ops knows the outcome of the decision tree.

## 3. Noise from JSON Module Warnings (optional)
- **Goal**: Avoid repeated "ExperimentalWarning" messages when importing JSON modules.
- **Current State**: Node 20 logs warnings during tests and runtime.
- **To Do** (if we care): either add `--no-warnings` to Node invocations or bump to a Node release where JSON modules are stable.

