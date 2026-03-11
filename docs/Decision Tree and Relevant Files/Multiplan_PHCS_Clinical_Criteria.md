# Multiplan / PHCS Clinical Criteria
## For MEDOCR Decision Tree Integration
### Version 1.0 -- February 2026

---

## Payers Covered
- Multiplan
- PHCS (Private Healthcare Systems)

---

## KEY CHARACTERISTIC: IBA PLANS -- CALL THE IBA, NOT THE NETWORK

These are Independent Benefit Administrator (IBA) plans. Cards are often obscure or random-looking.

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

| Network | HST Code |
|---------|----------|
| Multiplan | 95806 |
| PHCS | 95806 |

---

## ALLOWABLES

Each network uses its own allowables:
- Multiplan -> Multiplan allowables
- PHCS -> PHCS allowables

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
   +-- Do NOT call Multiplan or PHCS directly
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

Since these are IBA plans, clinical criteria depend on the underlying employer:
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
- Uses a network (Multiplan, PHCS) for provider access
- Sets its own rules separate from the network
- Contact the IBA, not the network, for auth/benefits

---

## DECISION TREE FLAGS

### FLAG_IBA_CALL_REQUIRED [!]
- **Trigger:** Multiplan or PHCS identified
- **Action:** Call the IBA using number on card -- not the network
- **Severity:** High (cannot proceed without call)
- **Blocking:** Yes (until verification complete)

---

## QUICK REFERENCE

| Field | Multiplan | PHCS |
|-------|-----------|------|
| HST Auth | [?] Call IBA | [?] Call IBA |
| In-Lab Auth | [?] Call IBA | [?] Call IBA |
| HST Code | 95806 | 95806 |
| Referral | Call to verify | Call to verify |
| Card Required | [OK] Yes | [OK] Yes |
| Pain Level | [YELLOW] Medium | [YELLOW] Medium |

---

*Document for MEDOCR v0.17*
*Payers: Multiplan / PHCS*
*Version 1.0 -- February 2026*
