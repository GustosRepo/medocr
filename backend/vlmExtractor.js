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
const VLM_MODEL = process.env.VLM_MODEL || 'minicpm-v';
const VLM_TIMEOUT = parseInt(process.env.VLM_TIMEOUT || '120000', 10); // 2min per page
const VLM_TEMPERATURE = parseFloat(process.env.VLM_TEMPERATURE || '0.1'); // Low temp for deterministic extraction

/**
 * The structured extraction prompt.
 * Designed for sleep medicine referral documents but handles any medical form.
 * The VLM sees the actual document image — it understands layout, tables, and spatial relationships.
 */
const EXTRACTION_PROMPT = `You are a medical document data extraction system. You are looking at a page from a medical referral document (possibly a fax).

Extract ALL structured data you can see into this EXACT JSON format. Use null for any field you cannot clearly read.

{
  "patient": {
    "first": "first name" or null,
    "last": "last name" or null,
    "dob": "MM/DD/YYYY" or null,
    "phones": ["10-digit numbers only"] or [],
    "email": "email" or null,
    "address": {
      "street": "street address" or null,
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
      "planType": "HMO/PPO/EPO/POS" or null
    }
  ],
  "provider": {
    "name": "ordering/referring physician full name with credentials" or null,
    "npi": "10-digit NPI number (ONLY a 10-digit number starting with 1, NOT a phone number)" or null,
    "practice": "practice or clinic name" or null,
    "phone": "10-digit phone (different from NPI)" or null,
    "fax": "10-digit fax" or null
  },
  "procedure": {
    "cpt": "CPT code as a single string like 95810 or 95811 (NOT an object or array)" or null,
    "description": "procedure description as a string" or null,
    "authNumber": "authorization number" or null
  },
  "diagnoses": [
    {
      "code": "single ICD-10 code as a string like G47.33 (NOT an array)" or null,
      "description": "diagnosis text as a string" or null
    }
  ],
  "clinical": {
    "reasonForReferral": "why the patient is being referred" or null,
    "symptoms": ["list of symptoms mentioned"] or [],
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
3. For phone numbers, extract digits only (no parentheses or dashes).
4. For dates, always use MM/DD/YYYY format.
5. If you see a table or form with labeled fields, use the labels to identify which value goes where.
6. If a field is partially legible, include your best reading with confidence < 0.7.
7. If handwriting is present, attempt to read it — it's often the most critical information.
8. If this page is a fax cover sheet with no patient data, set pageType to "cover_sheet" and all fields to null.
9. Member IDs and group IDs: copy EXACTLY as printed, including letters, numbers, and dashes.
10. If you see multiple insurance entries (primary/secondary), include both in the insurance array.
11. For patient name: "first" means the person's given name, "last" means their family/surname. If you see "LASTNAME, FIRSTNAME" format, the part BEFORE the comma is the last name.
12. NPI is ALWAYS a 10-digit number starting with 1 or 2. Phone numbers and fax numbers are NOT NPIs.
13. Every value in the JSON must be a simple string, number, or null — never nest objects inside string fields.
14. Each diagnosis code must be a single string (e.g., "G47.33"), not an array. List multiple diagnoses as separate objects in the diagnoses array.`;

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
      provider: { name: null, npi: null, practice: null, phone: null, fax: null },
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

    // Provider: prefer first non-null
    if (!merged.provider.name && page.provider?.name) merged.provider.name = page.provider.name;
    if (!merged.provider.npi && page.provider?.npi) merged.provider.npi = page.provider.npi;
    if (!merged.provider.practice && page.provider?.practice) merged.provider.practice = page.provider.practice;
    if (!merged.provider.phone && page.provider?.phone) merged.provider.phone = page.provider.phone;
    if (!merged.provider.fax && page.provider?.fax) merged.provider.fax = page.provider.fax;

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
function normalizeVlmResult(vlm) {
  // Fix name order: if first looks like a last name (all caps, followed by comma-style)
  // and last looks like a first name, swap them
  let firstName = vlm.patient?.first || null;
  let lastName = vlm.patient?.last || null;
  
  if (firstName && lastName) {
    // Check for "LASTNAME, FIRSTNAME" that got split wrong
    // Heuristic: if "first" contains a comma or period suffix suggesting it's actually "LAST,"
    const firstTrimmed = firstName.replace(/[,.\s]+$/, '').trim();
    const lastTrimmed = lastName.replace(/[,.\s]+$/, '').trim();
    
    // If what's labeled "first" looks like a surname (no spaces, all caps) 
    // and "last" has a middle initial or lowercase — they're likely swapped
    if (firstTrimmed && lastTrimmed && !firstTrimmed.includes(' ') && 
        (lastTrimmed.includes(' ') || lastTrimmed.includes('.'))) {
      // Swap — VLM likely read "LASTNAME FIRSTNAME M." and put them in wrong fields
      firstName = lastTrimmed.split(/[\s.]+/)[0]; // Take first token as given name
      lastName = firstTrimmed;
    }
  }
  
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
  
  // Normalize CPT: extract the code string if VLM returned an object/array
  const normalizeCpt = (cpt) => {
    if (!cpt) return null;
    if (typeof cpt === 'string') return cpt.replace(/[^\dA-Za-z]/g, '').toUpperCase();
    if (Array.isArray(cpt) && cpt.length > 0) {
      const first = cpt[0];
      if (typeof first === 'string') return first;
      if (first?.code) return String(first.code);
    }
    if (typeof cpt === 'object' && cpt.code) return String(cpt.code);
    return null;
  };
  
  // Normalize diagnosis code: ensure it's a string, not an array
  const normalizeDxCode = (code) => {
    if (!code) return null;
    if (typeof code === 'string') return code;
    if (Array.isArray(code)) return code[0] || null;
    return String(code);
  };
  // Build symptoms array in the expected format
  const symptoms = (vlm.clinical?.symptoms || []).map(s => ({
    name: typeof s === 'string' ? s : s.name || String(s),
    status: 'confirmed',
    context: 'VLM extraction',
    page: vlm._meta?.page || 1
  }));

  return {
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
    provider: {
      name: vlm.provider?.name || null,
      npi: normalizeNpi(vlm.provider?.npi),
      practice: vlm.provider?.practice || null,
      phone: normalizePhone(vlm.provider?.phone),
      fax: normalizePhone(vlm.provider?.fax)
    },
    procedure: {
      cpt: normalizeCpt(vlm.procedure?.cpt),
      description: typeof vlm.procedure?.description === 'string' ? vlm.procedure.description : null,
      authNumber: vlm.procedure?.authNumber || null,
      notes: [typeof vlm.procedure?.description === 'string' ? vlm.procedure.description : null].filter(Boolean)
    },
    diagnoses: (vlm.diagnoses || []).map(dx => ({
      code: normalizeDxCode(dx.code),
      description: typeof dx.description === 'string' ? dx.description : null,
      temporal: 'current'
    })).filter(dx => dx.code),
    symptoms,
    clinical: {
      reasonForReferral: vlm.clinical?.reasonForReferral || null,
      medications: vlm.clinical?.medications || [],
      history: vlm.clinical?.history || null,
      bmi: vlm.clinical?.bmi || null,
      notes: vlm.clinical?.notes || null
    },
    confidence: mapConfidenceLevel(vlm.confidence),
    confidenceScore: vlm.confidence || 0,
    extractionMethod: 'vlm_primary',
    flags: {
      verifyManually: (vlm.confidence || 0) < 0.6,
      reasons: (vlm.confidence || 0) < 0.6 ? ['Low VLM extraction confidence'] : []
    }
  };
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
    provider: { name: null, npi: null, practice: null, phone: null, fax: null },
    procedure: { cpt: null, description: null, authNumber: null },
    diagnoses: [],
    clinical: { reasonForReferral: null, symptoms: [], medications: [], history: null, bmi: null, notes: null },
    confidence: 0
  };
}

/**
 * Parse JSON from VLM response, handling common VLM output quirks.
 */
function parseVlmJson(raw, pageNum = 0) {
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
