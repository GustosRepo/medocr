/**
 * textLlmExtractor.js — OCR text + text-only LLM extraction pipeline
 * 
 * Architecture:
 *   1. OCR service reads the PDF → raw text per page (2-5 seconds)
 *   2. All page texts are concatenated into a single prompt
 *   3. Text-only qwen2.5:7b extracts structured JSON (3-8 seconds)
 *   4. Same normalizeVlmResult post-processing as the VLM pipeline
 *   5. Total: ~10-15 seconds per doc vs ~160 seconds with VLM
 * 
 * Falls back to VLM pipeline when OCR confidence is below threshold.
 */

import { log } from './logging/logger.js';
import { normalizeVlmResult, parseVlmJson } from './vlmExtractor.js';
import { buildKbPromptContext } from './kbLoader.js';

const TEXT_MODEL = process.env.TEXT_MODEL || 'qwen2.5:14b';
const TEXT_TIMEOUT = parseInt(process.env.TEXT_TIMEOUT || '180000', 10);
const TEXT_TEMPERATURE = parseFloat(process.env.TEXT_TEMPERATURE || '0.1');
const OCR_CONFIDENCE_THRESHOLD = parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.80');
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

// ──────────────────────────────────────────────
// Regex pre-extraction: pull structured hints from raw OCR text
// before sending to LLM. These hints are injected into the prompt
// so the LLM can confirm/override them rather than find them from scratch.
// ──────────────────────────────────────────────

/**
 * Extract patient name candidates from OCR text using regex patterns.
 * Returns { first, last } or null.
 */
function regexExtractName(text) {
  const candidates = [];
  
  // Pattern 1: "Patient Name: LASTNAME, FIRSTNAME" or "Patient Name: FIRSTNAME LASTNAME"
  const pnMatch = text.match(/Patient\s*Name\s*[:;.]\s*([A-Z][A-Za-z'-]+)\s*[,]\s*([A-Z][A-Za-z'-]+)/i);
  if (pnMatch) {
    candidates.push({ last: pnMatch[1].trim(), first: pnMatch[2].trim(), source: 'patient_name_label' });
  }
  
  // Pattern 2: "Veteran Name: Lastname, Firstname Middle"
  const vetMatch = text.match(/Veteran\s*Name\s*[:;.]\s*([A-Z][A-Za-z'-]+)\s*[,]\s*([A-Z][A-Za-z' -]+)/i);
  if (vetMatch) {
    const firstParts = vetMatch[2].trim().split(/\s+/);
    candidates.push({ last: vetMatch[1].trim(), first: firstParts[0].trim(), source: 'veteran_name' });
  }
  
  // Pattern 3: "Full Name: FIRSTNAME LASTNAME"
  const fullMatch = text.match(/Full\s*Name\s*[:;.]\s*([A-Z][A-Za-z'-]+)\s+([A-Z][A-Za-z'-]+)/i);
  if (fullMatch) {
    candidates.push({ first: fullMatch[1].trim(), last: fullMatch[2].trim(), source: 'full_name_label' });
  }
  
  // Pattern 4: "LASTNAME, FIRSTNAME (DOB:" pattern (common in clinical headers)
  const headerMatch = text.match(/([A-Z][A-Z'-]+)\s*[,]\s*([A-Z][A-Z'-]+)\s*\(\s*DOB/i);
  if (headerMatch) {
    candidates.push({ last: headerMatch[1].trim(), first: headerMatch[2].trim(), source: 'header_dob' });
  }
  
  // Pattern 5: "LASTNAME,FIRSTNAME" (no space after comma) followed by DOB or ID
  const compactMatch = text.match(/([A-Z][A-Za-z'-]+),([A-Z][A-Za-z'-]+)\s*\(?\s*(?:DOB|dob|ID)/i);
  if (compactMatch) {
    candidates.push({ last: compactMatch[1].trim(), first: compactMatch[2].trim(), source: 'compact_dob' });
  }
  
  // Pattern 6: "Firstname Lastname — MM/DD/YYYY" or "Firstname Lastname -MM/DD"
  const dashDobMatch = text.match(/([A-Z][a-z]+)\s+([A-Z][A-Za-z'-]+)\s*[—–-]\s*\d{1,2}\/\d{1,2}\/\d{2,4}/);
  if (dashDobMatch) {
    candidates.push({ first: dashDobMatch[1].trim(), last: dashDobMatch[2].trim(), source: 'name_dash_dob' });
  }
  
  // Pattern 7: After REFERRAL label, next line with ALL-CAPS "FIRSTNAME LASTNAME" (2-3 words)
  const refMatch = text.match(/REFERRAL[\s\S]{0,50}\n\s*([A-Z][A-Z'-]+)\s+([A-Z][A-Z'-]+)\s*\n/m);
  if (refMatch) {
    candidates.push({ first: refMatch[1].trim(), last: refMatch[2].trim(), source: 'referral_block' });
  }
  
  // Pattern 8: "Policy Holder: LASTNAME, FIRSTNAME"
  const phMatch = text.match(/Policy\s*Holder\s*[:;.]\s*([A-Z][A-Za-z'-]+)\s*[,]\s*([A-Z][A-Za-z' -]+)/i);
  if (phMatch) {
    candidates.push({ last: phMatch[1].trim(), first: phMatch[2].trim().split(/\s+/)[0], source: 'policy_holder' });
  }
  
  // Pattern 9: "FIRSTNAME LASTNAME" after PATIENT label (within 100 chars)
  const patientBlockMatch = text.match(/\bPATIENT\b[\s\S]{0,100}?\n\s*([A-Z][A-Z'-]+)\s+([A-Z][A-Z'-]+)\s*\n/m);
  if (patientBlockMatch) {
    // Filter out common non-name words
    const skip = new Set(['MEDICAL', 'CENTER', 'HOSPITAL', 'CLINIC', 'PRACTICE', 'GROUP', 'HEALTH', 'CARE', 'INSURANCE', 'PRIMARY', 'SECONDARY', 'PHONE', 'ADDRESS', 'STREET', 'REFERRAL', 'REPORT', 'STUDY', 'SLEEP', 'HOME', 'DIAGNOSTIC', 'NONE', 'UNKNOWN','NEMMEDICALCENTER1725SRAINBOW']);
    const w1 = patientBlockMatch[1].trim();
    const w2 = patientBlockMatch[2].trim();
    if (!skip.has(w1) && !skip.has(w2) && w1.length > 1 && w2.length > 1) {
      candidates.push({ first: w1, last: w2, source: 'patient_block' });
    }
  }
  
  // Pattern 10: "presents today for" — "Firstname Lastname presents today" in clinical notes
  const presentsMatch = text.match(/([A-Z][a-z]+)\s+([A-Z][A-Za-z'-]+)\s+presents\s+today/i);
  if (presentsMatch) {
    candidates.push({ first: presentsMatch[1].trim(), last: presentsMatch[2].trim(), source: 'presents_today' });
  }
  
  if (candidates.length === 0) return null;
  
  // Pick best candidate: prefer labeled sources over positional
  const priority = ['veteran_name', 'patient_name_label', 'full_name_label', 'header_dob', 'compact_dob', 'policy_holder', 'name_dash_dob', 'presents_today', 'referral_block', 'patient_block'];
  candidates.sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source));
  
  const best = candidates[0];
  // Title-case the result
  const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return {
    first: titleCase(best.first),
    last: titleCase(best.last),
    source: best.source,
    allCandidates: candidates.length
  };
}

/**
 * Extract DOB from OCR text using regex.
 * Returns "MM/DD/YYYY" or null.
 */
function regexExtractDob(text) {
  // Pattern: DOB: MM/DD/YYYY or DOB: M/D/YYYY or dob: M/DD/YY
  const dobMatch = text.match(/(?:DOB|Date\s*of\s*Birth|D\.?O\.?B\.?)\s*[:;.]?\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/i);
  if (dobMatch) {
    let [, m, d, y] = dobMatch;
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
  }
  // Pattern: "Firstname Lastname — MM/DD/YYYY"
  const dashMatch = text.match(/[A-Za-z]+\s+[A-Za-z]+\s*[—–-]\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (dashMatch) {
    let [, m, d, y] = dashMatch;
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
  }
  return null;
}

/**
 * Extract phone numbers near the patient section (not provider phones).
 * Returns array of 10-digit strings.
 */
function regexExtractPatientPhones(text) {
  const phones = [];
  // Look for phone near patient labels: H:, M:, Telephone:, Cell:
  const phonePatterns = [
    /(?:H|Home|M|Mobile|Cell|Telephone|Patient.*Phone)\s*[:;.]?\s*\(?\s*(\d{3})\s*\)?[\s.-]*(\d{3})[\s.-]*(\d{4})/gi,
  ];
  for (const pat of phonePatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      phones.push(m[1] + m[2] + m[3]);
    }
  }
  return [...new Set(phones)];
}

/**
 * Extract NPI from OCR text.
 * NPI is always 10 digits starting with 1 or 2.
 */
function regexExtractNpi(text) {
  const npiMatch = text.match(/NPI\s*[:;#.]?\s*([12]\d{9})/i);
  return npiMatch ? npiMatch[1] : null;
}

/**
 * Extract CPT codes from OCR text.
 */
function regexExtractCpt(text) {
  const cptMatch = text.match(/\b(95810|95811|95806|95800|95782|95783|95805|95801)\b/);
  return cptMatch ? cptMatch[1] : null;
}

/**
 * Extract ICD-10 codes from OCR text.
 */
function regexExtractIcd(text) {
  const codes = [];
  const icdPattern = /\b([A-TV-Z]\d{2}\.?\d{0,4})\b/g;
  let m;
  while ((m = icdPattern.exec(text)) !== null) {
    const code = m[1];
    // Filter out clearly non-ICD codes
    if (/^[A-TV-Z]\d{2}/.test(code) && !/^(NV|NV|VA|MD|DO|PA|PO|US)$/i.test(code)) {
      codes.push(code);
    }
  }
  return [...new Set(codes)].slice(0, 10);
}

/**
 * Run all regex extractions and build a hints object.
 */
function regexPreExtract(combinedText) {
  return {
    name: regexExtractName(combinedText),
    dob: regexExtractDob(combinedText),
    phones: regexExtractPatientPhones(combinedText),
    npi: regexExtractNpi(combinedText),
    cpt: regexExtractCpt(combinedText),
  };
}

/**
 * Build a hints block to inject into the LLM prompt.
 */
function buildHintsBlock(hints) {
  const parts = [];
  if (hints.name) {
    parts.push(`- Patient name (from document labels): first="${hints.name.first}", last="${hints.name.last}" [source: ${hints.name.source}]`);
  }
  if (hints.dob) {
    parts.push(`- Patient DOB (from document labels): ${hints.dob}`);
  }
  if (hints.phones.length > 0) {
    parts.push(`- Patient phone(s) (from labels like H:/M:/Telephone:): ${hints.phones.join(', ')}`);
  }
  if (hints.npi) {
    parts.push(`- Provider NPI (from NPI label): ${hints.npi}`);
  }
  if (hints.cpt) {
    parts.push(`- CPT code found in text: ${hints.cpt}`);
  }
  if (parts.length === 0) return '';
  return `\n\nPRE-EXTRACTED HINTS (regex-detected from the text — use these as strong signals, override only if clearly wrong):\n${parts.join('\n')}\n`;
}

/**
 * Extraction prompt designed for OCR text input (not images).
 * Key difference from VLM prompt: explicitly tells the model the text is OCR output
 * and may have ordering/spacing issues.
 */
const TEXT_EXTRACTION_PROMPT = `You are a medical document data extraction system. You are reading OCR-extracted text from a sleep medicine referral document (possibly a fax).

The text below was extracted by OCR and may be JUMBLED — words may appear out of order because OCR reads text boxes independently. Use context clues (labels like "Patient:", "DOB:", "Phone:", field proximity) to figure out which values belong to which fields.

Extract ALL structured data into this EXACT JSON format. Use null for any field you cannot determine.

{
  "patient": {
    "first": "first/given name" or null,
    "last": "last/family/surname" or null,
    "dob": "MM/DD/YYYY" or null,
    "phones": ["patient phone numbers — digits only"] or [],
    "email": "patient email" or null,
    "address": {
      "street": "patient home street address" or null,
      "city": "city" or null,
      "state": "2-letter state" or null,
      "zip": "zip code" or null
    }
  },
  "insurance": [
    {
      "carrier": "insurance company name" or null,
      "memberId": "member/subscriber ID exactly as printed" or null,
      "groupId": "group number" or null,
      "planType": "HMO/PPO/EPO/POS/Medicare/Medicaid" or null
    }
  ],
  "referringProvider": {
    "name": "referring/ordering physician full name with credentials" or null,
    "npi": "10-digit NPI (starts with 1 or 2, NOT a phone number)" or null,
    "practice": "practice/clinic/facility name" or null,
    "phone": "doctor's office phone — digits only" or null,
    "fax": "doctor's office fax — digits only" or null,
    "email": "doctor's email" or null
  },
  "procedure": {
    "cpt": "5-digit CPT code like 95810" or null,
    "description": "procedure description" or null,
    "authNumber": "authorization number" or null
  },
  "diagnoses": [
    {
      "code": "ICD-10 code like G47.33" or null,
      "description": "diagnosis text" or null
    }
  ],
  "clinical": {
    "reasonForReferral": "why referred" or null,
    "symptoms": ["symptoms"] or [],
    "medications": ["medications"] or [],
    "history": "medical history" or null,
    "bmi": "BMI value" or null,
    "notes": "clinical notes" or null
  },
  "confidence": 0.0 to 1.0
}

CRITICAL RULES:
1. Output ONLY valid JSON. No markdown, no explanation, no code fences.
2. PHONE SEPARATION: Patient phones are personal (home/cell/mobile, near patient name/address). Provider phones are office numbers (in letterhead, near provider name/practice). Do NOT mix them.
3. PATIENT vs PROVIDER ADDRESS: The patient lives at one address. The provider/practice has a separate office address (usually in the letterhead). Look for labels like "Patient Address" vs practice/clinic address.
4. NAME EXTRACTION (CRITICAL):
   - Names appear in many formats: "Scott Dubinoff", "HATFIELD, JENETTE", "John A. Smith"
   - Look for names near "Patient Name", near DOB, at the TOP of pages, or in clinical notes like "Scott Dubinoff presents today for..."
   - If you see "Firstname Lastname — MM/DD/YYYY" that IS the patient name + DOB
   - If you see "LASTNAME, FIRSTNAME" the part BEFORE the comma is the last name, AFTER is the first name
   - ALWAYS extract BOTH first AND last name. Never return just a last name if the first name appears anywhere in the text
5. NPI is always 10 digits starting with 1 or 2. Phone/fax numbers are NOT NPIs.
6. Member IDs: copy EXACTLY as printed including letters, numbers, dashes.
7. Dates: MM/DD/YYYY format.
8. CPT: 5-digit numeric code. If you don't see a CPT code, use null.
9. Each diagnosis code = single string (e.g. "G47.33"), not an array.

OCR TEXT FROM DOCUMENT:
`;

/**
 * Call Ollama text-only model (no images).
 */
async function callTextLlm(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEXT_TIMEOUT);

  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: TEXT_TEMPERATURE,
          num_ctx: 16384,
        }
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      throw new Error(`Ollama returned ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    return {
      response: data.response,
      totalDuration: data.total_duration,
      evalCount: data.eval_count,
      evalDuration: data.eval_duration
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compute average OCR confidence across all pages.
 * Returns { avgConfidence, totalBoxes, totalChars }
 */
export function computeOcrConfidence(ocrPages) {
  let totalConf = 0;
  let totalBoxes = 0;
  let totalChars = 0;

  for (const page of ocrPages) {
    const boxes = page.boxes || [];
    for (const box of boxes) {
      totalConf += (box.conf || 0);
      totalBoxes++;
    }
    totalChars += (page.text || '').length;
  }

  return {
    avgConfidence: totalBoxes > 0 ? totalConf / totalBoxes : 0,
    totalBoxes,
    totalChars
  };
}

/**
 * Main extraction function: OCR text → text LLM → structured data.
 * 
 * @param {Array} ocrPages - Array of { page, text, boxes } from OCR service
 * @param {Object} options - { id, filePath } for logging/fallback
 * @returns {Object} Normalized extraction result
 */
export async function extractFromOcrText(ocrPages, options = {}) {
  const { id = 'unknown' } = options;
  const startTime = Date.now();

  // Step 1: Compute OCR quality
  const ocrQuality = computeOcrConfidence(ocrPages);
  log('info', 'text_llm_ocr_quality', {
    id,
    avgConfidence: ocrQuality.avgConfidence.toFixed(3),
    totalBoxes: ocrQuality.totalBoxes,
    totalChars: ocrQuality.totalChars,
    pages: ocrPages.length
  });

  // Step 2: Check if OCR quality is sufficient
  if (ocrQuality.avgConfidence < OCR_CONFIDENCE_THRESHOLD) {
    log('warn', 'text_llm_low_ocr_confidence', {
      id,
      avgConfidence: ocrQuality.avgConfidence.toFixed(3),
      threshold: OCR_CONFIDENCE_THRESHOLD,
      action: 'flag_for_vlm_fallback'
    });
    // Return null to signal caller should use VLM fallback
    return null;
  }

  // Step 3: Build combined text from all pages
  const maxPages = parseInt(process.env.VLM_MAX_PAGES || '4', 10);
  const pagesToUse = ocrPages.slice(0, maxPages);
  
  let combinedText = '';
  for (const page of pagesToUse) {
    combinedText += `\n=== PAGE ${page.page} ===\n${page.text}\n`;
  }

  // Trim if excessively long (stay within 16k context)
  if (combinedText.length > 20000) {
    combinedText = combinedText.slice(0, 20000) + '\n[... truncated]';
  }

  // Step 3b: Regex pre-extraction — pull structured hints from OCR text
  const hints = regexPreExtract(combinedText);
  const hintsBlock = buildHintsBlock(hints);
  if (hints.name || hints.dob || hints.cpt) {
    log('info', 'text_llm_regex_hints', {
      id,
      hasName: !!hints.name,
      nameSource: hints.name?.source || null,
      hasDob: !!hints.dob,
      hasCpt: !!hints.cpt,
      hasNpi: !!hints.npi,
      phoneCount: hints.phones.length
    });
  }

  const kbBlock = buildKbPromptContext();
  const fullPrompt = TEXT_EXTRACTION_PROMPT + hintsBlock + kbBlock + combinedText;

  // Step 4: Call text-only LLM (single request for ALL pages)
  log('info', 'text_llm_extract_start', {
    id,
    model: TEXT_MODEL,
    pages: pagesToUse.length,
    textLength: combinedText.length,
    promptLength: fullPrompt.length,
    kbBlockLength: kbBlock.length
  });

  try {
    const llmResult = await callTextLlm(fullPrompt);
    const elapsed = Date.now() - startTime;

    log('info', 'text_llm_extract_complete', {
      id,
      elapsed,
      evalCount: llmResult.evalCount,
      responseLength: llmResult.response?.length || 0
    });

    // Step 5: Parse JSON response
    const parsed = parseVlmJson(llmResult.response, 0);
    if (!parsed || parsed._parseError) {
      log('warn', 'text_llm_parse_failed', {
        id,
        response: (llmResult.response || '').slice(0, 300)
      });
      return null; // Signal VLM fallback
    }

    // Step 6: Normalize using the same post-processing as VLM pipeline
    const normalized = normalizeVlmResult(parsed);
    normalized.extractionMethod = 'text_llm';

    // Step 6b: Patch missing fields from regex hints (LLM missed but regex found)
    if (hints.name) {
      if (!normalized.patient) normalized.patient = {};
      if (!normalized.patient.first && hints.name.first) {
        normalized.patient.first = hints.name.first;
        log('info', 'regex_patched_first_name', { id, value: hints.name.first, source: hints.name.source });
      }
      if (!normalized.patient.last && hints.name.last) {
        normalized.patient.last = hints.name.last;
        log('info', 'regex_patched_last_name', { id, value: hints.name.last, source: hints.name.source });
      }
    }
    if (hints.dob && !normalized.patient?.dob) {
      if (!normalized.patient) normalized.patient = {};
      normalized.patient.dob = hints.dob;
      log('info', 'regex_patched_dob', { id, value: hints.dob });
    }
    if (hints.phones.length > 0 && (!normalized.patient?.phones || normalized.patient.phones.length === 0)) {
      if (!normalized.patient) normalized.patient = {};
      normalized.patient.phones = hints.phones;
      log('info', 'regex_patched_phones', { id, count: hints.phones.length });
    }

    // Step 7: OCR-text-based CPT inference if LLM didn't find a sleep CPT
    const SLEEP_CPTS = new Set(['95810', '95811', '95806', '95800', '95782', '95783', '95805', '95801']);
    const currentCpt = normalized.procedure?.cpt;
    const needsCptFix = !currentCpt || !SLEEP_CPTS.has(currentCpt);
    if (needsCptFix) {
      const isSleepDoc = /sleep\s*study|polysomnogra|sleep\s*test|sleep\s*order|sleep\s*medicine|referral.*sleep|psg\s|hst\s/i.test(combinedText);
      if (isSleepDoc) {
        // Try to find specific CPT codes in the OCR text
        const cptMatch = combinedText.match(/\b(95810|95811|95806|95800|95782|95783|95805)\b/);
        if (cptMatch) {
          if (!normalized.procedure) normalized.procedure = {};
          const prev = normalized.procedure.cpt;
          normalized.procedure.cpt = cptMatch[1];
          log('info', 'cpt_inferred_from_ocr_text', { inferred: cptMatch[1], source: 'exact_match', replaced: prev || null });
        } else {
          // Default to 95810 (in-lab PSG) for sleep study documents
          if (!normalized.procedure) normalized.procedure = {};
          const prev = normalized.procedure.cpt;
          normalized.procedure.cpt = '95810';
          log('info', 'cpt_inferred_from_ocr_text', { inferred: '95810', source: 'sleep_doc_default', replaced: prev || null });
        }
      }
    }

    normalized._textLlm = {
      model: TEXT_MODEL,
      elapsed,
      ocrConfidence: ocrQuality.avgConfidence,
      pagesUsed: pagesToUse.length,
      textLength: combinedText.length
    };

    log('info', 'text_llm_result', {
      id,
      method: 'text_llm',
      elapsed,
      hasName: !!(normalized.patient?.first && normalized.patient?.last),
      hasDob: !!normalized.patient?.dob,
      hasCpt: !!normalized.procedure?.cpt,
      hasProvider: !!normalized.provider?.name,
      confidence: normalized.confidenceScore
    });

    return normalized;

  } catch (err) {
    log('error', 'text_llm_extract_error', {
      id,
      error: err.message,
      elapsed: Date.now() - startTime
    });
    return null; // Signal VLM fallback
  }
}

/**
 * Health check for text LLM availability.
 */
export async function checkTextLlmHealth() {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!resp.ok) return { ok: false, error: `Ollama returned ${resp.status}` };
    const data = await resp.json();
    const models = (data.models || []).map(m => m.name);
    const hasModel = models.some(m => m.startsWith(TEXT_MODEL.split(':')[0]));
    return { ok: hasModel, model: TEXT_MODEL, available: models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default {
  extractFromOcrText,
  computeOcrConfidence,
  checkTextLlmHealth
};
