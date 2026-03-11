/**
 * payerCriteria.js — Payer identification and criteria chain resolution
 * 
 * Maps extracted carrier name → payer_router.json → payer_id → payer_*.json
 * Produces: auth requirements, submission info, coverage rules, flags
 */

import { getPayerRouter, getPayerCriteriaMap } from '../../kbLoader.js';
import { log } from '../../logging/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, '..', '..', 'data', 'kb');

// Cache loaded payer files
const payerFileCache = new Map();

function loadPayerFile(payerId) {
  if (payerFileCache.has(payerId)) return payerFileCache.get(payerId);
  const filePath = path.join(KB_DIR, `payer_${payerId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payerFileCache.set(payerId, data);
    return data;
  } catch {
    payerFileCache.set(payerId, null);
    return null;
  }
}

/**
 * Resolve a carrier name (from OCR extraction) to a payer_id via the router.
 * Uses 3 strategies: exact match, substring match, fuzzy match.
 * 
 * @param {string} carrierName - Extracted carrier name (may be OCR-garbled)
 * @returns {{ payerId: string, notes: string, confidence: string }|null}
 */
export function resolvePayerId(carrierName) {
  if (!carrierName) return null;
  const router = getPayerRouter();
  if (!router?.layer_1_name_routes) return null;

  const routes = router.layer_1_name_routes;
  const normalized = carrierName.toLowerCase().trim();

  // Strategy 1: exact match
  if (routes[normalized]) {
    return { ...routes[normalized], confidence: 'exact', matchedName: normalized };
  }

  // Strategy 2: substring match — check if any route key is contained in the carrier name or vice versa
  for (const [key, val] of Object.entries(routes)) {
    if (key.startsWith('_')) continue;
    if (normalized.includes(key) || key.includes(normalized)) {
      return { ...val, confidence: 'substring', matchedName: key };
    }
  }

  // Strategy 3: word overlap — find best match by shared words
  const inputWords = new Set(normalized.split(/\s+/).filter(w => w.length > 2));
  let bestMatch = null;
  let bestOverlap = 0;
  for (const [key, val] of Object.entries(routes)) {
    if (key.startsWith('_')) continue;
    const keyWords = new Set(key.split(/\s+/).filter(w => w.length > 2));
    const overlap = [...inputWords].filter(w => keyWords.has(w)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = { ...val, confidence: 'fuzzy', matchedName: key };
    }
  }
  if (bestMatch && bestOverlap >= 1) return bestMatch;

  return null;
}

/**
 * Resolve a member ID pattern to payer_id (Layer 2 of payer_router).
 * @param {string} memberId - Member ID string
 * @returns {{ payerId: string, confidence: string }|null}
 */
export function resolvePayerByMemberId(memberId) {
  if (!memberId) return null;
  const router = getPayerRouter();
  const patterns = router?.layer_2_pattern_detection?.id_format_patterns;
  if (!patterns) return null;

  for (const [, rule] of Object.entries(patterns)) {
    if (!rule.regex) continue;
    try {
      if (new RegExp(rule.regex).test(memberId)) {
        return { payerId: rule.route_to, confidence: rule.confidence || 'medium', pattern: rule.description };
      }
    } catch { /* invalid regex in data */ }
  }
  return null;
}

/**
 * Load full payer criteria given a payer_id.
 * Tries payer_<id>.json first, falls back to payer_criteria_map.json.
 * 
 * @param {string} payerId
 * @returns {Object|null} Payer criteria including coverage, submission, flags
 */
export function loadPayerCriteria(payerId) {
  if (!payerId) return null;
  // Try dedicated payer file first
  const payerFile = loadPayerFile(payerId);
  if (payerFile) return payerFile;

  // Fallback to legacy criteria map
  const criteriaMap = getPayerCriteriaMap();
  if (!criteriaMap?.payers) return null;
  // Try to find by payer_id match in the criteria map keys (case-insensitive)
  for (const [key, val] of Object.entries(criteriaMap.payers)) {
    if (key.toLowerCase().replace(/\s+/g, '_') === payerId || key.toLowerCase() === payerId) {
      return val;
    }
  }
  return null;
}

/**
 * Full payer assessment: carrier name → payer_id → criteria → coverage for given CPT.
 * 
 * @param {Object} result - Extraction result
 * @returns {{ payerId, payerName, criteria, coverage, submission, flags, authRequired }}
 */
export function assessPayer(result) {
  const carrier = result?.insurance?.[0]?.carrier;
  const memberId = result?.insurance?.[0]?.memberId;
  const cpt = result?.procedure?.cpt;

  // Resolve payer ID
  let resolution = resolvePayerId(carrier);
  if (!resolution && memberId) {
    const byId = resolvePayerByMemberId(memberId);
    if (byId) resolution = { payer_id: byId.payerId, notes: byId.pattern, confidence: byId.confidence };
  }
  if (!resolution) {
    return {
      payerId: null,
      payerName: carrier || 'Unknown',
      criteria: null,
      coverage: null,
      submission: null,
      authRequired: null,
      flags: [{ id: 'FLAG_UNKNOWN_PAYER', severity: 3, label: 'FLAG', action: `Unknown payer "${carrier || 'none'}". Call for benefits.` }]
    };
  }

  const payerId = resolution.payer_id;
  const criteria = loadPayerCriteria(payerId);
  const flags = [];

  // Get coverage for the specific CPT code
  let coverage = null;
  let authRequired = null;
  if (criteria && cpt) {
    const codes = criteria.coverage || criteria.codes;
    if (codes?.[cpt]) {
      coverage = codes[cpt];
      authRequired = coverage.auth_required ?? null;
    }
  }

  // Pull submission info
  const submission = criteria?.submission || null;

  // Merge flags from payer file
  if (criteria?.flags) {
    for (const f of criteria.flags) {
      if (typeof f === 'string') {
        // Criteria map format: flags are plain string IDs
        flags.push({ id: f, severity: 3, label: 'FLAG', action: f });
      } else {
        flags.push({
          id: f.flag_id || f.id,
          severity: typeof f.severity_tier === 'number' ? f.severity_tier : 3,
          label: f.severity_label || 'FLAG',
          action: f.human_action || f.message || f.description || ''
        });
      }
    }
  }

  // Special rules
  if (criteria?.special_rules) {
    for (const rule of criteria.special_rules) {
      flags.push({ id: rule.rule_id, severity: 4, label: 'ALERT', action: rule.action || rule.description });
    }
  }

  log('info', 'payer_resolved', { carrier, payerId, confidence: resolution.confidence, cpt, authRequired });

  return {
    payerId,
    payerName: criteria?._meta?.payer_name || carrier,
    criteria,
    coverage,
    submission,
    authRequired,
    flags
  };
}
