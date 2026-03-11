/**
 * icdMatcher.js — ICD-10 Code Matching Engine (Tier A + Tier B)
 * 
 * 3-tier strategy:
 *   Tier A: Fast keyword match against icd10_curated.json (~85 codes with keywords)
 *   Tier B: LLM semantic match against icd10_master_fy2026.json (~5,193 codes)
 *   NLP Context: Negation detection, family-vs-personal, temporal qualifiers
 * 
 * Tier A runs deterministically (no LLM). Tier B only fires when Tier A finds nothing.
 */

import { getIcd10Curated, getIcd10Master } from '../../kbLoader.js';

const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const TEXT_MODEL = process.env.TEXT_MODEL || 'qwen2.5:14b';
const ICD_LLM_TIMEOUT = 15_000;

// ─── Tier A: Keyword-based matching ──────────────────────────

/**
 * Build an inverted index: keyword → [{ code, description, category }]
 * Cached on first call.
 */
let _tierAIndex = null;

function getTierAIndex() {
  if (_tierAIndex) return _tierAIndex;
  const curated = getIcd10Curated();
  if (!curated?.codes) return new Map();

  const index = new Map();
  for (const [code, entry] of Object.entries(curated.codes)) {
    const keywords = entry.keywords || [];
    for (const kw of keywords) {
      const norm = kw.toLowerCase().trim();
      if (!index.has(norm)) index.set(norm, []);
      index.get(norm).push({
        code,
        description: entry.description,
        category: entry.category,
        comorbidityFlags: entry.comorbidity_flags || [],
      });
    }
  }
  _tierAIndex = index;
  return index;
}

/**
 * Match clinical text against Tier A keywords.
 * Returns matched codes sorted by relevance (keyword length = specificity).
 * 
 * @param {string} clinicalText - Combined clinical text from extraction
 * @returns {Array<{ code, description, category, matchedKeyword, tier }>}
 */
export function matchTierA(clinicalText) {
  if (!clinicalText) return [];
  const index = getTierAIndex();
  if (index.size === 0) return [];

  const text = clinicalText.toLowerCase();
  const matches = new Map(); // code → best match

  for (const [keyword, entries] of index) {
    if (text.includes(keyword)) {
      for (const entry of entries) {
        const existing = matches.get(entry.code);
        // Keep the longest keyword match (more specific)
        if (!existing || keyword.length > existing.matchedKeyword.length) {
          matches.set(entry.code, {
            ...entry,
            matchedKeyword: keyword,
            tier: 'A',
          });
        }
      }
    }
  }

  // Sort by keyword length descending (more specific first)
  return [...matches.values()].sort((a, b) => b.matchedKeyword.length - a.matchedKeyword.length);
}

// ─── Tier B: LLM semantic matching ──────────────────────────

/**
 * Build a compact code list for a relevant ICD category.
 * The master file is category-grouped (e.g. "G47": { "G47.30": "...", ... }).
 * We find categories heuristically from the clinical text.
 */
function findRelevantCategories(clinicalText) {
  const text = clinicalText.toLowerCase();
  const categories = new Set();

  // Map clinical keywords to ICD chapter categories
  const heuristics = [
    { keywords: ['sleep', 'apnea', 'insomnia', 'narcolepsy', 'hypersomnia', 'parasomnia'], cats: ['G47'] },
    { keywords: ['obesity', 'bmi', 'overweight', 'morbid'], cats: ['E66'] },
    { keywords: ['hypertension', 'blood pressure', 'htn'], cats: ['I10', 'I11', 'I12', 'I13', 'I15'] },
    { keywords: ['diabetes', 'diabetic', 'dm', 'a1c'], cats: ['E08', 'E09', 'E10', 'E11', 'E13'] },
    { keywords: ['heart failure', 'chf', 'cardiomyopathy', 'ejection fraction'], cats: ['I50'] },
    { keywords: ['atrial fibrillation', 'afib', 'a-fib', 'flutter'], cats: ['I48'] },
    { keywords: ['copd', 'emphysema', 'chronic bronchitis', 'chronic obstructive'], cats: ['J44'] },
    { keywords: ['asthma'], cats: ['J45'] },
    { keywords: ['thyroid', 'hypothyroid', 'hyperthyroid'], cats: ['E03', 'E05'] },
    { keywords: ['depression', 'depressive', 'major depressive'], cats: ['F32', 'F33'] },
    { keywords: ['anxiety', 'gad', 'panic'], cats: ['F41'] },
    { keywords: ['ptsd', 'post-traumatic', 'trauma'], cats: ['F43'] },
    { keywords: ['opioid', 'substance', 'alcohol'], cats: ['F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F19'] },
    { keywords: ['stroke', 'cva', 'cerebrovascular'], cats: ['I63', 'I65', 'I66', 'I67'] },
    { keywords: ['chronic kidney', 'ckd', 'renal', 'dialysis'], cats: ['N18'] },
    { keywords: ['epilepsy', 'seizure'], cats: ['G40'] },
    { keywords: ['headache', 'migraine'], cats: ['G43', 'G44'] },
    { keywords: ['neuromuscular', 'muscular dystrophy', 'myasthenia', 'als'], cats: ['G71', 'G12'] },
    { keywords: ['oxygen', 'supplemental o2', 'home o2'], cats: ['Z99'] },
    { keywords: ['snoring', 'fatigue', 'tiredness', 'somnolence', 'drowsy'], cats: ['R06', 'R53', 'R40'] },
    { keywords: ['restless leg', 'rls', 'periodic limb'], cats: ['G25'] },
  ];

  for (const h of heuristics) {
    if (h.keywords.some(kw => text.includes(kw))) {
      h.cats.forEach(c => categories.add(c));
    }
  }

  // Always include sleep-primary categories
  categories.add('G47');

  return [...categories];
}

/**
 * Build a compact code block string from the master file for given categories.
 * Limited to keep LLM context manageable.
 */
function buildCandidateCodeBlock(categories) {
  const master = getIcd10Master();
  if (!master) return '';

  const lines = [];
  let count = 0;
  const MAX_CODES = 200; // Cap to keep prompt manageable

  for (const cat of categories) {
    const entries = master[cat];
    if (!entries) continue;
    for (const [code, desc] of Object.entries(entries)) {
      if (code.startsWith('_')) continue;
      lines.push(`${code}: ${desc}`);
      count++;
      if (count >= MAX_CODES) break;
    }
    if (count >= MAX_CODES) break;
  }

  return lines.join('\n');
}

/**
 * Call the text LLM to semantically match clinical text to ICD codes.
 * Only called when Tier A produces no results.
 * 
 * @param {string} clinicalText - Combined clinical text
 * @returns {Array<{ code, description, confidence, tier }>}
 */
export async function matchTierB(clinicalText) {
  if (!clinicalText || clinicalText.length < 10) return [];

  const categories = findRelevantCategories(clinicalText);
  const codeBlock = buildCandidateCodeBlock(categories);
  if (!codeBlock) return [];

  const prompt = `You are a medical coding assistant. Match the clinical text below to the MOST appropriate ICD-10 codes from the candidate list.

RULES:
- Return ONLY codes that appear in the candidate list below
- Return 1-3 codes maximum, ranked by relevance
- Include the EXACT code and description from the list
- Rate confidence: high (clear match), medium (probable), low (possible)
- If nothing matches well, return an empty array

CANDIDATE ICD-10 CODES:
${codeBlock}

CLINICAL TEXT:
${clinicalText}

Return ONLY valid JSON array:
[{"code": "G47.33", "description": "Obstructive sleep apnea (adult)", "confidence": "high"}]`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ICD_LLM_TIMEOUT);

  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 300, num_ctx: 8192 }
      }),
      signal: controller.signal
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    const responseText = data.response || '';

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(r => r.code && r.description)
      .map(r => ({ code: r.code, description: r.description, confidence: r.confidence || 'medium', tier: 'B' }))
      .slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── NLP Context Detection ──────────────────────────────────

/**
 * Detect negation, family history, and temporal context around ICD-relevant phrases.
 * 
 * @param {string} clinicalText
 * @param {Array} matchedCodes - From matchTierA or matchTierB
 * @returns {Array} matchedCodes enriched with context flags
 */
export function detectNlpContext(clinicalText, matchedCodes) {
  if (!clinicalText || !matchedCodes?.length) return matchedCodes;
  const text = clinicalText.toLowerCase();

  // Negation patterns (window: 40 chars before the keyword)
  const negationPrefixes = [
    'no ', 'no evidence of ', 'denies ', 'denied ', 'negative for ',
    'without ', 'absent ', 'not ', 'rules out ', 'ruled out ',
    'does not have ', 'never had ', 'no history of ', 'no hx of '
  ];

  // Family history patterns
  const familyPrefixes = [
    'family history of ', 'family hx of ', 'fh of ', 'fhx of ',
    'mother has ', 'father has ', 'sibling has ', 'parent has ',
    'family member with ', 'familial '
  ];

  // Temporal qualifiers
  const pastPrefixes = [
    'history of ', 'hx of ', 'h/o ', 'previous ', 'prior ', 'former ',
    'resolved ', 'past ', 'childhood '
  ];

  return matchedCodes.map(match => {
    const keyword = (match.matchedKeyword || match.description || '').toLowerCase();
    if (!keyword) return { ...match, context: 'personal', temporal: 'current', negated: false };

    const idx = text.indexOf(keyword);
    if (idx < 0) return { ...match, context: 'personal', temporal: 'current', negated: false };

    // Find the sentence containing the keyword (split on . ! ? ;)
    // Then only look at the part before the keyword within that sentence
    const sentenceStart = Math.max(
      text.lastIndexOf('.', idx - 1) + 1,
      text.lastIndexOf('!', idx - 1) + 1,
      text.lastIndexOf('?', idx - 1) + 1,
      text.lastIndexOf(';', idx - 1) + 1,
      0
    );
    const prefix = text.substring(sentenceStart, idx);

    const negated = negationPrefixes.some(n => prefix.includes(n));
    const isFamily = familyPrefixes.some(f => prefix.includes(f));
    const isPast = pastPrefixes.some(p => prefix.includes(p));

    return {
      ...match,
      context: isFamily ? 'family' : 'personal',
      temporal: isPast ? 'past' : 'current',
      negated,
    };
  });
}

// ─── Main Assessment Function ────────────────────────────────

/**
 * Full ICD matching assessment.
 * Tier A first (deterministic). If no results, falls through to Tier B (LLM).
 * NLP context applied to all results.
 * 
 * @param {Object} result - Extraction result
 * @returns {Promise<{ codes: Array, tier: string, flags: Array }>}
 */
export async function assessIcd(result) {
  const flags = [];

  // Build combined clinical text from all relevant fields
  const textParts = [
    result?.diagnosis,
    result?.referralReason,
    result?.clinicalNotes,
    result?.clinical?.primaryDiagnosis?.description,
    result?.narrative?.reasonForReferral,
    result?.narrative?.clinicalHistory,
    result?.narrative?.clinicalNotes,
  ];
  // Include existing diagnoses descriptions
  if (Array.isArray(result?.diagnoses)) {
    for (const dx of result.diagnoses) {
      if (typeof dx === 'string') textParts.push(dx);
      else if (dx?.description) textParts.push(dx.description);
    }
  }
  // Include symptoms
  if (Array.isArray(result?.symptoms)) {
    for (const s of result.symptoms) {
      textParts.push(typeof s === 'string' ? s : s?.name);
    }
  }
  // Include problems list
  if (Array.isArray(result?.clinical?.problemsList)) {
    for (const p of result.clinical.problemsList) {
      textParts.push(p?.condition);
    }
  }

  const clinicalText = textParts.filter(Boolean).join(' ').trim();
  if (!clinicalText) {
    return { codes: [], tier: 'none', flags: [{ id: 'INFO_NO_CLINICAL_TEXT', severity: 5, label: 'INFO', action: 'No clinical text available for ICD matching.' }] };
  }

  // Already-extracted ICD codes from the document (pass through)
  const existingCodes = [];
  if (Array.isArray(result?.diagnoses)) {
    for (const dx of result.diagnoses) {
      const code = typeof dx === 'string' ? dx : dx?.code;
      if (code && /^[A-Z]\d{2}/.test(code)) {
        existingCodes.push({
          code,
          description: (typeof dx === 'object' ? dx.description : '') || '',
          tier: 'extracted',
          context: 'personal',
          temporal: 'current',
          negated: false,
        });
      }
    }
  }

  // Tier A: keyword matching
  let tierAMatches = matchTierA(clinicalText);
  const tier = tierAMatches.length > 0 ? 'A' : 'pending_B';

  // Apply NLP context
  tierAMatches = detectNlpContext(clinicalText, tierAMatches);

  // Filter out negated matches
  const negated = tierAMatches.filter(m => m.negated);
  tierAMatches = tierAMatches.filter(m => !m.negated);

  if (negated.length > 0) {
    flags.push({
      id: 'INFO_ICD_NEGATED',
      severity: 5,
      label: 'INFO',
      action: `Negated conditions detected (not coded): ${negated.map(n => n.code).join(', ')}`
    });
  }

  // Family history codes get flagged
  const family = tierAMatches.filter(m => m.context === 'family');
  if (family.length > 0) {
    flags.push({
      id: 'ALERT_ICD_FAMILY_HISTORY',
      severity: 4,
      label: 'ALERT',
      action: `Family history only (not personal dx): ${family.map(f => `${f.code} ${f.description}`).join('; ')}`
    });
  }

  if (tierAMatches.length > 0) {
    // Merge existing + Tier A, deduplicate by code
    const allCodes = deduplicateCodes([...existingCodes, ...tierAMatches]);
    return { codes: allCodes, tier: 'A', flags };
  }

  // Tier B: LLM semantic matching (only if Tier A found nothing new beyond existing)
  if (existingCodes.length === 0) {
    try {
      let tierBMatches = await matchTierB(clinicalText);
      tierBMatches = detectNlpContext(clinicalText, tierBMatches);
      tierBMatches = tierBMatches.filter(m => !m.negated);

      if (tierBMatches.length > 0) {
        flags.push({
          id: 'INFO_ICD_TIER_B',
          severity: 5,
          label: 'INFO',
          action: `ICD codes matched via LLM (Tier B). Verify: ${tierBMatches.map(m => m.code).join(', ')}`
        });
        return { codes: tierBMatches, tier: 'B', flags };
      }
    } catch {
      // LLM unavailable — not a blocker
    }
  }

  // Return whatever we have (existing codes or empty)
  if (existingCodes.length > 0) {
    return { codes: existingCodes, tier: 'extracted', flags };
  }

  flags.push({
    id: 'FLAG_NO_ICD',
    severity: 3,
    label: 'FLAG',
    action: 'No ICD-10 codes could be matched from clinical text. Manual coding required.'
  });
  return { codes: [], tier: 'none', flags };
}

function deduplicateCodes(codes) {
  const seen = new Set();
  return codes.filter(c => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
}
