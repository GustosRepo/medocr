/**
 * RuleEngine: Universal dynamic rule-based scoring system
 * 
 * Loads field-specific patterns from JSON files and applies intelligent scoring
 * based on pattern matching, label detection, and context analysis.
 * 
 * Supports: carriers, CPT codes, ICD codes, credentials, phone classifiers, templates
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RuleEngine {
  constructor() {
    this.carrierRules = [];
    this.cptRules = [];
    this.icdRules = [];
    this.credentialRules = [];
    this.phoneClassifierRules = null;
    this.templateRules = [];
    
    this.loadAllRules();
  }

  /**
   * Load all rule types from JSON files
   */
  loadAllRules() {
    this.loadCarrierRules();
    this.loadCptRules();
    this.loadIcdRules();
    this.loadCredentialRules();
    this.loadPhoneClassifierRules();
    this.loadTemplateRules();
  }

  /**
   * Generic rule loader
   */
  loadRulesFromDirectory(directory, validator = null) {
    const rulesDir = path.join(__dirname, '../data', directory);
    const rules = [];
    
    try {
      if (!fs.existsSync(rulesDir)) {
        console.warn(`[RuleEngine] Directory not found: ${directory}`);
        return rules;
      }

      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));
      
      for (const file of files) {
        try {
          const filePath = path.join(rulesDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const rule = JSON.parse(content);
          
          // Validate if validator provided
          if (!validator || validator(rule)) {
            rules.push(rule);
          } else {
            console.warn(`[RuleEngine] Invalid rule structure in ${directory}/${file}`);
          }
        } catch (err) {
          console.error(`[RuleEngine] Error loading ${directory}/${file}:`, err.message);
        }
      }

      console.log(`[RuleEngine] Loaded ${rules.length} rules from ${directory}`);
    } catch (err) {
      console.error(`[RuleEngine] Error loading rules from ${directory}:`, err.message);
    }
    
    return rules;
  }

  /**
   * Load carrier rules
   */
  loadCarrierRules() {
    this.carrierRules = this.loadRulesFromDirectory('carriers', (rule) => {
      return rule.carrier && rule.patterns && rule.patterns.memberId;
    });
  }

  /**
   * Load CPT code rules
   */
  loadCptRules() {
    const rules = this.loadRulesFromDirectory('cpt', (rule) => {
      return rule.category && Array.isArray(rule.codes);
    });
    
    // Flatten codes from all category files and add category to each code
    this.cptRules = rules.flatMap(r => 
      (r.codes || []).map(code => ({
        ...code,
        category: r.category
      }))
    );
    
    console.log(`[RuleEngine] Flattened ${this.cptRules.length} CPT codes from ${rules.length} categories`);
  }

  /**
   * Load ICD code rules
   */
  loadIcdRules() {
    const rules = this.loadRulesFromDirectory('icd', (rule) => {
      return rule.category && Array.isArray(rule.codes);
    });
    
    // Flatten codes from all category files and add category to each code
    this.icdRules = rules.flatMap(r => 
      (r.codes || []).map(code => ({
        ...code,
        category: r.category
      }))
    );
    
    console.log(`[RuleEngine] Flattened ${this.icdRules.length} ICD-10 codes from ${rules.length} categories`);
  }

  /**
   * Load credential rules
   */
  loadCredentialRules() {
    const rules = this.loadRulesFromDirectory('credentials', (rule) => {
      return Array.isArray(rule.credentials);
    });
    
    // Flatten credentials from all files
    this.credentialRules = rules.flatMap(r => r.credentials || []);
  }

  /**
   * Load phone classifier rules (single file)
   */
  loadPhoneClassifierRules() {
    const filePath = path.join(__dirname, '../data/phone_classifiers.json');
    
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        this.phoneClassifierRules = JSON.parse(content);
        console.log('[RuleEngine] Loaded phone classifier rules');
      }
    } catch (err) {
      console.error('[RuleEngine] Error loading phone classifier rules:', err.message);
    }
  }

  /**
   * Load template rules
   */
  loadTemplateRules() {
    this.templateRules = this.loadRulesFromDirectory('templates', (rule) => {
      return rule.templateId && rule.fingerprint;
    });
  }

  /**
   * Validate rule structure
   */
  validateRule(rule) {
    return rule.carrier && 
           rule.patterns && 
           rule.patterns.memberId && 
           Array.isArray(rule.patterns.memberId);
  }

  /**
   * Find carrier rule by name (with fuzzy matching via synonyms)
   */
  findCarrierRule(carrierName) {
    if (!carrierName) return null;

    const normalized = carrierName.toLowerCase().trim();

    return this.carrierRules.find(rule => {
      // Exact match on carrier name
      if (rule.carrier.toLowerCase() === normalized) return true;
      
      // Check synonyms
      if (rule.synonyms && Array.isArray(rule.synonyms)) {
        return rule.synonyms.some(syn => syn.toLowerCase() === normalized);
      }
      
      return false;
    });
  }

  /**
   * Score a member ID candidate using carrier-specific rules
   * 
   * @param {Object} candidate - The candidate to score
   * @param {string} candidate.value - The member ID value
   * @param {string} candidate.label - The label used (e.g., "INSURANCE ID")
   * @param {string} candidate.sectionType - Where it was found (e.g., "insurance_section")
   * @param {string} carrierName - The detected carrier name
   * @param {Object} context - Additional context (proximity, pageIndex, etc.)
   * @returns {Object} { score, reasons, matchedPattern }
   */
  scoreCandidate(candidate, carrierName, context = {}) {
    const carrierRule = this.findCarrierRule(carrierName);
    
    if (!carrierRule) {
      return this.genericScore(candidate, context);
    }

    let score = 0;
    const reasons = [];
    let matchedPattern = null;

    // 1. Pattern matching (highest weight)
    for (const patternDef of carrierRule.patterns.memberId || []) {
      try {
        const regex = new RegExp(patternDef.pattern, 'i');
        if (regex.test(candidate.value)) {
          score += patternDef.score;
          matchedPattern = patternDef.name;
          reasons.push(`pattern:${patternDef.name}(+${patternDef.score})`);
          
          // Deprecated patterns get penalty
          if (patternDef.deprecated) {
            score -= 5;
            reasons.push('deprecated_format(-5)');
          }
          
          break; // Only match first pattern
        }
      } catch (err) {
        console.error(`[RuleEngine] Invalid regex in pattern: ${patternDef.pattern}`);
      }
    }

    // 2. Label matching
    if (candidate.label && carrierRule.labels && carrierRule.labels.memberId) {
      const normalizedLabel = candidate.label.toLowerCase().trim();
      const matchedLabel = carrierRule.labels.memberId.find(label => 
        normalizedLabel.includes(label.toLowerCase())
      );
      
      if (matchedLabel) {
        const labelScore = 20;
        score += labelScore;
        reasons.push(`label_match:${matchedLabel}(+${labelScore})`);
      }
    }

    // 3. Section preference
    if (candidate.sectionType && carrierRule.sections) {
      if (candidate.sectionType === carrierRule.sections.preferredLocation) {
        score += 15;
        reasons.push(`preferred_section(+15)`);
      }
      
      if (carrierRule.sections.avoidLocations?.includes(candidate.sectionType)) {
        score -= 30;
        reasons.push(`avoid_section(-30)`);
      }
    }

    // 4. Validation rules
    if (carrierRule.validation) {
      const validation = carrierRule.validation;
      
      // Length validation
      if (validation.memberIdLength) {
        const len = String(candidate.value).length;
        if (len < validation.memberIdLength.min || len > validation.memberIdLength.max) {
          score -= 20;
          reasons.push(`length_invalid(-20)`);
        }
      }
      
      // Alphanumeric requirement
      if (validation.mustHaveAlphanumeric) {
        const hasLetter = /[A-Z]/i.test(candidate.value);
        const hasDigit = /\d/.test(candidate.value);
        if (!hasLetter || !hasDigit) {
          score -= 15;
          reasons.push(`missing_alphanumeric(-15)`);
        }
      }
      
      // Cannot be all numeric
      if (validation.cannotBeAllNumeric && /^\d+$/.test(candidate.value)) {
        score -= 10;
        reasons.push(`all_numeric_invalid(-10)`);
      }
      
      // Exclude patterns (known bad patterns)
      if (validation.excludePatterns) {
        for (const excludePattern of validation.excludePatterns) {
          try {
            if (new RegExp(excludePattern).test(candidate.value)) {
              score -= 40;
              reasons.push(`excluded_pattern(-40)`);
              break;
            }
          } catch (err) {
            console.error(`[RuleEngine] Invalid exclude pattern: ${excludePattern}`);
          }
        }
      }
    }

    return {
      score,
      reasons,
      matchedPattern,
      carrierRule: carrierRule.carrier
    };
  }

  /**
   * Generic scoring for unknown carriers (fallback)
   */
  genericScore(candidate, context = {}) {
    let score = 10; // Base score for any candidate
    const reasons = ['generic_fallback(+10)'];

    // Basic alphanumeric check
    if (/[A-Z]/i.test(candidate.value) && /\d/.test(candidate.value)) {
      score += 8;
      reasons.push('alphanumeric(+8)');
    }

    // Length preference
    const len = String(candidate.value).length;
    if (len >= 8 && len <= 12) {
      score += 5;
      reasons.push('optimal_length(+5)');
    }

    return { score, reasons, matchedPattern: null, carrierRule: null };
  }

  /**
   * Score a CPT code candidate
   */
  scoreCptCandidate(cptCode, context = {}) {
    let bestScore = 0;
    let matchedRule = null;
    const reasons = [];

    for (const ruleFile of this.cptRules) {
      for (const codeRule of ruleFile.codes || []) {
        if (codeRule.code === cptCode) {
          let score = codeRule.score || 10;
          
          // Keyword matching in context
          if (codeRule.keywords && context.text) {
            const textLower = context.text.toLowerCase();
            const matchedKeywords = codeRule.keywords.filter(kw => 
              textLower.includes(kw.toLowerCase())
            );
            
            if (matchedKeywords.length > 0) {
              const keywordBonus = matchedKeywords.length * 5;
              score += keywordBonus;
              reasons.push(`keywords:${matchedKeywords.join(',')}(+${keywordBonus})`);
            }
          }
          
          // ICD requirement check
          if (codeRule.requiresICD && context.icdCodes) {
            const hasRequiredICD = codeRule.requiresICD.some(icd => 
              context.icdCodes.includes(icd)
            );
            
            if (hasRequiredICD) {
              score += 10;
              reasons.push('required_icd_present(+10)');
            } else {
              score -= 10;
              reasons.push('missing_required_icd(-10)');
            }
          }
          
          // Conflict detection
          if (codeRule.conflictsWith && context.detectedCpts) {
            const hasConflict = codeRule.conflictsWith.some(conflictCode => 
              context.detectedCpts.includes(conflictCode)
            );
            
            if (hasConflict) {
              score -= 15;
              reasons.push('code_conflict(-15)');
            }
          }
          
          if (score > bestScore) {
            bestScore = score;
            matchedRule = codeRule;
          }
          
          break; // Found the code
        }
      }
    }

    return {
      score: bestScore,
      reasons,
      matchedRule: matchedRule?.name || null
    };
  }

  /**
   * Score an ICD code candidate
   */
  scoreIcdCandidate(icdCode, context = {}) {
    let bestScore = 0;
    let matchedRule = null;
    const reasons = [];

    for (const ruleFile of this.icdRules) {
      for (const codeRule of ruleFile.codes || []) {
        if (codeRule.code === icdCode) {
          let score = codeRule.priority || 10;
          
          // Primary diagnosis eligibility
          if (context.isPrimary && !codeRule.canBePrimary) {
            score -= 50;
            reasons.push('cannot_be_primary(-50)');
          }
          
          // Must be secondary to another code
          if (codeRule.mustBeSecondaryTo && context.allIcdCodes) {
            const hasRequiredPrimary = codeRule.mustBeSecondaryTo.some(primaryIcd => 
              context.allIcdCodes.includes(primaryIcd)
            );
            
            if (!hasRequiredPrimary) {
              score -= 30;
              reasons.push('missing_required_primary(-30)');
            }
          }
          
          // Keyword matching
          if (codeRule.keywords && context.text) {
            const textLower = context.text.toLowerCase();
            const matchedKeywords = codeRule.keywords.filter(kw => 
              textLower.includes(kw.toLowerCase())
            );
            
            if (matchedKeywords.length > 0) {
              const keywordBonus = matchedKeywords.length * 8;
              score += keywordBonus;
              reasons.push(`keywords:${matchedKeywords.join(',')}(+${keywordBonus})`);
            }
          }
          
          if (score > bestScore) {
            bestScore = score;
            matchedRule = codeRule;
          }
          
          break;
        }
      }
    }

    return {
      score: bestScore,
      reasons,
      matchedRule: matchedRule?.name || null
    };
  }

  /**
   * Detect credential from text
   */
  detectCredential(text) {
    const results = [];
    
    for (const credRule of this.credentialRules) {
      for (const pattern of credRule.patterns || []) {
        try {
          const regex = new RegExp(pattern, 'gi');
          if (regex.test(text)) {
            results.push({
              abbr: credRule.abbr,
              fullName: credRule.fullName,
              score: credRule.score || 10,
              pattern: pattern
            });
          }
        } catch (err) {
          console.error(`[RuleEngine] Invalid credential pattern: ${pattern}`);
        }
      }
    }
    
    // Return highest scoring credential
    return results.sort((a, b) => b.score - a.score)[0] || null;
  }

  /**
   * Classify phone number type (fax vs mobile vs office)
   */
  classifyPhone(phoneNumber, context = {}) {
    if (!this.phoneClassifierRules) {
      return { type: 'unknown', score: 0 };
    }

    // Check business number database
    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    const businessMatch = this.phoneClassifierRules.businessNumbers?.find(
      bn => bn.number === normalizedPhone
    );
    
    if (businessMatch) {
      return {
        type: businessMatch.type,
        score: businessMatch.confidence || 100,
        carrier: businessMatch.carrier,
        source: 'business_db'
      };
    }

    // Pattern-based classification
    if (context.label) {
      const labelLower = context.label.toLowerCase();
      
      for (const [type, config] of Object.entries(this.phoneClassifierRules.patterns || {})) {
        const matchedLabel = config.labels?.find(label => 
          labelLower.includes(label.toLowerCase())
        );
        
        if (matchedLabel) {
          return {
            type,
            score: config.score || 10,
            matchedLabel,
            source: 'label_pattern'
          };
        }
      }
    }

    return { type: 'unknown', score: 0 };
  }

  /**
   * Identify document template
   */
  identifyTemplate(doc) {
    const text = doc.rawTextCombined || '';
    const pageCount = doc.rawOCR?.length || 0;
    
    for (const template of this.templateRules) {
      let matchScore = 0;
      
      // Check must-contain phrases
      if (template.fingerprint.mustContain) {
        const matches = template.fingerprint.mustContain.filter(phrase => 
          text.includes(phrase)
        );
        matchScore = (matches.length / template.fingerprint.mustContain.length) * 100;
      }
      
      // Check page count
      if (template.fingerprint.typicalPages) {
        const [minPages, maxPages] = template.fingerprint.typicalPages;
        if (pageCount >= minPages && pageCount <= maxPages) {
          matchScore += 20;
        }
      }
      
      // Return first template with >70% match
      if (matchScore > 70) {
        return {
          templateId: template.templateId,
          matchScore,
          zones: template.zones
        };
      }
    }
    
    return null;
  }

  /**
   * Get all loaded carriers
   */
  getLoadedCarriers() {
    return this.carrierRules.map(rule => ({
      carrier: rule.carrier,
      status: rule.status,
      synonymCount: rule.synonyms?.length || 0,
      patternCount: rule.patterns?.memberId?.length || 0
    }));
  }

  /**
   * Get statistics about loaded rules
   */
  getStats() {
    return {
      carriers: this.carrierRules.length,
      cptCategories: this.cptRules.length,
      cptCodes: this.cptRules.reduce((sum, r) => sum + (r.codes?.length || 0), 0),
      icdCategories: this.icdRules.length,
      icdCodes: this.icdRules.reduce((sum, r) => sum + (r.codes?.length || 0), 0),
      credentials: this.credentialRules.length,
      templates: this.templateRules.length,
      phoneClassifiers: this.phoneClassifierRules ? 'loaded' : 'not loaded'
    };
  }

  /**
   * Reload rules from disk (useful for hot-reloading in dev)
   */
  reload() {
    this.carrierRules = [];
    this.cptRules = [];
    this.icdRules = [];
    this.credentialRules = [];
    this.phoneClassifierRules = null;
    this.templateRules = [];
    
    this.loadAllRules();
    console.log('[RuleEngine] All rules reloaded:', this.getStats());
  }
}

// Singleton instance
const ruleEngine = new RuleEngine();

export default ruleEngine;
