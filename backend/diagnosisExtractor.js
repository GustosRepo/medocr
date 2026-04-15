/**
 * diagnosisExtractor.js — Context-aware ICD-10 extraction from OCR pages
 *
 * Architecture:
 *   1. Classify each page by type (order, facesheet, encounter, lab, etc.)
 *   2. Extract ICD-10 codes ONLY from diagnosis-relevant pages
 *   3. Use context awareness to avoid HCPCS/CPT codes masquerading as ICD-10
 *   4. Map condition names from Problems lists → ICD-10 via lookup dictionary
 *   5. Deduplicate and return clean diagnosis array
 *
 * This module runs on ALL OCR pages (not limited to the 8 the LLM sees)
 * and completes in <100ms. The LLM should NOT extract diagnoses.
 */

import { log } from './logging/logger.js';

// ──────────────────────────────────────────────
// Page Classification
// ──────────────────────────────────────────────

const PAGE_TYPES = {
  ORDER: 'order',
  FACESHEET: 'facesheet',
  ENCOUNTER: 'encounter',
  REFERRAL_NOTE: 'referral_note',
  LAB: 'lab',
  MEDICATION: 'medication',
  BLANK: 'blank',
  OTHER: 'other'
};

/**
 * Classify a single OCR page by its content.
 * Returns { type, confidence, signals }
 */
function classifyPage(pageText) {
  const text = (pageText || '').toLowerCase();
  const len = text.replace(/\s/g, '').length;

  if (len < 50) return { type: PAGE_TYPES.BLANK, confidence: 1.0, signals: ['too_short'] };

  const signals = [];
  const scores = {
    [PAGE_TYPES.ORDER]: 0,
    [PAGE_TYPES.FACESHEET]: 0,
    [PAGE_TYPES.ENCOUNTER]: 0,
    [PAGE_TYPES.REFERRAL_NOTE]: 0,
    [PAGE_TYPES.LAB]: 0,
    [PAGE_TYPES.MEDICATION]: 0,
  };

  // Order page signals
  if (/\border\s+(name|information|detail)/i.test(text)) scores[PAGE_TYPES.ORDER] += 3;
  if (/\bprocedure\s+code/i.test(text)) scores[PAGE_TYPES.ORDER] += 3;
  if (/\bplace\s+of\s+service/i.test(text)) scores[PAGE_TYPES.ORDER] += 2;
  if (/\bordering\s+provider/i.test(text)) scores[PAGE_TYPES.ORDER] += 2;
  if (/\bpre-op\s+orders?\b/i.test(text)) scores[PAGE_TYPES.ORDER] += 3;
  if (/\bauthorization.*not\s*required/i.test(text)) scores[PAGE_TYPES.ORDER] += 2;
  if (/\bicd[\s-]*10/i.test(text)) scores[PAGE_TYPES.ORDER] += 1;
  if (/\belectronically\s+signed\s+by/i.test(text)) scores[PAGE_TYPES.ORDER] += 1;

  // Facesheet signals
  if (/\bfacesheet\b/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 5;
  if (/\bdemographics\b/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 2;
  if (/\bprimary\s+insurance/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 2;
  if (/\bsecondary\s+insurance/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 2;
  if (/\bpreferred\s+(?:pharmacy|lab|imaging)/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 2;
  if (/\bproblems?\b[\s\S]{0,30}\breviewed/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 2;
  if (/\bportal\s+registration/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 1;
  if (/\bhome\s+phone\b.*\bmobile\s+phone\b/i.test(text)) scores[PAGE_TYPES.FACESHEET] += 2;

  // Encounter/clinical note signals
  if (/\bchief\s+complaint/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 3;
  if (/\bassessment\s*\/?\s*plan/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 3;
  if (/\bhistory\s+of\s+present/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 3;
  if (/\breview\s+of\s+systems/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 2;
  if (/\bphysical\s+exam/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 2;
  if (/\bencounter\s+date/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 2;
  if (/\bvitals?\b/i.test(text) && /\b(ht|wt|bp|bmi|pulse)\b/i.test(text)) scores[PAGE_TYPES.ENCOUNTER] += 2;
  if (/\bROS\b/.test(pageText)) scores[PAGE_TYPES.ENCOUNTER] += 1;

  // Referral note signals
  if (/\breferral\s+note\b/i.test(text)) scores[PAGE_TYPES.REFERRAL_NOTE] += 5;
  if (/\breason\s+for\s+referral/i.test(text)) scores[PAGE_TYPES.REFERRAL_NOTE] += 3;
  if (/\btable\s+of\s+contents/i.test(text)) scores[PAGE_TYPES.REFERRAL_NOTE] += 2;
  if (/\bpast\s+encounters?\b/i.test(text)) scores[PAGE_TYPES.REFERRAL_NOTE] += 2;

  // Lab report signals
  if (/\blabcorp\b/i.test(text)) scores[PAGE_TYPES.LAB] += 4;
  if (/\bquest\s+diagnostics/i.test(text)) scores[PAGE_TYPES.LAB] += 4;
  if (/\breference\s+(range|interval)/i.test(text)) scores[PAGE_TYPES.LAB] += 3;
  if (/\bspecimen\s+(id|source|coll)/i.test(text)) scores[PAGE_TYPES.LAB] += 3;
  if (/\bpreliminary\s+report/i.test(text)) scores[PAGE_TYPES.LAB] += 2;
  if (/\b(mg\/dl|mmol\/l|x10e3|iu\/l|ng\/ml|pg\/ml)\b/i.test(text)) scores[PAGE_TYPES.LAB] += 3;
  if (/\b(abnormal|normal|high|low|critical)\b/i.test(text) && /\b(result|value)\b/i.test(text)) scores[PAGE_TYPES.LAB] += 2;
  if (/\bdate\s+collected/i.test(text)) scores[PAGE_TYPES.LAB] += 2;

  // Medication list signals
  if (/\bmedication\s+list\b/i.test(text)) scores[PAGE_TYPES.MEDICATION] += 5;
  if (/\b\d+\s*mg\s+(tablet|capsule|injection)\b/i.test(text)) scores[PAGE_TYPES.MEDICATION] += 2;
  if ((text.match(/\b(filled|prescribed|requested|active|completed)\b/gi) || []).length >= 3) scores[PAGE_TYPES.MEDICATION] += 3;
  if (/\btake\s+\d+\s+(tablet|capsule)/i.test(text)) scores[PAGE_TYPES.MEDICATION] += 2;

  // Find best type
  let bestType = PAGE_TYPES.OTHER;
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // Require minimum score to classify
  if (bestScore < 3) bestType = PAGE_TYPES.OTHER;

  return { type: bestType, confidence: Math.min(bestScore / 10, 1.0), signals };
}

/**
 * Classify all pages in a document.
 */
function classifyAllPages(ocrPages) {
  return ocrPages.map((page, idx) => ({
    pageIndex: idx,
    pageNum: page.page || idx + 1,
    type: classifyPage(page.text),
    textLength: (page.text || '').length
  }));
}

// ──────────────────────────────────────────────
// Condition Name → ICD-10 Lookup
// ──────────────────────────────────────────────

const CONDITION_TO_ICD = new Map([
  // Sleep disorders
  ['obstructive sleep apnea', 'G47.33'],
  ['sleep apnea', 'G47.30'],
  ['sleep apnea, unspecified', 'G47.30'],
  ['central sleep apnea', 'G47.31'],
  ['insomnia', 'G47.00'],
  ['insomnia, unspecified', 'G47.00'],
  ['narcolepsy', 'G47.419'],
  ['restless legs syndrome', 'G25.81'],
  ['restless leg syndrome', 'G25.81'],
  ['circadian rhythm sleep disorder', 'G47.20'],
  ['hypersomnia', 'G47.10'],
  ['parasomnia', 'G47.50'],
  ['sleep disorder', 'G47.9'],

  // Obesity / Weight
  ['obesity', 'E66.9'],
  ['obesity, unspecified', 'E66.9'],
  ['morbid obesity', 'E66.01'],
  ['overweight', 'E66.3'],
  ['body mass index', 'Z68.1'], // generic — specifics are Z68.30-Z68.45

  // Metabolic
  ['type 2 diabetes', 'E11.9'],
  ['type 2 diabetes mellitus', 'E11.9'],
  ['type 2 diabetes mellitus without complications', 'E11.9'],
  ['type 1 diabetes', 'E10.9'],
  ['type 1 diabetes mellitus', 'E10.9'],
  ['diabetes mellitus', 'E11.9'],
  ['hyperlipidemia', 'E78.5'],
  ['hyperlipidemia, unspecified', 'E78.5'],
  ['dyslipidemia', 'E78.5'],
  ['hypothyroidism', 'E03.9'],
  ['hyperthyroidism', 'E05.90'],
  ['vitamin d deficiency', 'E55.9'],

  // Cardiovascular
  ['hypertension', 'I10'],
  ['essential hypertension', 'I10'],
  ['hypertensive heart disease', 'I11.9'],
  ['atrial fibrillation', 'I48.91'],
  ['atrial fibrillation, unspecified', 'I48.91'],
  ['coronary artery disease', 'I25.10'],
  ['coronary arteriosclerosis', 'I25.10'],
  ['atherosclerotic heart disease', 'I25.10'],
  ['old myocardial infarction', 'I25.2'],
  ['myocardial infarction', 'I25.2'],
  ['heart failure', 'I50.9'],
  ['congestive heart failure', 'I50.9'],
  ['coronary artery bypass graft', 'Z95.1'],

  // Respiratory
  ['snoring', 'R06.83'],
  ['shortness of breath', 'R06.02'],
  ['dyspnea', 'R06.00'],
  ['chronic obstructive pulmonary disease', 'J44.1'],
  ['copd', 'J44.1'],
  ['asthma', 'J45.909'],
  ['pneumoconiosis', 'J62.8'],

  // Neurological / Psychiatric
  ['fatigue', 'R53.83'],
  ['chronic fatigue', 'R53.83'],
  ['malaise and fatigue', 'R53.83'],
  ['excessive daytime sleepiness', 'R40.0'],
  ['depression', 'F33.9'],
  ['major depressive disorder', 'F33.9'],
  ['anxiety', 'F41.9'],
  ['anxiety disorder', 'F41.9'],
  ['generalized anxiety disorder', 'F41.1'],
  ['ptsd', 'F43.10'],
  ['post-traumatic stress disorder', 'F43.10'],
  ['nocturia', 'R35.1'],
  ['witnessed apnea', 'G47.33'],

  // Musculoskeletal
  ['neck pain', 'M54.2'],
  ['back pain', 'M54.5'],
  ['chronic pain', 'G89.29'],

  // GI
  ['gastroesophageal reflux', 'K21.9'],
  ['gerd', 'K21.9'],
  ['gastroesophageal reflux disease', 'K21.9'],

  // Other common
  ['polycythemia', 'D75.1'],
  ['tobacco use', 'F17.210'],
  ['tobacco dependence', 'F17.210'],
  ['nocturia', 'R35.1'],
  ['frequent urination', 'R35.0'],
  ['edema', 'R60.9'],
]);

// ──────────────────────────────────────────────
// Context-Aware ICD-10 Code Extraction
// ──────────────────────────────────────────────

// ICD-10 codes already have dots: A00.0 through T98.9, plus V/W/X/Y/Z codes
const ICD10_WITH_DOT = /\b([A-TV-Z]\d{2}\.\d{1,4})\b/g;

// Labels that indicate the nearby codes are diagnoses (not procedures)
const DIAGNOSIS_CONTEXT = /(?:diagnosis|diagnos|icd[\s-]*10|icd[\s-]*code|assessment|problem|condition|dx)\b/i;

// Labels that indicate the nearby codes are procedures (NOT diagnoses)
const PROCEDURE_CONTEXT = /(?:procedure\s+code|cpt|hcpcs|place\s+of\s+service|proc\s+code)\b/i;

// HCPCS G-codes (G0000-G9999) that are NOT ICD-10 diagnoses
// ICD-10 G codes are G00-G99 (nervous system diseases). HCPCS G codes are G0XXX (4+ digits after G)
const HCPCS_G_CODE = /^G\d{4,}$/; // G followed by 4+ digits = HCPCS, not ICD-10

// ROS (Review of Systems) section boundaries — codes inside ROS are typically denied symptoms
const ROS_START = /\b(?:review\s+of\s+systems|ROS)\b/i;
const ROS_END = /\b(?:physical\s+exam|assessment\s*\/?\s*plan|vitals?|PE:|exam:|objective)\b/i;

// Negation words — same pattern used for condition lookup
const ICD_NEGATION_WINDOW = 50; // chars before the code
const ICD_NEGATION_WORDS = /\b(?:no|not|denies|denied|without|never|absent|negative\s+for|rules?\s+out|r\/o|free\s+of|no\s+evidence|no\s+current)\b/i;

/**
 * Check if a position in the text falls within a ROS section.
 * ROS sections contain denied symptoms — ICD codes there are false positives.
 */
function isInsideROS(text, pos) {
  const before = text.slice(0, pos);
  const lastRosStart = before.search(/\b(?:review\s+of\s+systems|ROS)\b[^]*$/i);
  if (lastRosStart === -1) return false; // no ROS section before this position

  // Check if we've exited the ROS section (found a post-ROS header between ROS start and pos)
  const afterRos = text.slice(lastRosStart, pos);
  // The ROS_END pattern should appear AFTER the ROS start to indicate we've left the section
  // But we need to skip the first match which is the ROS start itself
  const rosContent = afterRos.replace(/^.*?\b(?:review\s+of\s+systems|ROS)\b/i, '');
  if (ROS_END.test(rosContent)) return false; // We left the ROS section

  return true;
}

/**
 * Extract ICD-10 codes from a diagnosis-relevant page.
 * Uses context to avoid procedure codes, HCPCS codes, and negated/ROS codes.
 *
 * @param {string} pageText - Raw OCR text for one page
 * @param {string} pageType - Classification of this page
 * @returns {Array<{code, description, source}>}
 */
function extractIcdFromPage(pageText, pageType, _debugPageNum) {
  const results = [];
  // Normalize OCR noise: collapse spurious spaces within potential ICD code patterns
  // e.g., "I 25.2" → "I25.2", "Z01. 818" → "Z01.818", "E 78.5" → "E78.5"
  const text = (pageText || '')
    .replace(/([A-TV-Z])\s+(\d{2}\.\d)/gi, '$1$2')   // "I 25.2" → "I25.2"
    .replace(/([A-TV-Z]\d{2})\s*\.\s*(\d)/gi, '$1.$2'); // "I25 .2" or "I25. 2" → "I25.2"
  const _dbg = _debugPageNum !== undefined;

  // Strategy 1: Find codes with proper dots already (high confidence)
  const dotMatches = [...text.matchAll(ICD10_WITH_DOT)];
  for (const match of dotMatches) {
    const code = match[1].toUpperCase();
    const pos = match.index;

    // Check surrounding context (100 chars before) to see if this is near a procedure label
    const before = text.slice(Math.max(0, pos - 100), pos);
    if (PROCEDURE_CONTEXT.test(before)) {
      if (_dbg) log('debug', 'dx_skip_procedure', { page: _debugPageNum, code, reason: 'near_procedure_label' });
      continue; // Skip — this code is near "Procedure code:" label
    }

    // Skip codes inside ROS sections — these are typically denied symptoms
    if (isInsideROS(text, pos)) {
      if (_dbg) log('debug', 'dx_skip_ros', { page: _debugPageNum, code, reason: 'inside_ros_section' });
      continue;
    }

    // Check for negation words in a window before the code
    const negBefore = text.slice(Math.max(0, pos - ICD_NEGATION_WINDOW), pos);
    if (ICD_NEGATION_WORDS.test(negBefore)) {
      if (_dbg) log('debug', 'dx_skip_negation', { page: _debugPageNum, code, reason: 'negated', context: negBefore.trim().slice(-40) });
      continue; // Skip — code appears after negation language
    }

    // Validate it looks like a real ICD-10 code
    if (isValidIcdCode(code)) {
      if (_dbg) log('debug', 'dx_found', { page: _debugPageNum, code, source: `page_${pageType}_dot` });
      // Try to find a description on the same line after the code
      const afterOnLine = text.slice(pos + code.length).split(/\n/)[0];
      const descMatch = afterOnLine.match(/^\s*[—–:,-]?\s*([A-Z][a-z][\w\s,()'-]+)/);
      const description = descMatch ? descMatch[1].trim().replace(/\s+/g, ' ').slice(0, 80) : null;

      results.push({
        code,
        description,
        source: `page_${pageType}_dot`
      });
    }
  }

  // Strategy 2: Find codes near explicit "ICD-10" or "Diagnosis" labels (dotless codes OK here)
  const icdLabelPattern = /(?:icd[\s-]*10|diagnosis|dx)[\s:]*([A-TV-Z]\d{2}\.?\d{1,4})/gi;
  let labelMatch;
  while ((labelMatch = icdLabelPattern.exec(text)) !== null) {
    let code = labelMatch[1].toUpperCase();
    const pos = labelMatch.index;
    if (!code.includes('.') && code.length >= 4) {
      code = code.slice(0, 3) + '.' + code.slice(3);
    }

    // Skip if inside ROS or negated
    if (isInsideROS(text, pos)) continue;
    const negBefore = text.slice(Math.max(0, pos - ICD_NEGATION_WINDOW), pos);
    if (ICD_NEGATION_WORDS.test(negBefore)) continue;

    if (isValidIcdCode(code) && !results.some(r => r.code === code)) {
      results.push({
        code,
        description: null,
        source: `page_${pageType}_label`
      });
    }
  }

  return results;
}

/**
 * Extract condition names from a Problems list (facesheet or encounter page)
 * and map them to ICD-10 codes using the lookup dictionary.
 *
 * @param {string} pageText - Raw OCR text for one page
 * @returns {Array<{code, description, source}>}
 */
function extractConditionsFromProblems(pageText, _debugPageNum) {
  const results = [];
  const text = pageText || '';
  const _dbg = _debugPageNum !== undefined;

  // Look for Problems section — stop at the next major section header
  const problemsMatch = text.match(/\bproblems?\b[:\s]*([\s\S]*?)(?=\b(?:HPI|Chief\s+Complaint|ROS|Review\s+of\s+Systems|Physical\s+Exam|Vitals?|Medications?|Allergies|Assessment|Surgical|Vaccines|Screening|Lab\s+Results|History\s+of\s+Present|Encounter\s+Sign|Return\s+to\s+Office)\b|$)/i);
  if (!problemsMatch) {
    if (_dbg) log('debug', 'dx_no_problems_section', { page: _debugPageNum });
    return results;
  }
  const problemsSection = problemsMatch[1] || problemsMatch[0];
  if (_dbg) log('debug', 'dx_problems_section', { page: _debugPageNum, len: problemsSection.length, preview: problemsSection.slice(0, 200) });

  // Only use the first 2000 chars to avoid bleeding into other sections
  const limitedSection = problemsSection.slice(0, 2000);

  // Negation patterns — if a condition appears after these words, it's denied
  const NEGATION_WINDOW = 40; // chars before the match to check for negation
  const NEGATION_WORDS = /\b(?:no|not|denies|denied|without|never|absent|negative\s+for|rules?\s+out|r\/o|free\s+of|no\s+evidence)\b/i;

  // Try to extract each condition name
  // OCR often inserts spurious spaces within words ("Vita min" instead of "Vitamin")
  // So we build fuzzy regexes that allow optional spaces between chars
  for (const [condition, icdCode] of CONDITION_TO_ICD) {
    // Build a fuzzy regex: allow optional space between any two characters within each word
    // e.g., "vitamin" → "v\s*i\s*t\s*a\s*m\s*i\s*n" to match "vita min" or "vitam in"
    const fuzzyPattern = condition.split(/\s+/).map(word => {
      return word.split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    }).join('\\s+');
    const condRegex = new RegExp(`(?:^|[\\s\\-·•●,;])${fuzzyPattern}(?=[\\s\\-·•●,;:.]|$)`, 'gi');
    let match;
    let foundPositive = false;

    while ((match = condRegex.exec(limitedSection)) !== null) {
      const pos = match.index;
      // Check for negation in the window before this match
      const before = limitedSection.slice(Math.max(0, pos - NEGATION_WINDOW), pos);
      if (NEGATION_WORDS.test(before)) {
        continue; // Skip — this is a denied/negated condition
      }
      foundPositive = true;
      break;
    }

    if (foundPositive && !results.some(r => r.code === icdCode)) {
      results.push({
        code: icdCode,
        description: condition,
        source: 'problems_list_lookup'
      });
    }
  }

  return results;
}

/**
 * Extract ICD codes from Past Encounters tables.
 * These often have format: "Condition Name  SNOMED_CODE  ICD_CODE"
 *
 * @param {string} pageText
 * @returns {Array<{code, description, source}>}
 */
function extractFromPastEncounters(pageText) {
  const results = [];
  // Normalize OCR spacing in ICD codes
  const text = (pageText || '')
    .replace(/([A-TV-Z])\s+(\d{2}\.\d)/gi, '$1$2')
    .replace(/([A-TV-Z]\d{2})\s*\.\s*(\d)/gi, '$1.$2');

  // Pattern: "condition name" followed by SNOMED + ICD code
  // e.g., "Type 2 diabetes mellitus  44054006 E11.9"
  // Also handle codes with 1-4 digits after dot (I25.2 has only 1 digit), and OCR spacing
  const encounterPattern = /([A-Za-z][\w\s]+?)\s+\d{6,10}\s*([A-TV-Z]\d{2}\.\d{1,4})/g;
  let m;
  while ((m = encounterPattern.exec(text)) !== null) {
    const code = m[2].toUpperCase();
    const desc = m[1].trim();
    if (isValidIcdCode(code) && !results.some(r => r.code === code)) {
      results.push({
        code,
        description: desc.slice(0, 80),
        source: 'past_encounters'
      });
    }
  }

  return results;
}

/**
 * Validate that a code looks like a real ICD-10 diagnosis code.
 * Filters out HCPCS codes, CPT codes, and other false positives.
 */
function isValidIcdCode(code) {
  if (!code || code.length < 3) return false;

  // Must match ICD-10 format: letter + 2 digits + dot + 1-4 digits
  if (!/^[A-TV-Z]\d{2}\.\d{1,4}$/.test(code)) return false;

  // Filter out G codes that are HCPCS (G0XXX patterns without dot in original)
  // G00-G99 are valid ICD-10. But G03.99 from G0399 (HCPCS) is not.
  // The 3rd digit after G in ICD-10 nervous system diseases maxes out:
  //   G00-G09 (inflammatory diseases), G10-G14, G20-G26, G30-G32, G35-G37,
  //   G40-G47, G50-G59, G60-G65, G70-G73, G80-G83, G89-G99
  // But HCPCS G-codes like G0399, G0108 etc. wouldn't have a proper ICD description
  // Our best heuristic: trust codes with dots that were in the original text

  // Filter known false-positive ranges
  const prefix = code.slice(0, 3);
  
  // S/T codes (injuries) are unusual in sleep referrals but valid
  // V/W/X/Y codes (external causes) are very unusual
  // U codes are reserved
  if (/^U/.test(prefix)) return false;

  return true;
}

// ──────────────────────────────────────────────
// Main Extraction Pipeline
// ──────────────────────────────────────────────

/**
 * Extract all diagnosis codes from a full set of OCR pages.
 * Runs against ALL pages (not limited to LLM page selection).
 *
 * @param {Array} ocrPages - Array of { page, text, boxes }
 * @param {Object} options - { id } for logging
 * @returns {{ diagnoses: Array<{code, description, source}>, pageClassifications: Array }}
 */
export function extractDiagnoses(ocrPages, options = {}) {
  const { id = 'unknown' } = options;
  const startTime = Date.now();

  // Step 1: Classify all pages
  const classifications = classifyAllPages(ocrPages);

  const typeCounts = {};
  for (const c of classifications) {
    typeCounts[c.type.type] = (typeCounts[c.type.type] || 0) + 1;
  }
  log('info', 'dx_page_classification', { id, pages: ocrPages.length, types: typeCounts });

  // Step 2: Extract diagnoses from relevant pages only
  const allDiagnoses = [];
  const seenCodes = new Set();

  const addDx = (dx) => {
    if (seenCodes.has(dx.code)) {
      log('debug', 'dx_dedup_exact', { id, code: dx.code, source: dx.source });
      return;
    }

    // Dedup within same code family: G47.30 vs G47.33
    // Only dedup if codes share the same 3-char prefix AND the first digit after the dot
    // e.g., G47.3x family: G47.30 (generic) vs G47.33 (specific)
    // But I25.2 and I25.10 are DIFFERENT conditions — do NOT dedup
    const codeBase = dx.code.match(/^([A-Z]\d{2}\.\d)/); // e.g. "G47.3" from G47.33
    const familyKey = codeBase ? codeBase[1] : dx.code;
    const isGeneric = /\.\d0$/.test(dx.code); // ends in X0 like G47.30, E66.90

    if (isGeneric && codeBase) {
      // Check if we already have a more specific code in this exact sub-family
      for (const existing of seenCodes) {
        const existBase = existing.match(/^([A-Z]\d{2}\.\d)/);
        if (existBase && existBase[1] === familyKey && existing !== dx.code) {
          log('debug', 'dx_dedup_generic', { id, code: dx.code, existingSpecific: existing });
          return; // Skip generic — we have a specific code like G47.33
        }
      }
    }

    seenCodes.add(dx.code);
    allDiagnoses.push(dx);
  };

  for (let i = 0; i < ocrPages.length; i++) {
    const page = ocrPages[i];
    const classification = classifications[i];
    const pageType = classification.type.type;
    const pageText = page.text || '';
    const pageNum = page.page || i + 1;

    // Skip pages that can't have diagnoses
    if (pageType === PAGE_TYPES.LAB || pageType === PAGE_TYPES.MEDICATION || pageType === PAGE_TYPES.BLANK) {
      continue;
    }

    log('debug', 'dx_processing_page', { id, pageNum, pageType, textLen: pageText.length });

    // Extract explicit ICD-10 codes from any non-skipped page
    const icdCodes = extractIcdFromPage(pageText, pageType, pageNum);
    icdCodes.forEach(addDx);

    // Extract condition names from Problems lists (any page can have them)
    const conditionCodes = extractConditionsFromProblems(pageText, pageNum);
    conditionCodes.forEach(addDx);

    // Extract from Past Encounters tables (any page can have them)
    const encounterCodes = extractFromPastEncounters(pageText);
    encounterCodes.forEach(addDx);
  }

  const elapsed = Date.now() - startTime;
  log('info', 'dx_extraction_complete', {
    id,
    elapsed,
    totalCodes: allDiagnoses.length,
    sources: [...new Set(allDiagnoses.map(d => d.source))],
    codes: allDiagnoses.map(d => d.code)
  });

  // Flag descriptions that look like OCR artifacts
  for (const dx of allDiagnoses) {
    dx.ocrFlag = hasOcrArtifact(dx.description);
  }

  return {
    diagnoses: allDiagnoses,
    pageClassifications: classifications
  };
}

/**
 * Detect OCR artifacts in a diagnosis description.
 * Returns true if the description looks garbled/truncated.
 */
function hasOcrArtifact(desc) {
  if (!desc || desc.length === 0) return false;
  // Very short description (likely truncated)
  if (desc.length <= 4) return true;

  const REAL_WORDS = /^(a|d|i|x|the|and|for|not|von|de|or|an|in|of|to|is|it|by|as|at|on|no|so|do|if|up|my|we|he|mg|ml|iv|ii|vs|type|old|with|without)$/i;

  // Check for space-broken words: look at each adjacent word pair
  // A broken word has one fragment ≤3 chars that isn't a real word
  // e.g., "dia betes" ("dia"=3, not real) → flagged
  // but "bypass graft" ("bypass"=6, "graft"=5) → not flagged
  // and "vitamin d deficiency" ("d"=1, but IS a real word) → not flagged
  const words = desc.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i].replace(/[^a-zA-Z]/g, '');
    const next = words[i + 1].replace(/[^a-zA-Z]/g, '');
    if (w.length <= 3 && w.length > 0 && /^[a-z]+$/i.test(w) && !REAL_WORDS.test(w)) return true;
    if (next.length <= 3 && next.length > 0 && /^[a-z]+$/i.test(next) && !REAL_WORDS.test(next)) return true;
  }

  // Ends abruptly mid-word (last word ≤3 chars and not a common word)
  const lastWord = words[words.length - 1].replace(/[^a-zA-Z]/g, '');
  if (lastWord && lastWord.length <= 3 && lastWord.length > 0 && /^[a-z]+$/i.test(lastWord) && !REAL_WORDS.test(lastWord)) return true;

  return false;
}

export default { extractDiagnoses };
