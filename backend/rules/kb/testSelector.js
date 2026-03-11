/**
 * testSelector.js — CPT Code / Test Type Selection Engine
 * 
 * Given patient context (age, payer, contraindications, physician order),
 * recommends the optimal CPT code using cpt_selector_FIXED.json rules.
 * 
 * Decision flow:
 * 1. Age check → pediatric routing or adult
 * 2. Contraindications → HST hard blocks (O2), soft recommendations
 * 3. Payer-aware home code mapping
 * 4. Split night / titration rules
 * 5. Physician order respect (never expand scope beyond order)
 */

import { getCptSelector, getContraindications } from '../../kbLoader.js';

/**
 * Check contraindications against extracted clinical data.
 * 
 * @param {Object} result - Extraction result (may have diagnoses, keywords, etc.)
 * @returns {{ hstBlocked: boolean, psgRecommended: boolean, flags: Array, removedCodes: Set }}
 */
export function checkContraindications(result) {
  const contra = getContraindications();
  if (!contra) return { hstBlocked: false, psgRecommended: false, flags: [], removedCodes: new Set() };

  const flags = [];
  const removedCodes = new Set();
  let hstBlocked = false;
  let psgRecommended = false;

  const clinicalText = [
    result?.clinicalNotes || '',
    result?.diagnosis || '',
    ...(result?.icdCodes || [])
  ].join(' ').toLowerCase();

  // Hard stops
  for (const [, rule] of Object.entries(contra.hard_stops || {})) {
    if (rule.icd_triggers?.some(icd => clinicalText.includes(icd.toLowerCase()))) {
      flags.push({ id: rule.flag, severity: 1, label: 'STOP', action: rule.human_action });
      (rule.removes_from_scope || []).forEach(c => removedCodes.add(c));
    }
  }

  // HST hard block (O2)
  const o2Rule = contra.hst_hard_block?.home_oxygen;
  if (o2Rule) {
    const hasO2 = o2Rule.keyword_triggers?.some(kw => clinicalText.includes(kw)) ||
                  o2Rule.icd_triggers?.some(icd => clinicalText.includes(icd.toLowerCase()));
    if (hasO2) {
      hstBlocked = true;
      flags.push({ id: o2Rule.flag, severity: 3, label: 'FLAG', action: o2Rule.human_action });
      (o2Rule.removes_from_scope || []).forEach(c => removedCodes.add(c));
    }
  }

  // Soft recommendations
  let softCount = 0;
  for (const [, rule] of Object.entries(contra.soft_recommendations || {})) {
    const triggered = rule.keyword_triggers?.some(kw => clinicalText.includes(kw)) ||
                      rule.icd_triggers?.some(icd => clinicalText.includes(icd.toLowerCase()));
    if (triggered) {
      softCount++;
      psgRecommended = true;
      flags.push({ id: rule.flag, severity: 4, label: 'ALERT', action: rule.reason });
    }
  }

  // Multiple moderate comorbidities
  if (softCount >= 2) {
    const multi = contra.soft_recommendations?.multiple_moderate_comorbidities;
    if (multi) {
      flags.push({ id: multi.flag, severity: 3, label: 'FLAG', action: multi.human_action });
    }
  }

  return { hstBlocked, psgRecommended, flags, removedCodes };
}

/**
 * Select the recommended CPT code based on full patient context.
 * 
 * @param {Object} params
 * @param {Object} params.ageAssessment - From ageCalc.assessAge()
 * @param {Object} params.payerAssessment - From payerCriteria.assessPayer()
 * @param {Object} params.result - Full extraction result
 * @returns {{ recommendedCpt: string, alternativeCpts: string[], reason: string, flags: Array }}
 */
export function selectTest({ ageAssessment, payerAssessment, result }) {
  const selector = getCptSelector();
  if (!selector) {
    return { recommendedCpt: '95810', alternativeCpts: [], reason: 'No CPT selector data. Defaulting to in-lab PSG.', flags: [] };
  }

  const flags = [];
  const orderedCpt = result?.procedure?.cpt;
  const age = ageAssessment?.age;
  const tier = ageAssessment?.tier;
  const payerId = payerAssessment?.payerId;

  // 1. Pediatric routing
  if (tier === 'cannot_test') {
    return { recommendedCpt: null, alternativeCpts: [], reason: 'Patient under 2 — cannot test.', flags: [{ id: 'STOP_AGE', severity: 1, label: 'STOP', action: 'Cannot perform sleep study on patient under 2.' }] };
  }

  if (tier === 'pediatric') {
    const pedCodes = selector.pediatricRouting?.codes || {};
    const isTitration = orderedCpt === '95783' || orderedCpt === '95811';
    const rec = isTitration ? (pedCodes.pediatric_titration || '95783') : (pedCodes.pediatric_diagnostic || '95782');
    flags.push({ id: 'REMOVE_HST', severity: 3, label: 'FLAG', action: 'HST not allowed for pediatric patients.' });
    return { recommendedCpt: rec, alternativeCpts: [pedCodes.pediatric_diagnostic, pedCodes.pediatric_titration].filter(Boolean), reason: `Pediatric patient (age ${age}). Using pediatric codes.`, flags };
  }

  // 2. Contraindications
  const contraResult = checkContraindications(result);
  flags.push(...contraResult.flags);

  // 3. Determine if titration or diagnostic
  const isTitration = /95811|95783|titration/i.test(orderedCpt || '');
  
  // Split night check
  if (isTitration && selector.splitNight?.blockDualCodes) {
    // Check titration prerequisites
    const requiresAny = selector.titrationAutoApproval?.requiresAny || [];
    const clinicalText = (result?.clinicalNotes || '').toLowerCase();
    const hasPrereq = requiresAny.some(req => clinicalText.includes(req.replace(/_/g, ' ')));
    
    if (!hasPrereq) {
      flags.push({ id: 'PENDING_NEW_ORDER', severity: 2, label: 'PENDING', action: 'Titration ordered but no prior positive/documented need. May need new order for diagnostic.' });
    }
  }

  // 4. Diagnostic routing — home vs lab
  const homeKw = selector.diagnosticRouting?.home_keywords || [];
  const labKw = selector.diagnosticRouting?.lab_keywords || [];
  const orderText = (orderedCpt || '').toLowerCase() + ' ' + (result?.procedure?.description || '').toLowerCase();
  
  const isHomeOrdered = homeKw.some(kw => orderText.includes(kw)) || ['95806', 'G0399', 'g0399'].includes(orderedCpt);
  const isLabOrdered = labKw.some(kw => orderText.includes(kw)) || ['95810', '95811'].includes(orderedCpt);

  let recommendedCpt;
  let reason;

  if (isTitration) {
    recommendedCpt = tier === 'pediatric_adult_codes' ? '95811' : (selector.splitNight?.preferred || '95811');
    reason = 'Titration ordered.';
  } else if (isHomeOrdered && !contraResult.hstBlocked) {
    // Payer-aware home code
    const homeMap = selector.diagnosticRouting?.payerAwareHomeCodes || {};
    recommendedCpt = homeMap[payerId] || homeMap.default || 'G0399';
    reason = `Home sleep test ordered. Payer-aware code: ${recommendedCpt}.`;

    // Check payer overrides
    if (selector.payerOverrides) {
      for (const [, override] of Object.entries(selector.payerOverrides)) {
        if (override.hst_allowed === false && payerId?.toLowerCase().includes('medicaid')) {
          recommendedCpt = selector.diagnosticRouting?.lab_code || '95810';
          reason = 'HST ordered but payer does not allow HST. Routing to in-lab.';
          flags.push({ id: 'PENDING_NEW_ORDER', severity: 2, label: 'PENDING', action: 'Payer does not allow HST. Need new order for PSG.' });
          break;
        }
      }
    }
  } else if (isLabOrdered || contraResult.hstBlocked) {
    recommendedCpt = selector.diagnosticRouting?.lab_code || '95810';
    reason = contraResult.hstBlocked ? 'HST blocked by contraindication. In-lab PSG required.' : 'In-lab PSG ordered.';
  } else if (contraResult.psgRecommended) {
    recommendedCpt = selector.diagnosticRouting?.lab_code || '95810';
    reason = 'PSG recommended due to clinical comorbidities.';
    flags.push({ id: 'ALERT_PSG_RECOMMENDED', severity: 4, label: 'ALERT', action: 'PSG recommended but HST still available if physician orders it.' });
  } else {
    // Fallback
    recommendedCpt = selector.fallback?.code || '95810';
    reason = selector.fallback?.notes || 'Default to in-lab PSG.';
  }

  // Respect physician scope — never expand beyond ordered test
  if (orderedCpt && recommendedCpt !== orderedCpt && !contraResult.hstBlocked) {
    flags.push({ id: 'INFO_CPT_MISMATCH', severity: 5, label: 'INFO', action: `Ordered: ${orderedCpt}, Recommended: ${recommendedCpt}. Physician order controls.` });
  }

  const alternativeCpts = ['95806', 'G0399', '95810', '95811'].filter(c => c !== recommendedCpt && !contraResult.removedCodes.has(c));

  return { recommendedCpt, alternativeCpts, reason, flags };
}
