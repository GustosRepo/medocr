/**
 * Field Normalizer - Adapts various document schemas to standard validation format
 * 
 * Handles:
 * - Combined vs split name formats (patient.name → firstName/lastName)
 * - Various address formats (single string → structured components)
 * - Placeholder values (—, N/A, empty) → null
 * - Client-specific field mappings
 * 
 * Purpose: Enable validation to work across different client document layouts
 */

import { log } from '../logging/logger.js';

/**
 * Detects and normalizes placeholder values
 */
function isPlaceholder(value) {
  if (!value) return true;
  if (typeof value !== 'string') return false;
  
  const placeholders = [
    '—', '–', '-', // dashes
    'N/A', 'n/a', 'NA', 'na',
    'pending', 'PENDING',
    'unknown', 'UNKNOWN',
    'TBD', 'tbd',
    '...', '...',
    'null', 'NULL',
    'None', 'none'
  ];
  
  const trimmed = value.trim();
  return trimmed === '' || placeholders.includes(trimmed);
}

/**
 * Split combined name into first/last/middle
 * Handles formats:
 * - "Last, First Middle"
 * - "First Last"
 * - "First Middle Last"
 */
function splitName(fullName) {
  if (!fullName || isPlaceholder(fullName)) {
    return { firstName: null, lastName: null, middleName: null };
  }
  
  const name = fullName.trim();
  
  // Handle "Last, First Middle" format
  if (name.includes(',')) {
    const parts = name.split(',').map(p => p.trim());
    const lastName = parts[0];
    const firstMiddle = parts[1] || '';
    const firstParts = firstMiddle.split(/\s+/);
    
    return {
      firstName: firstParts[0] || null,
      middleName: firstParts.slice(1).join(' ') || null,
      lastName: lastName || null
    };
  }
  
  // Handle "First Last" or "First Middle Last" format
  const parts = name.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null, middleName: null };
  } else if (parts.length === 2) {
    return { firstName: parts[0], lastName: parts[1], middleName: null };
  } else {
    // 3+ parts: First Middle(s) Last
    return {
      firstName: parts[0],
      middleName: parts.slice(1, -1).join(' '),
      lastName: parts[parts.length - 1]
    };
  }
}

/**
 * Parse address string into structured components
 * Handles various formats of single-line or multi-line addresses
 */
function parseAddress(addressString) {
  if (!addressString || isPlaceholder(addressString)) {
    return { address: null, city: null, state: null, zip: null };
  }
  
  const text = addressString.trim();
  
  // Try to extract ZIP (5 digits or 5+4 format)
  const zipMatch = text.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const zip = zipMatch ? zipMatch[1] : null;
  
  // Try to extract state (2-letter code before ZIP)
  const stateMatch = text.match(/\b([A-Z]{2})\s+\d{5}/);
  const state = stateMatch ? stateMatch[1] : null;
  
  // Try to extract city (word(s) before state)
  let city = null;
  if (state) {
    const cityMatch = text.match(new RegExp(`([^,\\n]+?)\\s*,?\\s*${state}`, 'i'));
    if (cityMatch) {
      city = cityMatch[1].trim();
    }
  }
  
  // Extract address (everything before city/state/zip)
  let address = text;
  if (city && state) {
    const idx = text.indexOf(city);
    if (idx > 0) {
      address = text.substring(0, idx).trim();
      // Remove trailing comma
      address = address.replace(/,\s*$/, '');
    }
  }
  
  return {
    address: address || null,
    city: city,
    state: state,
    zip: zip
  };
}

/**
 * Safely get nested property value
 */
function getNestedValue(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

/**
 * Normalize document data to standard validation schema
 * 
 * @param {Object} data - Raw extracted data from OCR/LLM
 * @param {Object} options - Normalization options
 * @param {Object} options.clientConfig - Optional client-specific field mappings
 * @returns {Object} Normalized data with standard field names
 */
function normalizeFields(data, options = {}) {
  const { clientConfig } = options;
  
  log('info', 'normalizing_fields', { 
    hasClientConfig: !!clientConfig,
    dataKeys: Object.keys(data || {}),
    patientKeys: data.patient ? Object.keys(data.patient) : []
  });
  
  const normalized = { ...data };
  
  // --- Patient Name Normalization ---
  // Try multiple possible field paths for patient name
  const namePaths = [
    'patient.name',
    'patientName',
    'name',
    'patient.fullName',
    'fullName'
  ];
  
  // Check if we already have split names (try both firstName/lastName and first/last)
  const hasFirstName = getNestedValue(data, 'patient.firstName') || data.firstName || 
                       getNestedValue(data, 'patient.first') || data.first;
  const hasLastName = getNestedValue(data, 'patient.lastName') || data.lastName ||
                      getNestedValue(data, 'patient.last') || data.last;
  
  log('info', 'name_check', { 
    hasFirstName: !!hasFirstName, 
    hasLastName: !!hasLastName,
    patientName: data.patient?.name,
    patientFirst: data.patient?.first,
    patientLast: data.patient?.last,
    patientFullName: data.patient?.fullName,
    topLevelName: data.name
  });
  
  // If we have first/last but not firstName/lastName, map them
  if (hasFirstName && hasLastName && data.patient) {
    const firstName = data.patient.firstName || data.patient.first;
    const lastName = data.patient.lastName || data.patient.last;
    const middleName = data.patient.middleName || data.patient.middle;
    
    normalized.patient = {
      ...normalized.patient,
      firstName: firstName || normalized.patient.firstName,
      lastName: lastName || normalized.patient.lastName,
      middleName: middleName || normalized.patient.middleName
    };
    
    log('info', 'name_normalized_from_split', { firstName, lastName, middleName });
  } else if (!hasFirstName || !hasLastName) {
    // Try to find combined name and split it
    let fullName = null;
    for (const path of namePaths) {
      const value = getNestedValue(data, path);
      if (value && !isPlaceholder(value)) {
        fullName = value;
        break;
      }
    }
    
    if (fullName) {
      const { firstName, lastName, middleName } = splitName(fullName);
      
      // Add to patient object if it exists, otherwise top level
      if (data.patient) {
        normalized.patient = {
          ...normalized.patient,
          firstName: firstName || normalized.patient.firstName,
          lastName: lastName || normalized.patient.lastName,
          middleName: middleName || normalized.patient.middleName
        };
      } else {
        normalized.firstName = firstName || normalized.firstName;
        normalized.lastName = lastName || normalized.lastName;
        normalized.middleName = middleName || normalized.middleName;
      }
      
      log('info', 'split_patient_name', { fullName, firstName, lastName, middleName });
    }
  }
  
  // --- Address Normalization ---
  // Try multiple possible field paths for address
  const addressPaths = [
    'patient.address',
    'patientAddress',
    'address',
    'patient.fullAddress'
  ];
  
  // Check if we already have structured address
  const hasAddress = getNestedValue(data, 'patient.address') || data.address;
  const hasCity = getNestedValue(data, 'patient.city') || data.city;
  const hasState = getNestedValue(data, 'patient.state') || data.state;
  
  if ((!hasAddress || !hasCity || !hasState) || isPlaceholder(hasAddress)) {
    // Try to find combined address and parse it
    let fullAddress = null;
    for (const path of addressPaths) {
      const value = getNestedValue(data, path);
      if (value && !isPlaceholder(value)) {
        fullAddress = value;
        break;
      }
    }
    
    if (fullAddress) {
      const { address, city, state, zip } = parseAddress(fullAddress);
      
      // Add to patient object if it exists, otherwise top level
      if (data.patient) {
        normalized.patient = {
          ...normalized.patient,
          address: address || normalized.patient.address,
          city: city || normalized.patient.city,
          state: state || normalized.patient.state,
          zip: zip || normalized.patient.zip
        };
      } else {
        normalized.address = address || normalized.address;
        normalized.city = city || normalized.city;
        normalized.state = state || normalized.state;
        normalized.zip = zip || normalized.zip;
      }
      
      log('info', 'parsed_patient_address', { fullAddress, address, city, state, zip });
    }
  }
  
  // --- Placeholder Cleanup ---
  // Replace placeholder values with null throughout the structure
  function cleanPlaceholders(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const cleaned = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && isPlaceholder(value)) {
        cleaned[key] = null;
      } else if (typeof value === 'object' && value !== null) {
        cleaned[key] = cleanPlaceholders(value);
      } else {
        cleaned[key] = value;
      }
    }
    
    return cleaned;
  }
  
  const finalNormalized = cleanPlaceholders(normalized);
  
  // --- Client-Specific Mappings ---
  // Apply any custom field mappings from client config
  if (clientConfig && clientConfig.fieldMappings) {
    for (const [standardField, clientField] of Object.entries(clientConfig.fieldMappings)) {
      const value = getNestedValue(finalNormalized, clientField);
      if (value !== undefined && value !== null) {
        // Set the value at the standard field path
        const keys = standardField.split('.');
        let target = finalNormalized;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]]) target[keys[i]] = {};
          target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
      }
    }
    
    log('info', 'applied_client_mappings', { 
      mappingCount: Object.keys(clientConfig.fieldMappings).length 
    });
  }
  
  return finalNormalized;
}

/**
 * Get client configuration by ID or infer from document characteristics
 */
function getClientConfig(clientId, documentData) {
  // Future: Load from database or config file
  // For now, return default config structure
  
  // Example client configs (to be externalized):
  const configs = {
    'default': {
      fieldMappings: {},
      requiredFields: ['patient.firstName', 'patient.lastName', 'patient.dob']
    },
    'medicare_standard': {
      fieldMappings: {
        'patient.memberId': 'insurance.memberId',
        'patient.policyNumber': 'insurance.policyNumber'
      },
      requiredFields: ['patient.firstName', 'patient.lastName', 'patient.dob', 'insurance.memberId']
    }
  };
  
  return configs[clientId] || configs.default;
}

export {
  normalizeFields,
  splitName,
  parseAddress,
  isPlaceholder,
  getClientConfig,
  getNestedValue
};
