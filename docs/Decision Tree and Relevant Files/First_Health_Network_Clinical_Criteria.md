# First Health Network Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payer Covered
- First Health Network

---

## KEY CHARACTERISTIC: IBA PLAN -- CALL THE IBA, NOT THE NETWORK

First Health Network is an Independent Benefit Administrator (IBA) plan. Cards are often obscure or random-looking.

**Always contact the IBA directly -- NOT the network.**

---

## AUTHORIZATION STATUS

| Test | Auth Required | Method |
|------|---------------|--------|
| HST | [?] Call to verify | Phone (IBA) |
| PSG (95810) | [?] Call to verify | Phone (IBA) |
| Titration (95811) | [?] Call to verify | Phone (IBA) |
| Split Night | [?] Call to verify | Phone (IBA) |

---

## HST CODE

**G0399**

---

## ALLOWABLES

First Health Network allowables

---

## [!] CRITICAL: CARD IDENTIFICATION

```
IBA plan cards are often:
|-- Random or obscure looking
|-- Don't clearly identify the network
|-- May have multiple logos
+-- Always need the physical card for the correct phone number
```

**The card is REQUIRED to find the correct contact number.**

---

## WORKFLOW

```
1. Get the member's card
   +-- REQUIRED -- cards are often obscure

2. Identify the IBA (not the network)
   +-- The IBA is who you call for auth/benefits

3. Call the IBA directly
   +-- Do NOT call First Health Network directly
   +-- Use the number on the card

4. During the call, verify:
   |-- Is authorization required?
   |-- For which codes?
   |-- What are the benefits?
   +-- How to submit auth if required?

5. Document everything from the call

6. Follow IBA-specific instructions
```

---

## CLINICAL CRITERIA

### Varies by IBA/Employer

Since this is an IBA plan, clinical criteria depend on the underlying employer:
- Some have strict criteria
- Some have no auth
- **Must verify each plan individually**

---

## REFERRAL REQUIREMENT

**Call to verify** -- varies by plan

---

## WHAT IS AN IBA?

**Independent Benefit Administrator (IBA):**
- Third-party company that handles benefits/auth for employer plans
- Uses a network (First Health) for provider access
- Sets its own rules separate from the network
- Contact the IBA, not the network, for auth/benefits

---

## DECISION TREE FLAGS

### FLAG_IBA_CALL_REQUIRED [!]
- **Trigger:** First Health Network identified
- **Action:** Call the IBA using number on card -- not the network
- **Severity:** High (cannot proceed without call)
- **Blocking:** Yes (until verification complete)

---

## QUICK REFERENCE

| Field | Value |
|-------|-------|
| Payer | First Health Network |
| HST Auth | [?] Call IBA |
| In-Lab Auth | [?] Call IBA |
| HST Code | G0399 |
| Referral | Call to verify |
| Card Required | [OK] Yes |
| Pain Level | [YELLOW] Medium |

---

*Document for MEDOCR v0.17*
*Payer: First Health Network*
*Version 1.0 -- February 2026*
