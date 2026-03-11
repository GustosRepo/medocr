/**
 * flagEngine.js — Flag Aggregation, Deduplication & Severity Sorting
 * 
 * Collects flags from all KB assessment modules, deduplicates by flag ID,
 * sorts by severity (STOP=1 first → INFO=5 last), and enriches with
 * human action text from flags_catalog_tree_v0_19_3.json.
 * 
 * Severity tiers:
 *   1 = STOP    — blocks processing
 *   2 = PENDING — paused, waiting for input
 *   3 = FLAG    — continues but human action required
 *   4 = ALERT   — informational warning
 *   5 = INFO    — logged for awareness
 */

import { getFlagsCatalog } from '../../kbLoader.js';

// Build a quick lookup map from the flags catalog (lazy-init)
let flagCatalogMap = null;

function getCatalogMap() {
  if (flagCatalogMap) return flagCatalogMap;
  const catalog = getFlagsCatalog();
  if (!catalog?.flags) return new Map();
  flagCatalogMap = new Map();
  for (const f of catalog.flags) {
    flagCatalogMap.set(f.id, f);
  }
  return flagCatalogMap;
}

/**
 * Enrich a flag with catalog data (description, human_action, source_module).
 * If the flag ID exists in the catalog, merge catalog fields onto it.
 * 
 * @param {Object} flag - { id, severity, label, action }
 * @returns {Object} Enriched flag
 */
function enrichFlag(flag) {
  const catalog = getCatalogMap();
  const entry = catalog.get(flag.id);
  if (!entry) return flag;
  return {
    ...flag,
    severity: flag.severity ?? entry.severity_tier,
    label: flag.label ?? entry.severity_label,
    action: flag.action || entry.human_action,
    description: entry.description,
    sourceModule: entry.source_module
  };
}

/**
 * Aggregate, deduplicate, enrich, and sort flags from all assessment modules.
 * 
 * @param  {...Array} flagArrays - Any number of flag arrays from assessment modules
 * @returns {{ flags: Array, highestSeverity: number, hasStop: boolean, hasPending: boolean, summary: string }}
 */
export function aggregateFlags(...flagArrays) {
  const allFlags = flagArrays.flat().filter(Boolean);
  
  // Deduplicate by flag ID (keep first occurrence)
  const seen = new Set();
  const unique = [];
  for (const f of allFlags) {
    const key = f.id || JSON.stringify(f);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(enrichFlag(f));
  }

  // Sort by severity (1=STOP first, 5=INFO last)
  unique.sort((a, b) => (a.severity || 5) - (b.severity || 5));

  const highestSeverity = unique.length > 0 ? unique[0].severity : null;
  const hasStop = unique.some(f => f.severity === 1);
  const hasPending = unique.some(f => f.severity === 2);

  // Build summary
  const counts = { STOP: 0, PENDING: 0, FLAG: 0, ALERT: 0, INFO: 0 };
  for (const f of unique) {
    const label = f.label || 'INFO';
    if (counts[label] !== undefined) counts[label]++;
  }
  const parts = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
  const summary = parts.length > 0 ? parts.join(', ') : 'No flags';

  return { flags: unique, highestSeverity, hasStop, hasPending, summary };
}

/**
 * Determine the overall KB assessment status from aggregated flags.
 * 
 * @param {{ hasStop: boolean, hasPending: boolean, highestSeverity: number }} flagResult
 * @returns {string} One of: 'STOP', 'PENDING', 'FLAG', 'ALERT', 'CLEAR'
 */
export function determineStatus(flagResult) {
  if (flagResult.hasStop) return 'STOP';
  if (flagResult.hasPending) return 'PENDING';
  if (flagResult.highestSeverity === 3) return 'FLAG';
  if (flagResult.highestSeverity === 4) return 'ALERT';
  return 'CLEAR';
}
