/**
 * bcbsRouter.js — BCBS 4-Step Routing Engine
 * 
 * Step 0: TPA detection (Quantum Health, Benesys/Union)
 * Step 1: Known prefix lookup (Tier 1 — exact match, 19,511 prefixes)
 * Step 2: Universal rules (letter-in-ID → Carelon, Medicare Supplement)
 * Step 3: Affiliate defaults (Tier 2) → Global fallback (Tier 3)
 * 
 * Also classifies member ID format (A/B/C/FEP) and detects
 * format-vs-prefix mismatches.
 */

import { getBcbsPrefixDb, getBcbsRoutingRules } from '../../kbLoader.js';

// ────────────────── Prefix extraction ──────────────────

/**
 * Extract the 3-character prefix from a BCBS member ID.
 * BCBS prefixes are 3 chars: mostly alpha (AAA, 14k) or alpha-digit-alpha (A0A, 5.4k).
 */
export function extractBcbsPrefix(memberId) {
  if (!memberId || typeof memberId !== 'string') return null;
  const cleaned = memberId.replace(/[\s-]/g, '').toUpperCase();
  // Prefix: 3 chars starting with a letter, can contain digits (e.g. A4S, B8N)
  const match = cleaned.match(/^([A-Z][A-Z0-9]{2})/);
  return match ? match[1] : null;
}

// ────────────────── Prefix lookup (Tier 1) ──────────────────

/**
 * Look up a BCBS prefix in the database.
 */
export function lookupBcbsPrefix(prefix) {
  if (!prefix) return null;
  const db = getBcbsPrefixDb();
  if (!db) return null;
  return db[prefix.toUpperCase()] || null;
}

// ────────────────── ID Format classification ──────────────────

/**
 * Classify a BCBS member ID into format categories.
 * FORMAT_FEP: starts with single R + digits (Federal Employee Program)
 * FORMAT_B:   alpha-numeric body (letters after prefix → likely Carelon)
 * FORMAT_C:   extended numeric (10+ digits after prefix)
 * FORMAT_A:   standard numeric (6+ digits after prefix)
 */
export function classifyIdFormat(memberId) {
  if (!memberId || typeof memberId !== 'string') return 'FORMAT_UNKNOWN';
  const cleaned = memberId.replace(/[\s-]/g, '').toUpperCase();

  // FEP: single R + 8+ digits
  if (/^R\d{8,}$/.test(cleaned)) return 'FORMAT_FEP';

  // Must start with a letter followed by 2 alphanumeric (the prefix)
  if (!/^[A-Z][A-Z0-9]{2}/.test(cleaned)) return 'FORMAT_UNKNOWN';

  const body = cleaned.slice(3);
  if (!body) return 'FORMAT_UNKNOWN';

  // Body has any alpha → FORMAT_B (alpha-numeric)
  if (/[A-Z]/.test(body)) return 'FORMAT_B';

  // Extended numeric: 10+ digits
  if (/^\d{10,}$/.test(body)) return 'FORMAT_C';

  // Standard numeric: 6+ digits
  if (/^\d{6,}$/.test(body)) return 'FORMAT_A';

  return 'FORMAT_UNKNOWN';
}

/**
 * Check if member ID body contains letters (letter-in-ID rule).
 */
function hasLetterInBody(memberId) {
  if (!memberId) return false;
  const cleaned = memberId.replace(/[\s-]/g, '').toUpperCase();
  // Strip the 3-char prefix (starts with letter + 2 alphanumeric)
  const body = cleaned.replace(/^[A-Z][A-Z0-9]{2}/, '');
  return /[A-Z]/.test(body);
}

// ────────────────── TPA detection (Step 0) ──────────────────

/**
 * Detect if this is a TPA plan (Quantum Health, Benesys/Union).
 */
function detectTpa(carrier, memberId, prefixEntry) {
  const rules = getBcbsRoutingRules();
  if (!rules?.tpa_rules) return null;

  const combined = `${carrier} ${prefixEntry?.group || ''} ${prefixEntry?.network || ''}`.toLowerCase();

  // Quantum Health
  const qh = rules.tpa_rules.quantum_health;
  if (qh?.detection_keywords?.some(k => combined.includes(k.toLowerCase()))) {
    return {
      tpa: 'quantum_health',
      name: 'Quantum Health',
      auth_required: qh.auth_required,
      portal: qh.portal,
      phone: qh.phone
    };
  }

  // Benesys/Union
  const bu = rules.tpa_rules.benesys_union;
  if (bu?.detection_keywords?.some(k => combined.includes(k.toLowerCase()))) {
    return {
      tpa: 'benesys_union',
      name: 'Benesys/Union Plan',
      auth_handlers: bu.auth_handlers,
      eligibility_tools: bu.eligibility_tools,
      note: bu.workflow
    };
  }

  return null;
}

// ────────────────── Affiliate resolution ──────────────────

/**
 * Resolve affiliate key from name string.
 */
function resolveAffiliateKey(affiliateName) {
  if (!affiliateName) return null;
  const rules = getBcbsRoutingRules();
  if (!rules?.affiliate_profiles) return null;

  const lower = affiliateName.toLowerCase();
  for (const [key, profile] of Object.entries(rules.affiliate_profiles)) {
    if (lower.includes(key.replace(/_/g, ' ')) || lower.includes(profile.name?.toLowerCase())) {
      return key;
    }
  }
  return null;
}

/**
 * Get affiliate profile by key.
 */
function getAffiliateProfile(key) {
  const rules = getBcbsRoutingRules();
  return rules?.affiliate_profiles?.[key] || null;
}

// ────────────────── Format × Prefix mismatch ──────────────────

function checkFormatMismatch(idFormat, prefixEntry) {
  if (!prefixEntry) return null;
  const authReq = (prefixEntry.auth_requirement || '').toLowerCase();
  const isCarelon = /carelon|aim/i.test(authReq);

  if (isCarelon && idFormat === 'FORMAT_A') {
    return { type: 'MISMATCH', note: 'Prefix says Carelon but ID format is numeric — verify before proceeding' };
  }
  if (!isCarelon && /phone|call/i.test(authReq) && idFormat === 'FORMAT_B') {
    return { type: 'SOFT_MISMATCH', note: 'Prefix says phone auth but ID format suggests chat may work — try chat first' };
  }
  return null;
}

// ────────────────── Full BCBS assessment (4-step) ──────────────────

/**
 * Full BCBS routing assessment with 4-step decision hierarchy.
 * 
 * @param {Object} result - Extraction result
 * @returns {Object} Comprehensive BCBS routing data
 */
export function assessBcbs(result) {
  const carrier = result?.insurance?.[0]?.carrier || '';
  const memberId = result?.insurance?.[0]?.memberId || '';
  const flags = [];

  // Check if carrier looks like BCBS
  const bcbsPattern = /\b(bcbs|blue\s*cross|blue\s*shield|anthem|regence|carefirst|premera|highmark|independence|horizon|wellmark|excellus)\b/i;
  if (!bcbsPattern.test(carrier)) {
    return { isBcbs: false, flags };
  }

  const prefix = extractBcbsPrefix(memberId);
  const idFormat = classifyIdFormat(memberId);
  const rules = getBcbsRoutingRules();
  const formatSignals = rules?.id_format_patterns?.[idFormat]?.signals || {};

  // ── Step 0: TPA check ──
  const prefixLookup = prefix ? lookupBcbsPrefix(prefix) : null;
  const tpa = detectTpa(carrier, memberId, prefixLookup);

  if (tpa) {
    flags.push({
      id: 'FLAG_BCBS_TPA_DETECTED',
      severity: 2,
      label: 'ALERT',
      action: `TPA plan detected: ${tpa.name}. ${tpa.portal ? 'Portal: ' + tpa.portal : ''} ${tpa.phone ? 'Phone: ' + tpa.phone : ''}`
    });
    return {
      isBcbs: true,
      prefix,
      idFormat,
      tpa,
      tier: 'TPA',
      confidence: 'VERIFIED',
      flags
    };
  }

  // No prefix found
  if (!prefix) {
    flags.push({
      id: 'FLAG_BCBS_NO_PREFIX',
      severity: 3,
      label: 'FLAG',
      action: 'BCBS carrier detected but no alpha prefix found in member ID. Call for affiliate routing.'
    });
    return {
      isBcbs: true,
      prefix: null,
      idFormat,
      tier: 'TIER_3',
      confidence: 'PRESUMED_GENERAL',
      globalDefault: rules?.global_default || null,
      flags
    };
  }

  // ── Step 1: Known prefix lookup (Tier 1) ──
  if (prefixLookup) {
    if (prefixLookup.affiliate === 'Prefix Not in Use') {
      flags.push({
        id: 'FLAG_BCBS_PREFIX_INACTIVE',
        severity: 3,
        label: 'FLAG',
        action: `BCBS prefix "${prefix}" is marked "Not in Use". Verify with patient.`
      });
      return { isBcbs: true, prefix, idFormat, tier: 'TIER_1', confidence: 'VERIFIED', flags };
    }

    const confidence = prefixLookup.verified_year ? 'VERIFIED' : 'LIKELY';
    const affiliateKey = resolveAffiliateKey(prefixLookup.affiliate);
    const profile = affiliateKey ? getAffiliateProfile(affiliateKey) : null;

    // Check auth requirement
    const authReq = prefixLookup.auth_requirement || '';
    if (/no auth/i.test(authReq)) {
      flags.push({
        id: 'INFO_BCBS_NO_AUTH',
        severity: 5,
        label: 'INFO',
        action: `BCBS ${prefixLookup.affiliate}: No auth required per prefix database.`
      });
    } else if (authReq) {
      flags.push({
        id: 'ALERT_BCBS_AUTH',
        severity: 4,
        label: 'ALERT',
        action: `BCBS ${prefixLookup.affiliate}: ${authReq}`
      });
    }

    // Format mismatch check
    const mismatch = checkFormatMismatch(idFormat, prefixLookup);
    if (mismatch) {
      flags.push({
        id: 'FLAG_BCBS_FORMAT_MISMATCH',
        severity: 3,
        label: 'FLAG',
        action: `${mismatch.type}: ${mismatch.note}`
      });
    }

    return {
      isBcbs: true,
      prefix,
      idFormat,
      idFormatSignals: formatSignals,
      affiliate: prefixLookup.affiliate,
      affiliateKey,
      affiliateProfile: profile,
      authRequirement: authReq,
      state: prefixLookup.state || null,
      portalChat: prefixLookup.portal_chat || null,
      website: prefixLookup.website || null,
      tier: 'TIER_1',
      confidence,
      formatMismatch: mismatch,
      flags
    };
  }

  // ── Step 2: Universal rules ──
  const letterInBody = hasLetterInBody(memberId);

  // Medicare supplement detection
  if (/supplement|medigap|plan [a-n]\b/i.test(carrier)) {
    flags.push({
      id: 'INFO_BCBS_MEDICARE_SUPPLEMENT',
      severity: 5,
      label: 'INFO',
      action: 'Medicare Supplement detected — no authorization required after Medicare. Exception: retirement plans.'
    });
    return {
      isBcbs: true,
      prefix,
      idFormat,
      tier: 'UNIVERSAL_RULE',
      confidence: 'LIKELY',
      universalRule: 'medicare_supplement',
      authRequired: false,
      flags
    };
  }

  // Letter-in-ID → Carelon signal
  if (letterInBody) {
    const carelon = rules?.universal_rules?.letter_in_id?.routing_if_true;
    flags.push({
      id: 'FLAG_BCBS_LETTER_IN_ID',
      severity: 4,
      label: 'ALERT',
      action: `Unknown prefix "${prefix}" but letter-in-ID detected — likely Carelon. Portal: providerportal.carelon.com. Chat may be available.`
    });
    return {
      isBcbs: true,
      prefix,
      idFormat,
      tier: 'UNIVERSAL_RULE',
      confidence: 'LIKELY',
      universalRule: 'letter_in_id_carelon',
      authMethod: carelon?.auth_method || 'carelon',
      chatAvailable: carelon?.chat_available ?? true,
      flags
    };
  }

  // ── Step 3: Affiliate defaults (Tier 2) → Global fallback (Tier 3) ──
  // Try to guess affiliate from carrier text
  const affiliateKey = resolveAffiliateKey(carrier);
  if (affiliateKey) {
    const profile = getAffiliateProfile(affiliateKey);
    flags.push({
      id: 'FLAG_BCBS_UNKNOWN_PREFIX',
      severity: 3,
      label: 'FLAG',
      action: `Prefix "${prefix}" not in database. Using ${profile?.name || affiliateKey} affiliate defaults. Verify with payer.`
    });
    return {
      isBcbs: true,
      prefix,
      idFormat,
      idFormatSignals: formatSignals,
      affiliate: profile?.name || affiliateKey,
      affiliateKey,
      affiliateProfile: profile,
      tier: 'TIER_2',
      confidence: 'PRESUMED_AFFILIATE',
      flags
    };
  }

  // Tier 3: Global fallback
  flags.push({
    id: 'FLAG_BCBS_UNKNOWN_PREFIX',
    severity: 3,
    label: 'FLAG',
    action: `BCBS prefix "${prefix}" not in database and affiliate unknown. Call ${rules?.universal_rules?.um_fallback_phone || '800-336-7767'} for routing.`
  });
  return {
    isBcbs: true,
    prefix,
    idFormat,
    idFormatSignals: formatSignals,
    tier: 'TIER_3',
    confidence: 'PRESUMED_GENERAL',
    globalDefault: rules?.global_default || null,
    flags
  };
}
