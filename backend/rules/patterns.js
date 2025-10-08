import { createRequire } from 'module';
import { loadJsonConfig } from './utils/configLoader.js';

const require = createRequire(import.meta.url);
const symptomDefaults = require('./data/symptom_vocab.json');

// Centralized regex and pattern configurations to reduce duplication.
// Grouped by domain: patient, procedure, clinical, insurance, infoAlerts.

const SYMPTOM_DEFAULTS = Array.isArray(symptomDefaults) ? symptomDefaults : [];

const SYMPTOM_FAMILY_CONTEXT_RE = /(family\s+history|\bfh[:\s]|\bfhx\b)/i;
const SYMPTOM_THIRD_PARTY_RE = /(mother|father|sister|brother|grandmother|grandfather|spouse|husband|wife|partner|child|son|daughter|kids|roommate|friend|coworker|colleague|neighbor)/i;
const SYMPTOM_PATIENT_TOKEN_RE = /(patient|pt)\b/i;
const SYMPTOM_CONDITIONAL_RE = /(if\s+patient|should\s+patient|would\s+indicate|rule\s+out|consider(?:ed)?|possible\b|maybe\b|might\b|could\b|to\s+be\s+evaluated|for\s+consideration|assess\s+for|differential\s+includes)/i;
const SYMPTOM_EDUCATIONAL_RE = /(sleep\s+apnea\s+is|symptoms\s+include|studies\s+indicate|literature\s+shows|patient\s+education|handout|brochure|definition:|examples:|generally|usually|commonly|often|check\s+all\s+that\s+apply|circle\s+one|mark\s+if\s+present|instructions:|please\s+indicate)/i;
const SYMPTOM_HISTORY_RE = /(history\s+of|hx\s+of|past\s+history|previously|former|used\s+to|remote\s+history|past\s+medical\s+history|\bpmh\b)/i;
const SYMPTOM_HISTORY_OVERRIDE_RE = /(still|ongoing|continues|currently|active|now|persists|persistent)/i;
const SYMPTOM_RESOLUTION_RE = /(resolved|no\s+longer|discontinued|stopped|was\s+on|had\s+been|off\s+cpap|quit\s+therapy|previously\s+treated)/i;
const SYMPTOM_MEDICATION_PATTERNS = [
  /(oxycodone|morphine|fentanyl|hydrocodone|percocet|vicodin|opioid|pain\s+medication)/i,
  /(lisinopril|metoprolol|amlodipine|bp\s+meds?|ace\s+inhibitor|beta\s+blocker|diuretic)/i,
  /(ambien|trazodone|melatonin|sleep\s+aid|antidepressant|anxiety\s+medication|benzodiazepine)/i
];
const SYMPTOM_TEST_RESULT_RE = /(previous\s+sleep\s+study|prior\s+psg|last\s+test|results\s+indicate|findings\s+show|report\s+states|ahi\s+was|rdi|oxygen\s+sat|desaturation|study\s+revealed|testing\s+showed|sleep\s+study)/i;

function buildRegex(patterns) {
  if (!Array.isArray(patterns)) return null;
  const cleaned = patterns
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  if (!cleaned.length) return null;
  const source = cleaned.length === 1 ? cleaned[0] : `(?:${cleaned.join(')|(?:')})`;
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

function compileSymptomEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const compiled = [];
  for (const entry of entries) {
    const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
    if (!label) continue;
    const posRegex = buildRegex(entry?.positive);
    if (!posRegex) continue;
    const negRegex = buildRegex(entry?.negative);
    compiled.push([label, posRegex, negRegex]);
  }
  return compiled;
}

function loadSymptomConfig() {
  const loaded = loadJsonConfig('symptom_vocab.json', {
    transform: compileSymptomEntries,
    defaultFactory: () => compileSymptomEntries(SYMPTOM_DEFAULTS)
  });
  if (Array.isArray(loaded) && loaded.length) return loaded;
  return compileSymptomEntries(SYMPTOM_DEFAULTS);
}

export const PATTERNS = {
  RELATIONSHIP_TOKENS: /(mother|father|parent|guardian|sister|brother|spouse|wife|husband|daughter|son|caregiver|friend|aunt|uncle|cousin)/i,
  TITRATION_CRITERIA: /(pressure\s*too\s*(high|low)|not\s*tolerating\s*(cpap|pressure)|failed\s*(cpap|pap|apap)|needs?\s*(pressure|settings)|still\s*tired\s*on\s*cpap|titration|pressures?\s*adjusted|urgent\/?stat\s+titration)/i,
  get SYMPTOM_CONFIG() {
    return loadSymptomConfig();
  },
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
};

// Utility accessor to future-proof pattern evolution.
export function getPattern(name) {
  return PATTERNS[name];
}
