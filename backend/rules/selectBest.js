// Late-fusion reranker to reduce page-1 bias and prefer demographics context
// Candidate shape: { value, score, sectionTag, page, line, context, patientHints? }

function confidenceThreshold(field) {
  switch ((field || '').toLowerCase()) {
    case 'patient_phone':
    case 'phone':
      return 1; // require positive evidence
    case 'provider_fax':
      return 0; // allow fax when weak if labeled
    case 'patient_name':
    case 'dob':
    case 'provider_name':
    case 'provider_phone':
      return 0; // neutral default
    default:
      return 0;
  }
}

function bool(v) { return !!v; }

function fieldAdjust(field, c) {
  const reasons = [];
  let delta = 0;
  const tag = (c.sectionTag || '').toLowerCase();
  const ctx = c.context || {};
  const patientHints = Number(c.patientHints) || Number(ctx.patientHints) || 0;
  const providerHints = Number(ctx.providerHints) || 0;
  const labeled = bool(c.labeled || ctx.labeled);
  const nextLineLabel = bool(c.nextLineLabel || ctx.nextLineLabel);
  const isFax = bool(c.isFax || ctx.isFax);
  const hasCredentialNearby = bool(ctx.hasCredentialNearby);
  const looksOrg = bool(ctx.looksOrg);
  const isFacilityBlocked = bool(ctx.isFacilityBlocked);

  switch ((field || '').toLowerCase()) {
    case 'patient_name': {
      if (labeled) { delta += 6; reasons.push('+6 labeled'); }
      if (nextLineLabel) { delta += 3; reasons.push('+3 nextLineLabel'); }
      if (providerHints) { delta -= 3; reasons.push('-3 providerHints'); }
      break;
    }
    case 'dob': {
      if (labeled) { delta += 6; reasons.push('+6 labeled'); }
      if (nextLineLabel) { delta += 3; reasons.push('+3 nextLineLabel'); }
      if (providerHints) { delta -= 3; reasons.push('-3 providerHints'); }
      break;
    }
    case 'patient_phone':
    case 'phone': {
      if (patientHints >= 2) { delta += 8; reasons.push('+8 ≥2 patientHints'); }
      if (isFax) { delta -= 8; reasons.push('-8 fax'); }
      if (providerHints) { delta -= 4; reasons.push('-4 providerHints'); }
      if (isFacilityBlocked) { delta = -999; reasons.push('HARDBAN facility'); }
      break;
    }
    case 'provider_phone': {
      if (providerHints) { delta += 6; reasons.push('+6 providerHints'); }
      if (patientHints) { delta -= 8; reasons.push('-8 patientHints'); }
      if (isFax) { delta -= 6; reasons.push('-6 fax for phone'); }
      break;
    }
    case 'provider_fax': {
      if (isFax) { delta += 8; reasons.push('+8 fax label'); }
      if (providerHints) { delta += 4; reasons.push('+4 providerHints'); }
      if (patientHints) { delta -= 8; reasons.push('-8 patientHints'); }
      break;
    }
    case 'provider_name': {
      if (hasCredentialNearby) { delta += 6; reasons.push('+6 credentialNearby'); }
      if (looksOrg) { delta -= 4; reasons.push('-4 looksOrg'); }
      break;
    }
    default: {
      // no-op
    }
  }

  return { delta, reasons };
}

function sectionBoost(tag) {
  switch ((tag || '').toLowerCase()) {
    case 'demographics':
      return 10;
    case 'provider':
      return -2;
    case 'cover':
      return -6;
    default:
      return 0;
  }
}

function pageBonus(page) {
  const p = Math.max(1, Number(page) || 1);
  // Small bonus for later pages to counter cover-sheet dominance
  // 0.25 per page after the first, capped at +3
  return Math.min(3, 0.25 * (p - 1));
}

function tieBreak(a, b, type) {
  // Prefer demographics tag
  const sbA = sectionBoost(a.sectionTag);
  const sbB = sectionBoost(b.sectionTag);
  if (sbA !== sbB) return sbB - sbA;
  // For phones, prefer more patient hints
  if (type === 'phone') {
    const pa = a.patientHints || 0;
    const pb = b.patientHints || 0;
    if (pa !== pb) return pb - pa;
  }
  // Prefer higher original score
  const sa = Number(a.score) || 0;
  const sb = Number(b.score) || 0;
  if (sa !== sb) return sb - sa;
  // Finally prefer later pages a bit (facesheet often later)
  const pgA = Number(a.page) || 1;
  const pgB = Number(b.page) || 1;
  if (pgA !== pgB) return pgB - pgA;
  // Lower line index (higher on page) as last resort
  const la = Number.isFinite(a.line) ? a.line : 1e9;
  const lb = Number.isFinite(b.line) ? b.line : 1e9;
  return la - lb;
}

export function pickBest(candidates, field) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const scored = candidates.map(c => {
    let base = Number(c.score) || 0;
    const reasons = [];
    // Section & page priors
    const sb = sectionBoost(c.sectionTag); if (sb) reasons.push(`sectionBoost:${sb}`); base += sb;
    const pb = pageBonus(c.page);          if (pb) reasons.push(`pageBonus:${pb.toFixed(2)}`); base += pb;

    // Field-aware adjustments
    const { delta, reasons: fieldReasons } = fieldAdjust(field, c);
    base += delta; reasons.push(...fieldReasons);

    return { ...c, fusedScore: base, rerankExplain: reasons.join(' | ') };
  });

  scored.sort((a, b) => {
    if (a.fusedScore !== b.fusedScore) return b.fusedScore - a.fusedScore;
    // field-aware tie-breaks
    if (String(field).toLowerCase() === 'provider_fax') {
      const af = (a.isFax || a.context?.isFax) ? 1 : 0;
      const bf = (b.isFax || b.context?.isFax) ? 1 : 0;
      if (af !== bf) return bf - af;
    }
    if (String(field).toLowerCase() === 'patient_phone' || String(field).toLowerCase() === 'phone') {
      const pa = Number(a.patientHints || a.context?.patientHints || 0);
      const pb = Number(b.patientHints || b.context?.patientHints || 0);
      if (pa !== pb) return pb - pa;
    }
    return tieBreak(a, b, String(field).toLowerCase().includes('phone') ? 'phone' : field);
  });

  const best = scored[0];
  const threshold = confidenceThreshold(field);
  if (best && best.fusedScore < threshold) return null; // confidence gating
  return best || null;
}
