import { normalizePages } from './normalize.js';
import { detectName, detectDob, detectPhones } from './patient.js';
import { detectCpt } from './cpt.js';
import { detectICDs } from './icd.js';
import { detectCarrier } from './carriers.js';
import { detectDates } from './date.js';
import { detectDME } from './dme.js';
import { PATTERNS } from './patterns.js';
import { loadJsonConfig } from './utils/configLoader.js';
import correctionsDB from '../corrections_db.js';
import npiService from '../npi_service.js';
import { applyOcrCorrections, applyFieldCorrection } from './utils/ocrCorrector.js';
import { isFaxLike, isLikelyProviderLine, isHeaderLine } from './context_guard.js';
import { isValidNANP } from './utils/phone.js';
import ruleEngine from './utils/ruleEngine.js';
import { 
  normalizeHistoryNotes, 
  hasHistoryOfFalls, 
  hasOpioidMed, 
  hasOxygenOrCaretaker,
  isPediatricDescription,
  hasPriorStudyEvidence,
  hasCpapTitrationContext
} from './utils/clinicalNormalization.js';

const BUSINESS_EMAIL_DEFAULTS = [
  'athomesleepstudies@ymail.com',
  'athomesleepstudies@gmail.com',
  'athomesleepstudfes@ymall.com',
  'athomesleepstudies@ymall.com',
  'athomesleepstudies@athomesleep.com',
  'athomesleepstudies@ymail.corn'
];

function getPatternOverrides() {
  return loadJsonConfig('pattern_overrides.json', { defaultFactory: () => ({}) }) || {};
}

function getCarrierIdPatterns() {
  return loadJsonConfig('carrier_id_patterns.json', { defaultFactory: () => ({}) }) || {};
}

function getCptCatalog() {
  return loadJsonConfig('cpt_catalog.json', { 
    defaultFactory: () => ([]),
    transform: (arr) => {
      const map = {};
      if (Array.isArray(arr)) {
        arr.forEach(entry => {
          if (entry.code) {
            map[entry.code] = { description: entry.description || null, why: entry.why };
          }
        });
      }
      return map;
    }
  }) || {};
}

function buildBusinessEmailBlock(overrides) {
  const overrideEmails = Array.isArray(overrides.businessEmails) ? overrides.businessEmails : [];
  const entries = [
    ...BUSINESS_EMAIL_DEFAULTS,
    ...overrideEmails.map(e => String(e || ''))
  ];
  return new Set(entries.filter(Boolean).map(e => e.toLowerCase()));
}

function escapeRegex(str) {
  return String(str || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}



const DEFAULT_PROVIDER_NAME_PATTERNS = [
  '(referring\\s*(provider|physician))',
  'refer\\s+from\\s*(provider|physician)',
  '(ordering\\s*(provider|physician))',
  'referred\\s+by',
  'attending\\s*(provider|physician)',
  '\\b[A-Z][a-zA-Z\'\\-]+(?:\\s+[A-Z][a-zA-Z\'\\-]+){1,2},\\s*(MD|DO|NP|PA\\-?C|APRN|FNP|ANP|DC|PhD)\\b',
  '\\bDr\\.?\\s+[A-Z]',
  'provider\\s*name'
];

function buildProviderNameRegexes(overrides) {
  const patterns = Array.isArray(overrides.providerNamePatterns)
    ? overrides.providerNamePatterns
    : DEFAULT_PROVIDER_NAME_PATTERNS;
  return patterns
    .map(pattern => {
      try { return new RegExp(pattern, 'i'); } catch { return null; }
    })
    .filter(Boolean);
}

const DEFAULT_PROVIDER_CREDENTIAL_PATTERNS = [
  { pattern: 'MD', token: 'MD' },
  { pattern: 'DO', token: 'DO' },
  { pattern: 'NP', token: 'NP' },
  { pattern: 'FNP', token: 'FNP' },
  { pattern: 'PA-?C', token: 'PA-C' },
  { pattern: 'APRN', token: 'APRN' },
  { pattern: 'ANP', token: 'ANP' },
  { pattern: 'DC', token: 'DC' },
  { pattern: 'RN', token: 'RN' },
  { pattern: 'PhD', token: 'PhD' }
];

function buildProviderCredentialRegexes(overrides) {
  const entries = Array.isArray(overrides.providerCredentialPatterns)
    ? overrides.providerCredentialPatterns
    : DEFAULT_PROVIDER_CREDENTIAL_PATTERNS;
  return entries
    .map(entry => {
      const obj = typeof entry === 'string' ? { pattern: entry, token: entry } : entry || {};
      if (!obj.pattern) return null;
      try {
        return {
          regex: new RegExp(`\\b(${obj.pattern})\\b`, 'i'),
          token: (obj.token || obj.pattern || '').toUpperCase().replace(/\s+/g, '')
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ==================== INTELLIGENT MEMBER ID DETECTION ====================

/**
 * Detects section type based on Y position and nearby text
 */
function detectSection(pages, pageIndex, yPosition) {
  if (!pages || !pages[pageIndex]) return 'unknown';
  
  const page = pages[pageIndex];
  const pageHeight = 3300; // Typical OCR page height
  const relativeY = yPosition / pageHeight;

  // Header/footer detection based on position
  if (relativeY < 0.1) return 'header';
  if (relativeY > 0.9) return 'footer';

  // Check nearby text for section indicators
  const nearbyText = (page.text || '').toLowerCase();
  
  if (/insurance|coverage|payer|policy|plan|carrier/i.test(nearbyText)) {
    return 'insurance_section';
  }
  if (/patient|demographics|personal\s+info/i.test(nearbyText)) {
    return 'patient_demographics';
  }
  if (/page\s+\d+|^\d+\s+of\s+\d+|pags\s+\d+/i.test(nearbyText)) {
    return 'page_identifier';
  }

  return 'body';
}

/**
 * Scores how well a member ID matches the detected carrier's typical format
 */
function scoreCarrierMatch(memberId, carrierName) {
  if (!carrierName || !memberId) return 0;

  const carrier = carrierName.toLowerCase();
  const id = String(memberId).toUpperCase();

  // Medicare patterns - new MBI format or legacy
  if (carrier.includes('medicare')) {
    // New MBI: 1 letter, 1 digit, 1 letter, 1 digit, 1 letter, 4 digits
    if (/^[A-Z]\d[A-Z]\d[A-Z]\d{4}$/i.test(id)) return 20;
    // Variations: 2-3 letters, 2-4 digits, 2-4 alphanumeric
    if (/^[A-Z]{2,3}\d{2,4}[A-Z0-9]{2,4}$/i.test(id)) return 15;
    // All numeric (legacy) - less common now
    if (/^\d{10,11}$/.test(id)) return 5;
    // Medicare unlikely to be very long alphanumeric
    if (id.length > 15) return -10;
  }

  // Medicaid patterns - vary by state
  if (carrier.includes('medicaid')) {
    // Common: 8-12 digits
    if (/^\d{8,12}$/.test(id)) return 15;
    // State prefix + digits
    if (/^[A-Z]{2}\d{6,10}$/i.test(id)) return 15;
    // Alphanumeric
    if (/^[A-Z0-9]{8,12}$/i.test(id)) return 10;
  }

  // Blue Cross Blue Shield patterns
  if (carrier.includes('blue cross') || carrier.includes('bcbs') || carrier.includes('anthem')) {
    // Common: 3 letters + 9 digits
    if (/^[A-Z]{3}\d{9}$/i.test(id)) return 18;
    // 2 letters + 10 digits
    if (/^[A-Z]{2}\d{10}$/i.test(id)) return 15;
    // Pure alphanumeric 11 chars
    if (/^[A-Z0-9]{11}$/i.test(id)) return 12;
  }

  // UnitedHealthcare patterns
  if (carrier.includes('united') || carrier.includes('uhc')) {
    // Common: 9 digits
    if (/^\d{9}$/.test(id)) return 18;
    // Or starts with letter
    if (/^[A-Z]\d{8}$/i.test(id)) return 15;
  }

  // Aetna patterns
  if (carrier.includes('aetna')) {
    // Letter + 8 digits
    if (/^[A-Z]\d{8}$/i.test(id)) return 18;
    // Or W + 9 digits
    if (/^W\d{9}$/i.test(id)) return 20;
  }

  // Cigna patterns
  if (carrier.includes('cigna')) {
    // Typically alphanumeric
    if (/^[A-Z0-9]{8,11}$/i.test(id)) return 15;
  }

  // Humana patterns
  if (carrier.includes('humana')) {
    // Often starts with H
    if (/^H\d{8,9}$/i.test(id)) return 18;
    // Or pure numeric
    if (/^\d{9,11}$/.test(id)) return 12;
  }

  return 0;
}

/**
 * Scores the quality of the label used to identify the member ID
 */
function scoreLabelQuality(labelText) {
  if (!labelText) return 0;
  
  const label = labelText.toLowerCase().trim();
  
  // Perfect matches
  if (label === 'insurance id' || label === 'member id') return 25;
  if (label === 'policy number' || label === 'member number') return 23;
  if (label === 'id number' || label === 'subscriber id') return 20;
  if (label === 'insurance number') return 20;
  
  // Good partial matches
  if (label.includes('insurance') && label.includes('id')) return 18;
  if (label.includes('member') && label.includes('id')) return 18;
  if (label.includes('policy') && label.includes('number')) return 15;
  if (label.includes('subscriber')) return 15;
  
  // Decent matches
  if (label.includes('member')) return 12;
  if (label.includes('policy')) return 10;
  if (label.includes('insurance')) return 8;
  
  // Generic
  if (label === 'id' || label === 'number') return 5;
  
  return 0;
}

/**
 * Checks if a value is likely NOT a member ID (filters out dates, phones, etc)
 */
function isLikelyNotMemberId(value) {
  if (!value) return true;
  
  const str = String(value);
  
  // Too short or too long
  if (str.length < 6 || str.length > 20) return true;
  
  // Looks like a date
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return true;
  if (/^\d{8}$/.test(str) && /^(19|20)\d{6}$/.test(str)) return true; // YYYYMMDD
  
  // Looks like a phone number
  if (/^\d{10}$/.test(str)) return true; // Could be phone
  if (/^\(\d{3}\)\s*\d{3}-?\d{4}$/.test(str)) return true;
  
  // Looks like a ZIP code
  if (/^\d{5}(-\d{4})?$/.test(str)) return true;
  
  // Looks like an SSN
  if (/^\d{3}-\d{2}-\d{4}$/.test(str)) return true;
  if (/^\d{9}$/.test(str)) return true; // Could be SSN without dashes
  
  // Looks like a fax/document header ID
  if (/^17027102839$/.test(str)) return true; // Known header ID pattern
  
  return false;
}

/**
 * Calculates proximity score based on how close an ID is to insurance keywords
 */
function calculateProximityScore(fullText, candidateIndex, keywords = ['insurance', 'member', 'policy', 'carrier', 'payer']) {
  if (candidateIndex === undefined || candidateIndex === null) return 0;
  
  let bestScore = 0;
  const lowerText = fullText.toLowerCase();
  
  for (const keyword of keywords) {
    let idx = lowerText.indexOf(keyword);
    while (idx !== -1) {
      const distance = Math.abs(candidateIndex - idx);
      // Score decreases with distance: 20 points for 0-50 chars, 15 for 50-150, 10 for 150-300, 5 for 300-500
      let score = 0;
      if (distance < 50) score = 20;
      else if (distance < 150) score = 15;
      else if (distance < 300) score = 10;
      else if (distance < 500) score = 5;
      
      if (score > bestScore) bestScore = score;
      
      idx = lowerText.indexOf(keyword, idx + 1);
    }
  }
  
  return bestScore;
}

/**
 * Main scoring function for member ID candidates
 * Uses RuleEngine for carrier-specific pattern matching + fallback logic
 */
function scoreIntelligentMemberIdCandidate(candidate, carrierName, pages) {
  let score = 0;
  const reasons = [];

  // 1. Source type scoring (most important factor)
  const sourceScores = {
    'insurance_member_labeled_id': 50,           // Labeled as "INSURANCE ID"
    'insurance_member_labeled_primary': 45,      // Labeled as "MEMBER ID"
    'insurance_id_carrier_pattern': 40,          // Matches carrier-specific pattern
    'insurance_id_primary_window': 35,           // Found in insurance section window
    'insurance_member_labeled_fallback': 30,     // Labeled as "SUBSCRIBER ID" etc
    'insurance_id_proximity_fallback': 15        // Generic pattern near insurance keywords
  };
  
  const sourceScore = candidate.sources?.[0]?.rule ? (sourceScores[candidate.sources[0].rule] || 10) : 10;
  score += sourceScore;
  reasons.push(`source:${candidate.sources?.[0]?.rule || 'unknown'}(+${sourceScore})`);

  // 2. Section type scoring
  const sectionType = candidate.sectionType || 'unknown';
  const sectionScores = {
    'insurance_section': 25,
    'body': 10,
    'patient_demographics': 5,
    'header': -15,
    'footer': -20,
    'page_identifier': -30
  };
  const sectionScore = sectionScores[sectionType] || 0;
  if (sectionScore !== 0) {
    score += sectionScore;
    reasons.push(`section:${sectionType}(${sectionScore >= 0 ? '+' : ''}${sectionScore})`);
  }

  // 3. **NEW: Use RuleEngine for carrier-specific scoring**
  if (carrierName) {
    const ruleScore = ruleEngine.scoreCandidate(
      {
        value: candidate.value,
        label: candidate.sources?.[0]?.meta?.label,
        sectionType: sectionType
      },
      carrierName
    );
    
    if (ruleScore.score > 0) {
      score += ruleScore.score;
      reasons.push(...ruleScore.reasons);
      
      if (ruleScore.matchedPattern) {
        reasons.push(`matched_pattern:${ruleScore.matchedPattern}`);
      }
    }
  } else {
    // Fallback: use hardcoded carrier matching if no carrier detected yet
    const carrierScore = scoreCarrierMatch(candidate.value, carrierName);
    if (carrierScore !== 0) {
      score += carrierScore;
      reasons.push(`carrier_match_fallback(${carrierScore >= 0 ? '+' : ''}${carrierScore})`);
    }
  }

  // 4. Proximity scoring
  if (candidate.sources?.[0]?.meta?.proximityScore !== undefined) {
    const proxScore = Math.min(candidate.sources[0].meta.proximityScore / 50, 15); // Max 15 points
    score += proxScore;
    reasons.push(`proximity(+${proxScore.toFixed(1)})`);
  }

  // 5. Format validation penalty
  if (isLikelyNotMemberId(candidate.value)) {
    score -= 40;
    reasons.push(`invalid_format(-40)`);
  }

  // 6. Alphanumeric bonus (most insurance IDs have letters and numbers)
  if (/[A-Z]/.test(candidate.value) && /\d/.test(candidate.value)) {
    score += 8;
    reasons.push(`alphanumeric(+8)`);
  }

  // 7. Length preference (8-12 is most common)
  const len = String(candidate.value).length;
  if (len >= 8 && len <= 12) {
    score += 5;
    reasons.push(`optimal_length(+5)`);
  } else if (len >= 13 && len <= 15) {
    score += 2;
    reasons.push(`acceptable_length(+2)`);
  }

  // 8. Duplicate occurrence penalty (if value appears many times, likely not unique ID)
  if (candidate.count && candidate.count > 3) {
    const penalty = (candidate.count - 3) * 3;
    score -= penalty;
    reasons.push(`duplicate_penalty(-${penalty})`);
  }

  return { score, reasons };
}

const DEV = process.env.NODE_ENV !== 'production';

export async function runExtraction(ocrPages) {
  const { fullText: rawFullText, lines: rawLines, tableCells } = normalizePages(ocrPages);
  
  // Apply OCR corrections before extraction (Step 2)
  const fullText = applyOcrCorrections(rawFullText, correctionsDB);
  const lines = rawLines;
  
  // Helper: extract from table cells (label in one column, value in adjacent column)
  function fromTables(labelRe) {
    if (!Array.isArray(tableCells)) return null;
    for (const cell of tableCells) {
      if (labelRe.test(cell.text || '')) {
        // Look for value in next column (same row)
        const right = tableCells.find(c => c.r === cell.r && c.c === cell.c + 1);
        if (right?.text) return right.text.trim();
      }
    }
    return null;
  }
  
  const patternOverrides = getPatternOverrides();
  const BUSINESS_EMAIL_BLOCK = buildBusinessEmailBlock(patternOverrides);
  const PROVIDER_NAME_REGEXES = buildProviderNameRegexes(patternOverrides);
  const PROVIDER_CREDENTIAL_REGEXES = buildProviderCredentialRegexes(patternOverrides);
  const SYMPTOM_CONFIG = PATTERNS.SYMPTOM_CONFIG;
  const {
    SYMPTOM_FAMILY_CONTEXT_RE,
    SYMPTOM_THIRD_PARTY_RE,
    SYMPTOM_PATIENT_TOKEN_RE,
    SYMPTOM_CONDITIONAL_RE,
    SYMPTOM_EDUCATIONAL_RE,
    SYMPTOM_HISTORY_RE,
    SYMPTOM_HISTORY_OVERRIDE_RE,
    SYMPTOM_RESOLUTION_RE,
    SYMPTOM_MEDICATION_PATTERNS,
    SYMPTOM_TEST_RESULT_RE
  } = PATTERNS;
  const trace = [];
  function logRerankToTrace(field, payload) {
    if (!DEV) return;
    try {
      const explain = payload && payload.rerankExplain ? payload.rerankExplain : null;
      if (explain) {
        trace.push({ rule: 'rerank_explain', field, explain });
      }
    } catch {}
  }
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

  const infoAlerts = {
    ppeRequired: null,
    safety: [],
    communication: [],
    accommodations: [],
    history: [],
    resolution: [],
    medications: [],
    testResults: []
  };

  const pushUnique = (arr, value) => {
    if (!value) return;
    if (!arr.includes(value)) arr.push(value);
  };

  // Patient
  const disablePatientNameOcr = process.env.DISABLE_PATIENT_NAME_OCR === '1';
  const name = disablePatientNameOcr ? { hit: false } : detectName(fullText, lines);
  if (name.hit) {
    result.patient = { ...result.patient, ...name.value };
    trace.push({ rule: name.why, value: `${result.patient.last}, ${result.patient.first}` });
  } else if (disablePatientNameOcr) {
    trace.push({ rule: 'patient_name_detection_skipped' });
  }
  logRerankToTrace('patient_name', name);
  const dob = detectDob(fullText, lines); if (dob.hit) { result.patient = { ...result.patient, dob: dob.value }; trace.push({ rule: dob.why, value: dob.value }); }
  logRerankToTrace('dob', dob);
  const phones = detectPhones(fullText, lines);
  if (phones.hit) {
    // Filter phones through NANP validation
    const validPhones = phones.value.filter(p => {
      const digits = p.formatted.replace(/\D/g, '');
      if (!isValidNANP(digits)) {
        trace.push({ rule: 'phone_suspect', value: p.formatted, reason: 'invalid_nanp', context: 'patient' });
        return false;
      }
      return true;
    });
    result.patient.phones = validPhones.map(p => p.formatted);
    trace.push({ rule: phones.why, count: validPhones.length, rejected: phones.value.length - validPhones.length });
  } else if (phones && phones.why) {
    trace.push({ rule: phones.why });
  }
  if (Array.isArray(phones?.trace) && phones.trace.length) {
    for (const ev of phones.trace) trace.push(ev);
  }
  logRerankToTrace('patient_phone', phones);
  // Email (contextual & filtered)
  {
    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const matches = [...new Set(((fullText || '').match(emailRe) || []))];
    if (matches.length) {
      // Normalize punctuation: strip trailing commas/periods/semicolons
      const cleaned = matches.map(e => e.replace(/[.,;:]+$/,'')).filter(Boolean);
      let chosen = null;
      const contactByEmailPattern = /contact\s*by\s*email/i;
      const hasContactByEmail = contactByEmailPattern.test(fullText || '');
      for (const emRaw of cleaned) {
        const em = emRaw.trim();
        const lower = em.toLowerCase();
        if (BUSINESS_EMAIL_BLOCK.has(lower)) continue;
        if (hasContactByEmail) {
          const escaped = escapeRegex(em);
          const inline = new RegExp(`contact\s*by\s*email[^\n]{0,80}${escaped}`, 'i');
          const nextLine = new RegExp(`contact\s*by\s*email[^\n]*\n[^\n]{0,80}${escaped}`, 'i');
          if (inline.test(fullText || '') || nextLine.test(fullText || '')) {
            chosen = em;
            break;
          }
        }
        if (/patient\s*email/i.test(fullText) && /patient/i.test(lower)) { chosen = em; break; }
        if (!chosen && /(gmail|yahoo|outlook|icloud|proton|hotmail)/i.test(lower)) chosen = em;
        if (!chosen) chosen = em; // fallback first non-blocked
      }
      if (chosen) {
        // De-dupe if appears multiple times with punctuation variants
        result.patient.email = chosen.toLowerCase();
        trace.push({ rule: 'patient_email_detect', value: chosen });
      }
    }
  }
  

  // Emergency contact (explicit line scan)
  {
    const relationshipTokens = /(mother|father|parent|spouse|wife|husband|partner|daughter|son|sister|brother|caregiver|guardian|aunt|uncle|friend|daughter|son)/i;
    const linesArr = (fullText || '').split(/\n/);
    const idx = linesArr.findIndex(l => /in\s*case\s*of\s*emergency|emergency\s*contact|contact\s*.*emergency/i.test(l));
    if (idx >= 0) {
      const windowLines = linesArr.slice(idx, idx + 3);
      const joined = windowLines.join(' | ');
      const nameMatch = joined.match(/([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+)/);
      const phoneMatch = joined.match(/(\(\d{3}\)\s*\d{3}-\d{4})/);
      const relMatch = joined.match(relationshipTokens);
      if (nameMatch) {
        result.patient.emergencyContact = {
          raw: nameMatch[1].slice(0,120),
          phone: phoneMatch ? phoneMatch[1] : null,
          relationship: relMatch ? relMatch[1].toLowerCase() : null
        };
        trace.push({ rule: 'patient_emergency_contact_detect', inferred: !!relMatch });
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
      '95805': 'MSLT / MWT daytime sleep testing',
      '99245': 'Office consultation (80 minutes)'
    };
    // Derive confidence hint for CPT selection
    let cptConfidence = 'high';
    if (Array.isArray(cpt.ambiguity) && cpt.ambiguity.length) {
      cptConfidence = cpt.ambiguity.length >= 2 ? 'low' : 'medium';
    }
    const ambiguityReasons = Array.isArray(cpt.ambiguity) ? cpt.ambiguity : [];
    const primaryDetail = Array.isArray(cpt.details) ? cpt.details.find(d => d.code === cpt.primary) : null;
    const derivedDescription = primaryDetail?.description || CPT_DESCRIPTIONS[cpt.primary];
    result.procedure = { 
      ...result.procedure,
      cpt: cpt.primary,
      cptPrimary: cpt.primary,
      cptCandidates: cpt.candidates,
      cptDetails: cpt.details,
      cptAmbiguity: ambiguityReasons,
      cptConfidence,
      description: derivedDescription || result.procedure?.description
    };
    trace.push({ rule: cpt.why, primary: cpt.primary, candidates: cpt.candidates, ambiguity: ambiguityReasons, confidence: cptConfidence, details: cpt.details });
    if (Array.isArray(cpt.ambiguity) && cpt.ambiguity.length) {
      result.flags.verifyManually = true;
      result.flags.reasons.push(...cpt.ambiguity);
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_cpt_multiple']));
      trace.push({ rule: 'cpt_ambiguity', reasons: cpt.ambiguity });
    }
    // 95811 prior-study evidence flag - require prior study evidence OR sleep diagnosis
    if (cpt.primary === '95811') {
      const priorStudyRe = /prior\s+(sleep\s+)?study|previous\s+(sleep\s+)?study|past\s+(sleep\s+)?study|earlier\s+(sleep\s+)?study|baseline\s+study|diagnostic\s+study\s+(completed|done|performed|shows|revealed)|hsat.*completed|home\s+sleep\s+test.*completed|psg.*failure|hsat.*failure|failed\s+(psg|hsat)/i;
      const sleepDxSet = new Set(['G47.33', 'G47.30', 'G47.31', 'G47.37', 'G47.10', 'G47.00']);
      const hasPriorStudy = priorStudyRe.test(fullText || '');
      const hasSleepDx = Array.isArray(result.diagnoses) && result.diagnoses.some(dx => sleepDxSet.has(String(dx)));
      
      if (!hasPriorStudy && !hasSleepDx) {
        result.flags.verifyManually = true;
        result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'document_prior_study_evidence', 'review_indication']));
        trace.push({ rule: '95811_prior_study_evidence_missing', reason: 'no_prior_study_or_sleep_dx' });
      } else {
        trace.push({ rule: '95811_prior_study_evidence_found', hasPriorStudy, hasSleepDx });
      }
      
      // NEW SAFETY FLAG: Titration requires clinical review
      // If CPT 95811 AND prior study evidence found BUT no CPAP failure/intolerance documentation
      const allCpts = Array.isArray(cpt.candidates) ? cpt.candidates.map(c => c.code) : [];
      const priorStudy = hasPriorStudyEvidence(fullText || '', allCpts);
      const hasCpapContext = hasCpapTitrationContext(fullText || '');
      
      if (priorStudy.found && !hasCpapContext) {
        result.flags.verifyManually = true;
        result.flags.reasons.push('titration_requires_clinical_review');
        result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_titration_justification']));
        trace.push({
          rule: 'titration_requires_clinical_review',
          priorStudyCpts: priorStudy.cpts,
          priorStudyKeywords: priorStudy.keywords,
          missingJustification: 'no_cpap_failure_or_intolerance_documented'
        });
      }
    }
  }

  // ICD
  const icd = detectICDs(fullText, lines);
  if (icd.hit) {
    let values = Array.isArray(icd.values) ? [...icd.values] : [];
    // If CPT indicates a sleep study, prioritize sleep-related diagnoses with clinical hierarchy
    const cptCode = result.procedure?.cpt;
    const sleepStudyCPT = new Set(['95811', '95810', '95806', 'G0399', '95782', '95783', '95805']);
    if (cptCode && sleepStudyCPT.has(String(cptCode))) {
      // Clinical priority tiers (lower number = higher priority)
      const getWeight = (code) => {
        const c = String(code);
        if (c === 'G47.30') return 0;  // Sleep Apnea, Unspecified (safest/broadest)
        if (c === 'G47.33') return 1;  // Obstructive Sleep Apnea (most common)
        if (c === 'G47.31') return 2;  // Primary Central Sleep Apnea
        if (c === 'G47.37') return 3;  // Central SA in Other Conditions (never primary alone)
        // Other sleep-related codes
        if (['G47.10', 'G47.00', 'R06.83', 'R06.09', 'R53.83', 'G25.81', 'F51.9'].includes(c)) return 4;
        return 10;  // Non-sleep codes (HTN, diabetes, etc.)
      };
      
      const weighted = values.map((code, idx) => ({ code, idx, w: getWeight(code) }));
      weighted.sort((a, b) => (a.w - b.w) || (a.idx - b.idx));
      values = weighted.map(x => x.code);
      
      // Special case: G47.37 should never be primary if G47.33 is present
      if (values[0] === 'G47.37' && values.includes('G47.33')) {
        const idx37 = values.indexOf('G47.37');
        const idx33 = values.indexOf('G47.33');
        values[idx37] = 'G47.33';
        values[idx33] = 'G47.37';
        trace.push({ rule: 'icd_g4737_demoted_secondary', primary: 'G47.33', secondary: 'G47.37' });
      }
      
      trace.push({ rule: 'icd_prioritize_for_cpt', top: values[0] || null, cpt: cptCode });
    }
    result.diagnoses = values;
    // Build primaryDiagnosis with description if available
    const primaryCode = values[0];
    if (!result.clinical) result.clinical = {};
    if (primaryCode && Array.isArray(icd.details)) {
      const det = icd.details.find(d => d.code === primaryCode);
      if (det) {
        const { code, description, chronic = null, severity = null, note = null } = det;
        result.clinical.primaryDiagnosis = { code, description, chronic, severity, note };
      }
      // Re-order diagnosesDetailed to match the ranked values array
      const detailsMap = new Map(icd.details.map(d => [d.code, d]));
      result.clinical.diagnosesDetailed = values.map(code => detailsMap.get(code)).filter(Boolean);
    }
    if (Array.isArray(icd.actions) && icd.actions.length) {
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), ...icd.actions]));
    }
    trace.push({ rule: icd.why, count: values.length });
  }

  // Carrier
  const car = detectCarrier(fullText, lines);
  // Always trace carrier detection result
  if (!car.hit) {
    trace.push({ rule: car.why || 'carrier_detection_failed', linesProvided: Array.isArray(lines) ? lines.length : 'not_array', fullTextLength: (fullText || '').length });
  }
  if (car.hit) {
    const insObj = { carrier: car.value.carrier, status: car.value.status };
    // Member / Group IDs (prefer explicit member labels and IDs containing digits)
    const rawText = fullText || '';
    const carrierIdMap = getCarrierIdPatterns();
    const carrierKey = String(car.value.carrier || '').toLowerCase();
    // Resolve best-matching carrier key, allowing synonyms like "Anthem BCBS" -> "anthem" or "blue cross blue shield" -> "blue cross"
    const resolveCarrierKey = (key, map) => {
      if (map[key]) return key;
      const keys = Object.keys(map || {});
      let best = null;
      for (const k of keys) {
        const kk = String(k || '').toLowerCase();
        if (!kk) continue;
        if (key.includes(kk) || kk.includes(key)) { best = k; break; }
        if (/anthem/.test(key) && /anthem/.test(kk)) { best = k; break; }
        if ((/bcbs/.test(key) || /blue\s*cross/.test(key)) && (/blue\s*cross/.test(kk) || /bcbs/.test(kk))) { best = k; break; }
      }
      return best;
    };
    const carrierMapKey = resolveCarrierKey(carrierKey, carrierIdMap);
    const carrierPatterns = Array.isArray(carrierIdMap[carrierMapKey]?.memberId) ? carrierIdMap[carrierMapKey].memberId : [];
    const carrierRegexes = carrierPatterns.map(p => {
      try { return new RegExp(p, 'im'); } catch { return null; }
    }).filter(Boolean);
    const structuredLineTexts = Array.isArray(lines)
      ? lines.map(entry => {
          if (entry == null) return '';
          if (typeof entry === 'string') return String(entry || '');
          return String(entry?.text || '');
        })
      : [];
    const linesLower = structuredLineTexts.map(l => l.toLowerCase());

    const memberIdCandidates = new Map();
    const memberIdTraceEvents = [];
    const registerMemberCandidate = (rawValue, weight, ruleName, meta = {}) => {
      const value = String(rawValue || '').trim();
      if (!value) return null;
      const normalized = value.replace(/[^A-Za-z0-9]/g, '');
      const upper = normalized.toUpperCase();
      // Tighten eligibility: require at least 8 chars AND at least one digit
      if (upper.length < 8 || !/\d/.test(upper)) return null;
      const entry = memberIdCandidates.get(upper) || { value: upper, score: 0, count: 0, sources: [] };
      entry.score += weight;
      entry.count += 1;
      entry.sources.push({ rule: ruleName, weight, ...meta });
      memberIdCandidates.set(upper, entry);
      memberIdTraceEvents.push({ rule: ruleName, value: upper, weight, ...meta });
      return upper;
    };

    let primaryBlockUpper = null;
    try {
      let anchorIdx = linesLower.findIndex(l => /primary\s+insurance|insurance\s*\(ppo\)|insurance\b/.test(l));
      if (anchorIdx === -1) anchorIdx = linesLower.findIndex(l => /aetna\b|anthem\b|cigna\b|humana\b|united\b|medicare\b|medicaid\b/.test(l));
      if (anchorIdx !== -1) {
        const windowStart = Math.max(0, anchorIdx);
        const windowEnd = Math.min(structuredLineTexts.length, anchorIdx + 8);
        const windowText = structuredLineTexts.slice(windowStart, windowEnd).join('\n');
        if (carrierRegexes.length) {
          for (const rx of carrierRegexes) {
            const m = windowText.match(rx);
            if (m) {
              // Boost carrier-pattern hits by +1.5 to prefer them over generic patterns
              const registered = registerMemberCandidate(m[1] || m[0], 7.5, 'insurance_id_carrier_pattern', { scope: 'primary_block', pattern: String(rx) });
              if (registered && !primaryBlockUpper) primaryBlockUpper = registered;
              break;
            }
          }
        }
        const mAlnum = windowText.match(/\b([A-Z]\d{8,10})\b/i);
        const mLbl = windowText.match(/\b(?:ins(?:urance)?|id)\s*(?:no\.?|#|id|number)?\s*[:#-]?\s*([A-Z0-9]{6,})\b/i);
        const pick = (mAlnum && mAlnum[1]) || (mLbl && mLbl[1]) || null;
        if (pick) {
          const registered = registerMemberCandidate(pick, 5, 'insurance_id_primary_window', {});
          if (registered && !primaryBlockUpper) primaryBlockUpper = registered;
        }
      }
    } catch {}

    const MEMBER_PRIMARY_RE = /\b(member\s*(?:id|#|number)?)\s*[:#-]?\s*([A-Z0-9]{3,})\b/ig;
    const MEMBER_FALLBACK_RE = /\b((?:subscriber|insured|policy(?!\s*holder))\s*(?:id|#|number))\s*[:#-]?\s*([A-Z0-9]{3,})\b/ig;
    const INSURANCE_ID_LABEL_RE = /\b(ins(?:urance)?\s*(?:no\.?|#|id|number)?)\s*[:#-]?\s*([A-Z0-9]{3,})\b/ig;
    const GROUP_RE = /\bgroup\s*(?:id|#|number)?\s*[:#-]?\s*([A-Z0-9]{2,})\b/ig;
    const pickBestId = matches => {
      for (const match of matches) {
        if (match && /\d/.test(match[1])) return match[1];
      }
      return null;
    };

    for (const match of rawText.matchAll(MEMBER_PRIMARY_RE)) {
      registerMemberCandidate(match[2], 4.5, 'insurance_member_labeled_primary', { index: match.index, label: match[1] });
    }
    for (const match of rawText.matchAll(MEMBER_FALLBACK_RE)) {
      registerMemberCandidate(match[2], 3.5, 'insurance_member_labeled_fallback', { index: match.index, label: match[1] });
    }

    let labeledPickUpper = null;
    const labeledIdCandidates = [...rawText.matchAll(INSURANCE_ID_LABEL_RE)];
    if (labeledIdCandidates.length) {
      for (const match of labeledIdCandidates) {
        const registered = registerMemberCandidate(match[2], 8, 'insurance_member_labeled_id', { index: match.index, label: match[1] });
        if (!labeledPickUpper && registered) labeledPickUpper = registered;
      }
    }

    {
      const INSURANCE_ID_PATTERN = /\b([A-Z]\d{8,10})\b/g;
      const genericIdCandidates = [...rawText.matchAll(INSURANCE_ID_PATTERN)];
      if (genericIdCandidates.length) {
        const insuranceKeywords = [
          'insurance', 'insured', 'carrier', 'lnsurance', 'insurence',
          'aetna', 'aetha', 'aethna',
          'anthem', 'blue cross', 'cigna', 'humana', 'united', 'medicare', 'medicaid',
          'primary', 'hcd primary', 'hed primary'
        ];
        const lowerText = rawText.toLowerCase();
        const keywordPositions = [];
        for (const kw of insuranceKeywords) {
          let idx = lowerText.indexOf(kw);
          while (idx !== -1) {
            keywordPositions.push(idx);
            idx = lowerText.indexOf(kw, idx + 1);
          }
        }
        for (const match of genericIdCandidates) {
          const idIdx = match.index ?? 0;
          let minDistance = Infinity;
          for (const kwPos of keywordPositions) {
            const distance = Math.abs(idIdx - kwPos);
            if (distance < minDistance) minDistance = distance;
          }
          const clamped = Math.min(minDistance, 800);
          const weight = minDistance === Infinity ? 1 : Math.max(1, 6 - Math.floor(clamped / 120));
          registerMemberCandidate(match[1], weight, 'insurance_id_proximity_fallback', { proximityScore: minDistance });
        }
      }
    }

    if (carrierRegexes.length) {
      for (const rx of carrierRegexes) {
        const m = rawText.match(rx);
        if (m) {
          // Boost carrier-pattern hits by +1.5 to prefer them over generic patterns
          registerMemberCandidate(m[1] || m[0], 6, 'insurance_id_carrier_pattern', { scope: 'global', pattern: String(rx) });
          break;
        }
      }
    }

    memberIdTraceEvents.forEach(ev => trace.push(ev));

    const areSimilarMemberIds = (a, b) => {
      if (!a || !b) return false;
      if (a === b) return true;
      const lenDiff = Math.abs(a.length - b.length);
      if (lenDiff > 1) return false;
      const longer = a.length >= b.length ? a : b;
      const shorter = longer === a ? b : a;
      if (longer.length === shorter.length) {
        let diff = 0;
        for (let i = 0; i < longer.length; i++) {
          if (longer[i] !== shorter[i]) diff++;
          if (diff > 2) return false;
        }
        return diff <= 2;
      }
      // length difference === 1 -> try to insert gap in shorter to best-align with longer
      let minDiff = Infinity;
      const arr = shorter.split('');
      for (let gap = 0; gap <= arr.length; gap++) {
        const test = [...arr];
        test.splice(gap, 0, '-');
        let diff = 0;
        for (let i = 0; i < longer.length; i++) {
          if (test[i] === '-') continue;
          if (longer[i] !== test[i]) diff++;
          if (diff > 2) break;
        }
        if (diff < minDiff) minDiff = diff;
      }
      return minDiff <= 2;
    };

    const mergeMemberIdCandidates = (candidateMap) => {
      const entries = Array.from(candidateMap.values());
      if (entries.length <= 1) return { merged: entries, mergeEvents: [] };
      entries.sort((a, b) => b.score - a.score);
      const seen = new Set();
      const mergedEntries = [];
      const mergeEvents = [];

      for (let i = 0; i < entries.length; i++) {
        const anchor = entries[i];
        if (seen.has(anchor.value)) continue;
        const group = [anchor];
        seen.add(anchor.value);
        for (let j = i + 1; j < entries.length; j++) {
          const candidate = entries[j];
          if (seen.has(candidate.value)) continue;
          if (!areSimilarMemberIds(anchor.value, candidate.value)) continue;
          group.push(candidate);
          seen.add(candidate.value);
        }

        if (group.length === 1) {
          mergedEntries.push(anchor);
          continue;
        }

        const anchorCandidate = group.reduce((best, entry) => {
          if (!best) return entry;
          if (entry.value.length > best.value.length) return entry;
          if (entry.value.length === best.value.length && entry.score > best.score) return entry;
          return best;
        }, null);

        const anchorValue = anchorCandidate?.value || anchor.value;
        const targetLength = anchorValue.length;
        const voteBuckets = Array.from({ length: targetLength }, () => new Map());
        const mergedValues = [];

        const alignToAnchor = (value) => {
          if (value.length === targetLength) return value;
          if (value.length === targetLength - 1) {
            const chars = value.split('');
            let bestAligned = null;
            let bestDiff = Infinity;
            for (let gap = 0; gap <= chars.length; gap++) {
              const copy = [...chars];
              copy.splice(gap, 0, '-');
              let diff = 0;
              for (let idx = 0; idx < targetLength; idx++) {
                if (copy[idx] === '-') continue;
                if (anchorValue[idx] !== copy[idx]) diff++;
                if (diff > 3) break;
              }
              if (diff < bestDiff) {
                bestDiff = diff;
                bestAligned = copy.join('');
              }
            }
            return bestAligned;
          }
          return null;
        };

        for (const entry of group) {
          mergedValues.push(entry.value);
          const weight = entry.score;
          let aligned = entry.value;
          if (entry.value.length !== targetLength) {
            aligned = alignToAnchor(entry.value) || entry.value;
          }
          for (let idx = 0; idx < Math.min(aligned.length, targetLength); idx++) {
            const ch = aligned[idx];
            if (!ch || ch === '-') continue;
            const map = voteBuckets[idx];
            map.set(ch, (map.get(ch) || 0) + weight);
          }
        }

        const optionSets = voteBuckets.map((votes, idx) => {
          const set = new Set();
          const fallback = anchorValue[idx];
          if (fallback) set.add(fallback);
          for (const key of votes.keys()) set.add(key);
          return set;
        });

        const levenshteinDistance = (s1, s2) => {
          const a = s1 || '';
          const b = s2 || '';
          const dp = Array.from({ length: b.length + 1 }, () => new Array(a.length + 1).fill(0));
          for (let i = 0; i <= a.length; i++) dp[0][i] = i;
          for (let j = 0; j <= b.length; j++) dp[j][0] = j;
          for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
              const cost = a[i - 1] === b[j - 1] ? 0 : 1;
              dp[j][i] = Math.min(
                dp[j][i - 1] + 1,
                dp[j - 1][i] + 1,
                dp[j - 1][i - 1] + cost
              );
            }
          }
          return dp[b.length][a.length];
        };

        const variableIndices = optionSets
          .map((set, idx) => (set.size > 1 ? idx : -1))
          .filter(idx => idx >= 0);
        const workingChars = anchorValue.split('');

        let bestConsensus = anchorValue.replace(/[^A-Z0-9]/g, '');
        let bestMetrics = { maxDistance: Infinity, weightedSum: Infinity };

        const evaluateCandidate = () => {
          const raw = workingChars.join('');
          const cleaned = raw.replace(/[^A-Z0-9]/g, '');
          if (!cleaned) return;
          let maxDistance = 0;
          let weightedSum = 0;
          for (const entry of group) {
            const dist = levenshteinDistance(cleaned, entry.value);
            if (dist > maxDistance) maxDistance = dist;
            weightedSum += dist * (entry.score + 1);
          }
          if (
            maxDistance < bestMetrics.maxDistance ||
            (maxDistance === bestMetrics.maxDistance && weightedSum < bestMetrics.weightedSum) ||
            (maxDistance === bestMetrics.maxDistance && weightedSum === bestMetrics.weightedSum && cleaned.localeCompare(bestConsensus) < 0)
          ) {
            bestMetrics = { maxDistance, weightedSum };
            bestConsensus = cleaned;
          }
        };

        const exploreVariants = (idx) => {
          if (idx >= variableIndices.length) {
            evaluateCandidate();
            return;
          }
          const position = variableIndices[idx];
          const original = workingChars[position];
          const options = Array.from(optionSets[position]);
          for (const option of options) {
            workingChars[position] = option;
            exploreVariants(idx + 1);
          }
          workingChars[position] = original;
        };

        evaluateCandidate();
        if (variableIndices.length) exploreVariants(0);

        const consensus = bestConsensus;
        const combinedScore = group.reduce((sum, entry) => sum + entry.score, 0);
        const combinedCount = group.reduce((sum, entry) => sum + entry.count, 0);
        const combinedSources = group.flatMap(entry => entry.sources);
        mergedEntries.push({ value: consensus, score: combinedScore, count: combinedCount, sources: combinedSources });
        mergeEvents.push({ rule: 'insurance_id_merge_consensus', merged: mergedValues, consensus, score: Number(combinedScore.toFixed(2)) });
      }

      return { merged: mergedEntries, mergeEvents };
    };

    const { merged: mergedCandidates, mergeEvents } = mergeMemberIdCandidates(memberIdCandidates);
    memberIdCandidates.clear();
    for (const entry of mergedCandidates) {
      memberIdCandidates.set(entry.value, entry);
    }
    mergeEvents.forEach(ev => trace.push(ev));

    // Use intelligent scoring system that considers context, carrier patterns, and section detection
    const rankedMemberCandidates = Array.from(memberIdCandidates.values()).map(candidate => {
      // Determine section type if we have page info
      const sectionType = 'unknown'; // Would need page coordinates to detect accurately
      const candidateWithSection = { ...candidate, sectionType };
      
      // Apply intelligent scoring
      const { score: intelligentScore, reasons } = scoreIntelligentMemberIdCandidate(
        candidateWithSection, 
        car?.value?.carrier || null,
        ocrPages
      );
      
      return { 
        ...candidate, 
        compositeScore: intelligentScore,
        scoreReasons: reasons
      };
    }).sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
      if (b.count !== a.count) return b.count - a.count;
      if (b.value.length !== a.value.length) return b.value.length - a.value.length;
      return a.value.localeCompare(b.value);
    });

    const bestMemberCandidate = rankedMemberCandidates[0];
    if (bestMemberCandidate) {
      insObj.memberId = bestMemberCandidate.value;
      trace.push({ 
        rule: 'insurance_id_intelligent_select', 
        value: bestMemberCandidate.value, 
        score: Number(bestMemberCandidate.compositeScore.toFixed(2)), 
        sources: bestMemberCandidate.sources.map(s => s.rule),
        scoreBreakdown: bestMemberCandidate.scoreReasons,
        allCandidates: rankedMemberCandidates.slice(0, 5).map(c => ({
          value: c.value,
          score: Number(c.compositeScore.toFixed(2)),
          source: c.sources?.[0]?.rule || 'unknown'
        }))
      });
      if (primaryBlockUpper && bestMemberCandidate.value === primaryBlockUpper) {
        trace.push({ rule: 'insurance_id_primary_block', value: bestMemberCandidate.value });
      }
    }
    const groupCandidates = [...rawText.matchAll(GROUP_RE)];
    const resolvedGroupId = pickBestId(groupCandidates);
    if (resolvedGroupId) insObj.groupId = resolvedGroupId;
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
    // Post-clean: avoid concatenated member/group (e.g., 'SNAMEGroup') due to OCR fusion
    if (insObj.memberId && /group/i.test(insObj.memberId)) {
      const split = insObj.memberId.split(/group/i);
      if (split[0] && split[0].length >= 3) {
        const possibleMember = split[0].replace(/[^A-Z0-9]/gi,'');
        insObj.memberId = possibleMember;
      }
    }
    // If fused pattern like ID: SNAMEGroup: NAME inside same line, attempt split
    if (!insObj.groupId) {
      const fuse = (fullText||'').match(/id:\s*([A-Z0-9]{3,})(group:|grp:?)([A-Z0-9]{2,})/i);
      if (fuse) {
        if (!insObj.memberId) insObj.memberId = fuse[1];
        insObj.groupId = fuse[3];
        trace.push({ rule: 'insurance_id_fused_split', member: insObj.memberId, group: insObj.groupId });
      }
    }
  }

  // Pre-authorization heuristic rules (carrier + CPT combos)
  try {
    const rules = getPreauthRules();
    if (rules.length && result.procedure?.cpt && result.insurance.length) {
      const primaryCarrier = (result.insurance[0].carrier || '').toLowerCase();
      for (const rRule of rules) {
        if ((rRule?.carrier || '').toLowerCase() === primaryCarrier && String(rRule?.cpt) === String(result.procedure.cpt)) {
          const act = rRule.action || 'preauth_check';
          if (!result.alerts.actions.includes(act)) result.alerts.actions.push(act);
          if (!result.flags.reasons.includes('preauth_required_possible')) {
            result.flags.verifyManually = true;
            result.flags.reasons.push('preauth_required_possible');
          }
          result.documentMeta = { ...(result.documentMeta || {}), preauthHints: [...(result.documentMeta?.preauthHints || []), rRule.note].slice(0, 8) };
          trace.push({ rule: 'preauth_rule_hit', carrier: rRule.carrier, cpt: rRule.cpt, action: act });
        }
      }
    }
  } catch (e) {
    trace.push({ rule: 'preauth_rule_error', error: e.message });
  }

  // Policy-driven action inference heuristics
  {
    const actsBefore = new Set(result.alerts.actions);
    const cptCode = String(result.procedure?.cpt || '');
    const txtLower = (fullText || '').toLowerCase();
    const dxSet = new Set((result.diagnoses || []).map(d => String(d)));
    // If in-lab titration (95811) mentioned but no explicit prior diagnostic evidence phrases
    if (cptCode === '95811' && !/95810|diagnostic\s+psg|prior\s+psg|baseline\s+study|hsat|home\s+sleep/i.test(fullText || '')) {
      result.alerts.actions.push('document_prior_study_evidence');
    }
    // Prior study evidence enhancement: if explicit mention of prior PSG or HSAT failure, mark supporting evidence
    if (/prior\s+(diagnostic\s+)?psg|baseline\s+study|failed\s+hsat|inconclusive\s+hsat/i.test(fullText || '')) {
      if (!result.alerts.actions.includes('prior_study_evidence_present')) {
        result.alerts.actions.push('prior_study_evidence_present');
      }
    }
    // If diagnostic 95810 ordered but text contains strong HSAT language suggesting HSAT first
    if (cptCode === '95810' && /uncomplicated|mild\s+osa|initial\s+evaluation/.test(txtLower) && !/failed\s+hsat|negative\s+hsat|hsat\s+inconclusive/.test(txtLower)) {
      result.alerts.actions.push('evaluate_hsat_prerequisite');
    }
    // PCP referral requirement: if carrier hints (e.g., HMO language) or "PCP referral" words present and no prior_study_evidence
    if (/pcp\s+referral|primary\s+care\s+referral|hmo\b/i.test(txtLower) && !result.alerts.actions.includes('obtain_pcp_referral')) {
      result.alerts.actions.push('obtain_pcp_referral');
    }
    // Pediatric codes require protocol review
    if (cptCode === '95782' || cptCode === '95783') {
      result.alerts.actions.push('pediatric_protocol_review');
    }
    // If complex comorbidity (cardiopulmonary) with home study codes (95806/G0399) -> escalate review
    if ((cptCode === '95806' || cptCode === 'G0399') && /(copd|congestive\s+heart|heart\s+failure|neuromuscular|opioid)/i.test(fullText || '')) {
      result.alerts.actions.push('consider_inlab_over_hsat');
    }
    // If no sleep-related dx but sleep study code present (already flagged wrong_test_ordered_possible) add explicit action
    const sleepStudySet = new Set(['95810','95811','95806','G0399']);
    if (sleepStudySet.has(cptCode)) {
      const hasSleepDx = ['G47.33','G47.30','G47.31','G47.37','R06.83','R06.09','R53.83','G25.81','F51.9'].some(d => dxSet.has(d));
      if (!hasSleepDx && !result.alerts.actions.includes('review_indication')) {
        result.alerts.actions.push('review_indication');
      }
    }
    // Normalize unique actions and remove contradictory/redundant pairs
    result.alerts.actions = Array.from(new Set(result.alerts.actions));
    
    // Filter out redundant actions when more specific ones exist
    const redundancyRules = [
      { specific: 'obtain_cpap_compliance_data', generic: ['insurance_verification_needed', 'auth_required'] },
      { specific: 'review_95811_required', generic: ['auth_required'] },
      { specific: 'pediatric_protocol_review', generic: ['provider_followup_needed'] }
    ];
    
    for (const rule of redundancyRules) {
      if (result.alerts.actions.includes(rule.specific)) {
        result.alerts.actions = result.alerts.actions.filter(a => !rule.generic.includes(a));
      }
    }
    
    // Normalize to snake_case
    result.alerts.actions = result.alerts.actions.map(a => 
      String(a).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    );
    result.alerts.actions = Array.from(new Set(result.alerts.actions));
    
    const added = result.alerts.actions.filter(a => !actsBefore.has(a));
    if (added.length) {
      result.flags.verifyManually = true;
      if (!result.flags.reasons.includes('policy_action_inference')) result.flags.reasons.push('policy_action_inference');
      trace.push({ rule: 'policy_action_infer', added });
    }
  }

  // Secondary insurance detection (precision-focused)
  if (result.insurance.length === 1) {
    const linesArr = (fullText || '').split(/\n/);
    const carrierLineIndices = [];
    for (let i=0;i<linesArr.length;i++) {
      const line = linesArr[i];
      if (/(other\s+insurance|secondary\s+insurance|\bsecondary\b.*insurance|payer\s*[:\-]|plan\s*[:\-]|^\s*insurance\s*[:\-])/i.test(line)) {
        carrierLineIndices.push(i);
      }
    }
    if (carrierLineIndices.length > 1) {
      const primaryCarrier = result.insurance[0].carrier;
      let best = null;
      for (let idx = 1; idx < carrierLineIndices.length; idx++) {
        const start = carrierLineIndices[idx];
        const end = Math.min(linesArr.length, start + 8);
        const blockLines = linesArr.slice(start, end);
        const block = blockLines.join('\n');
        const sec = detectCarrier(block, blockLines);
        if (sec.hit && sec.value.carrier !== primaryCarrier) {
          const mid = block.match(/(?:member|subscriber|policy)\s*(?:id|#|number)?[:\s]*([A-Z0-9]{4,})/i);
          const gid = block.match(/group\s*(?:id|#|number)?[:\s]*([A-Z0-9]{3,})/i);
            const memberId = mid ? mid[1] : null;
            const groupId = gid ? gid[1] : null;
          const distance = start - carrierLineIndices[0];
          const lineText = linesArr[start];
          const hasExplicitSecondary = /(other\s+insurance|secondary\s+insurance|\bsecondary\b)/i.test(lineText);
          const distinctCarrierToken = sec.value.carrier && sec.value.carrier.toLowerCase() !== (primaryCarrier||'').toLowerCase();
          const strongStructure = !!(memberId && (groupId || /group/i.test(block)));
          const score = (memberId ? 1 : 0) + (groupId ? 0.5 : 0) + (distance > 1 ? 0.25 : 0) + (hasExplicitSecondary ? 1.5 : 0);
          const accept = (
            (hasExplicitSecondary && distinctCarrierToken) ||
            (distinctCarrierToken && memberId && result.insurance[0].memberId && distance > 0 && strongStructure)
          );
          if (!accept) continue;
          if (!best || score > best.score) best = { sec, memberId, groupId, score };
        }
      }
      if (best) {
        const secObj = { carrier: best.sec.value.carrier, status: best.sec.value.status };
        if (best.memberId) secObj.memberId = best.memberId;
        if (best.groupId) secObj.groupId = best.groupId;
        result.insurance.push(secObj);
        trace.push({ rule: 'carrier_secondary_detect_refined', value: secObj.carrier, score: best.score });
      } else {
        const primaryCarrier2 = result.insurance[0].carrier;
        for (let idx = 1; idx < carrierLineIndices.length; idx++) {
          const start = carrierLineIndices[idx];
          const line = linesArr[start];
          if (!/^\s*insurance\s*[:\-]/i.test(line)) continue;
          const blockLines = linesArr.slice(start, Math.min(linesArr.length, start + 4));
          const block = blockLines.join('\n');
          const sec = detectCarrier(block, blockLines);
          if (!(sec.hit && sec.value.carrier && sec.value.carrier.toLowerCase() !== (primaryCarrier2||'').toLowerCase())) continue;
          const mid = block.match(/(?:member|subscriber|policy)\s*(?:id|#|number)?[:\s]*([A-Z0-9]{4,})/i);
          if (!mid) continue;
          if (!/group\s*(?:id|#|number)?[:\-]/i.test(block) && !/plan\s*[:\-]/i.test(block)) continue;
          const gid = block.match(/group\s*(?:id|#|number)?[:\s]*([A-Z0-9]{3,})/i);
          const secObj = { carrier: sec.value.carrier, status: sec.value.status };
          secObj.memberId = mid[1];
          if (gid) secObj.groupId = gid[1];
          result.insurance.push(secObj);
          trace.push({ rule: 'carrier_secondary_detect_fallback_generic', value: secObj.carrier });
          break;
        }
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

  // CPAP compliance metrics extraction & inference
  {
    const text = fullText || '';
    const metrics = {};
    // Hours per night (avg usage)
    const hrsMatch = text.match(/(avg\.?\s*)?(usage\s*)?(?:hours?|hrs)\s*(?:of\s*use\s*)?(?:per\s*night\s*)?(\d{1,2}(?:\.\d+)?)\s*(?:hrs?|hours?)/i) || text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:hrs?|hours?)\s*(?:per|\/)?\s*night/i);
    if (hrsMatch) metrics.avgHours = parseFloat(hrsMatch[3] || hrsMatch[1]);
    // AHI value
    const ahiMatch = text.match(/\bAHI\b[^0-9]{0,10}(\d{1,2}(?:\.\d+)?)/i);
    if (ahiMatch) metrics.ahi = parseFloat(ahiMatch[1]);
    // 90% pressure
    const p90 = text.match(/90%\s*pressure[^0-9]{0,10}(\d{1,2}(?:\.\d+)?)/i);
    if (p90) metrics.p90 = parseFloat(p90[1]);
    // Usage percent (>=4 hr nights)
    const usagePct = text.match(/(\d{2,3})%\s*(?:of\s*)?(?:nights|usage)/i);
    if (usagePct) metrics.usagePercent = parseFloat(usagePct[1]);
    // Pressure range or fixed setting (e.g., 5-15 cm, or 10 cm H2O)
    const pressureRange = text.match(/(\d{1,2})\s*[-to]{1,3}\s*(\d{1,2})\s*cm/i);
    if (pressureRange) {
      metrics.pressureMin = parseInt(pressureRange[1]);
      metrics.pressureMax = parseInt(pressureRange[2]);
    } else {
      const fixedPressure = text.match(/\b(\d{1,2})\s*cm\s*(?:h2o)?\b/i);
      if (fixedPressure) metrics.pressureFixed = parseInt(fixedPressure[1]);
    }
    if (Object.keys(metrics).length) {
      result.compliance = metrics;
      trace.push({ rule: 'dme_compliance_metrics_detect', keys: Object.keys(metrics) });
    }
    // Inference: if CPAP mentioned but no metrics at all
    const cpapMention = /(\bcpap\b|cpap\s*(?:user|uses|on)|apap|bipap)/i.test(text);
    const metricsPresent = Object.keys(metrics).length > 0;
    if (cpapMention && !metricsPresent) {
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'obtain_cpap_compliance_data']));
      if (!result.flags.reasons.includes('dme_compliance_data_missing')) result.flags.reasons.push('dme_compliance_data_missing');
      trace.push({ rule: 'dme_compliance_infer', reason: 'cpap_reference_without_compliance' });
    }
  }
  // DME linkage / prerequisite heuristics (after compliance metrics extraction so metrics are available)
  if (dme?.hit) {
    const cptCodeLocal = String(result.procedure?.cpt || '');
    const isTitrationLike = cptCodeLocal === '95811' || cptCodeLocal === '95783';
    const hasComplianceMetrics = !!result.compliance;
    const referencedDmeIssues = Array.isArray(dme.value?.issues) && dme.value.issues.length > 0;
  if (isTitrationLike && !hasComplianceMetrics && /cpap|pap|bipap|apap/i.test(fullText||'')) {
      if (!result.alerts.actions.includes('obtain_cpap_compliance_data')) result.alerts.actions.push('obtain_cpap_compliance_data');
      if (!result.alerts.actions.includes('verify_dme_prerequisites')) result.alerts.actions.push('verify_dme_prerequisites');
      if (!result.flags.reasons.includes('dme_prerequisites_missing')) {
        result.flags.verifyManually = true;
        result.flags.reasons.push('dme_prerequisites_missing');
      }
      trace.push({ rule: 'dme_prereq_infer', cpt: cptCodeLocal, issues: referencedDmeIssues });
    } else if (isTitrationLike && hasComplianceMetrics && referencedDmeIssues) {
      trace.push({ rule: 'dme_prereq_present', metrics: Object.keys(result.compliance||{}).length });
    }
  }

  // If 95811 chosen but we don't see obvious titration criteria phrases, flag for review
  if (result.procedure?.cpt === '95811') {
  const titrationCriteria = PATTERNS.TITRATION_CRITERIA;
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

  // Helper function to improve provider name using corrections DB and NPI lookup
  const improveProviderName = async (ocrName, trace) => {
    if (!ocrName) return null;

    // Step 1: Check corrections database for exact match
    const correction = correctionsDB.getCorrection('provider', ocrName);
    if (correction && correction.confidence >= 0.7) {
      trace.push({ 
        rule: 'provider_name_corrected', 
        value: correction.text,
        source: 'corrections_db',
        confidence: correction.confidence 
      });
      return correction.text;
    }

    // Step 2: Try fuzzy match in corrections DB
    const fuzzyCorrection = correctionsDB.fuzzyMatch('provider', ocrName, 0.85);
    if (fuzzyCorrection && fuzzyCorrection.confidence >= 0.7) {
      trace.push({ 
        rule: 'provider_name_fuzzy_corrected', 
        value: fuzzyCorrection.text,
        source: 'corrections_db_fuzzy',
        similarity: fuzzyCorrection.similarity 
      });
      return fuzzyCorrection.text;
    }

    // Step 3: Try NPI registry lookup (async)
    try {
      const npiMatch = await npiService.fuzzyMatchProvider(ocrName);
      if (npiMatch && npiMatch.similarity >= 0.75) {
        const fullName = npiMatch.credential ? 
          `${npiMatch.name}, ${npiMatch.credential}` : npiMatch.name;
        
        trace.push({ 
          rule: 'provider_name_npi_matched', 
          value: fullName,
          npi: npiMatch.npi,
          source: 'npi_registry',
          similarity: npiMatch.similarity 
        });
        
        // Cache this correction for future use
        correctionsDB.recordCorrection('provider', ocrName, npiMatch.name, {
          npi: npiMatch.npi,
          source: 'npi_auto'
        });
        
        return fullName;
      }
    } catch (err) {
      console.error('NPI lookup failed:', err.message);
    }

    // No improvement found, return original
    return null;
  };

  // Provider detection (basic)
  {
    const providerLines = (fullText || '').split(/\n/);
    const isOrderingProviderLine = (line) => {
      const lower = String(line || '').toLowerCase();
      if (!lower) return false;
      const normalized = lower.replace(/[1l]/g, 'l').replace(/0/g, 'o');
      if (/(ordering\s*(provider|physician))/i.test(normalized)) return true;
      const collapsed = normalized.replace(/[^a-z]/g, '');
      const orderingTokens = ['ordering', 'orderring', 'ordening', 'orderlng', 'ordcring', 'ordaring', 'ordoring'];
      const providerTokens = ['provider', 'provicer', 'proviser', 'provdcr', 'provdor', 'physician'];
      const hasOrdering = orderingTokens.some(tok => collapsed.includes(tok));
      const hasProvider = providerTokens.some(tok => collapsed.includes(tok));
      return hasOrdering && hasProvider;
    };

    const assignProviderFromLine = async (lineIndex) => {
      const line = providerLines[lineIndex] || '';
      if (!line) return false;
      if (!line) return false;

      const candidateSegments = [];
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0) {
        const afterColon = line.slice(colonIdx + 1).trim();
        if (afterColon) candidateSegments.push(afterColon);
      }
      candidateSegments.push(line);

      const normalizeDetectedName = raw => {
        if (!raw) return '';
        let cleaned = raw.replace(/^Dr\.?\s*/i, '').trim();
        
        // Pattern-based OCR corrections (general rules that apply to all text)
        // Fix trailing 'L' that should be 'I' in all-caps names (KERMANL → KERMANI)
        cleaned = cleaned.replace(/\b([A-Z]{3,})L\b/g, '$1I');
        
        // Strip trailing credentials from name itself (they'll be added back later)
        cleaned = cleaned.replace(/,?\s+(MD|DO|NP|PA|RN|DPM|PharmD|PhD)$/i, '');
        
        if (/,/.test(cleaned)) {
          const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const last = parts[0];
            const rest = parts.slice(1).join(' ');
            cleaned = `${rest} ${last}`.replace(/\s+/g, ' ').trim();
          }
        }
        return cleaned.replace(/\s+/g, ' ').trim();
      };

      const startsWithNoise = nameStr => {
        const token = (nameStr || '').split(/\s+/)[0] || '';
        return /^(refer|from|provider|referral|attention|attn)$/i.test(token);
      };

      let provName = null;
      for (const segment of candidateSegments) {
        if (!segment) continue;
        let match =
          segment.match(/([A-Z][a-zA-Z'’\-]+,\s*[A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*)/) ||
          segment.match(/Dr\.?\s*([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)+)/) ||
          segment.match(/([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)+)/);
        const detected = match ? match[1] || match[0] : '';
        const normalized = normalizeDetectedName(detected);
        if (normalized && !startsWithNoise(normalized)) {
          provName = normalized;
          break;
        }
      }

      if (!provName) return false;

      provName = provName.replace(/NP[l1]\b/g, 'NP');
      
      // Try to improve provider name using corrections DB and NPI lookup
      const improvedName = await improveProviderName(provName, trace);
      if (improvedName) {
        provName = improvedName;
      }
      
      trace.push({ rule: 'provider_name_detect', value: provName });

      const credSources = [line];
      if (lineIndex > 0) credSources.push(providerLines[lineIndex - 1]);
      if (lineIndex >= 0 && lineIndex + 1 < providerLines.length) credSources.push(providerLines[lineIndex + 1]);
      const credTokens = [];
      for (const sourceLine of credSources) {
        for (const entry of PROVIDER_CREDENTIAL_REGEXES) {
          const m = sourceLine && sourceLine.match(entry.regex);
          if (m && entry.token) {
            const token = entry.token;
            if (!credTokens.includes(token)) credTokens.push(token);
          }
        }
      }
      if (credTokens.length) {
        provName = `${provName}, ${credTokens.join('/')}`;
        trace.push({ rule: 'provider_credential_append', value: credTokens.join('/') });
      }
      result.provider.name = provName;
      return true;
    };

    let providerDetected = false;
    
    // Use async provider detection
    await (async () => {
      // Priority 1: "Ordering Provider:" - highest priority for medical referrals
      // Flexible pattern to handle OCR errors: "FroVder", "Orderlng" (i→l), etc.
      let orderingLineIndex = providerLines.findIndex(line => 
        /order[il1]ng\s*[fp]ro[vw]?[ild]*[de]+r\s*:/i.test(line || '')
      );
      if (orderingLineIndex === -1) {
        orderingLineIndex = providerLines.findIndex(line => isOrderingProviderLine(line));
      }
      
      if (orderingLineIndex >= 0) {
        providerDetected = await assignProviderFromLine(orderingLineIndex);
      }
      
      // Priority 2: "Refer from Provider/Physician"
      if (!providerDetected) {
        const referLineIndex = providerLines.findIndex(line => /refer\s+from\s*(provider|physician)/i.test(line || ''));
        if (referLineIndex >= 0) {
          providerDetected = await assignProviderFromLine(referLineIndex);
        }
      }

      // Priority 3: Generic provider name patterns
      if (!providerDetected) {
        const provLineIndex = providerLines.findIndex(line => PROVIDER_NAME_REGEXES.some(rx => rx.test(line || '')));
        if (provLineIndex >= 0) {
          providerDetected = await assignProviderFromLine(provLineIndex);
        }
      }
    })();
    const normalizeName = str => String(str || '').replace(/[^A-Za-z\s'’\-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const patientNameVariants = new Set();
    if (result.patient?.first && result.patient?.last) {
      const first = normalizeName(result.patient.first);
      const last = normalizeName(result.patient.last);
      if (first && last) {
        patientNameVariants.add(`${first} ${last}`);
        patientNameVariants.add(`${last} ${first}`);
        patientNameVariants.add(`${last}, ${first}`);
      }
    }
    if (!result.provider.name) {
      const credentialRe = /\b(MD|DO|NP|FNP|FNP-C|FNP-BC|NP-C|PA-C|APRN|ANP|DC|PhD|RN)\b/i;
      const specialtyRe = /(family\s+practice|primary\s+care|pulm|pulmon|sleep|cardio|obgyn|clinic|wellness|internal\s+medicine|pediatrics|neurology|fnp|fnp-c|np\b|aprn|md\b|do\b)/i;
      let fallback = null;
      
      // First pass: check for name WITH credentials on the same line
      const disclaimerRe = /\b(do\s+not|if\s+you|this\s+(fax|message|communication)|confidential|intended\s+recipient|addressee|please\s+contact|disclaimer)\b/i;
      
      for (let i = 0; i < providerLines.length; i++) {
        const line = providerLines[i] || '';
        if (!credentialRe.test(line)) continue;
        if (disclaimerRe.test(line)) continue; // Skip disclaimer lines
        
        // Extract name before credentials: "James Lentini APRN, FNP-C, FNP-BC" → "James Lentini"
        const nameMatch = line.match(/\b([A-Z][a-zA-Z''\-]+(?:\s+[A-Z][a-zA-Z''\-]+){1,3})\s*,?\s*(MD|DO|NP|FNP|PA-C|APRN|ANP|DC|PhD|RN|FNP-C|FNP-BC|NP-C)/i);
        if (nameMatch) {
          const raw = nameMatch[1].replace(/\s+/g, ' ').trim();
          const norm = normalizeName(raw);
          if (norm && !patientNameVariants.has(norm)) {
            fallback = raw;
            break;
          }
        }
      }
      
      // Second pass: original logic - look backward from specialty lines
      if (!fallback) {
        for (let i = 0; i < providerLines.length; i++) {
        const line = providerLines[i] || '';
        if (!specialtyRe.test(line)) continue;
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          const candidateLine = (providerLines[j] || '').trim();
          if (!candidateLine) continue;
          if (/patient|subscriber|member|policy|referral|subject|date|from\s+name|from\s+company|from\s+facility|to:?/i.test(candidateLine)) continue;
          if (candidateLine.includes(':')) continue;
          if (/^from\b/i.test(candidateLine)) continue;
          const match = candidateLine.match(/([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+){1,2})/);
          if (!match) continue;
          const raw = match[1].replace(/\s+/g, ' ').trim();
          const norm = normalizeName(raw);
          if (!norm) continue;
          if (patientNameVariants.has(norm)) continue;
          fallback = raw;
          break;
        }
        if (fallback) break;
        }
      }
      
      if (fallback) {
        result.provider.name = fallback;
        trace.push({ rule: 'provider_name_detect_fallback', value: fallback });
      }
    }
    if (!result.provider.practice) {
      // Check for "From Provider" section - facility name is typically the first meaningful line after
      const fromProviderRe = /(?:^|\b)f?rom\s+prov(?:ider|der)\b/i;
      const boilerplateRe = /(if you have medical|if you have questions|please contact|this fax|confidential|disclaimer|do\s*not\s*(write|fax)|cover\s*sheet|please\s*fax|information\s*contained|intended\s*recipient)/i;
      
      for (let i = 0; i < providerLines.length; i++) {
        const line = providerLines[i] || '';
        if (!fromProviderRe.test(line)) continue;
        // Look for facility value in the next few lines; handle label/value split like "Place of Surgery" on one line, value on next
        for (let j = i + 1; j < Math.min(i + 5, providerLines.length); j++) {
          const rawCand = (providerLines[j] || '').trim();
          console.log('[DEBUG] Checking line', j, ':', JSON.stringify(rawCand));
          if (!rawCand) { console.log('[DEBUG] Empty line, skipping'); continue; }
          
          // Hard skip disclaimer patterns first
          if (/^\s*(If you have medical|If you have questions|Please contact|This fax|Confidential|Disclaimer)\b/i.test(rawCand)) {
            console.log('[DEBUG] Matches explicit disclaimer pattern, skipping');
            continue;
          }
          
          // Skip boilerplate/disclaimer/address lines
          if (boilerplateRe.test(rawCand)) { console.log('[DEBUG] Contains boilerplate, skipping'); continue; }
          if (/^\d+\s+/.test(rawCand)) { console.log('[DEBUG] Starts with number (address), skipping'); continue; } // address line starting with number
          if (/phone|fax|ordering/i.test(rawCand)) { console.log('[DEBUG] Contains phone/fax/ordering, skipping'); continue; }
          if (/\b\d{5}(?:-\d{4})?\b/.test(rawCand)) { console.log('[DEBUG] Contains zip code, skipping'); continue; } // zip code
          if (/\d{3}.*\d{3}.*\d{4}/.test(rawCand)) { console.log('[DEBUG] Phone-only line, skipping'); continue; } // phone-only line
          if (isHeaderLine(rawCand)) { console.log('[DEBUG] Is header line, skipping'); continue; }

          // Skip label-only lines like "Place of Surgery" or "Place ot Surgery" (OCR typo) - value is on next line
          if (/^place\s+o[ft]\s+surgery\b/i.test(rawCand)) {
            console.log('[DEBUG] Skipping label line:', rawCand);
            continue;
          }

          // Handle lines starting with colon (value from previous label line)
          let candidate = rawCand.replace(/^\s*:\s*/, '').trim();
          console.log('[DEBUG] Processing candidate:', JSON.stringify(candidate));
          
          if (!candidate || candidate.length < 6) continue;
          
          // Valid candidate found - assign it directly (don't use stripAddressTail for practice names!)
          result.provider.practice = candidate;
          console.log('[DEBUG] Assigned practice:', JSON.stringify(candidate));
          trace.push({ rule: 'provider_practice_from_section', value: result.provider.practice });
          break;
        }
        if (result.provider.practice) break;
      }
    }
    
    if (!result.provider.practice) {
      const fromCompanyRe = /(?:^|\b)f?rom\s+company/i;
      const fromFacilityRe = /(?:^|\b)f?rom\s+facility/i;
      for (let i = 0; i < providerLines.length; i++) {
        const line = providerLines[i] || '';
        if (fromCompanyRe.test(line) || fromFacilityRe.test(line)) {
          const candidate = (providerLines[i + 1] || '').trim();
          if (candidate && !/sleep\s+stud/i.test(candidate.toLowerCase())) {
            result.provider.practice = candidate;
            trace.push({ rule: 'provider_practice_detect', value: candidate });
            break;
          }
        }
      }
    }
    const npiMatch = (fullText || '').match(/\bNPI\s*[:#-]?\s*(\d{10})\b/i);
    if (npiMatch) {
      result.provider.npi = npiMatch[1];
      trace.push({ rule: 'provider_npi_detect' });
    }
    // Provider phones/fax
    const linesArr = (fullText || '').split(/\n/);
    const providerPhones = new Set();
    // First pass: explicit fax lines (preserve earliest)
    for (const L of linesArr) {
      if (/fax/i.test(L)) {
        const afterFax = L.match(/fax[^0-9]{0,15}((\(\d{3}\)\s*\d{3}-\d{4})|(\b\d{3}[-\. ]\d{3}[-\. ]\d{4}\b))/i);
        if (afterFax) {
          const rawFax = afterFax[1];
          const digits = rawFax.replace(/\D/g,'');
          if (digits.length === 10 && !result.provider.fax) {
            result.provider.fax = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
            trace.push({ rule: 'provider_fax_detect', value: result.provider.fax, mode: 'line' });
          }
        }
      }
    }
    const phonePattern = /(fax|fx|facsimile|f)?[^\n\r]{0,40}?((?:\(\d{3}\)\s*\d{3}-\d{4})|(?:\b\d{3}[-\. ]\d{3}[-\. ]\d{4}\b)|(?:\b\d{10}\b))/gi;
    // Build provider-context anchor indices to require proximity when classifying provider phones
    const providerContextIdx = [];
    for (let i = 0; i < linesArr.length; i++) {
      const L = linesArr[i] || '';
      if (/order[il1]ng\s*[fp]ro[vw]?[ild]*[de]+r\s*:|refer\s+from\s*(provider|physician)|f?rom\s+prov(?:ider|der)|provider\s*name|\bdr\.?\b|\bnpi\b/i.test(L) || isOrderingProviderLine(L) || isLikelyProviderLine(L)) {
        providerContextIdx.push(i);
      }
    }
    let m;
    while ((m = phonePattern.exec(fullText || '')) !== null) {
      const labelPart = m[1] || '';
      const rawNum = m[2];
      const digits = rawNum.replace(/\D/g,'');
      if (digits.length !== 10) continue;
      const formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
      // Extract small context window to classify
      const ctxStart = Math.max(0, m.index - 40);
      const ctx = (fullText || '').slice(ctxStart, m.index + rawNum.length + 40).toLowerCase();
  const beforeLabel = (fullText || '').slice(Math.max(0, m.index - 15), m.index).toLowerCase();
  const labelLower = (labelPart || '').toLowerCase();
  let lineIdx = 0; let accLen = 0;
  for (let i = 0; i < linesArr.length; i++) {
        accLen += linesArr[i].length + 1;
        if (accLen > m.index) { lineIdx = i; break; }
      }
  const isFax = /(fax|fx|facsimile)/i.test(labelPart)
    || (/\bfax\b|\bfx\b|facsimile/.test(beforeLabel) && !/no\s*fax/.test(beforeLabel))
    || labelLower.trim() === 'f'
    || /\bf[:\s]/.test(beforeLabel)
    || isFaxLike(linesArr[lineIdx]);
  const lineLower = (linesArr[lineIdx] || '').toLowerCase();
  const isTel = ((/tel|telephone|phone|ph\b/.test(beforeLabel + ctx) || labelLower.trim() === 't' || /\bt[:\s]/.test(beforeLabel) || /^\s*t\b/.test(lineLower) || isLikelyProviderLine(linesArr[lineIdx])) && !isFax);
  // Proximity and negative context guards
  const nearProviderContext = providerContextIdx.some(pi => Math.abs(pi - lineIdx) <= 4);
  const patientWindow = (fullText || '').slice(Math.max(0, m.index - 80), m.index + rawNum.length + 80).toLowerCase();
  const looksPatientContext = /(patient\s*(phone|contact|information)|emergency\s*contact|home\s*phone|mobile\s*phone|cell\b|h:\s*\(?\d{3}|m:\s*\(?\d{3})/i.test(patientWindow);
  const facilityHint = /\bplace\s+of\s+surgery\b/.test(ctx) || /\bhome\s+sleep\s+stud/.test(ctx);
      if (isFax) {
        if (!result.provider.fax) {
          result.provider.fax = formatted;
          trace.push({ rule: 'provider_fax_detect', value: formatted, mode: 'scan' });
        }
      } else if (isTel || /provider|office|clinic|suite|ste\b/.test(ctx)) {
        // Only accept as provider phone if near provider context and not clearly a patient contact
        if (nearProviderContext && !looksPatientContext && !facilityHint) {
          providerPhones.add(formatted);
        }
      }
    }
    if (providerPhones.size && !result.provider.phone) {
      // Filter out numbers that also appear near patient contact labels
      const textLower = (fullText || '').toLowerCase();
      const patientLabelRe = /(contact\s+phone|patient\s+phone|patient\s+contact)/i;
      const orderedAll = Array.from(providerPhones).filter(p => p !== result.provider.fax).sort();
      // If provider fax present, prefer same-area-code phones to reduce cross-leakage
      const faxDigits = (result.provider.fax || '').replace(/\D/g, '');
      const faxArea = faxDigits.length === 10 ? faxDigits.slice(0,3) : null;
      let chosen = null;
      for (const cand of orderedAll) {
        const esc = cand.replace(/[-()\s]/g,'');
        const idx = textLower.indexOf(esc.slice(0,6));
        if (idx >= 0) {
          // Extract surrounding window
          const window = textLower.slice(Math.max(0, idx-40), idx+40);
          if (patientLabelRe.test(window)) continue; // skip patient-labeled numbers
        }
        if (faxArea && cand.replace(/\D/g,'').startsWith(faxArea)) { chosen = cand; break; }
        chosen = cand; break;
      }
      if (!chosen && orderedAll.length) chosen = orderedAll[0];
      if (chosen) {
        const digits = chosen.replace(/\D/g, '');
        if (!isValidNANP(digits)) {
          trace.push({ rule: 'phone_suspect', value: chosen, reason: 'invalid_nanp' });
        } else {
          result.provider.phone = chosen;
          trace.push({ rule: 'provider_phone_detect', value: chosen, candidates: orderedAll.length });
        }
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
    // Remove provider phone from patient list if it leaked there (avoid duplication/misclassification)
    if (result.provider.phone && Array.isArray(result.patient.phones)) {
      const before2 = result.patient.phones.length;
      result.patient.phones = result.patient.phones.filter(p => p !== result.provider.phone);
      if (result.patient.phones.length !== before2) trace.push({ rule: 'patient_phone_remove_provider_match', removed: result.provider.phone });
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
    const linesLocal = (fullText || '').split(/\n/);
    const confirmed = [];
    const details = [];
    for (const rawLine of linesLocal) {
      const trimmed = String(rawLine || '').trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();

      if (SYMPTOM_EDUCATIONAL_RE.test(lower)) continue;
      if (SYMPTOM_CONDITIONAL_RE.test(lower)) continue;
      if (SYMPTOM_FAMILY_CONTEXT_RE.test(lower)) continue;
      if (SYMPTOM_THIRD_PARTY_RE.test(lower) && !SYMPTOM_PATIENT_TOKEN_RE.test(lower)) continue;

      if (SYMPTOM_HISTORY_RE.test(lower) && !SYMPTOM_HISTORY_OVERRIDE_RE.test(lower)) {
        pushUnique(infoAlerts.history, trimmed.slice(0, 160));
        continue;
      }
      if (SYMPTOM_RESOLUTION_RE.test(lower)) {
        pushUnique(infoAlerts.resolution, trimmed.slice(0, 160));
        continue;
      }

      for (const medRe of SYMPTOM_MEDICATION_PATTERNS) {
        if (medRe.test(trimmed)) {
          pushUnique(infoAlerts.medications, trimmed.slice(0, 160));
          break;
        }
      }
      if (SYMPTOM_TEST_RESULT_RE.test(trimmed)) {
        pushUnique(infoAlerts.testResults, trimmed.slice(0, 160));
      }

      for (const [label, pos, neg] of SYMPTOM_CONFIG) {
        if (pos.test(trimmed)) {
          const negHit = neg ? neg.test(trimmed) : false;
          if (!negHit && !confirmed.includes(label)) confirmed.push(label);
          details.push({ name: label, status: negHit ? 'denied' : 'confirmed', context: trimmed.slice(0, 180) });
        } else if (neg && neg.test(trimmed)) {
          details.push({ name: label, status: 'denied', context: trimmed.slice(0, 180) });
        }
      }
    }
    if (confirmed.length) {
      result.clinical.symptoms = confirmed;
    }
    if (details.length) {
      result.clinical.symptomDetails = details.slice(0, 60);
      trace.push({ rule: 'symptoms_detect', confirmed: confirmed.length, totalMentions: details.length });
    }
  }

  // Vitals (BMI, height, weight, BP) with BP validation to avoid date-like artifacts
  {
    const vitals = {};
    const bmi = (fullText || '').match(/BMI\s*[:]?\s*(\d{2}(?:\.\d)?)/i);
    if (bmi) vitals.bmi = bmi[1];
    // Try table-based BP extraction first
    let bpValue = fromTables(/\b(bp|blood\s*pressure)\b/i);
    if (bpValue) {
      const bpMatch = bpValue.match(/(\d{2,3})\/(\d{2,3})/);
      if (bpMatch) {
        const sys = parseInt(bpMatch[1], 10), dia = parseInt(bpMatch[2], 10);
        if (sys >= 80 && sys <= 220 && dia >= 40 && dia <= 140) {
          vitals.bp = `${bpMatch[1]}/${bpMatch[2]}`;
          trace.push({ rule: 'vitals_bp_from_tables', value: vitals.bp });
        }
      }
    }
    
    // Fallback to text regex if not found in tables
    if (!vitals.bp) {
      const bp = (fullText || '').match(/\b(\d{2,3})\/(\d{2,3})\b\s*(?:mmhg|blood\s*pressure|bp)?/i);
      if (bp) {
        const sys = parseInt(bp[1],10), dia = parseInt(bp[2],10);
        if (sys >= 80 && sys <= 220 && dia >= 40 && dia <= 140) vitals.bp = `${bp[1]}/${bp[2]}`; // plausible range
      }
    }
    
    const wt = (fullText || '').match(/(?:weight|wt)\s*[:]?\s*(\d{2,3})\s*(?:lbs?|pounds?)/i);
    if (wt) vitals.weightLbs = wt[1];
    const ht = (fullText || '').match(/(?:height|ht)\s*[:]?\s*(\d['’]\s*\d{1,2}"?)/i);
    if (ht) vitals.height = ht[1].replace(/\s+/g,'');
    if (Object.keys(vitals).length) { result.clinical.vitals = vitals; trace.push({ rule: 'vitals_detect', keys: Object.keys(vitals) }); }
  }

  // Info alerts (PPE, safety, communication, accommodations, history)
  {
    const txtLower = (fullText || '').toLowerCase();
    if (/(isolation|airborne|droplet|ppe required|mask required)/i.test(fullText || '')) infoAlerts.ppeRequired = true;
    else if (/no ppe/i.test(fullText || '')) infoAlerts.ppeRequired = false;
    const safetyMap = [ ['seizure', /seizure|epilepsy/], ['cardiac_device', /pacemaker|defibrillator|cardiac\s+device/], ['mobility', /wheelchair|walker|limited\s+mobility|bedbound|bed\s+confined/], ['oxygen', /oxygen|o2\s+dependent/] ];
    for (const [k, re] of safetyMap) if (re.test(txtLower)) pushUnique(infoAlerts.safety, k);
    const commMap = [ ['hearing_impaired', /hearing\s+impaired|hard\s+of\s+hearing|deaf/], ['language_barrier', /spanish\s+only|interpreter|translation\s+needed|language\s+barrier/] ];
    for (const [k, re] of commMap) if (re.test(txtLower)) pushUnique(infoAlerts.communication, k);
    const accomMap = [ ['wheelchair', /wheelchair/], ['oxygen', /oxygen\s+dependent/], ['caretaker', /caretaker|caregiver|guardian/] ];
    for (const [k, re] of accomMap) if (re.test(txtLower)) pushUnique(infoAlerts.accommodations, k);
    const infoTotals = {
      ppe: infoAlerts.ppeRequired,
      safety: infoAlerts.safety.length,
      communication: infoAlerts.communication.length,
      accommodations: infoAlerts.accommodations.length,
      history: infoAlerts.history.length,
      resolution: infoAlerts.resolution.length,
      medications: infoAlerts.medications.length,
      testResults: infoAlerts.testResults.length
    };
    if (infoTotals.ppe !== null || infoTotals.safety || infoTotals.communication || infoTotals.accommodations || infoTotals.history || infoTotals.resolution || infoTotals.medications || infoTotals.testResults) {
      trace.push({ rule: 'info_alerts_detect', ...infoTotals });
    }
  }

  // Normalize clinical notes (deduplicate similar lines, remove footer noise)
  if (Array.isArray(infoAlerts.history) && infoAlerts.history.length > 0) {
    const beforeCount = infoAlerts.history.length;
    infoAlerts.history = normalizeHistoryNotes(infoAlerts.history);
    if (infoAlerts.history.length !== beforeCount) {
      trace.push({ rule: 'clinical_notes_normalized', before: beforeCount, after: infoAlerts.history.length });
    }
  }
  if (Array.isArray(infoAlerts.medications) && infoAlerts.medications.length > 0) {
    const beforeCount = infoAlerts.medications.length;
    infoAlerts.medications = normalizeHistoryNotes(infoAlerts.medications);
    if (infoAlerts.medications.length !== beforeCount) {
      trace.push({ rule: 'medications_normalized', before: beforeCount, after: infoAlerts.medications.length });
    }
  }

  result.infoAlerts = infoAlerts;
  
  // NEW SAFETY FLAG: High Acuity Safety Review Required
  // If patient has history of falls + opioid medication + oxygen/caretaker accommodations
  const fallsDetected = hasHistoryOfFalls([...(infoAlerts.history || []), ...(infoAlerts.safety || [])]);
  const opioidDetected = hasOpioidMed(infoAlerts.medications || []);
  const oxygenOrCaretaker = hasOxygenOrCaretaker([
    ...(infoAlerts.accommodations || []),
    ...(infoAlerts.safety || []),
    ...(infoAlerts.history || [])
  ]);
  
  if (fallsDetected.found && opioidDetected.found && oxygenOrCaretaker.found) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('high_acuity_safety_review_required');
    result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'safety_review_high_acuity']));
    trace.push({
      rule: 'high_acuity_safety_review_required',
      fallsPhrase: fallsDetected.phrase,
      opioidMedication: opioidDetected.name,
      oxygenOrCaretaker: oxygenOrCaretaker.term,
      reason: 'falls_plus_opioid_plus_oxygen_or_caretaker'
    });
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
  {
    const pedCpt = ['95782','95783'].includes(cptCode);
    // Try to compute age from DOB
    let ageYears = null;
    try {
      if (result.patient?.dob) {
        const parts = String(result.patient.dob).split('/');
        if (parts.length === 3) {
          const yr = parseInt(parts[2], 10);
          if (!isNaN(yr)) ageYears = (new Date()).getFullYear() - yr;
        }
      }
    } catch {}
    // Only treat textual mentions as pediatric if they're in a strong patient/procedure context and not a generic header/disclaimer
    let strongPedMention = false;
    try {
      const linesLocal = (fullText || '').split(/\n/);
      for (let i = 0; i < linesLocal.length; i++) {
        const L = linesLocal[i] || '';
        if (!/(pediatric|child|minor)/i.test(L)) continue;
        if (isHeaderLine(L)) continue; // skip header-like lines (e.g., cover sheet options)
        const window = linesLocal.slice(Math.max(0, i-1), Math.min(linesLocal.length, i+2)).join(' ').toLowerCase();
        if (/adult/.test(L.toLowerCase())) continue; // skip option lists like "(adult) (pediatric)"
        if (/(patient|study|procedure|cpt|referral|order)/i.test(window)) { strongPedMention = true; break; }
      }
    } catch {}
    if ((ageYears != null && ageYears < 18) || pedCpt || strongPedMention) {
      result.flags.verifyManually = true;
      result.flags.reasons.push('special_considerations_pediatric');
      result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'special_considerations']));
      trace.push({ rule: 'problem_pediatric_requirements', mode: (ageYears != null && ageYears < 18) ? 'age' : pedCpt ? 'cpt' : 'context' });
    }
    
    // NEW SAFETY FLAG: Age/CPT Pediatric Mismatch
    // If patient age >= 18 but CPT or description indicates pediatric, flag for review
    if (ageYears != null && ageYears >= 18) {
      const descriptionText = String(result.procedure?.description || '');
      const hasPediatricIndicator = pedCpt || isPediatricDescription(descriptionText);
      if (hasPediatricIndicator) {
        result.flags.verifyManually = true;
        result.flags.reasons.push('age_cpt_pediatric_mismatch');
        result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_age_cpt_mismatch']));
        trace.push({ 
          rule: 'age_cpt_pediatric_mismatch', 
          age: ageYears, 
          pediatricIndicator: pedCpt ? 'cpt' : 'description',
          cpt: cptCode,
          description: descriptionText.slice(0, 100) 
        });
      }
    }
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
  const ambiguousHandwriting = totalBoxes && (lowCount / totalBoxes) > 0.45;
  if (ambiguousHandwriting) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('ocr_handwriting_unclear');
    trace.push({ rule: 'flag_ocr_handwriting_unclear', ratio: Number((lowCount / totalBoxes).toFixed(3)) });
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

  // Additional contradictory context (explicit "but"/"however" constructs)
  const contradictionRe = /(reports|positive|noted).{0,80}(?:but|however).{0,80}(denies|negative)/i;
  if (contradictionRe.test(txt)) {
    result.flags.verifyManually = true;
    result.flags.reasons.push('contradictory_information');
    trace.push({ rule: 'flag_contradictory_information' });
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

  // Base confidence from extracted anchors (expanded set) with weighted scoring
  const anchors = {
    patientName: !!(result.patient?.first && result.patient?.last),
    dob: !!result.patient?.dob,
    cpt: !!result.procedure?.cpt,
    diagnosis: !!(result.diagnoses && result.diagnoses.length),
    insuranceCarrier: !!(Array.isArray(result.insurance) && result.insurance[0]?.carrier),
    insuranceIds: !!(Array.isArray(result.insurance) && (result.insurance[0]?.memberId || result.insurance[0]?.groupId)),
    complianceMetrics: !!result.compliance, // optional signal
  };
  const WEIGHTS = { patientName:1, dob:1, cpt:1, diagnosis:1, insuranceCarrier:0.75, insuranceIds:0.5, complianceMetrics:0.5 };
  let score = 0; for (const k of Object.keys(anchors)) if (anchors[k]) score += WEIGHTS[k];
  // Thresholds chosen heuristically; will be refined with calibration harness later
  let baseConf = score >= 4 ? 'High' : score >= 2.5 ? 'Medium' : 'Low';

  const adjustments = [];
  // Adjust confidence by OCR quality (downgrade one tier if poor)
  if (avgConf && avgConf < 0.8) { adjustments.push({ type: 'ocr_quality_downgrade', avgConf }); baseConf = baseConf === 'High' ? 'Medium' : 'Low'; }
  if (ambiguousHandwriting && baseConf !== 'Low') {
    adjustments.push({ type: 'handwriting_downgrade' });
    baseConf = baseConf === 'High' ? 'Medium' : 'Low';
  }

  // Escalate to Manual Review when multiple uncertainties or critical missing info
  const criticalReasons = new Set(['ocr_low_confidence_critical', 'ocr_incomplete_pages', 'ocr_low_text_volume', 'ocr_handwriting_unclear']);
  const manualTriggers = result.flags.reasons.filter(r => criticalReasons.has(r) || r.startsWith('mixed_signals_'));
  if (manualTriggers.length >= 2 || (lowCrit && score < 2) || result.flags.reasons.includes('contradictory_information')) {
    baseConf = 'Manual Review';
    result.confidence = 'Manual Review';
    adjustments.push({ type: 'manual_review_escalation', triggers: manualTriggers });
  } else {
    if (result.flags.verifyManually && baseConf === 'High') { adjustments.push({ type: 'verify_manual_cap' }); baseConf = 'Medium'; }
    result.confidence = baseConf;
  }
  // Emit transparency object
  result.confidenceDetail = {
    anchors, score: Number(score.toFixed(2)), base: baseConf, avgOcrConf: Number(avgConf.toFixed(3)),
    manualTriggers, adjustments
  };

  // Authorization notes (enriched narrative + structured rationale)
  {
  const notes = [];
  const structured = [];
  const CATEGORY_MAP = {
    wrong_test_ordered: 'policy',
    review_95811_required: 'policy',
    missing_chart_notes: 'documentation',
    insurance_issue: 'carrier',
    plan_not_accepted: 'carrier',
    contract_sunset: 'carrier',
    carrier_medicare: 'carrier_policy',
    carrier_aetna: 'carrier_policy',
    carrier_anthem_bcbs: 'carrier_policy',
    carrier_uhc: 'carrier_policy',
    carrier_cigna: 'carrier_policy',
    carrier_tricare: 'carrier_policy',
    cpt_95811_without_prior_hsat: 'policy',
    positive_cardio_support: 'clinical_support'
  };
    const acts = new Set(result.alerts?.actions || []);
    const primaryIns = Array.isArray(result.insurance) ? result.insurance[0] : null;
    const carrier = primaryIns?.carrier || '';
  function add(note, tag, cond, source='heuristic', confidence='medium') {
      if (!cond) return;
      if (!notes.includes(note)) {
    notes.push(note);
    const category = CATEGORY_MAP[tag] || source;
    structured.push({ note, tag, source, confidence, category });
      }
    }
  add('Review clinical indication vs ordered test.', 'wrong_test_ordered', acts.has('wrong_test_ordered'), 'policy');
  add('Verify titration criteria for 95811.', 'review_95811_required', acts.has('review_95811_required'), 'policy');
  add('Obtain chart or progress notes.', 'missing_chart_notes', acts.has('missing_chart_notes'), 'requirement');
  add('Verify active insurance coverage / benefits.', 'insurance_issue', acts.has('insurance_issue'), 'carrier');
  add('Plan not accepted: confirm self-pay or alternate insurance.', 'plan_not_accepted', primaryIns && primaryIns.status === 'not_accepted', 'carrier', 'high');
  add('Contract nearing end; confirm authorization path.', 'contract_sunset', (primaryIns?.sunsetDays != null && primaryIns.sunsetDays <= 30 && primaryIns.sunsetDays >= 0), 'carrier', 'high');
  // Simple carrier-specific heuristics (extendable)
  const cL = carrier.toLowerCase();
  add('Medicare: Typically no prior auth for diagnostic PSG (95810); confirm local coverage if atypical.', 'carrier_medicare', cL.includes('medicare'), 'carrier');
  add('Aetna: Check policy for HSAT vs PSG criteria; document failed HSAT if escalating to in-lab.', 'carrier_aetna', cL.includes('aetna'), 'carrier');
  add('Anthem/BCBS: Prior auth may be required for in-lab studies when HSAT criteria not met.', 'carrier_anthem_bcbs', (cL.includes('anthem') || cL.includes('blue')), 'carrier');
  add('UHC: Ensure comorbidities supporting in-lab documented (cardiopulmonary, neuromuscular, hypoventilation).', 'carrier_uhc', (cL.includes('uhc') || cL.includes('united')), 'carrier');
  add('Cigna: Verify HSAT prerequisite documentation or failed trial before in-lab PSG.', 'carrier_cigna', cL.includes('cigna'), 'carrier');
  add('Tricare: Confirm referral authorization requirements and PCM involvement.', 'carrier_tricare', cL.includes('tricare'), 'carrier');
  // CPT-specific nuance
  add('Ensure documentation of failed HSAT if moving to in-lab titration.', 'cpt_95811_without_prior_hsat', (result.procedure?.cpt === '95811' && !acts.has('review_95811_required')), 'policy');
  // Positive justification: cardiovascular comorbidity supports in-lab titration when 95811 ordered and titration evidence present
  const hasCardioDxForNote = (result.diagnoses || []).some(code => /^I1\d|^I2\d|^I3\d|^I4\d|^I5\d/.test(code));
  const hasTitrationEvidenceForNote = Array.isArray(result.procedure?.providerNotes) && result.procedure.providerNotes.some(n => /titration/i.test(n));
  add('Cardiovascular comorbidity supports in-lab titration.', 'positive_cardio_support', (result.procedure?.cpt === '95811' && hasCardioDxForNote && hasTitrationEvidenceForNote), 'clinical', 'high');
  // Preauth rule-derived hints
  const preHints = Array.isArray(result.documentMeta?.preauthHints) ? result.documentMeta.preauthHints : [];
  for (const h of preHints) add(h, 'preauth_rule', true);
    if (notes.length) {
      result.documentMeta = { ...(result.documentMeta||{}), authorizationNotes: notes, authorizationNotesStructured: structured };
      trace.push({ rule: 'auth_notes_derive', count: notes.length, structured: structured.length });
    }
  }

  // Post-processing pruning: if titration evidence present and cardiovascular comorbidity, suppress wrong_test_ordered flags
  {
    const hasTitrationEvidence = Array.isArray(result.procedure?.providerNotes) && result.procedure.providerNotes.includes('titration');
    const hasCardioDx = (result.diagnoses || []).some(code => /^I\d+/.test(code));
    if (hasTitrationEvidence && hasCardioDx) {
      const beforeReasons = result.flags.reasons.length;
      result.flags.reasons = result.flags.reasons.filter(r => r !== 'wrong_test_ordered_possible');
      if (beforeReasons !== result.flags.reasons.length) trace.push({ rule: 'prune_wrong_test_for_titration_cardio' });
      if (Array.isArray(result.alerts.actions)) {
        const beforeActions = result.alerts.actions.length;
        result.alerts.actions = result.alerts.actions.filter(a => a !== 'wrong_test_ordered');
        if (beforeActions !== result.alerts.actions.length) trace.push({ rule: 'prune_wrong_test_action' });
      }
    }
  }
  // Ambiguity pruning: if home codes only mentioned and primary is non-home, drop home/inlab conflict
  if (Array.isArray(result.procedure?.cptDetails)) {
    const primaryC = String(result.procedure.cpt||'');
    const homeSet = new Set(['95806','G0399']);
    const anyHomePrimary = homeSet.has(primaryC);
    if (!anyHomePrimary) {
      const homeDetails = result.procedure.cptDetails.filter(d=>homeSet.has(d.code));
      const allMentioned = homeDetails.length && homeDetails.every(d=>d.intent==='mentioned');
      if (allMentioned) {
        if (Array.isArray(result.procedure.cptAmbiguity)) {
          const before = result.procedure.cptAmbiguity.length;
            result.procedure.cptAmbiguity = result.procedure.cptAmbiguity.filter(a=>a!=='cpt_home_and_inlab_conflict');
          if (before !== result.procedure.cptAmbiguity.length) trace.push({ rule: 'prune_home_inlab_conflict_weak' });
        }
      }
    }
  }

  // Pediatric age guard: demote pediatric CPT if patient age > 18 unless word 'pediatric' present near code
  {
    try {
      if (result.patient?.dob && result.procedure?.cpt && (result.procedure.cpt === '95782' || result.procedure.cpt === '95783')) {
        const dobParts = result.patient.dob.split('/');
        if (dobParts.length === 3) {
          const yr = parseInt(dobParts[2],10);
          if (!isNaN(yr)) {
            const age = (new Date()).getFullYear() - yr;
            if (age > 18 && !/pediatric|child|under\s*6/i.test(fullText||'')) {
              // Find next best non-pediatric primary (prefer 95810 then 95811 else first candidate)
              const altOrder = ['95810','95811'];
              const candidates = Array.isArray(result.procedure.cptCandidates) ? result.procedure.cptCandidates : [];
              let newPrimary = altOrder.find(c=>candidates.includes(c));
              if (!newPrimary && candidates.length) newPrimary = candidates.find(c=>c!=='95782'&&c!=='95783');
              if (newPrimary && newPrimary !== result.procedure.cpt) {
                const was = result.procedure.cpt;
                const wasDesc = result.procedure.description;
                result.procedure.cpt = newPrimary;
                result.procedure.cptPrimary = newPrimary;
                trace.push({ rule: 'pediatric_age_guard_demote', from: was, to: newPrimary, age });
                // Update description to match new CPT code
                const cptCatalog = getCptCatalog();
                if (cptCatalog[newPrimary] && cptCatalog[newPrimary].description) {
                  result.procedure.description = cptCatalog[newPrimary].description;
                  trace.push({ rule: 'cpt_description_updated_age_guard', from: wasDesc, to: result.procedure.description, cpt: newPrimary });
                }
                // Reinsert pediatric code in candidates order after primary
                result.procedure.cptCandidates = [newPrimary, ...candidates.filter(c=>c!==newPrimary)];
                if (Array.isArray(result.procedure.cptAmbiguity) && !result.procedure.cptAmbiguity.includes('pediatric_age_guard')) {
                  result.procedure.cptAmbiguity.push('pediatric_age_guard');
                }
              }
            }
          }
        }
      }
    } catch {}
  }

  // Inline risk scoring (triage) – aggregate heuristic flags into a numeric score & tier
  {
    const factors = new Set();
    const add = (cond, key) => { if (cond) factors.add(key); };
    const reasonsSet = new Set(result.flags.reasons || []);
    const actionsSet = new Set(result.alerts.actions || []);
    add(reasonsSet.has('wrong_test_ordered_possible'), 'wrong_test');
    add(reasonsSet.has('preauth_required_possible'), 'preauth');
    add(reasonsSet.has('ocr_low_confidence_critical'), 'ocr_low_critical');
    add(reasonsSet.has('ocr_incomplete_pages'), 'ocr_incomplete');
    add(reasonsSet.has('ocr_low_text_volume'), 'ocr_low_volume');
    add(reasonsSet.has('missing_chart_notes'), 'missing_chart_notes');
    add(reasonsSet.has('handwritten_notes_present'), 'handwritten');
    add(reasonsSet.has('complex_medical_history'), 'complex_history');
    add(reasonsSet.has('special_considerations_pediatric'), 'pediatric');
    add(reasonsSet.has('special_considerations_dme'), 'dme');
    add(reasonsSet.has('special_considerations_mobility'), 'mobility');
    for (const r of reasonsSet) if (r.startsWith('mixed_signals_')) factors.add(r);
    add(actionsSet.has('insurance_not_accepted'), 'insurance_not_accepted');
    add(actionsSet.has('review_indication'), 'review_indication');
    add(actionsSet.has('document_prior_study_evidence'), 'missing_prior_study_doc');
    add(actionsSet.has('evaluate_hsat_prerequisite'), 'hsat_prereq');
  add(actionsSet.has('verify_dme_prerequisites'), 'dme_prereq');
    // Chronic / severity influence from enriched primary diagnosis
    if (result.clinical?.primaryDiagnosis) {
      if (result.clinical.primaryDiagnosis.chronic === true) add(true, 'chronic_condition');
      const sev = (result.clinical.primaryDiagnosis.severity || '').toLowerCase();
      if (sev === 'severe') add(true, 'severity_severe');
      else if (sev === 'moderate') add(true, 'severity_moderate');
    }
    // Score weights
    let score = 0;
    const weightMap = {
      wrong_test: 3, preauth: 2, ocr_low_critical: 2, ocr_incomplete: 2, ocr_low_volume: 2,
      missing_chart_notes: 2, handwritten: 1, complex_history: 2, pediatric: 1, dme: 1,
      mobility: 1, insurance_not_accepted: 2, review_indication: 2, missing_prior_study_doc: 2,
      hsat_prereq: 1,
  dme_prereq: 2,
      chronic_condition: 1, // mild additive risk due to longer coordination complexity
      severity_moderate: 1,
      severity_severe: 2
    };
    for (const f of factors) score += (weightMap[f] || 1);
    // Tiering
    let tier = 'low';
    if (score >= 8) tier = 'high'; else if (score >= 4) tier = 'medium';
    // Escalate to high if confidence already Manual Review
    if (result.confidence === 'Manual Review' && score >= 4 && tier !== 'high') tier = 'high';
    result.risk = { score, tier, factors: Array.from(factors).sort() };
    trace.push({ rule: 'risk_score_compute', score, tier, factors: result.risk.factors.length });
  }

  // Apply learned corrections from corrections database (Step 3)
  try {
    // Insurance carrier
    if (result.insurance[0]?.carrier) {
      const corrected = applyFieldCorrection('carrier', result.insurance[0].carrier, correctionsDB);
      if (corrected !== result.insurance[0].carrier) {
        trace.push({ 
          rule: 'learned_correction_carrier', 
          from: result.insurance[0].carrier, 
          to: corrected 
        });
        result.insurance[0].carrier = corrected;
      }
    }
    
    // CPT code
    if (result.procedure?.cpt) {
      const corrected = applyFieldCorrection('cpt', result.procedure.cpt, correctionsDB);
      if (corrected !== result.procedure.cpt) {
        trace.push({ 
          rule: 'learned_correction_cpt', 
          from: result.procedure.cpt, 
          to: corrected 
        });
        result.procedure.cpt = corrected;
        // Update description to match new CPT code
        const cptCatalog = getCptCatalog();
        const catalogEntry = cptCatalog[corrected];
        if (catalogEntry?.description) {
          trace.push({
            rule: 'cpt_description_updated',
            from: result.procedure.description || 'none',
            to: catalogEntry.description
          });
          result.procedure.description = catalogEntry.description;
        }
      }
    }
    
    // Re-check titration flag after CPT corrections
    if (result.procedure?.cpt === '95811') {
      const allCpts = cpt?.candidates ? cpt.candidates.map(c => c.code) : [];
      const priorStudy = hasPriorStudyEvidence(fullText || '', allCpts);
      const hasCpapContext = hasCpapTitrationContext(fullText || '');
      
      if (priorStudy.found && !hasCpapContext && !result.flags.reasons.includes('titration_requires_clinical_review')) {
        result.flags.verifyManually = true;
        result.flags.reasons.push('titration_requires_clinical_review');
        result.alerts.actions = Array.from(new Set([...(result.alerts.actions || []), 'review_titration_justification']));
        trace.push({
          rule: 'titration_requires_clinical_review',
          timing: 'post_corrections',
          priorStudyCpts: priorStudy.cpts,
          priorStudyKeywords: priorStudy.keywords,
          missingJustification: 'no_cpap_failure_or_intolerance_documented'
        });
      }
    }
    
    // Provider name - DISABLED to test raw OCR extraction
    // if (result.provider?.name) {
    //   const corrected = applyFieldCorrection('provider', result.provider.name, correctionsDB);
    //   if (corrected !== result.provider.name) {
    //     trace.push({ 
    //       rule: 'learned_correction_provider', 
    //       from: result.provider.name, 
    //       to: corrected 
    //     });
    //     result.provider.name = corrected;
    //   }
    // }
    
    // Practice name
    if (result.provider?.practice) {
      const corrected = applyFieldCorrection('practiceName', result.provider.practice, correctionsDB);
      if (corrected !== result.provider.practice) {
        trace.push({ 
          rule: 'learned_correction_practice', 
          from: result.provider.practice, 
          to: corrected 
        });
        result.provider.practice = corrected;
      }
    }
    
    // Provider phone
    if (result.provider?.phone) {
      const corrected = applyFieldCorrection('phone', result.provider.phone, correctionsDB);
      if (corrected !== result.provider.phone) {
        trace.push({
          rule: 'learned_correction_provider_phone',
          from: result.provider.phone,
          to: corrected
        });
        result.provider.phone = corrected;
      }
    }

    // Provider fax
    if (result.provider?.fax) {
      const corrected = applyFieldCorrection('fax', result.provider.fax, correctionsDB);
      if (corrected !== result.provider.fax) {
        trace.push({
          rule: 'learned_correction_provider_fax',
          from: result.provider.fax,
          to: corrected
        });
        result.provider.fax = corrected;
      }
    }

    // Fallback: If provider phone was not detected from OCR, try learned phone by provider/practice
    // Conservative: require high confidence OR >=3 occurrences, and NANP-valid, to avoid cross-document leakage
    if (!result.provider?.phone) {
      const provName = result.provider?.name || null;
      const practice = result.provider?.practice || null;
      let learnedPhone = null;
      const minHighConfidence = 0.9;
      if (provName) {
        const detail = correctionsDB.getCorrectionDetail('referringPhone', provName);
        if (detail && detail.text) {
          const pass = (typeof detail.confidence === 'number' && detail.confidence >= minHighConfidence) || (typeof detail.topCount === 'number' && detail.topCount >= 3);
          if (pass) {
            learnedPhone = detail.text;
            trace.push({ rule: 'learned_provider_phone_from_name', to: detail.text, confidence: detail.confidence, occurrences: detail.topCount, source: detail.source || 'corrections_db' });
          } else {
            trace.push({ rule: 'learned_provider_phone_rejected_threshold_name', candidate: detail.text, confidence: detail.confidence ?? null, occurrences: detail.topCount ?? null });
          }
        }
      }
      if (!learnedPhone && practice) {
        const detail2 = correctionsDB.getCorrectionDetail('referringPhone', practice);
        if (detail2 && detail2.text) {
          const pass2 = (typeof detail2.confidence === 'number' && detail2.confidence >= minHighConfidence) || (typeof detail2.topCount === 'number' && detail2.topCount >= 3);
          if (pass2) {
            learnedPhone = detail2.text;
            trace.push({ rule: 'learned_provider_phone_from_practice', to: detail2.text, confidence: detail2.confidence, occurrences: detail2.topCount, source: detail2.source || 'corrections_db' });
          } else {
            trace.push({ rule: 'learned_provider_phone_rejected_threshold_practice', candidate: detail2.text, confidence: detail2.confidence ?? null, occurrences: detail2.topCount ?? null });
          }
        }
      }
      if (learnedPhone) {
        // final validation: basic NANP formatting
        const digits = String(learnedPhone || '').replace(/\D/g, '');
        if (digits.length === 10 && isValidNANP(digits)) {
          result.provider.phone = learnedPhone;
          trace.push({ rule: 'learned_provider_phone_applied', to: learnedPhone });
        } else {
          trace.push({ rule: 'learned_provider_phone_rejected_format', candidate: learnedPhone });
        }
      }
    }
  } catch (err) {
    console.warn('[runExtraction] Failed to apply learned corrections:', err.message);
  }

  // Harmonize CPT description to match final CPT code (guard against stale descriptions)
  try {
    if (result.procedure?.cpt) {
      // Load the catalog array directly and find the matching entry
      const cptCatalogArray = loadJsonConfig('cpt_catalog.json', { 
        defaultFactory: () => [],
        transform: (arr) => Array.isArray(arr) ? arr : []
      });
      const catalogEntry = cptCatalogArray.find(entry => entry.code === result.procedure.cpt);
      // Fallback static map if catalog is missing or incomplete
      const CPT_FALLBACK = {
        '95810': 'In-lab diagnostic polysomnography',
        '95811': 'In-lab PAP titration / split-night polysomnography',
        '95806': 'Home sleep apnea test (HSAT)',
        'G0399': 'Home sleep apnea test (Type III) - alternative code',
        '95782': 'Pediatric in-lab polysomnography',
        '95783': 'Pediatric PAP titration',
        '95805': 'MSLT / MWT daytime sleep testing',
        '99245': 'Office consultation (80 minutes)'
      };
      const finalDesc = (catalogEntry && catalogEntry.description) ? catalogEntry.description : CPT_FALLBACK[result.procedure.cpt];
      if (finalDesc) {
        if (finalDesc !== result.procedure.description) {
          trace.push({ rule: 'cpt_description_harmonize', from: result.procedure.description || null, to: finalDesc, cpt: result.procedure.cpt });
          result.procedure.description = finalDesc;
        } else {
          trace.push({ rule: 'cpt_description_harmonize_keep', cpt: result.procedure.cpt });
        }
      } else {
        trace.push({ rule: 'cpt_description_harmonize_unavailable', cpt: result.procedure.cpt, catalogSize: cptCatalogArray.length });
      }
    }
  } catch (e) {
    trace.push({ rule: 'cpt_description_harmonize_error', error: e.message, stack: e.stack });
  }

  return { result, trace };
}

function getPreauthRules() {
  return loadJsonConfig('preauth_rules.json', {
    transform: rules => (Array.isArray(rules) ? rules : []),
    defaultFactory: () => []
  });
}

// After extraction, enrich with normalized dates
export async function runExtractionWithDates(ocrPages) {
  const { result, trace } = await runExtraction(ocrPages);
  try {
    const fullText = (ocrPages || []).map(p => p.text || '').join('\n');
    const dates = detectDates(fullText);
    if (dates.length) {
      // Promote likely order/referral date
      const order = dates.find(d => d.type === 'order') || dates.find(d => d.type === 'referral');
      const study = dates.find(d => d.type === 'study');
      result.documentMeta = {
        ...(result.documentMeta||{}),
        dates,
        orderDate: order?.value,
        studyDate: study?.value
      };
      trace.push({ rule: 'dates_detect', count: dates.length, order: order?.value || null, study: study?.value || null });
    }
  } catch (e) {
    trace.push({ rule: 'dates_detect_error', error: e.message });
  }
  return { result, trace };
}
