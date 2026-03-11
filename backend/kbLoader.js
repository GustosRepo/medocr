/**
 * kbLoader.js — Knowledge Base data loader
 * 
 * Loads and caches JSON files from backend/data/kb/ at startup.
 * Provides accessor functions for each KB dataset so other modules
 * don't need to deal with file paths or parsing.
 * 
 * File-watch: uses mtime-based cache (same pattern as rules/utils/configLoader.js).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_DIR = path.join(__dirname, 'data', 'kb');

const cache = new Map();

function loadKb(filename) {
  const abs = path.join(KB_DIR, filename);
  try {
    const stat = fs.statSync(abs);
    const cached = cache.get(abs);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.value;
    }
    const raw = fs.readFileSync(abs, 'utf8');
    const value = JSON.parse(raw);
    cache.set(abs, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch (err) {
    if (cache.has(abs)) return cache.get(abs).value;
    console.warn(`[kbLoader] Failed to load ${filename}: ${err.message}`);
    return null;
  }
}

// ─── Accessor functions ──────────────────────────────────────

export function getInsurance() {
  return loadKb('insurance.json');
}

export function getCptKeywords() {
  return loadKb('cpt_keywords.json');
}

export function getFacilityConfig() {
  return loadKb('facility_config.json');
}

export function getSignaturePatterns() {
  return loadKb('signature_patterns.json');
}

export function getPayerRouter() {
  return loadKb('payer_router.json');
}

export function getPayerCriteriaMap() {
  return loadKb('payer_criteria_map.json');
}

export function getInsuranceAllowables() {
  return loadKb('insurance_allowables.json');
}

export function getBcbsPrefixDb() {
  return loadKb('bcbs_prefix_database.json');
}

export function getBcbsRoutingRules() {
  return loadKb('bcbs_routing_rules.json');
}

export function getNonBcbsOperationalRules() {
  return loadKb('nonbcbs_operational_rules.json');
}

export function getBusinessRules() {
  return loadKb('business_rules.json');
}

export function getMaRoutingRules() {
  return loadKb('ma_routing_rules.json');
}

export function getUnknownPayerProtocol() {
  return loadKb('unknown_payer_protocol.json');
}

export function getContraindications() {
  return loadKb('contraindications.json');
}

export function getFlagsCatalog() {
  return loadKb('flags_catalog_tree_v0_19_3.json');
}

export function getCptSelector() {
  return loadKb('cpt_selector_FIXED.json');
}

export function getIcd10Curated() {
  return loadKb('icd10_curated.json');
}

export function getIcd10Master() {
  return loadKb('icd10_master_fy2026.json');
}

export function getEligibilityCombinations() {
  return loadKb('eligibility_combinations.json');
}

export function getReferralKeywords() {
  return loadKb('referral_keywords.json');
}

export function getFilenameClassification() {
  return loadKb('filename_classification.json');
}

// ─── Prompt-building helpers ─────────────────────────────────

/**
 * Build a compact carrier list string for LLM prompt injection.
 * Returns the accepted + doNotAccept lists as a short text block.
 */
export function buildInsurancePromptBlock() {
  const ins = getInsurance();
  if (!ins) return '';

  const accepted = (ins.accepted || []).filter(s => typeof s === 'string' && s.length > 1);
  const dna = (ins.doNotAccept || []).filter(s => typeof s === 'string' && s.length > 1);

  if (accepted.length === 0) return '';

  const lines = [
    'KNOWN INSURANCE CARRIERS (match OCR-garbled text to the closest name below):',
    `Accepted: ${accepted.join(', ')}`,
  ];
  if (dna.length > 0) {
    lines.push(`Not accepted (flag if detected): ${dna.join(', ')}`);
  }
  return '\n' + lines.join('\n') + '\n';
}

/**
 * Build a CPT keyword mapping block for the LLM prompt.
 * Only includes sleep-related CPTs to keep it concise.
 */
export function buildCptKeywordsPromptBlock() {
  const kw = getCptKeywords();
  if (!kw) return '';

  const sleepCodes = ['95782', '95783', '95805', '95806', '95810', '95811', 'G0398', 'G0399'];
  const lines = ['CPT CODE KEYWORD REFERENCE (if you see these phrases, extract the matching CPT):'];
  for (const code of sleepCodes) {
    const keywords = kw[code];
    if (keywords && keywords.length > 0) {
      lines.push(`  ${code}: ${keywords.slice(0, 8).join(', ')}`);
    }
  }
  if (lines.length === 1) return '';
  return '\n' + lines.join('\n') + '\n';
}

/**
 * Build a facility exclusion block for the LLM prompt.
 * Tells the LLM which phone/fax/NPI values belong to the facility and should NOT
 * be assigned to the referring provider.
 */
export function buildFacilityExclusionPromptBlock() {
  const fac = getFacilityConfig();
  if (!fac) return '';

  const excl = fac.ocr_exclusion_filter?.exclude_from_provider_fields;
  if (!excl) return '';

  const parts = [];

  const phones = (excl.phone_numbers || []).filter(s => !s.startsWith('PLACEHOLDER'));
  const faxes = (excl.fax_numbers || []).filter(s => !s.startsWith('PLACEHOLDER'));
  const npis = (excl.npi_numbers || []).filter(s => !s.startsWith('PLACEHOLDER'));
  const names = (excl.entity_names || []).filter(s => !s.startsWith('PLACEHOLDER'));

  if (phones.length) parts.push(`  Facility phones (NOT provider): ${phones.join(', ')}`);
  if (faxes.length) parts.push(`  Facility faxes (NOT provider): ${faxes.join(', ')}`);
  if (npis.length) parts.push(`  Facility NPIs (NOT provider): ${npis.join(', ')}`);
  if (names.length) parts.push(`  Facility names (NOT provider practice): ${names.join(', ')}`);

  if (parts.length === 0) return ''; // All PLACEHOLDERs — skip until client fills them

  return '\nFACILITY SELF-IDENTIFICATION (these values belong to THIS facility — do NOT assign them to the referring provider):\n' + parts.join('\n') + '\n';
}

/**
 * Build a credential tier block for the LLM prompt.
 * Helps the LLM flag ordering authority issues during extraction.
 */
export function buildCredentialTiersPromptBlock() {
  const sig = getSignaturePatterns();
  if (!sig?.credentials) return '';

  const creds = sig.credentials;
  const lines = ['PROVIDER CREDENTIAL TIERS (extract the credential and note the ordering authority):'];

  if (creds.can_order_independently?.titles) {
    lines.push(`  Can order independently: ${creds.can_order_independently.titles.join(', ')}`);
  }
  if (creds.mid_level_may_need_supervising?.titles) {
    lines.push(`  Mid-level (may need supervising MD): ${creds.mid_level_may_need_supervising.titles.join(', ')}`);
  }
  if (creds.cannot_order?.titles) {
    lines.push(`  Cannot order (invalid signature): ${creds.cannot_order.titles.join(', ')}`);
  }

  if (lines.length === 1) return '';
  return '\n' + lines.join('\n') + '\n';
}

/**
 * Build the complete KB context block to inject into the LLM extraction prompt.
 * Combines all 4 Layer 1 blocks. Returns empty string if no KB data is available.
 */
export function buildKbPromptContext() {
  const blocks = [
    buildInsurancePromptBlock(),
    buildCptKeywordsPromptBlock(),
    buildFacilityExclusionPromptBlock(),
    buildCredentialTiersPromptBlock(),
  ].filter(b => b.length > 0);

  if (blocks.length === 0) return '';

  return '\n--- KNOWLEDGE BASE CONTEXT ---' + blocks.join('') + '--- END KNOWLEDGE BASE CONTEXT ---\n';
}

// ─── Startup validation ──────────────────────────────────────

export function validateKbAtStartup() {
  const results = [];
  const critical = [
    'insurance.json', 'cpt_keywords.json', 'facility_config.json',
    'signature_patterns.json', 'payer_router.json', 'payer_criteria_map.json',
    'flags_catalog_tree_v0_19_3.json', 'insurance_allowables.json',
    'bcbs_prefix_database.json', 'bcbs_routing_rules.json', 'nonbcbs_operational_rules.json', 'business_rules.json', 'ma_routing_rules.json', 'unknown_payer_protocol.json', 'contraindications.json', 'cpt_selector_FIXED.json',
    'icd10_curated.json', 'icd10_master_fy2026.json', 'eligibility_combinations.json', 'referral_keywords.json'
  ];

  for (const file of critical) {
    const data = loadKb(file);
    results.push({ file, ok: data !== null });
  }

  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok);

  console.log(`[kbLoader] KB validation: ${ok}/${results.length} files loaded`);
  if (fail.length > 0) {
    console.warn('[kbLoader] Missing KB files:', fail.map(r => r.file).join(', '));
  }

  return { ok: ok === results.length, results };
}
