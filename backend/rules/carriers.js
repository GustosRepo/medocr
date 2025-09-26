import fs from 'fs';
import path from 'path';

let carrierSyn = [];
function loadCarriers() {
  if (carrierSyn.length) return;
  try {
    const p = path.resolve(process.cwd(), 'backend/rules/data/carriers_catalog.json');
    const raw = fs.readFileSync(p, 'utf8');
    const list = JSON.parse(raw);
    carrierSyn = list.map(item => {
      const res = (item.patterns || []).map(pat => new RegExp(pat, 'i'));
      return { name: item.name, status: item.status || 'unknown', reList: res };
    });
  } catch (e) {
    carrierSyn = [];
  }
}

let policies = null;
function loadPolicies() {
  if (policies) return;
  try {
    const p = path.resolve(process.cwd(), 'backend/rules/data/insurance_policies.json');
    const raw = fs.readFileSync(p, 'utf8');
    policies = JSON.parse(raw);
  } catch (e) {
    policies = { accepted: [], doNotAccept: [], selfPay: [], sunsets: {}, contract_end: {}, auto_flag: [], planNotes: {} };
  }
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
  loadCarriers();
  loadPolicies();

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

  // Pass 1: regex catalog
  for (const c of carrierSyn) {
    for (const re of c.reList) {
      if (re.test(fullText)) {
        let status = applyPolicyDecorations(c.name, c.status);
        return { hit: true, value: { carrier: c.name, status }, why: 'carrier_detect', actions: Array.from(actions), notes, meta };
      }
    }
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
