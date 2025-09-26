import fs from 'fs';
import path from 'path';

function loadRequirements() {
  const p = path.resolve(process.cwd(), 'docs/requirements.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data.items) ? data : { items: [] };
  } catch {
    return {
      items: [
        { id: 'patient_name', title: 'Patient name', status: 'met', notes: 'Label-aware' },
        { id: 'patient_dob', title: 'Patient DOB', status: 'met', notes: 'Label + context filters' },
        { id: 'cpt_catalog', title: 'CPT selection (catalog)', status: 'met', notes: '95811, 95810, 95806, G0399, 95782, 95783, 95805' },
        { id: 'icd_catalog', title: 'ICD detection (catalog)', status: 'met', notes: 'Allowlist with normalization' },
        { id: 'carrier_policies', title: 'Carrier detection + policy overlay', status: 'met', notes: 'Status, flags, sunsets, notes' },
        { id: 'dme_catalog', title: 'DME vendors/HCPCS (catalog)', status: 'met', notes: 'Vendors and codes' },
        { id: 'member_group_ids', title: 'Member/Group ID extraction', status: 'gap', notes: 'Not implemented yet' },
        { id: 'provider_block', title: 'Provider block extraction', status: 'gap', notes: 'Name/NPI/phone/fax' },
        { id: 'multi_insurance', title: 'Multiple insurances', status: 'gap', notes: 'Single plan only' },
        { id: 'icd_keywords', title: 'ICD keyword inference', status: 'gap', notes: 'Codes only, no narrative inference' },
        { id: 'qc_confidence', title: 'QC + confidence scoring', status: 'partial', notes: 'Basic; needs per-field scoring' },
        { id: 'debug_trace', title: 'Debug trace', status: 'met', notes: 'Per-rule why outputs' },
        { id: 'health_endpoints', title: 'Health endpoints', status: 'met', notes: '/api/health, OCR /health' },
        { id: 'no_seed_mode', title: 'No template seed mode', status: 'met', notes: 'Default; demo only via flag' },
        { id: 'schema_validation', title: 'JSON Schema validation', status: 'met', notes: 'AJV in tests' },
        { id: 'dev_launcher', title: 'Dev all-in-one launcher', status: 'met', notes: 'scripts/dev-all.sh' }
      ]
    };
  }
}

export function buildCoverage() {
  const reqs = loadRequirements();
  const items = reqs.items.map(it => ({
    id: it.id,
    title: it.title,
    status: it.status,
    notes: it.notes || null
  }));
  const counts = items.reduce((acc, it) => {
    acc[it.status] = (acc[it.status] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { met: 0, partial: 0, gap: 0, total: 0 });

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0',
    summary: { met: counts.met, partial: counts.partial, gap: counts.gap, total: counts.total },
    items
  };
}
