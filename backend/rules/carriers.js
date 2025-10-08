import { loadJsonConfig } from './utils/configLoader.js';

const DEFAULT_POLICIES = { accepted: [], doNotAccept: [], selfPay: [], sunsets: {}, contract_end: {}, auto_flag: [], planNotes: {} };

function buildCarrierSynonyms(list) {
  if (!Array.isArray(list)) return [];
  const compiled = [];
  for (const item of list) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const status = item?.status || 'unknown';
    const res = [];
    for (const pat of item?.patterns || []) {
      try { res.push(new RegExp(pat, 'i')); } catch {}
    }
    if (!res.length) continue;
    compiled.push({ name, status, reList: res });
  }
  return compiled;
}

function buildPolicies(obj) {
  const base = { ...DEFAULT_POLICIES };
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj.accepted)) base.accepted = obj.accepted;
    if (Array.isArray(obj.doNotAccept)) base.doNotAccept = obj.doNotAccept;
    if (Array.isArray(obj.selfPay)) base.selfPay = obj.selfPay;
    if (obj.sunsets && typeof obj.sunsets === 'object') base.sunsets = obj.sunsets;
    if (obj.contract_end && typeof obj.contract_end === 'object') base.contract_end = obj.contract_end;
    if (Array.isArray(obj.auto_flag)) base.auto_flag = obj.auto_flag;
    if (obj.planNotes && typeof obj.planNotes === 'object') base.planNotes = obj.planNotes;
  }
  return base;
}

function getCarrierSynonyms() {
  return loadJsonConfig('carriers_catalog.json', {
    transform: buildCarrierSynonyms,
    defaultFactory: () => []
  });
}

function getPolicies() {
  return loadJsonConfig('insurance_policies.json', {
    transform: buildPolicies,
    defaultFactory: () => ({ ...DEFAULT_POLICIES })
  });
}

function norm(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  const now = new Date();
  const ms = d.getTime() - now.setHours(0,0,0,0);
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function detectCarrier(fullText, lines) {
  const carrierSyn = getCarrierSynonyms();
  const policies = getPolicies();

  const U = norm(fullText);
  const actions = new Set();
  const notes = [];
  const meta = {};

  const sunsets = { ...(policies.sunsets || {}), ...(policies.contract_end || {}) };
  const accepted = new Set((policies.accepted || []).map(norm));
  const dna = new Set((policies.doNotAccept || []).map(norm));
  const selfPay = new Set((policies.selfPay || []).map(norm));

  function applyPolicyDecorations(name, status) {
    const nName = norm(name);
    if (dna.has(nName)) status = 'not_accepted';
    else if (accepted.has(nName)) status = status === 'unknown' ? 'accepted' : status;

    const sunset = sunsets[name] || sunsets[nName];
    if (sunset) {
      meta.sunsetDate = sunset;
      const days = daysUntil(sunset);
      meta.sunsetDays = days;
      if (days != null) {
        if (days < 0) { status = 'not_accepted'; actions.add('insurance_contract_expired'); }
        else if (days <= 30) { actions.add('insurance_contract_expiring'); }
      }
    }

    const pn = policies.planNotes?.[name] || policies.planNotes?.[nName];
    if (Array.isArray(pn)) pn.forEach(n => notes.push(n));

    for (const kw of policies.auto_flag || []) {
      if (kw && U.includes(norm(kw))) actions.add(`insurance_auto_flag:${kw}`);
    }
    return status;
  }

  // Pass 1: regex catalog (choose earliest occurrence)
  let best = null;
  for (const c of carrierSyn) {
    for (const re of c.reList) {
      try { re.lastIndex = 0; } catch {}
      const idx = fullText.search(re);
      if (idx >= 0) {
        if (!best || idx < best.idx) {
          best = { entry: c, idx };
        }
        break;
      }
    }
  }
  if (best) {
    const c = best.entry;
    let status = applyPolicyDecorations(c.name, c.status);
    return { hit: true, value: { carrier: c.name, status }, why: 'carrier_detect', actions: Array.from(actions), notes, meta };
  }
  const labeled = lines.find(l => /(insurance|plan|payer)\s*[:\-]/i.test(l));
  if (labeled) {
    for (const c of carrierSyn) {
      for (const re of c.reList) {
        if (re.test(labeled)) {
          let status = applyPolicyDecorations(c.name, c.status);
          return { hit: true, value: { carrier: c.name, status }, why: 'carrier_detect', actions: Array.from(actions), notes, meta };
        }
      }
    }
  }

  // Pass 2: policy-only fallback by raw presence
  for (const name of dna) { if (U.includes(name)) { const status = applyPolicyDecorations(name, 'not_accepted'); return { hit: true, value: { carrier: name, status }, why: 'carrier_policies_dna', actions: Array.from(actions), notes, meta }; } }
  for (const name of accepted) { if (U.includes(name)) { const status = applyPolicyDecorations(name, 'accepted'); return { hit: true, value: { carrier: name, status }, why: 'carrier_policies_accepted', actions: Array.from(actions), notes, meta }; } }
  for (const name of selfPay) { if (U.includes(name)) { const status = applyPolicyDecorations('Self Pay', 'self_pay'); return { hit: true, value: { carrier: 'Self Pay', status }, why: 'carrier_policies_selfpay', actions: Array.from(actions), notes, meta }; } }

  // No match
  for (const kw of policies.auto_flag || []) { if (kw && U.includes(norm(kw))) actions.add(`insurance_auto_flag:${kw}`); }
  return { hit: false, why: 'carrier_none', actions: Array.from(actions) };
}
