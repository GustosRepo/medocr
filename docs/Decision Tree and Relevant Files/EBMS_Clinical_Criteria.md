# EBMS Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- EBMS (Employee Benefit Management Services)

---

## KEY CHARACTERISTIC: TPA -- ALWAYS CALL

EBMS is a Third Party Administrator (TPA). Rules vary entirely by the underlying plan/employer.

**There are NO standard rules for EBMS -- every plan is different.**

---

## AUTHORIZATION STATUS

| Test | Auth Required | Method |
|------|---------------|--------|
| HST | [?] Call to verify | Phone |
| PSG (95810) | [?] Call to verify | Phone |
| Titration (95811) | [?] Call to verify | Phone |
| Split Night | [?] Call to verify | Phone |

---

## HST CODE

**Depends on parent network**

EBMS is a TPA -- the HST code depends on which network the underlying plan uses:
- If parent network uses G0399 -> use G0399
- If parent network uses 95806 -> use 95806
- **Must verify during benefits call**

---

## [!] CRITICAL: ALWAYS NEED THE CARD

```
EBMS plans require the physical card to get:
|-- Correct phone number
|-- Plan-specific rules
|-- Network information
+-- Authorization requirements
```

**Do NOT assume anything about EBMS plans without calling.**

---

## CLINICAL CRITERIA

### Varies by Plan

Since EBMS is a TPA, clinical criteria depend on the underlying employer/plan:
- Some plans have strict criteria
- Some plans have no auth at all
- Some plans use specific networks (Cigna, UHC, etc.)
- **Must verify each plan individually**

---

## WORKFLOW

```
1. Get the member's card
   +-- REQUIRED -- cannot proceed without it

2. Call the number on the card
   +-- Not a standard EBMS number -- varies by plan

3. During the call, verify:
   |-- Is authorization required?
   |-- For which codes?
   |-- What's the HST code?
   |-- What network are they using?
   +-- How to submit auth if required?

4. Document everything from the call

5. Follow plan-specific instructions
```

---

## REFERRAL REQUIREMENT

**Call to verify** -- varies by plan

---

## DECISION TREE FLAGS

### FLAG_EBMS_CALL_REQUIRED [!]
- **Trigger:** EBMS identified as payer
- **Action:** Must call using number on member card -- no standard rules apply
- **Severity:** High (cannot proceed without call)
- **Blocking:** Yes (until verification complete)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | EBMS (TPA) |
| HST Auth | [?] Call to verify |
| In-Lab Auth | [?] Call to verify |
| HST Code | Varies by plan |
| Referral | Call to verify |
| Card Required | [OK] Yes |
| Pain Level | [YELLOW] Medium (phone wait varies) |

---

## WHAT IS A TPA?

**Third Party Administrator (TPA):**
- Administers benefits for self-funded employer plans
- Does NOT set the rules -- the employer does
- Each employer using EBMS can have completely different rules
- EBMS just processes claims per the employer's instructions

---

*Document for MEDOCR v0.17*
*Payer: EBMS*
*Version 1.0 -- February 2026*
