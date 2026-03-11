/**
 * costEstimate.js — Insurance Allowable Rate Lookup
 * 
 * Given a resolved payer_id + CPT code, looks up the allowable rate
 * from insurance_allowables.json. Returns rate, source payer name,
 * and flags if no rate found.
 */

import { getInsuranceAllowables } from '../../kbLoader.js';

/**
 * Look up the allowable rate for a payer + CPT code.
 * 
 * @param {string} payerId - Resolved payer_id (e.g. "aetna", "medicare_ffs")
 * @param {string} cptCode - CPT code (e.g. "95810", "G0399")
 * @returns {{ rate: number|null, payerName: string|null, found: boolean, flags: Array }}
 */
export function lookupAllowable(payerId, cptCode) {
  if (!payerId || !cptCode) {
    return { rate: null, payerName: null, found: false, flags: [] };
  }

  const allowables = getInsuranceAllowables();
  if (!allowables) return { rate: null, payerName: null, found: false, flags: [] };

  const payers = allowables.payers || allowables;
  const normalizedPayer = payerId.toLowerCase().replace(/[\s_-]+/g, ' ');
  const normalizedCpt = cptCode.toUpperCase();

  // Search by payer key name OR aliases
  for (const [payerName, entry] of Object.entries(payers)) {
    const normalizedKey = payerName.toLowerCase().replace(/[\s_-]+/g, ' ');
    const aliases = (entry.aliases || []).map(a => a.toLowerCase().replace(/[\s_-]+/g, ' '));
    const match = normalizedKey === normalizedPayer
               || normalizedKey.includes(normalizedPayer)
               || normalizedPayer.includes(normalizedKey)
               || aliases.some(a => a === normalizedPayer || a.includes(normalizedPayer));

    if (match) {
      const rates = entry.rates || entry;
      if (rates[normalizedCpt] !== undefined) {
        return { rate: rates[normalizedCpt], payerName, found: true, flags: [] };
      }
      return {
        rate: null,
        payerName,
        found: false,
        flags: [{ id: 'INFO_NO_RATE', severity: 5, label: 'INFO', action: `No allowable rate for ${normalizedCpt} with ${payerName}.` }]
      };
    }
  }

  return {
    rate: null,
    payerName: null,
    found: false,
    flags: [{ id: 'INFO_UNKNOWN_PAYER_RATE', severity: 5, label: 'INFO', action: `No allowable rates on file for payer "${payerId}".` }]
  };
}

/**
 * Full cost assessment: resolve payer + recommended CPT → allowable rate.
 * 
 * @param {Object} params
 * @param {Object} params.payerAssessment - From payerCriteria.assessPayer()
 * @param {string} params.recommendedCpt - From testSelector.selectTest()
 * @returns {{ allowableRate: number|null, payerName: string|null, cpt: string, flags: Array }}
 */
export function assessCost({ payerAssessment, recommendedCpt }) {
  const payerId = payerAssessment?.payerId;
  const { rate, payerName, found, flags } = lookupAllowable(payerId, recommendedCpt);

  return {
    allowableRate: rate,
    payerName: payerName || payerAssessment?.payerName || null,
    cpt: recommendedCpt,
    found,
    flags
  };
}
