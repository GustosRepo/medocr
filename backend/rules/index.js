import { normalizePages } from './normalize.js';
import { detectName, detectDob } from './patient.js';
import { selectCpt } from './cpt.js';
import { detectICDs } from './icd.js';
import { detectCarrier } from './carriers.js';
import { detectDME } from './dme.js';

export function runExtraction(ocrPages) {
  const { fullText, lines } = normalizePages(ocrPages);
  const trace = [];
  const result = {
    documentMeta: {},
    patient: {},
    insurance: [],
    provider: {},
    procedure: {},
    diagnoses: [],
    alerts: { info: [], actions: [], review: [] },
    flags: { verifyManually: false, reasons: [] },
    confidence: 'Low'
  };

  // Patient
  const name = detectName(fullText, lines); if (name.hit) { result.patient = { ...result.patient, ...name.value }; trace.push({ rule: name.why, value: `${result.patient.last}, ${result.patient.first}` }); }
  const dob = detectDob(fullText); if (dob.hit) { result.patient = { ...result.patient, dob: dob.value }; trace.push({ rule: dob.why, value: dob.value }); }

  // CPT
  const cpt = selectCpt(fullText); if (cpt.hit) { result.procedure = { ...result.procedure, cpt: cpt.value }; trace.push({ rule: 'cpt_select', value: cpt.value }); }

  // ICD
  const icd = detectICDs(fullText, lines);
  if (icd.hit) {
    let values = Array.isArray(icd.values) ? [...icd.values] : [];
    // If CPT indicates a sleep study, prioritize sleep-related diagnoses first
    const cptCode = result.procedure?.cpt;
    const sleepStudyCPT = new Set(['95811', '95810', '95806', 'G0399', '95782', '95783', '95805']);
    if (cptCode && sleepStudyCPT.has(String(cptCode))) {
      const sleepICD = new Set(['G47.33', 'G47.30', 'G47.10', 'G47.00', 'G47.31', 'G47.37', 'R06.83', 'R06.09', 'R53.83', 'G25.81', 'F51.9']);
      const weighted = values.map((code, idx) => ({ code, idx, w: sleepICD.has(String(code)) ? 0 : 1 }));
      weighted.sort((a, b) => (a.w - b.w) || (a.idx - b.idx));
      values = weighted.map(x => x.code);
      trace.push({ rule: 'icd_prioritize_for_cpt', top: values[0] || null, cpt: cptCode });
    }
    result.diagnoses = values;
    if (Array.isArray(icd.actions) && icd.actions.length) {
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), ...icd.actions]));
    }
    trace.push({ rule: icd.why, count: values.length });
  }

  // Carrier
  const car = detectCarrier(fullText, lines);
  if (car.hit) {
    const insObj = { carrier: car.value.carrier, status: car.value.status };
    if (car.meta?.sunsetDate) insObj.sunsetDate = car.meta.sunsetDate;
    if (typeof car.meta?.sunsetDays === 'number') insObj.sunsetDays = car.meta.sunsetDays;
    if (Array.isArray(car.notes) && car.notes.length) insObj.notes = car.notes;
    result.insurance = [insObj];
    trace.push({ rule: car.why, value: `${car.value.carrier}:${car.value.status}` });
    // Alerts/actions from policy
    if (Array.isArray(car.actions) && car.actions.length) {
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), ...car.actions]));
    }
    if (car.value.status !== 'accepted') {
      result.flags.verifyManually = true;
      result.flags.reasons.push('do_not_accept_or_pending_contract');
      if (car.value.status === 'not_accepted') result.alerts.actions.push('insurance_not_accepted');
    }
  }

  // DME
  const dme = detectDME(fullText);
  if (dme.hit) {
    result.dme = dme.value;
    trace.push({ rule: dme.why, codes: dme.value.codes, providers: dme.value.vendors });
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_dme_required']));
  }

  // If 95811 chosen but we don't see obvious titration criteria phrases, flag for review
  if (result.procedure?.cpt === '95811') {
    const titrationCriteria = /(pressure\s*too\s*(high|low)|not\s*tolerating\s*(cpap|pressure)|failed\s*(cpap|pap|apap)|needs?\s*(pressure|settings)|still\s*tired\s*on\s*cpap)/i;
    if (!titrationCriteria.test(fullText)) {
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_95811_required']));
      trace.push({ rule: 'cpt_95811_review_flag', reason: 'no_titration_criteria_found' });
    }
  }
  
  // OCR processing priorities and handwritten/low-confidence note detection
  {
    const _pages = Array.isArray(ocrPages) ? ocrPages : [];
    let handLowConfCount = 0;
    let handTotal = 0;
    let topHits = 0, insuranceHits = 0, providerSigHits = 0, checkboxHits = 0;
    for (const p of _pages) {
      const boxes = Array.isArray(p?.boxes) ? p.boxes : [];
      // Estimate page height by max y+h
      let pageH = 0; for (const b of boxes) { const y = (b?.bbox?.[1] || 0); const h = (b?.bbox?.[3] || 0); pageH = Math.max(pageH, y + h); }
      const topCut = pageH * 0.25; const bottomCut = pageH * 0.75;
      for (const b of boxes) {
        const txt = String(b?.text || '');
        const conf = typeof b?.conf === 'number' ? b.conf : 0;
        const y = (b?.bbox?.[1] || 0);
        if (conf < 0.6) { handLowConfCount++; } handTotal++;
        if (y <= topCut && /(patient|name|dob|date\s*of\s*birth|mrn|medical\s*record)/i.test(txt)) topHits++;
        if (/(insurance|member\s*id|policy|subscriber)/i.test(txt)) insuranceHits++;
        if (y >= bottomCut && /(signature|signed|provider)/i.test(txt)) providerSigHits++;
        if (/\[(?:\s|x|X)?\]|checkbox|select\s+all\s+that\s+apply|☑|□|■/i.test(txt)) checkboxHits++;
      }
    }
    if (handTotal && handLowConfCount / handTotal > 0.3) {
      result.flags.verifyManually = true;
      result.flags.reasons.push('handwritten_notes_present');
      trace.push({ rule: 'flag_handwritten_notes', ratio: Number((handLowConfCount / handTotal).toFixed(2)) });
    }
    trace.push({ rule: 'ocr_priority_zones', topHits, insuranceHits, providerSigHits, checkboxHits });
  }
  
  // Quality control checks
  // Missing patient info
  if (!(result.patient?.first && result.patient?.last) || !result.patient?.dob) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('missing_patient_info');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'missing_patient_information']));
    trace.push({ rule: 'qc_missing_patient_info' });
  }
  // DOB MM/DD/YYYY
  if (result.patient?.dob && !/^\d{2}\/\d{2}\/\d{4}$/.test(result.patient.dob)) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('invalid_dob_format');
    trace.push({ rule: 'qc_invalid_dob_format', dob: result.patient.dob });
  }
  // Phone validity (if found)
  let phoneValidity = 'unknown';
  const phoneMatch = (fullText || '').match(/(?:phone|tel|contact)[:\s]*([\(\)\-\.\s]*\d[\d\(\)\-\.\s]{8,}\d)/i);
  if (phoneMatch) {
    const digits = (phoneMatch[1] || '').replace(/\D/g, '');
    phoneValidity = digits.length === 10 ? 'pass' : 'fail';
    if (phoneValidity === 'fail') {
      result.flags.verifyManually = true;
      result.flags.reasons.push('phone_format_invalid');
      trace.push({ rule: 'qc_phone_invalid', raw: phoneMatch[1] });
    }
  }
  // Insurance ID format (alphanum & dashes)
  const insIdMatch = (fullText || '').match(/(?:member\s*id|subscriber\s*id|policy\s*(?:#|number)?)\s*[:#\-]?\s*([A-Z0-9\-]{5,})/i);
  if (insIdMatch) {
    const id = insIdMatch[1] || '';
    if (!/^[A-Z0-9\-]+$/i.test(id)) {
      result.flags.verifyManually = true;
      result.flags.reasons.push('insurance_id_format');
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'insurance_issue']));
      trace.push({ rule: 'qc_insurance_id_invalid', id });
    }
  }
  // CPT validity against approved list (schema enum)
  const approvedCPT = new Set(['95810','95811','G0399','95806','95782','95783','split_night']);
  let cptValid = 'unknown';
  if (result.procedure?.cpt) {
    cptValid = approvedCPT.has(String(result.procedure.cpt)) ? 'pass' : 'fail';
    if (cptValid === 'fail') {
      result.flags.verifyManually = true;
      result.flags.reasons.push('cpt_missing_or_unapproved');
      trace.push({ rule: 'qc_cpt_unapproved', cpt: result.procedure.cpt });
    }
  } else {
    result.flags.verifyManually = true;
    result.flags.reasons.push('cpt_missing_or_unapproved');
    trace.push({ rule: 'qc_cpt_missing' });
  }
  // Name consistency (best-effort)
  let nameConsistency = 'unknown';
  if (result.patient?.first && result.patient?.last) {
    const re = new RegExp(`${result.patient.last}[^\n]{0,80}${result.patient.first}|${result.patient.first}[^\n]{0,80}${result.patient.last}`, 'i');
    nameConsistency = re.test(fullText || '') ? 'pass' : 'unknown';
  }
  result.qc = {
    nameConsistency,
    dateValidity: result.patient?.dob ? (/^\d{2}\/\d{2}\/\d{4}$/.test(result.patient.dob) ? 'pass' : 'fail') : 'unknown',
    phoneValidity,
    cptValid
  };
  
  // Problem detection overview
  const cptCode = result.procedure?.cpt ? String(result.procedure.cpt) : '';
  const dxCodes = new Set((result.diagnoses || []).map(String));
  const sleepDx = ['G47.33','G47.30','G47.31','G47.37','R06.83','R06.09','R53.83','G25.81','F51.9'];
  // Wrong Test Ordered - CPT vs clinical indication
  if (cptCode && (cptCode === '95810' || cptCode === '95811' || cptCode === '95806' || cptCode === 'G0399')) {
    const hasSleepDx = sleepDx.some(code => dxCodes.has(code));
    if (!hasSleepDx) {
      result.flags.verifyManually = true;
      result.flags.reasons.push('wrong_test_ordered_possible');
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'wrong_test_ordered']));
      trace.push({ rule: 'problem_wrong_test_vs_dx' });
    }
  }
  // Missing Chart Notes
  if (!/(chart\s*notes?|progress\s*note|consult|H&P|history\s*&\s*physical|history\s+and\s+physical)/i.test(fullText || '')) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('missing_chart_notes');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'missing_chart_notes']));
    trace.push({ rule: 'problem_missing_chart_notes' });
  }
  // Insurance issues (non-accepted handled earlier); also look for inactive/expired
  if (/(inactive|expired|termination|coverage\s+ended)/i.test(fullText || '')) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('insurance_issue_possible');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'insurance_issue']));
    trace.push({ rule: 'problem_insurance_issue_terms' });
  }
  // Special Considerations
  if (/(pediatric|child|minor)/i.test(fullText || '') || ['95782','95783'].includes(cptCode)) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('special_considerations_pediatric');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'special_considerations']));
    trace.push({ rule: 'problem_pediatric_requirements' });
  }
  if (typeof dme?.hit === 'boolean' && dme.hit) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('special_considerations_dme');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'special_considerations']));
  }
  if (dxCodes.has('Z74.01') || dxCodes.has('Z74.09')) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('special_considerations_mobility');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'special_considerations']));
  }

  // Confidence
  // --- Conservative flagging system ---
  // 1) OCR signal quality and critical fields (<80% confidence)
  const pages = Array.isArray(ocrPages) ? ocrPages : [];
  let totalBoxes = 0;
  let lowCrit = false;
  let sumConf = 0;
  let lowCount = 0;
  let emptyPageCount = 0;
  const critRe = /(dob|date\s*of\s*birth|diagnos(?:is|es)|assessment|impression|icd|cpt|procedure|study|referral|patient|name|mrn|medical\s*record|insurance|policy)/i;
  for (const p of pages) {
    const boxes = Array.isArray(p?.boxes) ? p.boxes : [];
    if (!boxes.length) emptyPageCount++;
    for (const b of boxes) {
      const conf = typeof b?.conf === 'number' ? b.conf : 0;
      const text = String(b?.text || '');
      totalBoxes++; sumConf += conf; if (conf < 0.8) lowCount++;
      if (critRe.test(text) && conf < 0.8) lowCrit = true;
    }
  }
  const avgConf = totalBoxes ? (sumConf / totalBoxes) : 0;
  if (lowCrit) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('ocr_low_confidence_critical');
    trace.push({ rule: 'flag_ocr_low_confidence_critical', avgConf: Number(avgConf.toFixed(3)) });
  }
  if (emptyPageCount > 0) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('ocr_incomplete_pages');
    trace.push({ rule: 'flag_ocr_incomplete_pages', pagesEmpty: emptyPageCount });
  }

  // 2) Mixed signals / contradictions
  const txt = fullText || '';
  const groups = [
    { key: 'apnea', pos: /(sleep\s*apnea|apneas|apneic\s*episodes|witnessed\s*apnea|gasping|choking)/i, neg: /(denies|no\s+history\s+of|not\s+consistent\s+with).{0,40}(apnea|apneic|snor(?:e|ing))/i },
    { key: 'snoring', pos: /snor(?:e|ing)/i, neg: /(denies|no\s+snor(?:e|ing))/i },
    { key: 'eds', pos: /(excessive\s+daytime\s+sleepiness|hypersomnia|very\s+sleepy\s+during\s+the\s+day)/i, neg: /(denies|no\s+daytime\s+sleepiness|no\s+sleepiness)/i },
    { key: 'insomnia', pos: /insomnia|difficulty\s+(staying|falling)\s+asleep/i, neg: /(denies|no\s+)insomnia/i }
  ];
  for (const g of groups) {
    if (g.pos.test(txt) && g.neg.test(txt)) {
      result.flags.verifyManually = true;
      result.flags.reasons.push(`mixed_signals_${g.key}`);
      trace.push({ rule: 'flag_mixed_signals', symptom: g.key });
    }
  }

  // 3) Complex medical history
  const dx = Array.isArray(result.diagnoses) ? result.diagnoses.map(String) : [];
  const severeSet = new Set(['I50.9', 'I27.20']);
  const severePrefixes = ['J96', 'Z95', 'Z99.81', 'G40', 'G35', 'G20'];
  let hasSevere = false;
  for (const code of dx) {
    if (severeSet.has(code)) { hasSevere = true; break; }
    if (severePrefixes.some(p => code.startsWith(p.replace('.', '')) || code.startsWith(p))) { hasSevere = true; break; }
  }
  if (hasSevere && dx.length >= 2) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('complex_medical_history');
    trace.push({ rule: 'flag_complex_history', count: dx.length });
  }

  // 4) Incomplete OCR: very low text volume
  if ((fullText || '').trim().length < 80) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('ocr_low_text_volume');
    trace.push({ rule: 'flag_ocr_low_text_volume', len: (fullText || '').length });
  }

  // Base confidence from extracted anchors
  let score = 0; if (result.patient?.dob) score++; if (result.patient?.first && result.patient?.last) score++; if (result.procedure?.cpt) score++; if ((result.diagnoses || []).length) score++;
  let baseConf = score >= 3 ? 'High' : score === 2 ? 'Medium' : 'Low';

  // Adjust confidence by OCR quality
  if (avgConf && avgConf < 0.8) baseConf = baseConf === 'High' ? 'Medium' : 'Low';

  // Escalate to Manual Review when multiple uncertainties or critical missing info
  const criticalReasons = new Set(['ocr_low_confidence_critical', 'ocr_incomplete_pages', 'ocr_low_text_volume']);
  const manualTriggers = result.flags.reasons.filter(r => criticalReasons.has(r) || r.startsWith('mixed_signals_'));
  if (manualTriggers.length >= 2 || (lowCrit && score < 2)) {
    result.confidence = 'Manual Review';
  } else {
    // If any uncertainty, cap at Low
    if (result.flags.verifyManually && baseConf === 'High') baseConf = 'Medium';
    result.confidence = baseConf;
  }

  return { result, trace };
}
