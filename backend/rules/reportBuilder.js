// Build a normalized patient report object from runExtraction() result
// Production-safe: no console logging, no environment assumptions

// Inputs: extraction result from runExtraction or runExtractionWithDates
// Output: structured report object matching client sections; all fields exist

function safe(s, fallback = '—') {
  const v = s == null ? '' : String(s).trim();
  return v ? v : fallback;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function parseDobToAge(dob) {
  // dob: MM/DD/YYYY
  try {
    if (!dob || !/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) return null;
    const [mm, dd, yyyy] = dob.split('/').map(x => parseInt(x, 10));
    const birth = new Date(yyyy, mm - 1, dd);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  } catch { return null; }
}

function fmtPhoneList(primary, secondaryArr) {
  const p = Array.isArray(primary) ? primary : (primary ? [primary] : []);
  const s = Array.isArray(secondaryArr) ? secondaryArr : [];
  const all = [...p, ...s].filter(Boolean);
  if (!all.length) return '—';
  if (all.length === 1) return all[0];
  return `${all[0]} / ${all[1]}`;
}

function pickPrimaryDiagnosis(res) {
  try {
    const pd = res?.clinical?.primaryDiagnosis;
    if (pd && (pd.code || pd.description)) {
      return { code: pd.code || '—', description: pd.description || '—' };
    }
    const list = Array.isArray(res?.diagnoses) ? res.diagnoses : [];
    const code = list[0] || null;
    if (code) {
      const det = Array.isArray(res?.clinical?.diagnosesDetailed)
        ? res.clinical.diagnosesDetailed.find(d => String(d.code) === String(code))
        : null;
      return { code: String(code), description: det?.description || '—' };
    }
  } catch {}
  return { code: '—', description: '—' };
}

function normalizeConfidence(conf) {
  const c = String(conf || '').toLowerCase();
  if (c === 'high') return 'High';
  if (c === 'medium') return 'Medium';
  if (c === 'low') return 'Low';
  // Map Manual Review
  if (c.includes('manual')) return 'Manual Review Required';
  return 'Low';
}

function resolveReferralDate(res) {
  // Prefer extracted order/referral/study date, else intake if present
  const meta = res?.documentMeta || {};
  const date = meta.orderDate || meta.referralDate || meta.studyDate || meta.intakeDate || '';
  return safe(date);
}

function shouldIncludeEmergencyContact(res, age) {
  if (typeof age === 'number' && age < 18) return true;
  const accom = Array.isArray(res?.infoAlerts?.accommodations) ? res.infoAlerts.accommodations.map(String) : [];
  // Heuristic: include when caretaker/guardian/caregiver flags present
  const tokens = accom.join(' ').toLowerCase();
  if (/caretaker|guardian|caregiver/.test(tokens)) return true;
  return false;
}

function fmtVitals(res) {
  const v = res?.clinical?.vitals || {};
  const out = [];
  if (v.bmi) out.push(`BMI: ${v.bmi}`);
  const ht = v.height ? `Height ${v.height}` : '';
  const wt = v.weightLbs ? `Weight ${v.weightLbs} lbs` : '';
  const htwt = [ht, wt].filter(Boolean).join(' // ');
  if (htwt) out.push(htwt);
  if (v.bp) out.push(`BP: ${v.bp}`);
  return out.length ? out.join(' | ') : '—';
}

export function buildPatientReport(extractionResult) {
  const r = extractionResult || {};
  const p = r.patient || {};
  const ins = Array.isArray(r.insurance) ? r.insurance : [];
  const primaryIns = ins[0] || {};
  const secondaryIns = ins[1] || null;

  const first = safe(p.first, '');
  const last = safe(p.last, '');
  const patientName = [last, first].filter(Boolean).join(', ') || 'Unknown';
  const dob = safe(p.dob);
  const age = parseDobToAge(p.dob);

  const phonePrimary = Array.isArray(p.phones) && p.phones.length ? p.phones[0] : null;
  const phoneSecondary = Array.isArray(p.altPhones) ? p.altPhones : [];
  const phonesFormatted = fmtPhoneList(phonePrimary, phoneSecondary);
  const email = safe(p.email);

  const emer = p.emergencyContact || {};
  const includeEC = shouldIncludeEmergencyContact(r, age);
  const emergency = includeEC && (emer?.raw || emer?.name || emer?.phone)
    ? {
        name: safe(emer.raw || emer.name),
        relationship: safe(emer.relationship || ''),
        phone: safe(emer.phone || '')
      }
    : null;

  const carrier = safe(primaryIns.carrier);
  const memberId = safe(primaryIns.memberId);
  const groupId = safe(primaryIns.groupId);
  const secondary = secondaryIns
    ? {
        carrier: safe(secondaryIns.carrier),
        memberId: safe(secondaryIns.memberId),
        groupId: safe(secondaryIns.groupId)
      }
    : null;

  const cpt = safe(r?.procedure?.cpt);
  const description = safe(r?.procedure?.description);
  const providerNotes = Array.isArray(r?.procedure?.providerNotes) ? r.procedure.providerNotes : [];

  const provider = r.provider || {};
  const providerName = safe(provider.name);
  const npi = safe(provider.npi);
  const practice = safe(provider.practice);
  const providerPhone = safe(provider.phone);
  const providerFax = safe(provider.fax);
  const supervising = safe(provider.supervising || provider.supervisingPhysician || provider.supervisingName || '');

  const primaryDx = pickPrimaryDiagnosis(r);
  const symptoms = Array.isArray(r?.clinical?.symptoms) ? r.clinical.symptoms : [];
  const vitals = fmtVitals(r);

  const ppeRequired = r?.infoAlerts?.ppeRequired === true ? 'Yes' : r?.infoAlerts?.ppeRequired === false ? 'No' : '—';
  const safety = Array.isArray(r?.infoAlerts?.safety) ? r.infoAlerts.safety : [];
  const communication = Array.isArray(r?.infoAlerts?.communication) ? r.infoAlerts.communication : [];
  const accommodations = Array.isArray(r?.infoAlerts?.accommodations) ? r.infoAlerts.accommodations : [];

  const problemFlags = Array.isArray(r?.flags?.reasons) ? r.flags.reasons : [];
  const authorizationNotes = Array.isArray(r?.documentMeta?.authorizationNotes) ? r.documentMeta.authorizationNotes : [];
  const confidence = normalizeConfidence(r?.confidence);

  const referralDate = resolveReferralDate(r);

  return {
    header: {
      patient: patientName,
      dob,
      referralDate
    },
    demographics: {
      phone: phonesFormatted,
      email,
      emergencyContact: emergency
    },
    insurance: {
      primary: { carrier, memberId, groupId },
      secondary
    },
    procedure: {
      cpt,
      description,
      providerNotes
    },
    referringProvider: {
      name: providerName,
      npi,
      practice,
      contact: { phone: providerPhone, fax: providerFax },
      supervising: supervising || '—'
    },
    clinical: {
      primaryDiagnosis: primaryDx,
      allDiagnoses: (Array.isArray(res?.diagnoses) ? res.diagnoses : []).map(d => ({
        code: typeof d === 'string' ? d : (d?.code || '—'),
        description: typeof d === 'object' ? (d?.description || '') : '',
        ocrFlag: typeof d === 'object' ? (d?.ocrFlag || false) : false
      })),
      symptoms,
      vitals
    },
    infoAlerts: {
      ppeRequired,
      safety,
      communication,
      accommodations
    },
    problemFlags,
    authorizationNotes,
    confidence
  };
}

// Named exports for helpers (useful in tests)
export const __helpers = { safe, fmtPhoneList, pickPrimaryDiagnosis, normalizeConfidence, parseDobToAge, fmtVitals };
