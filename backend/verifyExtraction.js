/**
 * verifyExtraction.js — Post-extraction verification layer (v2)
 * 
 * Three verification passes:
 * 
 * Pass A: String-match verification (instant, no LLM)
 *   Checks that each extracted value actually appears in the OCR text.
 *   Catches hallucinations (LLM made up data that's not in the document).
 * 
 * Pass B: Uncertainty detection (instant, no LLM)
 *   Analyzes the extraction result + OCR text for signals that the
 *   VLM cross-check is actually warranted. Avoids wasting ~30s on
 *   docs where everything looks clean.
 *   Triggers: multiple phone numbers, provider phone == patient phone digits,
 *   missing critical fields, low confidence, string-match hallucinations.
 * 
 * Pass C: VLM confirmation check (~25-35s, vision model on page 1)
 *   ONLY runs when Pass B detects uncertainty.
 *   Uses CONFIRMATION prompt: shows the VLM what the text-LLM extracted
 *   and asks "is this correct?" — much more accurate than asking VLM to
 *   extract independently and comparing two noisy answers.
 *   Catches misattribution (real data assigned to wrong field).
 * 
 * Output: Adds _verification object + flags to the result.
 */

import { log } from './logging/logger.js';
import fs from 'fs';

const OLLAMA_HOST = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const VLM_MODEL = process.env.VLM_MODEL || 'qwen2.5vl:7b';
const VLM_TIMEOUT = parseInt(process.env.VLM_TIMEOUT || '180000', 10);

// ──────────────────────────────────────────────────────────
// Pass A: String-match verification
// ──────────────────────────────────────────────────────────

/**
 * Normalize a string for fuzzy matching: lowercase, strip non-alphanumeric.
 */
function norm(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Check if a value (or a fuzzy version) appears anywhere in the OCR text.
 * Returns { found: boolean, matchType: string }
 */
function valueInText(value, ocrText) {
  if (!value || !ocrText) return { found: false, matchType: 'not_found' };

  const val = String(value).trim();
  if (val.length < 2) return { found: true, matchType: 'too_short' };

  // Exact match
  if (ocrText.includes(val)) return { found: true, matchType: 'exact' };

  // Case-insensitive match
  if (ocrText.toLowerCase().includes(val.toLowerCase())) return { found: true, matchType: 'case_insensitive' };

  // Normalized match (strip punctuation, spaces)
  const normVal = norm(val);
  const normText = norm(ocrText);
  if (normVal.length > 2 && normText.includes(normVal)) return { found: true, matchType: 'normalized' };

  // For names: check if each word appears individually (OCR may split them)
  const words = val.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 1) {
    const allFound = words.every(w => ocrText.toLowerCase().includes(w.toLowerCase()));
    if (allFound) return { found: true, matchType: 'words_split' };
  }

  // For phone numbers: check digits only
  const digits = val.replace(/\D/g, '');
  if (digits.length >= 7) {
    const textDigits = ocrText.replace(/\D/g, '');
    if (textDigits.includes(digits)) return { found: true, matchType: 'digits' };
  }

  return { found: false, matchType: 'not_found' };
}

/**
 * Run string-match verification on all key fields.
 * Returns { fieldChecks, hallucinations, score }
 */
export function stringMatchVerify(result, ocrText) {
  const checks = {};
  const hallucinations = [];

  // Patient fields
  const p = result.patient || {};
  if (p.first) {
    checks.patientFirst = valueInText(p.first, ocrText);
    if (!checks.patientFirst.found) hallucinations.push(`patient.first "${p.first}" not found in OCR text`);
  }
  if (p.last) {
    checks.patientLast = valueInText(p.last, ocrText);
    if (!checks.patientLast.found) hallucinations.push(`patient.last "${p.last}" not found in OCR text`);
  }
  if (p.dob) {
    checks.patientDob = valueInText(p.dob, ocrText);
    if (!checks.patientDob.found) {
      const parts = p.dob.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (parts) {
        const altFormats = [
          `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[3]}`,
          `${parts[1]}-${parts[2]}-${parts[3]}`,
          `${parts[3]}-${parts[1]}-${parts[2]}`,
        ];
        const anyFound = altFormats.some(f => ocrText.includes(f));
        if (anyFound) {
          checks.patientDob = { found: true, matchType: 'alt_date_format' };
        } else {
          hallucinations.push(`patient.dob "${p.dob}" not found in OCR text`);
        }
      }
    }
  }
  if (p.phones?.length) {
    for (const phone of p.phones) {
      const key = `patientPhone_${phone}`;
      checks[key] = valueInText(phone, ocrText);
      if (!checks[key].found) hallucinations.push(`patient.phone "${phone}" not found in OCR text`);
    }
  }

  // Provider fields
  const prov = result.provider || {};
  if (prov.name) {
    checks.providerName = valueInText(prov.name, ocrText);
  }
  if (prov.phone) {
    checks.providerPhone = valueInText(prov.phone, ocrText);
    if (!checks.providerPhone.found) hallucinations.push(`provider.phone "${prov.phone}" not found in OCR text`);
  }
  if (prov.npi) {
    checks.providerNpi = valueInText(prov.npi, ocrText);
    if (!checks.providerNpi.found) hallucinations.push(`provider.npi "${prov.npi}" not found in OCR text`);
  }

  // Insurance
  const ins = (result.insurance || [])[0] || {};
  if (ins.memberId) {
    checks.memberId = valueInText(ins.memberId, ocrText);
    if (!checks.memberId.found) hallucinations.push(`insurance.memberId "${ins.memberId}" not found in OCR text`);
  }

  // Score: percentage of checked fields that were found
  const checkedFields = Object.values(checks);
  const foundCount = checkedFields.filter(c => c.found).length;
  const score = checkedFields.length > 0 ? foundCount / checkedFields.length : 1;

  return { fieldChecks: checks, hallucinations, score };
}

// ──────────────────────────────────────────────────────────
// Pass B: Uncertainty detection — should we bother with VLM?
// ──────────────────────────────────────────────────────────

/**
 * Analyze the extraction result for uncertainty signals.
 * Returns { needsVlm: boolean, reasons: string[], score: number }
 * 
 * Score 0 = no uncertainty, higher = more reasons to run VLM.
 * VLM triggers at score >= 1.
 */
export function detectUncertainty(result, ocrText, stringCheckResult) {
  const reasons = [];
  let score = 0;
  const p = result.patient || {};
  const prov = result.provider || {};

  // 1. String-match found hallucinations — LLM may have fabricated data
  if (stringCheckResult.hallucinations.length > 0) {
    score += 2;
    reasons.push(`hallucinations: ${stringCheckResult.hallucinations.length} field(s) not found in OCR text`);
  }

  // 2. Multiple patient phones — common misattribution vector
  //    (LLM throws in provider phone + patient phone together)
  if (p.phones?.length > 1) {
    // Extra suspicious: does any patient phone match provider phone digits?
    const provDigits = (prov.phone || '').replace(/\D/g, '');
    const faxDigits = (prov.fax || '').replace(/\D/g, '');
    const overlap = p.phones.some(ph => {
      const phDigits = ph.replace(/\D/g, '');
      return (provDigits.length >= 7 && (phDigits === provDigits || phDigits.includes(provDigits) || provDigits.includes(phDigits))) ||
             (faxDigits.length >= 7 && phDigits === faxDigits);
    });
    if (overlap) {
      score += 3; // Definite misattribution signal
      reasons.push('patient phone list contains provider phone or fax number');
    }
    // Multiple phones alone is weak signal — only worth 0.5
    // (many docs legitimately have home + cell)
  }

  // 3. Provider phone same digits as patient phone
  if (p.phones?.length === 1 && prov.phone) {
    const patDigits = p.phones[0].replace(/\D/g, '');
    const provDigits = prov.phone.replace(/\D/g, '');
    if (patDigits.length >= 7 && patDigits === provDigits) {
      score += 3;
      reasons.push('patient phone is identical to provider phone');
    }
  }

  // 4. Provider fax == patient phone (another common swap)
  if (p.phones?.length && prov.fax) {
    const faxDigits = (prov.fax || '').replace(/\D/g, '');
    const hasMatch = p.phones.some(ph => ph.replace(/\D/g, '') === faxDigits);
    if (hasMatch && faxDigits.length >= 7) {
      score += 2;
      reasons.push('patient phone is identical to provider fax');
    }
  }

  // 5. Missing critical patient fields — LLM may have misplaced them
  if (!p.first || !p.last) {
    score += 2;
    reasons.push('missing patient name');
  }
  if (!p.dob) {
    score += 1;
    reasons.push('missing patient DOB');
  }

  // 6. Low confidence from the LLM itself
  const conf = result.confidenceScore || 0;
  if (conf < 0.7) {
    score += 2;
    reasons.push(`low LLM confidence: ${conf}`);
  } else if (conf < 0.75) {
    score += 1;
    reasons.push(`low-moderate LLM confidence: ${conf}`);
  }

  // 7. Provider name missing but we have a phone — suspicious context
  if (!prov.name && prov.phone) {
    score += 1;
    reasons.push('provider phone without provider name');
  }

  // 8. Multiple distinct phone numbers in the OCR text
  //    Only flag if there are a LOT — every fax has sender/receiver phones
  const allDigitSequences = (ocrText.match(/\d{3}[\s.-]*\d{3}[\s.-]*\d{4}/g) || [])
    .map(ph => ph.replace(/\D/g, ''));
  const uniquePhones = [...new Set(allDigitSequences)];
  if (uniquePhones.length >= 8) {
    score += 1;
    reasons.push(`${uniquePhones.length} phone numbers in OCR text — high ambiguity`);
  }

  return {
    needsVlm: score >= 2,
    reasons,
    score,
  };
}

// ──────────────────────────────────────────────────────────
// Pass C: VLM confirmation check (confirmation prompt)
// ──────────────────────────────────────────────────────────

/**
 * Build a CONFIRMATION prompt — instead of asking VLM to extract from scratch,
 * we show it what the text-LLM found and ask "is this correct?"
 * 
 * Why this is better:
 * - VLM's spatial awareness identifies WHERE on the page data appears
 * - Confirmation is easier than extraction → higher accuracy
 * - Response is tiny (just yes/no per field + corrections) → faster
 * - No risk of comparing two independently wrong extractions
 */
function buildConfirmationPrompt(result) {
  const p = result.patient || {};
  const prov = result.provider || {};

  const patientPhones = (p.phones || []).join(', ') || 'none found';
  const provPhone = prov.phone || 'none found';
  const provFax = prov.fax || 'none found';

  return `I extracted data from this medical document using OCR + text analysis. I need you to VERIFY my extraction by looking at the actual document image.

MY EXTRACTION:
  Patient Name: ${p.first || '?'} ${p.last || '?'}
  Patient DOB: ${p.dob || '?'}
  Patient Phone(s): ${patientPhones}
  Patient Address: ${p.address?.street || '?'}, ${p.address?.city || '?'}, ${p.address?.state || '?'} ${p.address?.zip || '?'}
  Provider Name: ${prov.name || '?'}
  Provider Phone: ${provPhone}
  Provider Fax: ${provFax}

For EACH field, respond with:
- "correct" if my extraction matches what you see in the document
- "wrong" with the correct value if I got it wrong
- "swapped" if I assigned the right data to the wrong field (e.g. provider phone in patient phone)
- "unsure" if you can't clearly read it

Respond in this exact JSON format:
{
  "patientFirst": { "verdict": "correct|wrong|swapped|unsure", "correction": "correct value or null" },
  "patientLast": { "verdict": "correct|wrong|swapped|unsure", "correction": "correct value or null" },
  "patientDob": { "verdict": "correct|wrong|swapped|unsure", "correction": "correct value or null" },
  "patientPhone": { "verdict": "correct|wrong|swapped|unsure", "correction": "correct value or null", "note": "optional explanation" },
  "providerName": { "verdict": "correct|wrong|swapped|unsure", "correction": "correct value or null" },
  "providerPhone": { "verdict": "correct|wrong|swapped|unsure", "correction": "correct value or null" }
}

CRITICAL RULES:
- Patient phone = personal/home/cell number, usually near their name/address section
- Provider phone = doctor's office number, usually in letterhead or near practice name
- These are DIFFERENT numbers from different parts of the document
- If my patient phone is actually the provider's number, verdict = "swapped"
- Output ONLY valid JSON. No markdown, no explanation.`;
}

/**
 * Call VLM on page 1 with a confirmation prompt.
 */
async function vlmConfirmationCheck(imagePath, result) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VLM_TIMEOUT);

  try {
    const prompt = buildConfirmationPrompt(result);
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_MODEL,
        prompt,
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 768,
          top_p: 0.9,
        }
      })
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`VLM returned ${response.status}`);

    const data = await response.json();
    const raw = data.response || '';

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { parsed: null, raw };

    try {
      return { parsed: JSON.parse(jsonMatch[0]), raw };
    } catch {
      return { parsed: null, raw };
    }
  } catch (err) {
    clearTimeout(timeout);
    log('warn', 'vlm_confirmation_error', { error: err.message });
    return { parsed: null, raw: err.message };
  }
}

/**
 * Process VLM confirmation verdicts into matches/mismatches/corrections.
 */
function processVerdicts(verdicts, result) {
  const matches = [];
  const mismatches = [];
  const corrections = {};

  const p = result.patient || {};
  const prov = result.provider || {};

  const fieldMap = {
    patientFirst: { path: 'patient.first', current: p.first },
    patientLast: { path: 'patient.last', current: p.last },
    patientDob: { path: 'patient.dob', current: p.dob },
    patientPhone: { path: 'patient.phone', current: p.phones?.[0] },
    providerName: { path: 'provider.name', current: prov.name },
    providerPhone: { path: 'provider.phone', current: prov.phone },
  };

  for (const [key, field] of Object.entries(fieldMap)) {
    const v = verdicts[key];
    if (!v) continue;

    const verdict = (v.verdict || '').toLowerCase().trim();
    const correction = v.correction || null;

    if (verdict === 'correct') {
      matches.push({ field: field.path, value: field.current });
    } else if (verdict === 'wrong' && correction) {
      mismatches.push({
        field: field.path,
        extracted: field.current,
        vlmSays: correction,
        verdict: 'wrong',
        severity: ['patient.first', 'patient.last', 'patient.dob', 'patient.phone'].includes(field.path) ? 'high' : 'medium',
        note: v.note || null,
      });
      corrections[field.path] = correction;
    } else if (verdict === 'swapped') {
      mismatches.push({
        field: field.path,
        extracted: field.current,
        vlmSays: correction || 'swapped with another field',
        verdict: 'swapped',
        severity: 'high',
        note: v.note || `VLM says this value belongs to a different field`,
      });
      if (correction) corrections[field.path] = correction;
    } else if (verdict === 'unsure') {
      // Don't flag unsure — VLM couldn't read it, not helpful
      matches.push({ field: field.path, value: field.current, uncertain: true });
    }
  }

  return { matches, mismatches, corrections };
}

/**
 * Auto-correct the result using VLM verdicts.
 * Only applies corrections when VLM is confident (verdict = "wrong" or "swapped" with a correction value).
 */
function applyCorrections(result, corrections) {
  const applied = [];
  const p = result.patient || {};
  const prov = result.provider || {};

  if (corrections['patient.first']) {
    const old = p.first;
    p.first = corrections['patient.first'];
    applied.push({ field: 'patient.first', old, new: p.first });
  }
  if (corrections['patient.last']) {
    const old = p.last;
    p.last = corrections['patient.last'];
    applied.push({ field: 'patient.last', old, new: p.last });
  }
  if (corrections['patient.dob']) {
    const old = p.dob;
    p.dob = corrections['patient.dob'];
    applied.push({ field: 'patient.dob', old, new: p.dob });
  }
  if (corrections['patient.phone']) {
    const old = p.phones?.[0];
    const corrected = corrections['patient.phone'].replace(/\D/g, '');
    if (corrected.length >= 7) {
      // Replace first phone or set if empty; keep others
      if (p.phones?.length) {
        // Remove any phones that match the provider phone (it was swapped)
        const provDigits = (prov.phone || '').replace(/\D/g, '');
        p.phones = p.phones.filter(ph => ph.replace(/\D/g, '') !== provDigits);
        // Add the corrected phone if not already there
        if (!p.phones.some(ph => ph.replace(/\D/g, '') === corrected)) {
          p.phones.unshift(corrected);
        }
      } else {
        p.phones = [corrected];
      }
      applied.push({ field: 'patient.phone', old, new: corrected });
    }
  }
  if (corrections['provider.name']) {
    const old = prov.name;
    prov.name = corrections['provider.name'];
    applied.push({ field: 'provider.name', old, new: prov.name });
  }
  if (corrections['provider.phone']) {
    const old = prov.phone;
    prov.phone = corrections['provider.phone'].replace(/\D/g, '');
    applied.push({ field: 'provider.phone', old, new: prov.phone });
  }

  return applied;
}

// ──────────────────────────────────────────────────────────
// Main verification entry point
// ──────────────────────────────────────────────────────────

/**
 * Run full verification on an extraction result.
 * 
 * @param {Object} result - The normalized extraction result
 * @param {string} ocrText - Combined OCR text from all pages
 * @param {string|null} page1ImagePath - Path to page 1 image for VLM check (null to skip)
 * @param {Object} options - { id, forceVlm }
 * @returns {Object} result with _verification and updated flags
 */
export async function verifyExtraction(result, ocrText, page1ImagePath, options = {}) {
  const { id = 'unknown', forceVlm = false } = options;
  const t0 = Date.now();

  // Pass A: String-match verification (instant)
  const stringCheck = stringMatchVerify(result, ocrText);
  log('info', 'verify_string_match', {
    id,
    score: stringCheck.score.toFixed(2),
    hallucinations: stringCheck.hallucinations.length,
    details: stringCheck.hallucinations.slice(0, 3)
  });

  // Pass B: Uncertainty detection (instant)
  const uncertainty = detectUncertainty(result, ocrText, stringCheck);
  log('info', 'verify_uncertainty', {
    id,
    needsVlm: uncertainty.needsVlm,
    score: uncertainty.score,
    reasons: uncertainty.reasons.slice(0, 3),
  });

  // Pass C: VLM confirmation check — ONLY if uncertain (or force flag)
  let vlmCheck = null;
  const shouldRunVlm = (uncertainty.needsVlm || forceVlm) && page1ImagePath && fs.existsSync(page1ImagePath);
  
  if (shouldRunVlm) {
    const vlmStart = Date.now();
    log('info', 'verify_vlm_start', { id, model: VLM_MODEL, trigger: uncertainty.reasons[0] || 'forced' });

    const { parsed: verdicts, raw } = await vlmConfirmationCheck(page1ImagePath, result);
    const vlmElapsed = Date.now() - vlmStart;

    if (verdicts) {
      const { matches, mismatches, corrections } = processVerdicts(verdicts, result);
      
      // Auto-apply corrections from VLM
      let applied = [];
      if (Object.keys(corrections).length > 0) {
        applied = applyCorrections(result, corrections);
        if (applied.length > 0) {
          log('info', 'verify_vlm_corrections_applied', { id, corrections: applied });
        }
      }

      vlmCheck = { matches, mismatches, corrections: applied, elapsed: vlmElapsed, verdicts };
      
      log('info', 'verify_vlm_complete', {
        id,
        elapsed: vlmElapsed,
        matches: matches.length,
        mismatches: mismatches.length,
        correctionsApplied: applied.length,
        mismatchFields: mismatches.map(m => m.field)
      });
    } else {
      log('warn', 'verify_vlm_no_result', { id, elapsed: vlmElapsed, raw: (raw || '').slice(0, 200) });
    }
  } else if (!uncertainty.needsVlm && !forceVlm) {
    log('info', 'verify_vlm_skipped', { id, reason: 'no_uncertainty_detected' });
  }

  // Build verification summary
  const verification = {
    stringMatch: {
      score: stringCheck.score,
      hallucinations: stringCheck.hallucinations,
    },
    uncertainty: {
      needsVlm: uncertainty.needsVlm,
      score: uncertainty.score,
      reasons: uncertainty.reasons,
    },
    vlmConfirmation: vlmCheck ? {
      matches: vlmCheck.matches.map(m => m.field),
      mismatches: vlmCheck.mismatches,
      correctionsApplied: vlmCheck.corrections,
      elapsed: vlmCheck.elapsed,
    } : null,
    elapsed: Date.now() - t0,
    verified: true,
  };

  // Determine overall verification status
  const highSeverityMismatches = vlmCheck?.mismatches?.filter(m => m.severity === 'high') || [];
  const hasHallucinations = stringCheck.hallucinations.length > 0;
  const hasMisattribution = highSeverityMismatches.length > 0;
  const wasAutoCorrected = (vlmCheck?.corrections?.length || 0) > 0;

  if (hasMisattribution && !wasAutoCorrected) {
    // Misattribution found but we couldn't auto-correct — manual review needed
    verification.status = 'flagged';
    verification.flagReasons = highSeverityMismatches.map(m =>
      `${m.verdict === 'swapped' ? 'Swap' : 'Mismatch'}: ${m.field} — extracted "${m.extracted}", VLM says "${m.vlmSays}"${m.note ? ` (${m.note})` : ''}`
    );
  } else if (wasAutoCorrected) {
    // VLM found issues but we auto-corrected them
    verification.status = 'auto_corrected';
    verification.corrections = vlmCheck.corrections;
  } else if (hasHallucinations) {
    // Values not found in text
    verification.status = 'flagged';
    verification.flagReasons = stringCheck.hallucinations.map(h => `Hallucination: ${h}`);
  } else if (shouldRunVlm && vlmCheck && vlmCheck.mismatches.length === 0) {
    // VLM ran and confirmed everything
    verification.status = 'vlm_confirmed';
  } else {
    // String-match passed, no uncertainty detected
    verification.status = uncertainty.needsVlm ? 'unverified' : 'confirmed';
  }

  // Merge into result
  result._verification = verification;

  // Update flags
  if (!result.flags) result.flags = { verifyManually: false, reasons: [] };
  if (verification.status === 'flagged') {
    result.flags.verifyManually = true;
    result.flags.reasons = [
      ...new Set([...(result.flags.reasons || []), ...(verification.flagReasons || [])])
    ];
  }

  log('info', 'verify_complete', {
    id,
    status: verification.status,
    stringScore: stringCheck.score.toFixed(2),
    uncertaintyScore: uncertainty.score,
    vlmRan: !!vlmCheck,
    hallucinations: stringCheck.hallucinations.length,
    mismatches: highSeverityMismatches.length,
    corrections: vlmCheck?.corrections?.length || 0,
    elapsed: verification.elapsed
  });

  return result;
}

export default { verifyExtraction, stringMatchVerify, detectUncertainty };
