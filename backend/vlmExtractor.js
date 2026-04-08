/**
 * VLM Primary Extractor
 * 
 * Uses a Vision-Language Model as the PRIMARY document extraction engine.
 * Sends page images directly to the VLM and receives structured JSON.
 * 
 * This replaces the regex-over-linearized-text approach with a model that
 * can see the document layout, understand forms, tables, and handwriting.
 * 
 * The OCR rules engine is retained as a FALLBACK and cross-validation layer.
 */

import fs from 'fs';
import fetch from 'node-fetch';
import { log } from './logging/logger.js';
import { ollamaMonitor } from './ollamaMonitor.js';

// Configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const VLM_MODEL = process.env.VLM_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';
const VLM_TIMEOUT = parseInt(process.env.VLM_TIMEOUT || '180000', 10); // 3min per page
const VLM_TEMPERATURE = parseFloat(process.env.VLM_TEMPERATURE || '0.1'); // Low temp for deterministic extraction

// ── SLEEP STUDY CPT LOOKUP ──
// Maps CPT codes to their descriptions for validation
const SLEEP_CPT_MAP = {
  '95800': 'Portable sleep study (Type 3)',
  '95801': 'Portable sleep study (Type 4)',
  '95805': 'Multiple sleep latency test (MSLT)',
  '95806': 'Unattended sleep study',
  '95807': 'Attended sleep study with CPAP',
  '95808': 'Polysomnography (PSG) - attended, 1-3 parameters',
  '95810': 'Polysomnography (PSG) - attended, 4+ parameters',
  '95811': 'PSG with PAP titration / split-night',
  '95782': 'Pediatric polysomnography',
  '95783': 'Pediatric PSG with PAP titration',
  '95869': 'Maintenance of wakefulness test (MWT)'
};

// ── CPT INFERENCE RULES ──
// Order matters: more specific matches first
const CPT_INFERENCE_RULES = [
  [['split-night', 'split night', 'splitnight'], '95811'],
  [['titration', 'pap titration', 'cpap titration', 'bipap titration'], '95811'],
  [['mslt', 'multiple sleep latency', 'latency test'], '95805'],
  [['mwt', 'maintenance of wakefulness'], '95869'],
  [['hsat', 'home sleep', 'portable sleep', 'type 3', 'type iii'], '95800'],
  [['unattended', 'type 4', 'type iv'], '95806'],
  [['polysomnography', 'polysomnogram', 'psg', 'sleep study', 'in-lab', 'in lab', 'inlab'], '95810'],
  [['pediatric psg', 'pediatric sleep', 'pediatric polysomnography'], '95782'],
  [['sleep test', 'sleep evaluation', 'sleep assessment', 'sleep medicine', 'sleep referral', 'sleep consult'], '95810']
];

/**
 * The structured extraction prompt.
 * Designed for sleep medicine referral documents but handles any medical form.
 * The VLM sees the actual document image — it understands layout, tables, and spatial relationships.
 */
const EXTRACTION_PROMPT = `You are a medical document data extraction system. You are looking at a page from a medical referral document (possibly a fax).

Extract ALL structured data you can see into this EXACT JSON format. Use null for any field you cannot clearly read.

{
  "patient": {
    "first": "first/given name" or null,
    "last": "last/family/surname" or null,
    "dob": "MM/DD/YYYY" or null,
    "phones": ["patient's personal phone numbers — home, cell, mobile — digits only"] or [],
    "email": "patient's personal email address" or null,
    "address": {
      "street": "patient's home/mailing street address" or null,
      "city": "city" or null,
      "state": "2-letter state code" or null,
      "zip": "5 or 9 digit zip" or null
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
    "name": "referring/ordering physician full name with credentials (MD, DO, NP, etc.)" or null,
    "npi": "10-digit NPI number starting with 1 or 2 (NOT a phone or fax number)" or null,
    "practice": "practice, clinic, or facility name" or null,
    "phone": "the doctor's office phone number — digits only" or null,
    "fax": "the doctor's office fax number — digits only (often labeled 'Fax' or 'F')" or null,
    "email": "the doctor's or office email" or null
  },
  "procedure": {
    "cpt": "ONE CPT code as a 5-digit string like 95810 or 95811" or null,
    "description": "procedure description" or null,
    "authNumber": "authorization/auth number" or null
  },
  "diagnoses": [
    {
      "code": "ONE ICD-10 code as a string like G47.33" or null,
      "description": "diagnosis text" or null
    }
  ],
  "clinical": {
    "reasonForReferral": "why the patient is being referred" or null,
    "symptoms": ["list of symptoms"] or [],
    "medications": ["current medications"] or [],
    "history": "relevant medical history" or null,
    "bmi": "BMI value" or null,
    "notes": "any clinical notes or comments" or null
  },
  "pageType": "cover_sheet | demographics | clinical_notes | insurance_card | lab_results | referral_form | other",
  "confidence": 0.0 to 1.0
}

CRITICAL RULES:
1. Output ONLY valid JSON — no markdown, no explanation, no code fences.
2. Preserve exact spelling, numbers, and formatting as printed on the document.
3. PHONE NUMBER SEPARATION IS CRITICAL:
   - patient.phones = the PATIENT's personal phone (home, cell, mobile). Usually near the patient's name/address/demographics section.
   - referringProvider.phone = the DOCTOR's office phone. Usually near the provider name, practice, or in a "Referring Physician" section.
   - referringProvider.fax = the office fax. Usually labeled "Fax", "F:", or near the provider section.
   - If a phone number is in the header/letterhead of a medical practice, it belongs to referringProvider, NOT the patient.
   - If a phone number is near "Patient Phone", "Home", "Cell", "Mobile" labels, it belongs to patient.
   - When in doubt about whose phone it is, put it in BOTH patient.phones AND referringProvider.phone so nothing is lost.
4. For dates, always use MM/DD/YYYY format.
5. If you see a table or form with labeled fields, use the labels to identify which value goes where.
6. If handwriting is present, attempt to read it — it's often the most critical information.
7. If this page is a fax cover sheet with no patient data, set pageType to "cover_sheet" and all fields to null.
8. Member IDs and group IDs: copy EXACTLY as printed, including letters, numbers, and dashes.
9. If you see multiple insurance entries (primary/secondary), include both in the insurance array.
10. PATIENT NAME — "first" = given/personal name, "last" = family/surname:
    - "LASTNAME, FIRSTNAME" format: part BEFORE the comma is last.
    - "FIRSTNAME LASTNAME" format: first word is first, last word is last.
    - "Dr. Smith" is a PROVIDER name, not the patient. Do not confuse them.
    - Middle names/initials go with first name (e.g., "John Michael" goes in first, "Smith" goes in last).
    - If the document shows the name as "DOE, JOHN" then first="JOHN", last="DOE".
11. NPI is ALWAYS a 10-digit number starting with 1 or 2. Phone/fax numbers are NOT NPIs.
12. Every value in the JSON must be a simple string, number, or null — never nest objects inside string fields.
13. Each diagnosis code must be a single string (e.g., "G47.33"), not an array.
14. CPT CODE RULES — THIS IS CRITICAL:
    - procedure.cpt MUST be a 5-digit NUMERIC string like "95810", "95811", "95782".
    - NEVER put a diagnosis name (like "OSA", "Insomnia", "Sleep Apnea") in the cpt field.
    - NEVER put an ICD code (like "G47.33") in the cpt field.
    - If you cannot find a 5-digit CPT code on the page, set cpt to null.
    - Put the procedure NAME in the "description" field, not in "cpt".
    - Common sleep study CPT codes: 95810 (PSG), 95811 (split-night/titration), 95800 (home sleep test), 95782 (pediatric PSG).
    - If the document says "polysomnography" or "sleep study" but no numeric code, set cpt to null and put the text in description.`;

/**
 * Multi-page merge prompt — sent after individual pages are extracted.
 * Combines data from all pages into a single coherent record.
 */
const MERGE_PROMPT = `You have extracted data from multiple pages of the same medical document. 
Merge them into a single coherent patient record using the same JSON schema.

Rules for merging:
- Use the most complete/detailed version of each field across all pages.
- If two pages have different values for the same field, prefer the demographics/facesheet page.
- Combine symptoms, medications, and diagnoses from all pages (deduplicate).
- Skip cover_sheet pages entirely.
- Set confidence based on the clarity and consistency of the merged data.

Page extractions:
`;

/**
 * Send a single page image to the VLM and get structured extraction.
 * 
 * @param {string} imagePath - Path to the page image (JPEG/PNG)
 * @param {number} pageNum - 1-based page number (for logging)
 * @returns {Promise<Object>} Extracted data for this page
 */
export async function extractPage(imagePath, pageNum = 1) {
  const startTime = Date.now();
  
  try {
    // Read image as base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    log('info', 'vlm_extract_page_start', { page: pageNum, model: VLM_MODEL, imageSize: imageBuffer.length });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VLM_TIMEOUT);

    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_MODEL,
        prompt: EXTRACTION_PROMPT,
        images: [base64Image],
        stream: false,
        options: {
          temperature: VLM_TEMPERATURE,
          num_predict: 4096,  // Enough tokens for full extraction
          top_p: 0.9,
        }
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      throw new Error(`Ollama returned ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawResponse = data.response || '';
    const elapsed = Date.now() - startTime;

    log('info', 'vlm_extract_page_complete', { 
      page: pageNum, elapsed, responseLength: rawResponse.length,
      evalCount: data.eval_count, evalDuration: data.eval_duration
    });

    // Parse the JSON from the VLM response
    const parsed = parseVlmJson(rawResponse, pageNum);
    parsed._meta = {
      page: pageNum,
      model: VLM_MODEL,
      elapsed,
      tokensGenerated: data.eval_count || 0,
      rawLength: rawResponse.length
    };

    ollamaMonitor.recordRequest(true, elapsed);
    return parsed;

  } catch (error) {
    const elapsed = Date.now() - startTime;
    log('error', 'vlm_extract_page_error', { page: pageNum, elapsed, error: String(error) });
    ollamaMonitor.recordRequest(false, elapsed);

    // Return empty structure on failure so pipeline continues
    return {
      patient: { first: null, last: null, dob: null, phones: [], email: null, address: {} },
      insurance: [],
      provider: { name: null, npi: null, practice: null, phone: null, fax: null, email: null },
      procedure: { cpt: null, description: null, authNumber: null },
      diagnoses: [],
      clinical: { reasonForReferral: null, symptoms: [], medications: [], history: null, notes: null },
      pageType: 'unknown',
      confidence: 0,
      _meta: { page: pageNum, model: VLM_MODEL, elapsed, error: String(error) }
    };
  }
}

/**
 * Extract structured data from a multi-page document.
 * Processes each page, then merges into a single record.
 * 
 * @param {string[]} imagePaths - Array of page image paths
 * @param {Object} options - Processing options
 * @param {number[]} options.priorityPages - 0-based indices of information-rich pages to process first
 * @returns {Promise<Object>} Merged extraction result
 */
export async function extractDocument(imagePaths, options = {}) {
  const startTime = Date.now();
  const { priorityPages } = options;

  log('info', 'vlm_extract_document_start', { 
    totalPages: imagePaths.length, 
    priorityPages: priorityPages?.length || imagePaths.length,
    model: VLM_MODEL 
  });

  // Determine which pages to process
  // If we have priority pages from the page selector, use those
  // Otherwise process all pages (up to a reasonable limit)
  const maxPages = parseInt(process.env.VLM_MAX_PAGES || '8', 10);
  let pageIndices;
  
  if (priorityPages && priorityPages.length > 0) {
    pageIndices = priorityPages.slice(0, maxPages);
  } else {
    // Process up to maxPages, preferring early pages
    pageIndices = Array.from({ length: Math.min(imagePaths.length, maxPages) }, (_, i) => i);
  }

  // Extract each page sequentially (VLM is GPU-bound, parallel won't help on single GPU)
  const pageExtractions = [];
  for (const idx of pageIndices) {
    if (idx >= imagePaths.length) continue;
    const result = await extractPage(imagePaths[idx], idx + 1);
    pageExtractions.push(result);
  }

  // Filter out cover sheets and empty pages
  const usablePages = pageExtractions.filter(p => 
    p.pageType !== 'cover_sheet' && p.confidence > 0
  );

  if (usablePages.length === 0) {
    log('warn', 'vlm_no_usable_pages', { totalPages: imagePaths.length, processed: pageExtractions.length });
    return {
      ...emptyResult(),
      _vlm: {
        model: VLM_MODEL,
        pagesProcessed: pageExtractions.length,
        pagesUsable: 0,
        elapsed: Date.now() - startTime,
        pageResults: pageExtractions
      }
    };
  }

  // If only one usable page, use it directly
  let merged;
  if (usablePages.length === 1) {
    merged = usablePages[0];
  } else {
    // Merge multiple pages using deterministic merge (no second LLM call)
    merged = mergePageExtractions(usablePages);
  }

  // Normalize to match the app's expected schema
  const normalized = normalizeVlmResult(merged);
  
  const elapsed = Date.now() - startTime;
  log('info', 'vlm_extract_document_complete', { 
    elapsed, 
    pagesProcessed: pageExtractions.length, 
    pagesUsable: usablePages.length,
    confidence: normalized.confidence
  });

  normalized._vlm = {
    model: VLM_MODEL,
    pagesProcessed: pageExtractions.length,
    pagesUsable: usablePages.length,
    elapsed,
    pageResults: pageExtractions.map(p => ({
      page: p._meta?.page,
      pageType: p.pageType,
      confidence: p.confidence,
      elapsed: p._meta?.elapsed
    }))
  };

  return normalized;
}

/**
 * Deterministic multi-page merge without a second LLM call.
 * Prefers data from higher-confidence pages and demographics/referral pages.
 */
function mergePageExtractions(pages) {
  // Sort pages by priority: demographics > referral_form > clinical_notes > other
  const typePriority = { demographics: 4, referral_form: 3, insurance_card: 2, clinical_notes: 1, other: 0 };
  const sorted = [...pages].sort((a, b) => {
    const pa = typePriority[a.pageType] || 0;
    const pb = typePriority[b.pageType] || 0;
    if (pa !== pb) return pb - pa;
    return (b.confidence || 0) - (a.confidence || 0);
  });

  const merged = emptyResult();

  for (const page of sorted) {
    // Patient: prefer first non-null value (highest priority page wins)
    if (!merged.patient.first && page.patient?.first) merged.patient.first = page.patient.first;
    if (!merged.patient.last && page.patient?.last) merged.patient.last = page.patient.last;
    if (!merged.patient.dob && page.patient?.dob) merged.patient.dob = page.patient.dob;
    if (!merged.patient.email && page.patient?.email) merged.patient.email = page.patient.email;

    // Phones: collect unique
    for (const ph of (page.patient?.phones || [])) {
      const digits = String(ph).replace(/\D/g, '');
      if (digits.length >= 10 && !merged.patient.phones.includes(digits)) {
        merged.patient.phones.push(digits);
      }
    }

    // Address: prefer first complete address
    if (!merged.patient.address?.street && page.patient?.address?.street) {
      merged.patient.address = { ...page.patient.address };
    }

    // Insurance: collect unique carriers
    for (const ins of (page.insurance || [])) {
      if (ins.carrier || ins.memberId) {
        const existing = merged.insurance.find(e => 
          (e.carrier && ins.carrier && e.carrier.toLowerCase() === ins.carrier.toLowerCase()) ||
          (e.memberId && ins.memberId && e.memberId === ins.memberId)
        );
        if (!existing) {
          merged.insurance.push(ins);
        } else {
          // Fill in blanks from this page
          if (!existing.memberId && ins.memberId) existing.memberId = ins.memberId;
          if (!existing.groupId && ins.groupId) existing.groupId = ins.groupId;
          if (!existing.planType && ins.planType) existing.planType = ins.planType;
        }
      }
    }

    // Provider (VLM may output as "referringProvider" or "provider")
    const prov = getProvider(page);
    if (!merged.provider.name && prov.name) merged.provider.name = prov.name;
    if (!merged.provider.npi && prov.npi) merged.provider.npi = prov.npi;
    if (!merged.provider.practice && prov.practice) merged.provider.practice = prov.practice;
    if (!merged.provider.phone && prov.phone) merged.provider.phone = prov.phone;
    if (!merged.provider.fax && prov.fax) merged.provider.fax = prov.fax;
    if (!merged.provider.email && prov.email) merged.provider.email = prov.email;

    // Procedure: prefer first non-null
    if (!merged.procedure.cpt && page.procedure?.cpt) merged.procedure.cpt = page.procedure.cpt;
    if (!merged.procedure.description && page.procedure?.description) merged.procedure.description = page.procedure.description;
    if (!merged.procedure.authNumber && page.procedure?.authNumber) merged.procedure.authNumber = page.procedure.authNumber;

    // Diagnoses: collect unique codes
    for (const dx of (page.diagnoses || [])) {
      if (dx.code && !merged.diagnoses.some(d => d.code === dx.code)) {
        merged.diagnoses.push(dx);
      }
    }

    // Clinical: merge narrative fields
    if (!merged.clinical.reasonForReferral && page.clinical?.reasonForReferral) {
      merged.clinical.reasonForReferral = page.clinical.reasonForReferral;
    }
    for (const sym of (page.clinical?.symptoms || [])) {
      if (sym && !merged.clinical.symptoms.includes(sym)) merged.clinical.symptoms.push(sym);
    }
    for (const med of (page.clinical?.medications || [])) {
      if (med && !merged.clinical.medications.includes(med)) merged.clinical.medications.push(med);
    }
    if (!merged.clinical.history && page.clinical?.history) merged.clinical.history = page.clinical.history;
    if (!merged.clinical.bmi && page.clinical?.bmi) merged.clinical.bmi = page.clinical.bmi;
    if (page.clinical?.notes) {
      merged.clinical.notes = merged.clinical.notes 
        ? `${merged.clinical.notes}\n${page.clinical.notes}` 
        : page.clinical.notes;
    }
  }

  // Confidence: weighted average of usable pages
  const totalConf = sorted.reduce((sum, p) => sum + (p.confidence || 0), 0);
  merged.confidence = sorted.length > 0 ? totalConf / sorted.length : 0;

  return merged;
}

/**
 * Normalize VLM extraction to match the app's expected result schema.
 * Maps VLM output fields to the exact format downstream consumers expect.
 */
export function normalizeVlmResult(vlm) {
  // Fix name order: VLMs often mix up first/last names.
  // Common failure modes:
  //   1. "LASTNAME, FIRSTNAME" split wrong — comma part placed in "first"
  //   2. "LASTNAME FIRSTNAME" read left-to-right, first word placed in "first"
  //   3. A comma in one of the fields indicates the VLM parsed a "Last, First" combined string
  let firstName = vlm.patient?.first || null;
  let lastName = vlm.patient?.last || null;
  
  if (firstName && lastName) {
    const firstTrimmed = firstName.replace(/[,.\s]+$/, '').trim();
    const lastTrimmed = lastName.replace(/[,.\s]+$/, '').trim();
    
    // Case 1: "first" field contains a comma — VLM likely put "LASTNAME," in the first field
    if (firstName.includes(',') && !lastName.includes(',')) {
      firstName = lastTrimmed;
      lastName = firstTrimmed;
    }
    // Case 2: "last" field contains a comma — VLM put "LASTNAME, FIRSTNAME" all in last
    else if (lastName.includes(',') && !firstName.includes(',')) {
      const parts = lastName.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        lastName = parts[0];
        firstName = parts[1].split(/\s+/)[0]; // Take first token after comma as given name
      }
    }
    // Case 3: "first" looks like a single-word surname and "last" has a middle initial or space
    else if (firstTrimmed && lastTrimmed && !firstTrimmed.includes(' ') && 
        (lastTrimmed.includes(' ') || lastTrimmed.includes('.'))) {
      firstName = lastTrimmed.split(/[\s.]+/)[0]; // Take first token as given name
      lastName = firstTrimmed;
    }
    // Case 4: Both fields are single words but the format was likely "Last First" left-to-right
    // We can't reliably detect this without more context, so leave as-is
  }
  
  // Normalize: capitalize names properly ("DOE" → "Doe", "JOHN" → "John")
  const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  if (firstName && firstName === firstName.toUpperCase() && firstName.length > 1) firstName = titleCase(firstName);
  if (lastName && lastName === lastName.toUpperCase() && lastName.length > 1) lastName = titleCase(lastName);
  
  // Normalize phone numbers to 10-digit strings
  const normalizePhone = (p) => {
    if (!p) return null;
    const digits = String(p).replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
  };
  
  // Normalize NPI: must be exactly 10 digits starting with 1 or 2
  const normalizeNpi = (npi) => {
    if (!npi) return null;
    const digits = String(npi).replace(/\D/g, '');
    if (digits.length === 10 && (digits.startsWith('1') || digits.startsWith('2'))) return digits;
    return null; // Not a valid NPI (might be a phone number the VLM confused)
  };
  
  // ── CPT SPLITTING & NORMALIZATION ──
  // Handles concatenated CPT codes (e.g., "95801G03999580095806") and objects/arrays
  // Also rejects diagnosis text that the VLM sometimes puts in the CPT field
  const DIAGNOSIS_NAMES_REGEX = /^(OSA|obstructive\s+sleep|sleep\s+apnea|insomnia|narcolepsy|hypersomnia|restless\s+leg|snoring|parasomnia|bruxism|apnea|obesity|hypertension|copd|chf|afib|cpt|icd)$/i;

  const normalizeCpt = (cpt) => {
    if (!cpt) return null;
    let raw;
    if (typeof cpt === 'string') {
      // Treat "null", "NULL", "none", "N/A" as null
      if (/^(null|none|n\/?a|not\s*applicable)$/i.test(cpt.trim())) return null;
      // Reject pure diagnosis names/abbreviations mistakenly placed in CPT field
      if (DIAGNOSIS_NAMES_REGEX.test(cpt.trim())) return null;
      raw = cpt;
    } else if (Array.isArray(cpt) && cpt.length > 0) {
      const first = cpt[0];
      raw = typeof first === 'string' ? first : first?.code ? String(first.code) : null;
    } else if (typeof cpt === 'object' && cpt.code) {
      raw = String(cpt.code);
    }
    if (!raw) return null;

    // Strip non-alphanumeric
    raw = raw.replace(/[^\dA-Za-z]/g, '').toUpperCase();

    // Reject if it's all letters (no digits) — it's a diagnosis name, not a CPT code
    if (/^[A-Z]+$/.test(raw)) return null;

    // If it's already a clean 5-digit code, return it
    if (/^\d{5}$/.test(raw)) return raw;

    // Try to extract valid 5-digit CPT codes from concatenated mess
    const cptMatches = raw.match(/\d{5}/g);
    if (cptMatches && cptMatches.length > 0) {
      // Return the first valid sleep-study CPT if present, otherwise first match
      const sleepCpts = cptMatches.filter(c => SLEEP_CPT_MAP[c]);
      return sleepCpts.length > 0 ? sleepCpts[0] : cptMatches[0];
    }

    // Last resort: return raw if it's a valid short alphanumeric code with at least one digit (not garbage)
    if (raw.length <= 6 && /\d/.test(raw)) return raw;
    return null;
  };

  // ── CPT INFERENCE FROM DESCRIPTION ──
  // If VLM couldn't find a CPT code but gave us a description, infer it
  const inferCptFromDescription = (description) => {
    if (!description) return null;
    const desc = description.toLowerCase();
    for (const [keywords, code] of CPT_INFERENCE_RULES) {
      if (keywords.some(kw => desc.includes(kw))) return code;
    }
    return null;
  };

  // ── ICD-10 CODE CLEANING ──
  // Extracts clean ICD-10 code from messy strings like "R0683 Snoring" → "R06.83"
  const cleanIcdCode = (code) => {
    if (!code) return null;
    if (typeof code !== 'string') {
      if (Array.isArray(code)) return cleanIcdCode(code[0]);
      return String(code);
    }

    // Already clean format like G47.33
    if (/^[A-Z]\d{2}\.\d{1,4}$/.test(code.trim())) return code.trim();

    // Try to extract ICD-10 pattern from messy string
    // Matches: G47.33, R06.83, E66.01, Z12.11, etc.
    const withDot = code.match(/\b([A-Z]\d{2}\.\d{1,4})\b/i);
    if (withDot) return withDot[1].toUpperCase();

    // No dot format: R0683 → R06.83, G4733 → G47.33
    const noDot = code.match(/\b([A-Z]\d{2})(\d{1,4})\b/i);
    if (noDot) return `${noDot[1].toUpperCase()}.${noDot[2]}`;

    // Match just the code part if description is appended: "G47.00 (ICD-10-CM) - Insomnia"
    const prefixed = code.match(/^\s*([A-Z]\d{2}\.?\d{0,4})/i);
    if (prefixed) {
      let c = prefixed[1].toUpperCase();
      // Insert dot if missing: G4700 → G47.00
      if (c.length >= 4 && !c.includes('.')) {
        c = c.slice(0, 3) + '.' + c.slice(3);
      }
      return c;
    }

    return code.trim();
  };
  // Build symptoms array in the expected format
  const symptoms = (vlm.clinical?.symptoms || []).map(s => ({
    name: typeof s === 'string' ? s : s.name || String(s),
    status: 'confirmed',
    context: 'VLM extraction',
    page: vlm._meta?.page || 1
  }));

  const result = {
    patient: {
      first: firstName,
      last: lastName,
      dob: vlm.patient?.dob || null,
      phones: (vlm.patient?.phones || []).map(normalizePhone).filter(Boolean),
      email: vlm.patient?.email || null,
      address: vlm.patient?.address || {}
    },
    insurance: (vlm.insurance || []).map(ins => ({
      carrier: ins.carrier || null,
      memberId: ins.memberId || null,
      groupId: (ins.groupId && !/none|n\/a|not|recorded/i.test(ins.groupId)) ? ins.groupId : null,
      planType: ins.planType || null,
      status: 'pending_verification'
    })),
    provider: (() => {
      const prov = vlm.referringProvider || vlm.provider || {};
      return {
        name: prov.name || null,
        npi: normalizeNpi(prov.npi),
        practice: prov.practice || null,
        phone: normalizePhone(prov.phone),
        fax: normalizePhone(prov.fax),
        email: prov.email || null
      };
    })(),
    procedure: (() => {
      let cpt = normalizeCpt(vlm.procedure?.cpt);
      const desc = typeof vlm.procedure?.description === 'string' ? vlm.procedure.description : null;
      // If CPT is null or invalid, try to infer from description
      if (!cpt && desc) {
        cpt = inferCptFromDescription(desc);
        if (cpt) log('info', 'cpt_inferred', { from: desc, inferred: cpt });
      }
      // Also try inferring from diagnoses if still null
      if (!cpt) {
        const dxCodes = (vlm.diagnoses || []).map(d => d.code).filter(Boolean).join(' ');
        if (/G47\.|R06\.83|E66/i.test(dxCodes)) {
          cpt = '95810'; // Sleep apnea diagnosis → PSG
          log('info', 'cpt_inferred_from_dx', { codes: dxCodes, inferred: cpt });
        }
      }
      return {
        cpt,
        description: desc,
        authNumber: vlm.procedure?.authNumber || null,
        notes: [desc].filter(Boolean)
      };
    })(),
    diagnoses: (vlm.diagnoses || []).map(dx => ({
      code: cleanIcdCode(dx.code),
      description: typeof dx.description === 'string' ? dx.description : null,
      temporal: 'current'
    })).filter(dx => dx.code),
    symptoms,
    clinical: (() => {
      const clin = {
        reasonForReferral: vlm.clinical?.reasonForReferral || null,
        medications: vlm.clinical?.medications || [],
        history: vlm.clinical?.history || null,
        bmi: vlm.clinical?.bmi || null,
        notes: vlm.clinical?.notes || null
      };
      // Promote first diagnosis to primaryDiagnosis so frontend can display it
      const dxArr = (vlm.diagnoses || []).filter(dx => cleanIcdCode(dx.code));
      if (dxArr.length > 0) {
        clin.primaryDiagnosis = {
          code: cleanIcdCode(dxArr[0].code),
          description: typeof dxArr[0].description === 'string' ? dxArr[0].description : null,
          chronic: null,
          severity: null,
          note: null
        };
      }
      return clin;
    })(),
    confidence: mapConfidenceLevel(vlm.confidence),
    confidenceScore: vlm.confidence || 0,
    extractionMethod: 'vlm_primary',
    flags: {
      verifyManually: (vlm.confidence || 0) < 0.6,
      reasons: (vlm.confidence || 0) < 0.6 ? ['Low VLM extraction confidence'] : []
    }
  };

  // ── POST-PROCESSING: Phone cross-check ──
  // If patient has no phones but provider section has them, flag for review
  const prov = result.provider || {};
  if (result.patient.phones.length === 0 && (prov.phone || prov.fax)) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('No patient phone found — verify provider phone is not patient\'s');
  }

  // If patient has phones that look like they match the provider's, flag
  if (prov.phone && result.patient.phones.includes(prov.phone)) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('Patient phone matches provider phone — possible mix-up');
  }

  return result;
}

/**
 * Map numeric confidence to the app's string levels.
 */
function mapConfidenceLevel(score) {
  if (!score) return 'Manual Review Required';
  if (score >= 0.85) return 'High';
  if (score >= 0.65) return 'Medium';
  if (score >= 0.4) return 'Low';
  return 'Manual Review Required';
}

/**
 * Empty result template.
 */
function emptyResult() {
  return {
    patient: { first: null, last: null, dob: null, phones: [], email: null, address: {} },
    insurance: [],
    provider: { name: null, npi: null, practice: null, phone: null, fax: null, email: null },
    procedure: { cpt: null, description: null, authNumber: null },
    diagnoses: [],
    clinical: { reasonForReferral: null, symptoms: [], medications: [], history: null, bmi: null, notes: null },
    confidence: 0
  };
}

/**
 * Get provider data from VLM output — handles both "provider" and "referringProvider" field names.
 */
function getProvider(page) {
  return page.referringProvider || page.provider || {};
}

/**
 * Parse JSON from VLM response, handling common VLM output quirks.
 */
export function parseVlmJson(raw, pageNum = 0) {
  if (!raw || !raw.trim()) {
    log('warn', 'vlm_empty_response', { page: pageNum });
    return { ...emptyResult(), confidence: 0, pageType: 'unknown' };
  }

  let cleaned = raw.trim();

  // Strip markdown code fences (VLMs love to wrap in ```json ... ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Strip any leading/trailing non-JSON text
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  // Fix common VLM JSON errors
  // 1. Trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  // 2. Single quotes → double quotes (but not inside strings)  
  cleaned = cleaned.replace(/(?<=[\[{,:\s])'/g, '"').replace(/'(?=[\]},:\s])/g, '"');
  // 3. Unquoted keys
  cleaned = cleaned.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');

  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    log('warn', 'vlm_json_parse_fail', { page: pageNum, error: e1.message, preview: cleaned.substring(0, 200) });

    // Second attempt: try to extract first valid JSON object
    try {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (e2) {
      // ignore
    }

    log('error', 'vlm_json_unrecoverable', { page: pageNum, rawLength: raw.length });
    return { ...emptyResult(), confidence: 0, pageType: 'unknown' };
  }
}

/**
 * Check if the VLM model is available in Ollama.
 */
export async function checkVlmHealth() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) return { available: false, reason: `Ollama returned ${response.status}` };
    
    const data = await response.json();
    const models = (data.models || []).map(m => m.name);
    const hasModel = models.some(m => m.startsWith(VLM_MODEL));
    
    return {
      available: hasModel,
      model: VLM_MODEL,
      installedModels: models,
      reason: hasModel ? 'ready' : `Model ${VLM_MODEL} not found. Run: ollama pull ${VLM_MODEL}`
    };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

/**
 * Cross-validate VLM extraction against OCR/regex extraction.
 * Returns a merged result that combines the strengths of both.
 * 
 * Strategy:
 * - VLM is source of truth for structured fields (it sees layout)
 * - OCR regex is used for cross-check and to fill gaps
 * - Disagreements are flagged for review
 * 
 * @param {Object} vlmResult - VLM extraction result
 * @param {Object} regexResult - Regex extraction result from rules engine
 * @returns {Object} Merged and validated result
 */
export function crossValidate(vlmResult, regexResult) {
  const conflicts = [];
  const merged = JSON.parse(JSON.stringify(vlmResult)); // deep clone VLM as base

  // Patient name cross-check
  if (regexResult.patient?.first && vlmResult.patient?.first) {
    if (regexResult.patient.first.toLowerCase() !== vlmResult.patient.first.toLowerCase()) {
      conflicts.push({
        field: 'patient.first',
        vlm: vlmResult.patient.first,
        regex: regexResult.patient.first,
        resolution: 'vlm' // VLM sees the actual document
      });
    }
  } else if (!vlmResult.patient?.first && regexResult.patient?.first) {
    merged.patient.first = regexResult.patient.first;
  }

  if (regexResult.patient?.last && vlmResult.patient?.last) {
    if (regexResult.patient.last.toLowerCase() !== vlmResult.patient.last.toLowerCase()) {
      conflicts.push({
        field: 'patient.last',
        vlm: vlmResult.patient.last,
        regex: regexResult.patient.last,
        resolution: 'vlm'
      });
    }
  } else if (!vlmResult.patient?.last && regexResult.patient?.last) {
    merged.patient.last = regexResult.patient.last;
  }

  // DOB cross-check (critical field)
  if (regexResult.patient?.dob && vlmResult.patient?.dob) {
    const vlmDob = normalizeDateStr(vlmResult.patient.dob);
    const regDob = normalizeDateStr(regexResult.patient.dob);
    if (vlmDob !== regDob) {
      conflicts.push({
        field: 'patient.dob',
        vlm: vlmResult.patient.dob,
        regex: regexResult.patient.dob,
        resolution: 'flag_review' // DOB disagreement = manual review
      });
      merged.flags = merged.flags || { verifyManually: false, reasons: [] };
      merged.flags.verifyManually = true;
      merged.flags.reasons.push('DOB mismatch between VLM and OCR — needs manual verification');
    }
  } else if (!vlmResult.patient?.dob && regexResult.patient?.dob) {
    merged.patient.dob = regexResult.patient.dob;
  }

  // Insurance member ID cross-check (critical field)
  const vlmMemberId = vlmResult.insurance?.[0]?.memberId;
  const regMemberId = regexResult.insurance?.[0]?.memberId;
  if (vlmMemberId && regMemberId && vlmMemberId !== regMemberId) {
    conflicts.push({
      field: 'insurance[0].memberId',
      vlm: vlmMemberId,
      regex: regMemberId,
      resolution: 'vlm' // VLM reads the actual printed characters
    });
  } else if (!vlmMemberId && regMemberId) {
    if (merged.insurance.length === 0) merged.insurance.push({});
    merged.insurance[0].memberId = regMemberId;
  }

  // Provider NPI cross-check
  const vlmNpi = vlmResult.provider?.npi;
  const regNpi = regexResult.provider?.npi;
  if (vlmNpi && regNpi && vlmNpi !== regNpi) {
    conflicts.push({
      field: 'provider.npi',
      vlm: vlmNpi,
      regex: regNpi,
      resolution: 'flag_review'
    });
  } else if (!vlmNpi && regNpi) {
    merged.provider.npi = regNpi;
  }

  // Phones: union of both sources
  const allPhones = new Set([
    ...(vlmResult.patient?.phones || []).map(p => String(p).replace(/\D/g, '')),
    ...(regexResult.patient?.phones || []).map(p => String(p).replace(/\D/g, ''))
  ]);
  merged.patient.phones = [...allPhones].filter(p => p.length >= 10);

  // Diagnoses: union of both sources
  const dxCodes = new Set((merged.diagnoses || []).map(d => d.code));
  for (const dx of (regexResult.diagnoses || [])) {
    if (dx.code && !dxCodes.has(dx.code)) {
      merged.diagnoses.push(dx);
      dxCodes.add(dx.code);
    }
  }

  // Ensure clinical.primaryDiagnosis is set (prefer regex enrichment, fallback to VLM first dx)
  if (!merged.clinical?.primaryDiagnosis) {
    merged.clinical = merged.clinical || {};
    if (regexResult.clinical?.primaryDiagnosis) {
      merged.clinical.primaryDiagnosis = regexResult.clinical.primaryDiagnosis;
    } else if (merged.diagnoses?.length > 0) {
      const first = merged.diagnoses[0];
      merged.clinical.primaryDiagnosis = {
        code: first.code,
        description: first.description || null,
        chronic: null,
        severity: null,
        note: null
      };
    }
  }

  // CPT: prefer VLM, fallback to regex
  if (!merged.procedure?.cpt && regexResult.procedure?.cpt) {
    merged.procedure = merged.procedure || {};
    merged.procedure.cpt = regexResult.procedure.cpt;
    merged.procedure.description = regexResult.procedure.description;
  }

  // Clinical: merge narrative from both
  if (!merged.clinical?.reasonForReferral && regexResult.clinical?.reasonForReferral) {
    merged.clinical = merged.clinical || {};
    merged.clinical.reasonForReferral = regexResult.clinical.reasonForReferral;
  }

  // Symptoms: union
  const symNames = new Set((merged.symptoms || []).map(s => s.name?.toLowerCase()));
  for (const sym of (regexResult.symptoms || [])) {
    if (sym.name && !symNames.has(sym.name.toLowerCase())) {
      merged.symptoms = merged.symptoms || [];
      merged.symptoms.push(sym);
      symNames.add(sym.name.toLowerCase());
    }
  }

  // Record cross-validation metadata
  merged._crossValidation = {
    conflicts,
    conflictCount: conflicts.length,
    regexFieldsUsedAsFallback: countFallbacks(vlmResult, regexResult, merged),
    method: 'vlm_primary_regex_fallback'
  };

  return merged;
}

function normalizeDateStr(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(/[^\d]/g, ''); // just compare digits
}

function countFallbacks(vlm, regex, merged) {
  let count = 0;
  if (!vlm.patient?.first && merged.patient?.first) count++;
  if (!vlm.patient?.last && merged.patient?.last) count++;
  if (!vlm.patient?.dob && merged.patient?.dob) count++;
  if (!vlm.provider?.npi && merged.provider?.npi) count++;
  if (!vlm.procedure?.cpt && merged.procedure?.cpt) count++;
  return count;
}
