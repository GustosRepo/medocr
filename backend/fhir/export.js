// Expanded FHIR export:
//  - Patient (identifier, name, telecom)
//  - Coverage resources for each insurance
//  - Condition for primary diagnosis
//  - DiagnosticReport referencing Condition
//  - Observation resources for CPAP compliance metrics (if present)
//  - ServiceRequest for ordered CPT code
//  - Basic provenance via meta.tag (non-authoritative)

function makeId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2,10); }

export function toFhirBundle(result) {
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [] };
  const now = new Date().toISOString();

  // Patient
  const patientId = makeId('pat');
  const patient = {
    resourceType: 'Patient',
    id: patientId,
    meta: { tag: [ { system: 'http://example.org/source', code: 'extraction-engine' } ] },
    identifier: [],
    name: (result.patient?.last || result.patient?.first) ? [ { family: result.patient.last, given: [result.patient.first].filter(Boolean) } ] : undefined,
    telecom: (result.patient?.phones||[]).map(p => ({ system: 'phone', value: p }))
  };
  if (result.patient?.dob) patient.birthDate = result.patient.dob; // Keep original format for now
  if (result.patient?.email) patient.telecom.push({ system: 'email', value: result.patient.email });
  if (result.patient?.mrn) patient.identifier.push({ system: 'http://hospital.example.org/mrn', value: result.patient.mrn });
  bundle.entry.push({ resource: patient });

  // Practitioner (if provider name available in result.provider?.name)
  let practitionerRef = null;
  if (result.provider?.name) {
    const pract = {
      resourceType: 'Practitioner',
      id: makeId('prac'),
      name: [ { text: result.provider.name } ],
      telecom: []
    };
    if (result.provider.npi) pract.identifier = [ { system: 'http://hl7.org/fhir/sid/us-npi', value: result.provider.npi } ];
    if (result.provider.phone) pract.telecom.push({ system: 'phone', value: result.provider.phone });
    if (result.provider.fax) pract.telecom.push({ system: 'fax', value: result.provider.fax });
    bundle.entry.push({ resource: pract });
    practitionerRef = `Practitioner/${pract.id}`;
  }

  // Organization placeholder (if carrier of primary insurance exists)
  let orgRef = null;
  const primaryCarrier = (result.insurance || [])[0]?.carrier;
  if (primaryCarrier) {
    const org = { resourceType: 'Organization', id: makeId('org'), name: primaryCarrier };
    bundle.entry.push({ resource: org });
    orgRef = `Organization/${org.id}`;
  }

  // Coverage (one per insurance entry)
  (result.insurance || []).forEach((ins, idx) => {
    if (!ins?.carrier) return;
    const cov = {
      resourceType: 'Coverage',
      id: makeId('cov'),
      status: 'active',
      kind: 'insurance',
      subscriber: { reference: `Patient/${patientId}` },
      subscriberId: ins.memberId || undefined,
      payor: [ { display: ins.carrier } ],
      class: [],
      order: idx + 1
    };
    if (ins.groupId) cov.class.push({ type: { text: 'group' }, value: ins.groupId });
    if (ins.status && ins.status !== 'accepted') cov.meta = { tag: [ { system: 'http://example.org/plan-status', code: ins.status } ] };
    bundle.entry.push({ resource: cov });
  });

  // Condition (primary diagnosis)
  let conditionRef = null;
  if (result.clinical?.primaryDiagnosis?.code) {
    const cond = {
      resourceType: 'Condition',
      id: makeId('cond'),
      subject: { reference: `Patient/${patientId}` },
      code: { coding: [ { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: result.clinical.primaryDiagnosis.code } ], text: result.clinical.primaryDiagnosis.description },
      recordedDate: now
    };
    bundle.entry.push({ resource: cond });
    conditionRef = `Condition/${cond.id}`;
  }

  // ServiceRequest for ordered study
  let serviceRef = null;
  if (result.procedure?.cpt) {
    const sr = {
      resourceType: 'ServiceRequest',
      id: makeId('srv'),
      status: 'active',
      intent: 'order',
      code: { coding: [ { system: 'http://www.ama-assn.org/go/cpt', code: result.procedure.cpt } ], text: result.procedure.description || result.procedure.cpt },
      subject: { reference: `Patient/${patientId}` },
      authoredOn: now,
      reasonReference: conditionRef ? [ { reference: conditionRef } ] : undefined,
      requester: practitionerRef ? { reference: practitionerRef } : undefined,
      performer: practitionerRef ? [ { reference: practitionerRef } ] : undefined
    };
    bundle.entry.push({ resource: sr });
    serviceRef = `ServiceRequest/${sr.id}`;
  }

  // Observations for compliance metrics
  if (result.compliance) {
    const metrics = [
      ['avgHours', 'Average usage hours', 'hours', result.compliance.avgHours],
      ['ahi', 'Apnea-Hypopnea Index', 'events/hour', result.compliance.ahi],
      ['p90', '90% Pressure', 'cmH2O', result.compliance.p90],
      ['usagePercent', 'Usage Percent', '%', result.compliance.usagePercent],
      ['pressureMin', 'Pressure Min', 'cmH2O', result.compliance.pressureMin],
      ['pressureMax', 'Pressure Max', 'cmH2O', result.compliance.pressureMax],
      ['pressureFixed', 'Pressure Fixed', 'cmH2O', result.compliance.pressureFixed]
    ];
    metrics.forEach(([key, label, unit, val]) => {
      if (val == null) return;
      const obs = {
        resourceType: 'Observation',
        id: makeId('obs'),
        status: 'final',
        code: { text: label },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: now,
        valueQuantity: { value: Number(val), unit }
      };
      bundle.entry.push({ resource: obs });
    });
  }

  // DiagnosticReport
  const dr = {
    resourceType: 'DiagnosticReport',
    id: makeId('dr'),
    status: 'unknown',
    code: { text: result.procedure?.description || result.procedure?.cpt || 'Sleep Study' },
    subject: { reference: `Patient/${patientId}` },
    issued: now,
    conclusion: result.clinical?.primaryDiagnosis?.description || undefined,
    conclusionCode: result.clinical?.primaryDiagnosis?.code ? [ { coding: [ { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: result.clinical.primaryDiagnosis.code } ] } ] : undefined,
    result: bundle.entry.filter(e => e.resource.resourceType === 'Observation').map(e => ({ reference: `Observation/${e.resource.id}` })),
    basedOn: serviceRef ? [ { reference: serviceRef } ] : undefined
  };
  bundle.entry.push({ resource: dr });

  // Provenance linking extraction generation
  const prov = {
    resourceType: 'Provenance',
    id: makeId('prov'),
    recorded: now,
    activity: { text: 'document-extraction' },
    agent: [ { type: { text: 'author' }, who: { display: 'Extraction Engine' } } ],
    target: bundle.entry.slice(0,5).map(e => ({ reference: `${e.resource.resourceType}/${e.resource.id}` })),
    extension: result.documentMeta?.fileHash ? [ { url: 'http://example.org/fhir/StructureDefinition/source-file-sha256', valueString: result.documentMeta.fileHash } ] : undefined
  };
  bundle.entry.push({ resource: prov });

  return bundle;
}
