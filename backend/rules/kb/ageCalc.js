/**
 * ageCalc.js — Age calculation and pediatric tier classification
 * 
 * Consumes: patient DOB from extraction + facility_config.json
 * Produces: age, pediatric tier, age-based flags
 */

import { getFacilityConfig } from '../../kbLoader.js';

/**
 * Calculate age in years from DOB string.
 * @param {string} dob - Date of birth in MM/DD/YYYY or similar format
 * @param {string|Date} [asOf] - Calculate age as of this date (default: now)
 * @returns {number|null} Age in years, or null if unparseable
 */
export function calcAge(dob, asOf) {
  if (!dob) return null;
  const parsed = parseDob(dob);
  if (!parsed) return null;
  const ref = asOf ? new Date(asOf) : new Date();
  if (isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - parsed.getFullYear();
  const monthDiff = ref.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < parsed.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

/**
 * Parse DOB from various formats.
 */
function parseDob(dob) {
  if (!dob || typeof dob !== 'string') return null;
  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = dob.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) return new Date(+mdy[3], +mdy[1] - 1, +mdy[2]);
  // YYYY-MM-DD (ISO)
  const iso = dob.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  // Fallback: let Date parse it
  const d = new Date(dob);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Determine pediatric tier based on age.
 * Tiers from cpt_selector_FIXED.json:
 *   - under 2: cannot test
 *   - 2-5: pediatric codes (95782/95783)
 *   - 6-17: adult codes, but still pediatric for some payers
 *   - 18+: adult
 * 
 * @param {number} age - Age in years
 * @returns {{ tier: string, label: string, codes: string[], hstAllowed: boolean }}
 */
export function getPediatricTier(age) {
  if (age === null || age === undefined) {
    return { tier: 'unknown', label: 'Age unknown', codes: [], hstAllowed: true };
  }
  if (age < 2) {
    return { tier: 'cannot_test', label: 'Under 2 — cannot test', codes: [], hstAllowed: false };
  }
  if (age <= 5) {
    return { tier: 'pediatric', label: 'Pediatric (2-5)', codes: ['95782', '95783'], hstAllowed: false };
  }
  if (age <= 17) {
    return { tier: 'pediatric_adult_codes', label: 'Pediatric (6-17)', codes: ['95810', '95811'], hstAllowed: false };
  }
  return { tier: 'adult', label: 'Adult (18+)', codes: ['95810', '95811', '95806', 'G0399'], hstAllowed: true };
}

/**
 * Full age assessment for a patient.
 * @param {Object} result - Extraction result with patient.dob
 * @returns {{ age: number|null, tier: Object, flags: Array }}
 */
export function assessAge(result) {
  const dob = result?.patient?.dob;
  const age = calcAge(dob);
  const tier = getPediatricTier(age);
  const flags = [];

  if (tier.tier === 'cannot_test') {
    flags.push({ id: 'STOP_AGE', severity: 1, label: 'STOP', action: 'Patient under 2 — cannot test. Notify provider.' });
  }
  if (tier.tier === 'pediatric') {
    flags.push({ id: 'FLAG_PEDIATRIC', severity: 3, label: 'FLAG', action: 'Use pediatric CPT codes (95782/95783). No HST.' });
  }
  if (tier.tier === 'pediatric_adult_codes') {
    flags.push({ id: 'ALERT_PEDIATRIC_ADULT', severity: 4, label: 'ALERT', action: 'Patient 6-17: adult CPT codes apply, but no HST. Verify payer pediatric policy.' });
  }

  return { age, tier, flags };
}
