// PDF normalization model (Step 1). Provides stable structure for renderer & tests.
export const PDF_MODEL_VERSION = '1.0.0';

function s(v){ return (v===undefined||v===null)?'':String(v).trim(); }
function arr(v){ return Array.isArray(v)?v:[]; }

export function buildPdfModel(result){
  const r = result||{};
  const p = r.patient||{};
  const ins = Array.isArray(r.insurance)?r.insurance:[];
  const primary = ins[0]||{}; const secondary = ins[1]||null;
  const proc = r.procedure||{}; const prov = r.provider||{};
  const clinical = r.clinical||{}; const vitals = clinical.vitals||{};
  const info = r.infoAlerts||{}; const qc = r.qc||{};
  const narrative = r.narrative||{};
  const authNotes = r.documentMeta?.authorizationNotes||[];
  const reasons = r.flags?.reasons||[]; const actions = r.alerts?.actions||[];
  const missing = [];
  const req=(path,val)=>{ if(!val || (Array.isArray(val)&&!val.length)) missing.push(path); };
  req('patient.last',p.last); req('patient.first',p.first); req('patient.dob',p.dob);
  req('insurance.primary.carrier',primary.carrier); req('procedure.cpt',proc.cpt); req('provider.name',prov.name);
  if (clinical.primaryDiagnosis && !clinical.primaryDiagnosis.code) req('clinical.primaryDiagnosis.code', clinical.primaryDiagnosis.code);
  const cptAmbiguity = Array.isArray(proc.cptCandidates)&&proc.cptCandidates.length>1?proc.cptCandidates:[];
  return {
    version: PDF_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    document: { intakeDate: r.documentMeta?.intakeDate||null, suggestedFilename: r.documentMeta?.suggestedFilename||null, pages: r.documentMeta?.pages||null },
    patient: { first: s(p.first)||null, last: s(p.last)||null, dob: s(p.dob)||null, phones: arr(p.phones).map(s).filter(Boolean), email: s(p.email)||null, emergencyContact: p.emergencyContact?{ raw: s(p.emergencyContact.raw)||null, relationship: s(p.emergencyContact.relationship)||null, phone: s(p.emergencyContact.phone)||null }: null },
    insurance: { primary: { carrier: s(primary.carrier)||null, memberId: s(primary.memberId)||null, groupId: s(primary.groupId)||null, status: s(primary.status)||null }, secondary: secondary?{ carrier: s(secondary.carrier)||null, memberId: s(secondary.memberId)||null, groupId: s(secondary.groupId)||null, status: s(secondary.status)||null }: null },
    procedure: { cpt: s(proc.cpt)||null, description: s(proc.description)||null, providerNotes: arr(proc.providerNotes).map(s).filter(Boolean), cptCandidates: arr(proc.cptCandidates).map(s).filter(Boolean) },
    provider: { name: s(prov.name)||null, npi: s(prov.npi)||null, practice: s(prov.practice)||null, supervising: s(prov.supervising)||null, phone: s(prov.phone)||null, fax: s(prov.fax)||null },
    clinical: { primaryDiagnosis: clinical.primaryDiagnosis?{ code: s(clinical.primaryDiagnosis.code)||null, description: s(clinical.primaryDiagnosis.description)||null }: null, symptoms: arr(clinical.symptoms).map(s).filter(Boolean), vitals: { bmi: s(vitals.bmi)||null, bp: s(vitals.bp)||null, weightLbs: vitals.weightLbs||null, height: s(vitals.height)||null }, problemsList: arr(clinical.problemsList), diagnosesDetailed: arr(clinical.diagnosesDetailed) },
    narrative: { reasonForReferral: s(narrative.reasonForReferral)||null, presentIllness: s(narrative.presentIllness)||null, clinicalHistory: s(narrative.clinicalHistory)||null, clinicalNotes: s(narrative.clinicalNotes)||null },
    infoAlerts: {
      ppeRequired: info.ppeRequired===true?true:info.ppeRequired===false?false:null,
      safety: arr(info.safety).map(s).filter(Boolean),
      communication: arr(info.communication).map(s).filter(Boolean),
      accommodations: arr(info.accommodations).map(s).filter(Boolean),
      history: arr(info.history).map(s).filter(Boolean),
      resolution: arr(info.resolution).map(s).filter(Boolean),
      medications: arr(info.medications).map(s).filter(Boolean),
      testResults: arr(info.testResults).map(s).filter(Boolean)
    },
    problemFlags: { reasons: arr(reasons).map(s).filter(Boolean), actions: arr(actions).map(s).filter(Boolean) },
    authorization: { notes: arr(authNotes), derivedFromActions: !authNotes.length && actions.length>0 },
    dataQuality: { confidence: r.confidenceLevel||r.confidence||null, qc: { nameConsistency: qc.nameConsistency||null, dateValidity: qc.dateValidity||null, phoneValidity: qc.phoneValidity||null, cptValid: qc.cptValid||null }, cptAmbiguity },
    confidenceLevel: r.confidenceLevel||r.confidence||null,
    missing
  };
}
