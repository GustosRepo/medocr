// Human-readable phrases for internal action/flag codes
export const ACTION_LABELS = {
  // Core workflow actions
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
  dme_evaluation_needed: 'DME evaluation needed before testing',
  // CPT / test-selection actions
  review_cpt_multiple: 'Multiple CPT codes detected – verify correct test ordered',
  document_prior_study_evidence: 'Document prior study evidence required for 95811',
  review_indication: 'Review clinical indication for ordered test',
  review_titration_justification: 'Verify titration justification (CPAP failure/intolerance)',
  consider_inlab_over_hsat: 'Consider in-lab study – comorbidities present',
  evaluate_hsat_prerequisite: 'Evaluate HSAT prerequisite requirements',
  // Insurance / authorization actions
  insurance_not_accepted: 'Insurance not accepted – verify coverage',
  obtain_pcp_referral: 'Obtain PCP/HMO referral before scheduling',
  // Prior study / evidence actions
  prior_study_evidence_present: 'Prior study evidence confirmed',
  // DME actions
  review_dme_required: 'DME review required before testing',
  // Flag reasons (shown in Reasons list)
  cpt_multiple_detected: 'Multiple CPT codes detected',
  cpt_95811_without_evidence: '95811 ordered – no prior study evidence found',
  cpt_95811_lacks_support: '95811 lacks supporting documentation',
  titration_requires_clinical_review: 'Titration order requires clinical review',
  preauth_required_possible: 'Pre-authorization may be required',
};

export function mapAction(code) { return ACTION_LABELS[code] || code.replace(/_/g,' '); }
export function mapActions(list=[]) { return [...new Set(list)].map(mapAction); }