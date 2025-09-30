import { normalizePages } from './normalize.js';
import { detectName, detectDob, detectPhones } from './patient.js';
import { detectCpt } from './cpt.js';
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
  clinical: {},
  infoAlerts: {},
    alerts: { info: [], actions: [], review: [] },
    flags: { verifyManually: false, reasons: [] },
    confidence: 'Low'
  };

  // Patient
  const name = detectName(fullText, lines); if (name.hit) { result.patient = { ...result.patient, ...name.value }; trace.push({ rule: name.why, value: `${result.patient.last}, ${result.patient.first}` }); }
  const dob = detectDob(fullText); if (dob.hit) { result.patient = { ...result.patient, dob: dob.value }; trace.push({ rule: dob.why, value: dob.value }); }
  const phones = detectPhones(fullText); if (phones.hit) { result.patient.phones = phones.value.map(p => p.formatted); trace.push({ rule: phones.why, count: phones.value.length }); }
  // Email (contextual & filtered)
  {
    const BUSINESS_EMAIL_BLOCK = new Set([
      'athomesleepstudies@ymail.com',
      'athomesleepstudies@gmail.com'
    ]);
    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const all = [...new Set(((fullText || '').match(emailRe) || []))];
    if (all.length) {
      let chosen = null;
      for (const em of all) {
        const lower = em.toLowerCase();
        if (BUSINESS_EMAIL_BLOCK.has(lower)) { trace.push({ rule: 'patient_email_ignored_business', value: lower }); continue; }
        // locate line context
        let lineIdx = lines.findIndex(l => l.includes(em) || l.toLowerCase().includes(lower));
        if (lineIdx < 0) lineIdx = 0;
        const ctxLines = [lines[lineIdx-1]||'', lines[lineIdx]||'', lines[lineIdx+1]||''].join('\n').toLowerCase();
        const hasLabel = /email|e-mail|contact/.test(ctxLines);
        const hasPatientRef = /patient|pt\b/.test(ctxLines);
        const nameTie = (result.patient?.last && ctxLines.includes(result.patient.last.toLowerCase())) || (result.patient?.first && ctxLines.includes(result.patient.first.toLowerCase()));
        if (hasLabel || (hasPatientRef && nameTie)) { chosen = em; break; }
      }
      if (chosen) { result.patient.email = chosen; trace.push({ rule: 'patient_email_detect', value: chosen }); }
    }
  }
  // Emergency contact if minor (<18) or caretaker keywords
  if (result.patient?.dob) {
    const year = parseInt(result.patient.dob.slice(-4), 10);
    const age = (new Date()).getFullYear() - year;
    const needsEC = age < 18 || /(caretaker|caregiver|guardian)/i.test(fullText || '');
    if (needsEC) {
      const ecLine = (fullText || '').split(/\n/).find(l => /emergency\s*contact/i.test(l));
      if (ecLine) {
        const namePart = ecLine.split(/:/)[1] || '';
        const phone = (namePart.match(/(\(\d{3}\)\s*\d{3}-\d{4})/) || [])[1];
        const relMatch = namePart.match(/\b(mother|father|parent|guardian|sister|brother|spouse|wife|husband|daughter|son|caregiver|friend)\b/i);
        if (namePart.trim()) {
          result.patient.emergencyContact = {
            raw: namePart.trim().slice(0,120),
            phone: phone || null,
            relationship: relMatch ? relMatch[1] : null
          };
          trace.push({ rule: 'patient_emergency_contact_detect' });
        }
      }
    }
  }

  // CPT (multi-detect)
  const cpt = detectCpt(fullText);
  if (cpt.hit) {
    const CPT_DESCRIPTIONS = {
      '95810': 'In-lab diagnostic polysomnography',
      '95811': 'In-lab PAP titration / split-night polysomnography',
      '95806': 'Home sleep apnea test (Type III)',
      'G0399': 'Home sleep apnea test (Type III) - alternative code',
      '95782': 'Pediatric in-lab polysomnography',
      '95783': 'Pediatric PAP titration',
      '95805': 'MSLT / MWT daytime sleep testing'
    };
    result.procedure = { ...result.procedure, cpt: cpt.primary, cptPrimary: cpt.primary, cptCandidates: cpt.candidates, cptDetails: cpt.details, description: CPT_DESCRIPTIONS[cpt.primary] };
    trace.push({ rule: cpt.why, primary: cpt.primary, candidates: cpt.candidates, details: cpt.details });
    if (Array.isArray(cpt.ambiguity) && cpt.ambiguity.length) {
      result.flags.verifyManually = true;
      result.flags.reasons.push(...cpt.ambiguity);
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_cpt_multiple']));
      trace.push({ rule: 'cpt_ambiguity', reasons: cpt.ambiguity });
    }
  }

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
    // Build primaryDiagnosis with description if available
    const primaryCode = values[0];
    if (primaryCode && Array.isArray(icd.details)) {
      const det = icd.details.find(d => d.code === primaryCode);
      if (det) {
        result.clinical.primaryDiagnosis = { code: det.code, description: det.description };
      }
      result.clinical.diagnosesDetailed = icd.details;
    }
    if (Array.isArray(icd.actions) && icd.actions.length) {
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), ...icd.actions]));
    }
    trace.push({ rule: icd.why, count: values.length });
  }

  // Carrier
  const car = detectCarrier(fullText, lines);
  if (car.hit) {
    const insObj = { carrier: car.value.carrier, status: car.value.status };
  // Member / Group IDs
  // Member / Group IDs (tightened: enforce word boundaries & separators to avoid concatenation 'ID: ABCGroup: DEF')
  const memberMatch = (fullText || '').match(/\b(?:member|subscriber|policy)\s*(?:id|#|number)?\s*[:#-]?\s*([A-Z0-9]{3,})\b/i);
  if (memberMatch) insObj.memberId = memberMatch[1];
  const groupMatch = (fullText || '').match(/\bgroup\s*(?:id|#|number)?\s*[:#-]?\s*([A-Z0-9]{2,})\b/i);
  if (groupMatch) insObj.groupId = groupMatch[1];
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

  // Secondary insurance naive detection: look for a second labeled line
  if (result.insurance.length === 1) {
    const linesArr = (fullText || '').split(/\n/);
    const carrierLineIndices = [];
    for (let i=0;i<linesArr.length;i++) if (/(other\s+insurance|secondary\s+insurance|secondary\b|insurance|plan|payer)\s*[:\-]/i.test(linesArr[i])) carrierLineIndices.push(i);
    if (carrierLineIndices.length > 1) {
      // Evaluate candidates beyond the first; choose the best distinct carrier with minimal line distance overlap
      const primaryCarrier = result.insurance[0].carrier;
      let best = null;
      for (let idx = 1; idx < carrierLineIndices.length; idx++) {
        const start = carrierLineIndices[idx];
        const end = Math.min(linesArr.length, start + 8);
        const blockLines = linesArr.slice(start, end);
        const block = blockLines.join('\n');
        const sec = detectCarrier(block, blockLines);
        if (sec.hit && sec.value.carrier !== primaryCarrier) {
          // Correlate memberId pattern distinctness
          const mid = block.match(/(?:member|subscriber|policy)\s*(?:id|#|number)?[:\s]*([A-Z0-9]{5,})/i);
          const gid = block.match(/group\s*(?:id|#|number)?[:\s]*([A-Z0-9]{3,})/i);
          const memberId = mid ? mid[1] : null;
          const groupId = gid ? gid[1] : null;
          const distance = start - carrierLineIndices[0];
          const score = (memberId ? 1 : 0) + (groupId ? 0.5 : 0) + (distance > 2 ? 0.25 : 0) + (/(other|secondary)/i.test(linesArr[start]) ? 0.5 : 0);
          if (!best || score > best.score) {
            best = { sec, memberId, groupId, score };
          }
        }
      }
      if (best) {
        const secObj = { carrier: best.sec.value.carrier, status: best.sec.value.status };
        if (best.memberId) secObj.memberId = best.memberId;
        if (best.groupId) secObj.groupId = best.groupId;
        result.insurance.push(secObj);
        trace.push({ rule: 'carrier_secondary_detect_refined', value: secObj.carrier, score: best.score });
      }
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
    const titrationCriteria = /(pressure\s*too\s*(high|low)|not\s*tolerating\s*(cpap|pressure)|failed\s*(cpap|pap|apap)|needs?\s*(pressure|settings)|still\s*tired\s*on\s*cpap|titration|pressures?\s*adjusted|urgent\/?stat\s+titration)/i;
    if (!titrationCriteria.test(fullText || '')) {
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

  // Provider detection (basic)
  {
    const provLine = (fullText || '').split(/\n/).find(l => /(referring|ordering)\s*(provider|physician)|\bDr\.?\s+[A-Z]/i.test(l));
    if (provLine) {
      const nameMatch = provLine.match(/(Dr\.?\s*)?([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+)/);
      if (nameMatch) {
        result.provider.name = nameMatch[2];
        trace.push({ rule: 'provider_name_detect', value: result.provider.name });
        // Credential normalization in same or nearby line
        const credMatch = provLine.match(/\b(NP|PA-?C|MD|DO|FNP)\b/i);
        if (credMatch) {
          const cred = credMatch[1].toUpperCase().replace(/PA ?C/i,'PA-C');
          result.provider.name = `${result.provider.name}, ${cred}`;
          trace.push({ rule: 'provider_credential_append', value: cred });
        }
      }
    }
    const npiMatch = (fullText || '').match(/\b(\d{10})\b/);
  if (npiMatch) { result.provider.npi = npiMatch[1]; trace.push({ rule: 'provider_npi_detect' }); }
    // Provider phones/fax
    const linesArr = (fullText || '').split(/\n/);
    for (const L of linesArr) {
      if (/fax/i.test(L) && /(\d[\d\-()\s]{8,}\d)/.test(L)) {
        const digits = L.match(/(\d[\d\-()\s]{8,}\d)/)[1].replace(/\D/g,'');
        if (digits.length === 10) result.provider.fax = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
      }
    }
    // Post-filter patient phones: remove provider fax if present
    if (result.provider.fax && Array.isArray(result.patient.phones)) {
      const before = result.patient.phones.length;
      result.patient.phones = result.patient.phones.filter(p => p !== result.provider.fax);
      if (result.patient.phones.length !== before) {
        trace.push({ rule: 'patient_phone_remove_fax_match', removed: result.provider.fax });
      }
    }
      // Classify altPhones if more than 1 remains
      if (Array.isArray(result.patient.phones) && result.patient.phones.length > 1) {
        result.patient.altPhones = result.patient.phones.slice(1);
        result.patient.phones = [result.patient.phones[0]];
        trace.push({ rule: 'patient_alt_phones_split', count: result.patient.altPhones.length });
      }
  }

  // Provider notes phrases
  {
    const notes = [];
    const notePhrases = [
      { re: /eval\s*&\s*treat|evaluation\s+and\s+treatment/i, label: 'eval & treat' },
      { re: /urgent|stat/i, label: 'urgent/stat' },
      { re: /complete\s+study/i, label: 'complete study' },
      { re: /split[- ]?night/i, label: 'split-night' },
      { re: /titration/i, label: 'titration' }
    ];
    for (const obj of notePhrases) if (obj.re.test(fullText || '')) notes.push(obj.label);
    if (notes.length) { result.procedure.providerNotes = Array.from(new Set(notes)).slice(0,6); trace.push({ rule: 'provider_notes_detect', count: result.procedure.providerNotes.length }); }
  }

  // Symptoms list
  {
    const symptoms = [];
    const SYM_MAP = [
      ['snoring', /snor(?:e|ing)/i],
      ['daytime_sleepiness', /(excessive\s+daytime\s+sleepiness|hypersomnia)/i],
      ['fatigue', /fatigue|tired/i],
      ['witnessed_apnea', /witnessed\s+(apnea|apneic)/i],
      ['choking_gasping', /gasping|choking/i],
      ['insomnia', /insomnia|difficulty\s+(falling|staying)\s+asleep/i],
      ['restless_legs', /restless\s+legs|rls/i],
      ['headache', /headache/i]
    ];
    for (const [label,re] of SYM_MAP) if (re.test(fullText || '')) symptoms.push(label);
    if (symptoms.length) { result.clinical.symptoms = symptoms; trace.push({ rule: 'symptoms_detect', count: symptoms.length }); }
  }

  // Vitals (BMI, height, weight, BP) with BP validation to avoid date-like artifacts
  {
    const vitals = {};
    const bmi = (fullText || '').match(/BMI\s*[:]?\s*(\d{2}(?:\.\d)?)/i);
    if (bmi) vitals.bmi = bmi[1];
    const bp = (fullText || '').match(/\b(\d{2,3})\/(\d{2,3})\b\s*(?:mmhg|blood\s*pressure|bp)?/i);
    if (bp) {
      const sys = parseInt(bp[1],10), dia = parseInt(bp[2],10);
      if (sys >= 80 && sys <= 220 && dia >= 40 && dia <= 140) vitals.bp = `${bp[1]}/${bp[2]}`; // plausible range
    }
    const wt = (fullText || '').match(/(?:weight|wt)\s*[:]?\s*(\d{2,3})\s*(?:lbs?|pounds?)/i);
    if (wt) vitals.weightLbs = wt[1];
    const ht = (fullText || '').match(/(?:height|ht)\s*[:]?\s*(\d['’]\s*\d{1,2}"?)/i);
    if (ht) vitals.height = ht[1].replace(/\s+/g,'');
    if (Object.keys(vitals).length) { result.clinical.vitals = vitals; trace.push({ rule: 'vitals_detect', keys: Object.keys(vitals) }); }
  }

  // Info alerts (PPE, safety, communication, accommodations)
  {
    const txtLower = (fullText || '').toLowerCase();
    const info = { ppeRequired: null, safety: [], communication: [], accommodations: [] };
    if (/(isolation|airborne|droplet|ppe required|mask required)/i.test(fullText || '')) info.ppeRequired = true; else if (/no ppe/i.test(fullText || '')) info.ppeRequired = false;
    const safetyMap = [ ['seizure', /seizure|epilepsy/], ['cardiac_device', /pacemaker|defibrillator|cardiac\s+device/], ['mobility', /wheelchair|walker|limited\s+mobility|bedbound|bed\s+confined/], ['oxygen', /oxygen|o2\s+dependent/] ];
    for (const [k,re] of safetyMap) if (re.test(txtLower)) info.safety.push(k);
    const commMap = [ ['hearing_impaired', /hearing\s+impaired|hard\s+of\s+hearing|deaf/], ['language_barrier', /spanish\s+only|interpreter|translation\s+needed|language\s+barrier/] ];
    for (const [k,re] of commMap) if (re.test(txtLower)) info.communication.push(k);
    const accomMap = [ ['wheelchair', /wheelchair/], ['oxygen', /oxygen\s+dependent/], ['caretaker', /caretaker|caregiver|guardian/] ];
    for (const [k,re] of accomMap) if (re.test(txtLower)) info.accommodations.push(k);
    if (info.ppeRequired !== null || info.safety.length || info.communication.length || info.accommodations.length) {
      result.infoAlerts = info; trace.push({ rule: 'info_alerts_detect', safety: info.safety.length, communication: info.communication.length, accommodations: info.accommodations.length });
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

  // Authorization notes (derive simple narrative from actions & insurance status)
  {
    const notes = [];
    const acts = new Set(result.alerts?.actions || []);
    const primaryIns = Array.isArray(result.insurance) ? result.insurance[0] : null;
    const carrier = primaryIns?.carrier || '';
    if (acts.has('wrong_test_ordered')) notes.push('Review clinical indication vs ordered test.');
    if (acts.has('review_95811_required')) notes.push('Verify titration criteria for 95811.');
    if (acts.has('missing_chart_notes')) notes.push('Obtain chart or progress notes.');
    if (acts.has('insurance_issue')) notes.push('Verify active insurance coverage / benefits.');
    if (primaryIns && primaryIns.status === 'not_accepted') notes.push('Plan not accepted: confirm self-pay or alternate insurance.');
    if (primaryIns?.sunsetDays != null && primaryIns.sunsetDays <= 30 && primaryIns.sunsetDays >= 0) notes.push('Contract nearing end; confirm authorization path.');
  // Simple carrier-specific heuristics (extendable)
  const cL = carrier.toLowerCase();
  if (cL.includes('medicare')) notes.push('Medicare: Typically no prior auth for diagnostic PSG (95810); confirm local coverage if atypical.');
  if (cL.includes('aetna')) notes.push('Aetna: Check policy for HSAT vs PSG criteria; document failed HSAT if escalating to in-lab.');
  if (cL.includes('anthem') || cL.includes('blue')) notes.push('Anthem/BCBS: Prior auth may be required for in-lab studies when HSAT criteria not met.');
  if (cL.includes('uhc') || cL.includes('united')) notes.push('UHC: Ensure comorbidities supporting in-lab documented (cardiopulmonary, neuromuscular, hypoventilation).');
    if (notes.length) {
      result.documentMeta = { ...(result.documentMeta||{}), authorizationNotes: notes };
      trace.push({ rule: 'auth_notes_derive', count: notes.length });
    }
  }

  return { result, trace };
}
