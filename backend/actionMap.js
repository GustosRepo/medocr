// Human-readable phrases for internal action/flag codes
export const ACTION_LABELS = {
  missing_chart_notes: 'No chart notes – obtain documentation',
  obtain_cpap_compliance_data: 'Obtain CPAP compliance data',
  pediatric_protocol_review: 'Review pediatric protocol requirements',
  review_95811_required: 'Verify titration criteria (95811)',
  dme_compliance_data_missing: 'DME compliance data missing',
  cpt_home_and_inlab_conflict: 'Home vs in-lab CPT conflict – clarify order',
  wrong_test_ordered: 'Wrong test ordered – correct before scheduling',
  insurance_verification_needed: 'Insurance verification required',
  auth_required: 'Authorization required – submit/fax request',
  provider_followup_needed: 'Provider follow-up – more clinical documentation',
  missing_demographics: 'Missing demographics – contact provider',
  out_of_network: 'Out of network – UTS referral',
  pediatric_specialist_required: 'Pediatric specialist referral required',
  dme_evaluation_needed: 'DME evaluation needed before testing'
};

export function mapAction(code) { return ACTION_LABELS[code] || code.replace(/_/g,' '); }
export function mapActions(list=[]) { return [...new Set(list)].map(mapAction); }