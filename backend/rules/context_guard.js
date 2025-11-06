// Centralized context/section heuristics ("context guard")
// Provides small, composable helpers used by patient/provider detectors
// to avoid cross-leakage and to recognize header-like and provider-like lines.

import { loadJsonConfig } from './utils/configLoader.js';

// Default patterns mirror existing inline guards in patient.js and index.js,
// but are centralized here and can be extended via pattern_overrides.json
const DEFAULTS = {
  nonPersonLineRegex: [
    'fax','efax','referral','order','clinic','medical','services','sleep','home','information','summary',
    'patient information','patient summary','provider','insurance','authorization','request','signature','physician',
    'doctor','practice','department','center','hospital','imaging','lab','laboratory','durable','equipment','dme',
    'specialty','pages','cover sheet','attention','attn','subject','re:','from:',
    'preferred language','language preferred','reply please','see please','please reply','please see',
    'language of correspondence','preferred contact','fax cover','patient instructions','patient notes',
    'documentation supporting','sleep studies','home sleep','sleep study','study sleep','medical group',
    'medical center','home care','care team','front desk','forwarding','forwarded','referred'
  ],
  nonPersonTokensStrict: [
    'fax','efax','referral','order','orders','summary','information','info','patient','provider','practice','clinic',
    'medical','medicine','services','service','sleep','home','unknown','report','reports','signature','signed',
    'physician','doctor','md','do','pa','np','rn','llc','inc','corp','company','group','center','centre',
    'hospital','imaging','lab','laboratory','department','specialty','care','health','insurance','authorization',
    'auth','request','requests','from','to','re','attention','attn','unit','units','npi','id','member','policy',
    'patientinformation','patientinfo'
  ],
  addressStop: [
    'road','rd','street','st','suite','ste','ave','avenue','blvd','drive','dr','court','ct','lane','ln',
    'circle','cir','parkway','pkwy','apt','apartment','unit','floor','fl','highway','hwy','way','terrace','ter',
    'place','pl','north','south','east','west','n','s','e','w','city','state','zip','address','phone','fax'
  ],
  providerLineRegex: [
    'ordering\s*(provider|physician)','referring\s*(provider|physician)','attending\s*(provider|physician)',
    '\bprovider\b','\bprovder\b','\bphysician\b','\bnpi\b','\bdr\.?\b',
    'from\s+provider','from\s+provder','from\s+company','from\s+facility'
  ],
  faxRegex: ['(^|\b)(fax|fx|facsimile)\b','(^|\b)f[ao0@][xk](?![a-z])']
};

function buildPatterns() {
  // Load patient_config.json (data lists) if present
  const patientCfg = loadJsonConfig('patient_config.json', { defaultFactory: () => ({}) }) || {};
  const overrides = loadJsonConfig('pattern_overrides.json', { defaultFactory: () => ({}) }) || {};

  const pick = (key, fallback) => {
    const fromCfg = Array.isArray(patientCfg[key]) ? patientCfg[key] : null;
    const fromOv = Array.isArray(overrides[key]) ? overrides[key] : null;
    return (fromOv || fromCfg || fallback).map(s => String(s || ''));
  };

  const nonPersonLineRegex = pick('nonPersonLineRegex', DEFAULTS.nonPersonLineRegex);
  const nonPersonTokensStrict = pick('nonPersonTokensStrict', DEFAULTS.nonPersonTokensStrict);
  const addressStop = pick('addressStop', DEFAULTS.addressStop);
  const providerLineRegex = pick('providerLineRegex', DEFAULTS.providerLineRegex);
  const faxRegex = pick('faxRegex', DEFAULTS.faxRegex);

  // Precompile as regexes (case-insensitive)
  const reHeader = new RegExp(`(${nonPersonLineRegex.map(escapeReg).join('|')})`, 'i');
  const reProvider = new RegExp(`(${providerLineRegex.map(escapeReg).join('|')})`, 'i');
  const reFax = new RegExp(`(${faxRegex.map(escapeReg).join('|')})`, 'i');

  return { nonPersonLineRegex, nonPersonTokensStrict, addressStop, providerLineRegex, faxRegex, reHeader, reProvider, reFax };
}

function escapeReg(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cached patterns (reload if config loader invalidates cache upstream)
let _pat = null;
function getPat() { if (!_pat) _pat = buildPatterns(); return _pat; }

export function isHeaderLine(line) {
  const { reHeader } = getPat();
  const L = String(line || '');
  return reHeader.test(L);
}

export function isNonPatientLine(line) {
  const { nonPersonTokensStrict } = getPat();
  const L = String(line || '').toLowerCase();
  return nonPersonTokensStrict.some(tok => tok && L.includes(tok));
}

export function isLikelyProviderLine(line) {
  const { reProvider } = getPat();
  return reProvider.test(String(line || ''));
}

export function isFaxLike(line) {
  const { reFax } = getPat();
  return reFax.test(String(line || ''));
}

export function isFromHeaderLine(line) {
  return /^\s*from\b/i.test(String(line || ''));
}

export function stripAddressTail(str) {
  const { addressStop } = getPat();
  const s = String(str || '');
  if (!s) return s;
  const lower = s.toLowerCase();
  let cut = -1;
  for (const t of addressStop) {
    const i = lower.indexOf(t);
    if (i >= 0) cut = cut === -1 ? i : Math.min(cut, i);
  }
  return cut >= 0 ? s.slice(0, cut).trim() : s;
}

export function windowAround(lines, idx, before = 1, after = 1) {
  const arr = Array.isArray(lines) ? lines : [];
  const start = Math.max(0, idx - before);
  const end = Math.min(arr.length, idx + after + 1);
  return arr.slice(start, end).join(' ').toLowerCase();
}

export function hasPatientContext(ctx) {
  const c = String(ctx || '').toLowerCase();
  return /patient\b|pt\b|patient\s*(information|contact|phone)/i.test(c);
}

// Optional reset if upstream invalidates config cache
export function _resetGuardCache() { _pat = null; }

// Check if a single token (word-ish) is a known non-person token
export function isNonPersonToken(token) {
  const { nonPersonTokensStrict } = getPat();
  const t = String(token || '').toLowerCase().trim();
  if (!t) return false;
  return nonPersonTokensStrict.includes(t);
}

// Provide a simple context scoring for tunable thresholds in detectors
// Returns flags plus an aggregate score (higher => more non-patient/provider header-like)
export function contextScore(line) {
  const L = String(line || '');
  const header = isHeaderLine(L) ? 1 : 0;
  const provider = isLikelyProviderLine(L) ? 1 : 0;
  const fax = isFaxLike(L) ? 1 : 0;
  const patient = hasPatientContext(L) ? 1 : 0;
  const nonPatient = isNonPatientLine(L) ? 1 : 0;
  const score = header * 2 + provider * 2 + fax + nonPatient - patient;
  return { header, provider, fax, patient, nonPatient, score };
}
