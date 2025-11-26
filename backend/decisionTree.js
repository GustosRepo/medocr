/**
 * Decision Tree Engine for Medical Referral Routing
 * 
 * Five-level validation pipeline:
 * 1. Completeness Check - Are required fields present?
 * 2. Insurance Check - Is insurance valid and verified?
 * 3. Clinical Check - Are clinical requirements met?
 * 4. Provider Check - Is provider information complete?
 * 5. Demographics Check - Are patient demographics complete?
 * 
 * Routes documents to appropriate workflow based on validation results.
 * 
 * DYNAMIC VALIDATION: Supports flexible field paths to handle different document layouts
 */

import { getNestedValue, isPlaceholder } from './utils/fieldNormalizer.js';

class DecisionTreeEngine {
  constructor(options = {}) {
    // Configurable field requirements by category
    this.requiredFields = options.requiredFields || {
      patient: ['firstName', 'lastName', 'dob', 'phone'],
      insurance: ['insuranceName', 'memberId'],
      clinical: ['diagnosis', 'referralReason'],
      provider: ['referringProvider', 'providerNPI'],
      demographics: ['address', 'city', 'state', 'zip']
    };

    // Routing actions in priority order
    this.routingActions = {
      READY_TO_SCHEDULE: {
        priority: 1,
        label: 'Ready to Schedule',
        description: 'All validations passed, ready for appointment scheduling',
        estimatedTime: '5 minutes',
        color: 'green'
      },
      INSURANCE_VERIFICATION: {
        priority: 2,
        label: 'Insurance Verification Needed',
        description: 'Insurance information incomplete or needs verification',
        estimatedTime: '15-30 minutes',
        color: 'yellow'
      },
      AUTHORIZATION_REQUEST: {
        priority: 3,
        label: 'Authorization Request Required',
        description: 'Prior authorization needed from insurance',
        estimatedTime: '1-3 business days',
        color: 'orange'
      },
      PROVIDER_FOLLOWUP: {
        priority: 4,
        label: 'Provider Follow-up Required',
        description: 'Missing clinical information, need provider clarification',
        estimatedTime: '1-2 business days',
        color: 'orange'
      },
      MANUAL_REVIEW: {
        priority: 5,
        label: 'Manual Review Required',
        description: 'Multiple issues detected, requires human review',
        estimatedTime: '30-60 minutes',
        color: 'red'
      }
    };
  }

  /**
   * Main decision tree evaluation
   * @param {Object} extractedData - Merged OCR + LLM data
   * @param {Object} validationResult - Validation metadata from dual-engine processing
   * @returns {Object} Routing decision with actions and validation details
   */
  evaluate(extractedData, validationResult = {}) {
    const validationSteps = [
      this.checkCompleteness(extractedData),
      this.checkInsurance(extractedData),
      this.checkClinical(extractedData),
      this.checkProvider(extractedData),
      this.checkDemographics(extractedData)
    ];

    const route = this.determineRoute(validationSteps, validationResult);

    return {
      route,
      validationSteps,
      timestamp: new Date().toISOString(),
      processingMetadata: {
        agreementScore: validationResult.agreementScore || null,
        conflictCount: validationResult.conflicts?.length || 0,
        dataQuality: this._assessDataQuality(validationSteps)
      }
    };
  }

  /**
   * Helper: Get field value from multiple possible paths
   */
  _getFieldValue(data, fieldName) {
    const possiblePaths = [
      fieldName, // Direct access
      `patient.${fieldName}`, // Nested in patient
      `patient${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`, // patientFirstName
      fieldName.replace('patient', '').charAt(0).toLowerCase() + fieldName.replace('patient', '').slice(1) // Remove patient prefix
    ];
    
    for (const path of possiblePaths) {
      const value = getNestedValue(data, path);
      if (value !== undefined && value !== null && !isPlaceholder(value)) {
        return value;
      }
    }
    
    return null;
  }

  /**
   * Helper: Check if any field value exists from multiple paths
   * Also handles array format (e.g., insurance[0].memberId)
   */
  _hasFieldValue(data, ...fieldNames) {
    return fieldNames.some(fieldName => {
      const value = this._getFieldValue(data, fieldName);
      if (value !== null && value !== undefined && !isPlaceholder(value)) {
        return true;
      }
      
      // Check array format: e.g., insurance[0].fieldName
      const arrayMatch = fieldName.match(/^([^.]+)\.(.+)$/);
      if (arrayMatch) {
        const [, baseField, subField] = arrayMatch;
        const arrayData = data[baseField];
        if (Array.isArray(arrayData) && arrayData.length > 0) {
          const val = arrayData[0][subField];
          if (val !== null && val !== undefined && !isPlaceholder(val)) {
            return true;
          }
        }
      }
      
      return false;
    });
  }

  /**
   * Level 1: Completeness Check
   * Validates that essential fields are present
   * DYNAMIC: Checks multiple possible field paths
   */
  checkCompleteness(data) {
    const missingFields = [];
    
    // Check patient basics - try multiple field paths
    if (!this._hasFieldValue(data, 'firstName', 'patient.firstName', 'patientFirstName')) {
      missingFields.push('firstName');
    }
    if (!this._hasFieldValue(data, 'lastName', 'patient.lastName', 'patientLastName')) {
      missingFields.push('lastName');
    }
    if (!this._hasFieldValue(data, 'dob', 'patient.dob', 'dateOfBirth', 'patient.dateOfBirth')) {
      missingFields.push('dob');
    }
    
    // Check contact info - at least one method required
    const hasPhone = this._hasFieldValue(data, 'phone', 'patient.phone', 'patientPhone', 'phoneNumber');
    const hasEmail = this._hasFieldValue(data, 'email', 'patient.email', 'patientEmail');
    
    if (!hasPhone && !hasEmail) {
      missingFields.push('phone or email');
    }
    
    const passed = missingFields.length === 0;

    return {
      level: 1,
      name: 'Completeness Check',
      passed,
      severity: passed ? 'success' : 'critical',
      missingFields,
      message: passed 
        ? 'All required fields present'
        : `Missing required fields: ${missingFields.join(', ')}`,
      requiredAction: passed ? null : 'MANUAL_REVIEW'
    };
  }

  /**
   * Level 2: Insurance Check
   * Validates insurance information completeness
   * DYNAMIC: Checks multiple possible field paths
   */
  checkInsurance(data) {
    const issues = [];
    
    // Check insurance name/carrier (extraction uses 'carrier' field)
    if (!this._hasFieldValue(data, 'insuranceName', 'insurance.insuranceName', 'insurance.name', 'insurance.carrier', 'insuranceCompany')) {
      issues.push('Insurance name missing');
    }
    
    // Check member ID (handle array format from extraction)
    const hasDirectMemberId = this._hasFieldValue(data, 'memberId', 'insurance.memberId', 'insuranceMemberId', 'policyNumber', 'insurance.policyNumber');
    const hasArrayMemberId = Array.isArray(data.insurance) && data.insurance[0]?.memberId;
    if (!hasDirectMemberId && !hasArrayMemberId) {
      issues.push('Member ID missing');
    }
    
    // Check for authorization indicators
    const needsAuth = this._checkAuthorizationRequired(data);
    if (needsAuth) {
      issues.push('Prior authorization may be required');
    }

    const passed = issues.length === 0;

    return {
      level: 2,
      name: 'Insurance Check',
      passed,
      severity: passed ? 'success' : 'warning',
      issues,
      needsAuthorization: needsAuth,
      message: passed 
        ? 'Insurance information complete'
        : `Insurance issues: ${issues.join(', ')}`,
      requiredAction: needsAuth ? 'AUTHORIZATION_REQUEST' : 
                      issues.length > 0 ? 'INSURANCE_VERIFICATION' : null
    };
  }

  /**
   * Level 3: Clinical Check
   * Validates clinical information and requirements
   * DYNAMIC: Checks multiple possible field paths
   */
  checkClinical(data) {
    const issues = [];
    
    // Check diagnosis (handle object format: clinical.primaryDiagnosis.code)
    const hasDiagnosisCode = this._hasFieldValue(data, 'diagnosis', 'clinical.diagnosis', 'primaryDiagnosis', 'diagnosisCode', 'clinical.primaryDiagnosis.code');
    const hasDiagnosisObj = data.clinical?.primaryDiagnosis?.code;
    const hasDiagnosesArray = Array.isArray(data.diagnoses) && data.diagnoses.length > 0;
    
    if (!hasDiagnosisCode && !hasDiagnosisObj && !hasDiagnosesArray) {
      issues.push('Diagnosis missing');
    }
    
    // Check referral reason or chief complaint (also check symptoms as they often contain clinical context)
    const hasReason = this._hasFieldValue(data, 'referralReason', 'clinical.referralReason', 'reasonForReferral');
    const hasComplaint = this._hasFieldValue(data, 'chiefComplaint', 'clinical.chiefComplaint', 'complaint');
    const hasSymptoms = this._hasFieldValue(data, 'symptoms', 'clinical.symptoms', 'symptomsPresent');
    const hasSymptomsArray = Array.isArray(data.symptoms) && data.symptoms.length > 0;
    
    if (!hasReason && !hasComplaint && !hasSymptoms && !hasSymptomsArray) {
      issues.push('Referral reason or chief complaint missing');
    }
    
    // Check for critical clinical flags
    const hasUrgentKeywords = this._checkUrgentKeywords(data);
    if (hasUrgentKeywords) {
      issues.push('Urgent clinical indicators detected');
    }

    const passed = issues.length === 0 || (issues.length === 1 && hasUrgentKeywords);

    return {
      level: 3,
      name: 'Clinical Check',
      passed,
      severity: hasUrgentKeywords ? 'critical' : (passed ? 'success' : 'warning'),
      issues,
      isUrgent: hasUrgentKeywords,
      message: passed 
        ? 'Clinical information adequate'
        : `Clinical issues: ${issues.join(', ')}`,
      requiredAction: issues.filter(i => !i.includes('Urgent')).length > 0 ? 'PROVIDER_FOLLOWUP' : null
    };
  }

  /**
   * Level 4: Provider Check
   * Validates referring provider information
   * DYNAMIC: Checks multiple possible field paths, more lenient on NPI
   */
  checkProvider(data) {
    const issues = [];
    
    // Check provider name
    if (!this._hasFieldValue(data, 'referringProvider', 'provider.referringProvider', 'provider.name', 'providerName', 'referringPhysician')) {
      issues.push('Referring provider name missing');
    }
    
    // Check NPI - not required if provider name present
    const hasNPI = this._hasFieldValue(data, 'providerNPI', 'provider.npi', 'provider.providerNPI', 'npi');
    if (!hasNPI) {
      // NPI can be looked up if we have provider name, so this is a warning not blocker
      issues.push('Provider NPI missing (can be looked up)');
    }
    
    // Check contact info
    const hasPhone = this._hasFieldValue(data, 'providerPhone', 'provider.phone', 'provider.providerPhone', 'referringProviderPhone');
    const hasFax = this._hasFieldValue(data, 'providerFax', 'provider.fax', 'provider.providerFax', 'referringProviderFax');
    
    if (!hasPhone && !hasFax) {
      issues.push('Provider contact information missing');
    }

    // Pass if only NPI is missing (can be looked up)
    const criticalIssues = issues.filter(i => !i.includes('can be looked up'));
    const passed = criticalIssues.length === 0;

    return {
      level: 4,
      name: 'Provider Check',
      passed,
      severity: passed ? 'success' : 'warning',
      issues,
      message: passed 
        ? 'Provider information complete'
        : `Provider issues: ${issues.join(', ')}`,
      requiredAction: criticalIssues.length > 0 ? 'PROVIDER_FOLLOWUP' : null
    };
  }

  /**
   * Level 5: Demographics Check
   * Validates patient demographic information
   * DYNAMIC: Checks multiple possible field paths
   */
  checkDemographics(data) {
    const issues = [];
    
    // Check address
    if (!this._hasFieldValue(data, 'address', 'patient.address', 'patientAddress', 'streetAddress')) {
      issues.push('Address missing');
    }
    
    // Check city
    if (!this._hasFieldValue(data, 'city', 'patient.city', 'patientCity')) {
      issues.push('City missing');
    }
    
    // Check state
    if (!this._hasFieldValue(data, 'state', 'patient.state', 'patientState')) {
      issues.push('State missing');
    }
    
    // Check ZIP
    if (!this._hasFieldValue(data, 'zip', 'patient.zip', 'zipCode', 'patient.zipCode', 'postalCode')) {
      issues.push('ZIP code missing');
    }
    
    // Validate DOB format
    const dobValue = this._getFieldValue(data, 'dob') || this._getFieldValue(data, 'dateOfBirth');
    if (dobValue && !this._isValidDate(dobValue)) {
      issues.push('Date of birth format invalid');
    }

    const passed = issues.length === 0;

    return {
      level: 5,
      name: 'Demographics Check',
      passed,
      severity: passed ? 'success' : 'warning',
      issues,
      message: passed 
        ? 'Demographics complete'
        : `Demographics issues: ${issues.join(', ')}`,
      requiredAction: issues.length > 2 ? 'MANUAL_REVIEW' : null
    };
  }

  /**
   * Determine final routing decision based on validation steps
   * @param {Array} validationSteps - Results from all validation levels
   * @param {Object} validationResult - Metadata from dual-engine processing
   * @returns {Object} Routing decision
   */
  determineRoute(validationSteps, validationResult) {
    // Check for critical failures
    const criticalFailures = validationSteps.filter(
      step => !step.passed && step.severity === 'critical'
    );
    
    if (criticalFailures.length > 0) {
      return this._buildRouteResponse('MANUAL_REVIEW', validationSteps, {
        reason: 'Critical validation failures detected',
        details: criticalFailures.map(f => f.message)
      });
    }

    // Check for low agreement score (conflicts between OCR and LLM)
    if (validationResult.agreementScore && validationResult.agreementScore < 70) {
      return this._buildRouteResponse('MANUAL_REVIEW', validationSteps, {
        reason: `Low agreement score (${validationResult.agreementScore}%)`,
        details: ['Significant discrepancies between OCR and AI extraction']
      });
    }

    // Collect all required actions from validation steps
    const requiredActions = validationSteps
      .filter(step => step.requiredAction)
      .map(step => step.requiredAction);

    // If no actions required, ready to schedule
    if (requiredActions.length === 0) {
      return this._buildRouteResponse('READY_TO_SCHEDULE', validationSteps, {
        reason: 'All validation checks passed',
        details: ['Document is complete and ready for processing']
      });
    }

    // Priority-based routing
    // 1. Authorization (highest priority after critical issues)
    if (requiredActions.includes('AUTHORIZATION_REQUEST')) {
      return this._buildRouteResponse('AUTHORIZATION_REQUEST', validationSteps, {
        reason: 'Prior authorization required',
        details: validationSteps.find(s => s.requiredAction === 'AUTHORIZATION_REQUEST')?.issues || []
      });
    }

    // 2. Insurance verification
    if (requiredActions.includes('INSURANCE_VERIFICATION')) {
      return this._buildRouteResponse('INSURANCE_VERIFICATION', validationSteps, {
        reason: 'Insurance information needs verification',
        details: validationSteps.find(s => s.requiredAction === 'INSURANCE_VERIFICATION')?.issues || []
      });
    }

    // 3. Provider follow-up
    if (requiredActions.includes('PROVIDER_FOLLOWUP')) {
      return this._buildRouteResponse('PROVIDER_FOLLOWUP', validationSteps, {
        reason: 'Missing information requires provider follow-up',
        details: validationSteps.filter(s => s.requiredAction === 'PROVIDER_FOLLOWUP')
                               .flatMap(s => s.issues || [])
      });
    }

    // 4. Multiple issues = manual review
    if (requiredActions.length > 2) {
      return this._buildRouteResponse('MANUAL_REVIEW', validationSteps, {
        reason: 'Multiple validation issues detected',
        details: validationSteps.filter(s => !s.passed).map(s => s.message)
      });
    }

    // Default to manual review for unhandled cases
    return this._buildRouteResponse('MANUAL_REVIEW', validationSteps, {
      reason: 'Document requires review',
      details: requiredActions
    });
  }

  /**
   * Build standardized route response
   */
  _buildRouteResponse(actionKey, validationSteps, context) {
    const action = this.routingActions[actionKey];
    
    return {
      action: actionKey,
      ...action,
      context,
      nextSteps: this._generateNextSteps(actionKey, validationSteps),
      validationSummary: {
        passed: validationSteps.filter(s => s.passed).length,
        failed: validationSteps.filter(s => !s.passed).length,
        total: validationSteps.length
      }
    };
  }

  /**
   * Generate actionable next steps based on routing decision
   */
  _generateNextSteps(actionKey, validationSteps) {
    const steps = [];

    switch (actionKey) {
      case 'READY_TO_SCHEDULE':
        steps.push('Contact patient to schedule appointment');
        steps.push('Confirm insurance benefits');
        steps.push('Send appointment confirmation');
        break;

      case 'INSURANCE_VERIFICATION':
        steps.push('Verify insurance eligibility');
        steps.push('Check coverage for referred services');
        steps.push('Confirm copay/deductible information');
        break;

      case 'AUTHORIZATION_REQUEST':
        steps.push('Submit prior authorization request to insurance');
        steps.push('Gather supporting clinical documentation');
        steps.push('Follow up on authorization status');
        break;

      case 'PROVIDER_FOLLOWUP':
        const providerIssues = validationSteps.filter(s => 
          s.requiredAction === 'PROVIDER_FOLLOWUP' || !s.passed
        );
        steps.push('Contact referring provider office');
        providerIssues.forEach(issue => {
          if (issue.issues?.length > 0) {
            steps.push(`Request: ${issue.issues.join(', ')}`);
          }
        });
        break;

      case 'MANUAL_REVIEW':
        steps.push('Review document for data quality issues');
        steps.push('Verify conflicting information');
        steps.push('Complete missing fields manually');
        steps.push('Escalate if unable to resolve');
        break;
    }

    return steps;
  }

  /**
   * Assess overall data quality score
   */
  _assessDataQuality(validationSteps) {
    const totalChecks = validationSteps.length;
    const passedChecks = validationSteps.filter(s => s.passed).length;
    const score = (passedChecks / totalChecks) * 100;

    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 60) grade = 'D';
    else grade = 'F';

    return {
      score: Math.round(score),
      grade,
      level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low'
    };
  }

  /**
   * Check if authorization is likely required
   * DYNAMIC: Checks multiple field paths
   */
  _checkAuthorizationRequired(data) {
    const authKeywords = [
      'sleep study', 'cpap', 'polysomnography', 'hsat',
      'dme', 'durable medical equipment', 'home sleep test'
    ];

    const diagnosisText = (this._getFieldValue(data, 'diagnosis') || '').toLowerCase();
    const reasonText = (this._getFieldValue(data, 'referralReason') || '').toLowerCase();
    const combinedText = `${diagnosisText} ${reasonText}`;

    return authKeywords.some(keyword => combinedText.includes(keyword));
  }

  /**
   * Check for urgent clinical keywords
   * DYNAMIC: Checks multiple field paths
   */
  _checkUrgentKeywords(data) {
    const urgentKeywords = [
      'urgent', 'stat', 'emergency', 'acute', 'severe',
      'critical', 'immediate', 'asap'
    ];

    const diagnosisText = (this._getFieldValue(data, 'diagnosis') || '').toLowerCase();
    const reasonText = (this._getFieldValue(data, 'referralReason') || '').toLowerCase();
    const notesText = (this._getFieldValue(data, 'clinicalNotes') || '').toLowerCase();
    const combinedText = `${diagnosisText} ${reasonText} ${notesText}`;

    return urgentKeywords.some(keyword => combinedText.includes(keyword));
  }

  /**
   * Validate date format
   */
  _isValidDate(dateString) {
    // Try to parse common date formats
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
  }
}

export { DecisionTreeEngine };
export default DecisionTreeEngine;
