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
 */

class DecisionTreeEngine {
  constructor() {
    // Field requirements by category
    this.requiredFields = {
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
   * Level 1: Completeness Check
   * Validates that essential fields are present
   */
  checkCompleteness(data) {
    const missingFields = [];
    
    // Check patient basics
    if (!data.firstName || data.firstName.trim() === '') missingFields.push('firstName');
    if (!data.lastName || data.lastName.trim() === '') missingFields.push('lastName');
    if (!data.dob) missingFields.push('dob');
    
    // Check contact info
    if (!data.phone && !data.email) missingFields.push('phone or email');
    
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
   */
  checkInsurance(data) {
    const issues = [];
    
    if (!data.insuranceName || data.insuranceName.trim() === '') {
      issues.push('Insurance name missing');
    }
    
    if (!data.memberId || data.memberId.trim() === '') {
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
   */
  checkClinical(data) {
    const issues = [];
    
    if (!data.diagnosis || data.diagnosis.trim() === '') {
      issues.push('Diagnosis missing');
    }
    
    if (!data.referralReason && !data.chiefComplaint) {
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
   */
  checkProvider(data) {
    const issues = [];
    
    if (!data.referringProvider || data.referringProvider.trim() === '') {
      issues.push('Referring provider name missing');
    }
    
    if (!data.providerNPI) {
      issues.push('Provider NPI missing');
    }
    
    if (!data.providerPhone && !data.providerFax) {
      issues.push('Provider contact information missing');
    }

    const passed = issues.length === 0;

    return {
      level: 4,
      name: 'Provider Check',
      passed,
      severity: passed ? 'success' : 'warning',
      issues,
      message: passed 
        ? 'Provider information complete'
        : `Provider issues: ${issues.join(', ')}`,
      requiredAction: issues.length > 0 ? 'PROVIDER_FOLLOWUP' : null
    };
  }

  /**
   * Level 5: Demographics Check
   * Validates patient demographic information
   */
  checkDemographics(data) {
    const issues = [];
    
    if (!data.address || data.address.trim() === '') {
      issues.push('Address missing');
    }
    
    if (!data.city || data.city.trim() === '') {
      issues.push('City missing');
    }
    
    if (!data.state || data.state.trim() === '') {
      issues.push('State missing');
    }
    
    if (!data.zip || data.zip.trim() === '') {
      issues.push('ZIP code missing');
    }
    
    // Validate DOB format
    if (data.dob && !this._isValidDate(data.dob)) {
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
   */
  _checkAuthorizationRequired(data) {
    const authKeywords = [
      'sleep study', 'cpap', 'polysomnography', 'hsat',
      'dme', 'durable medical equipment', 'home sleep test'
    ];

    const diagnosisText = (data.diagnosis || '').toLowerCase();
    const reasonText = (data.referralReason || '').toLowerCase();
    const combinedText = `${diagnosisText} ${reasonText}`;

    return authKeywords.some(keyword => combinedText.includes(keyword));
  }

  /**
   * Check for urgent clinical keywords
   */
  _checkUrgentKeywords(data) {
    const urgentKeywords = [
      'urgent', 'stat', 'emergency', 'acute', 'severe',
      'critical', 'immediate', 'asap'
    ];

    const diagnosisText = (data.diagnosis || '').toLowerCase();
    const reasonText = (data.referralReason || '').toLowerCase();
    const notesText = (data.clinicalNotes || '').toLowerCase();
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
