/**
 * Address Detection for Patient Information
 * 
 * Extracts patient address, city, state, and ZIP from medical referral documents
 */

/**
 * Detect patient address from structured lines
 * @param {string} fullText - Complete OCR text
 * @param {Array} structLines - Structured line objects with text, page, line properties
 * @returns {Object} Address components {address, city, state, zip}
 */
export function detectAddress(fullText, structLines) {
  const lines = Array.isArray(structLines) && structLines.length
    ? structLines.map(l => l.text || '')
    : fullText.split(/\r?\n/);

  // Pattern for ZIP code (5 digits or 5+4)
  const zipPattern = /\b(\d{5}(?:-\d{4})?)\b/;
  
  // Pattern for state code (2 uppercase letters)
  const statePattern = /\b([A-Z]{2})\b/;
  
  // Pattern for labeled address fields
  const addressLabelPattern = /(?:address|addr|street|residence)\s*[:\-]?\s*(.+)/i;
  const cityLabelPattern = /(?:city)\s*[:\-]?\s*(.+)/i;
  const stateLabelPattern = /(?:state|st)\s*[:\-]?\s*(.+)/i;
  const zipLabelPattern = /(?:zip|postal|zip\s*code)\s*[:\-]?\s*(.+)/i;
  
  // Look for labeled fields first
  const labeled = {
    address: null,
    city: null,
    state: null,
    zip: null
  };
  
  for (let i = 0; i < Math.min(lines.length, 300); i++) {
    const line = lines[i];
    if (!line) continue;
    
    // Skip header/footer noise
    if (/^page:|^\d+\/\d+|fax|confidential|athena|disclaimer/i.test(line)) continue;
    
    // Address label
    if (!labeled.address) {
      const addrMatch = line.match(addressLabelPattern);
      if (addrMatch && addrMatch[1]) {
        const addr = addrMatch[1].trim();
        // Must look like a street address
        if (/\d+\s+[A-Za-z]/.test(addr) && addr.length > 5) {
          labeled.address = addr.split(',')[0].trim(); // Take first part before comma
          
          // Look ahead 1-5 lines for city/state/ZIP
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const nextLine = lines[j];
            // Check if line has "City, ST ZIP" format
            const csz = nextLine.match(/^([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
            if (csz) {
              labeled.city = csz[1].trim();
              labeled.state = csz[2];
              labeled.zip = csz[3];
              break;
            }
          }
        }
      } else {
        // Check if this is a standalone "Address" label - look ahead for street + city/state/zip
        if (/^address$/i.test(line.trim())) {
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const nextLine = lines[j];
            // Look for street address pattern
            if (/^\d+\s+[A-Za-z]/.test(nextLine) && nextLine.length > 5) {
              labeled.address = nextLine.split(',')[0].trim();
              // Now look for city/state/zip in subsequent lines
              for (let k = j + 1; k < Math.min(j + 4, lines.length); k++) {
                const cszLine = lines[k];
                const csz = cszLine.match(/^([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
                if (csz) {
                  labeled.city = csz[1].trim();
                  labeled.state = csz[2];
                  labeled.zip = csz[3];
                  break;
                }
              }
              break;
            }
          }
        }
      }
    }
    
    // City label
    if (!labeled.city) {
      const cityMatch = line.match(cityLabelPattern);
      if (cityMatch && cityMatch[1]) {
        labeled.city = cityMatch[1].trim().split(',')[0].trim();
      }
    }
    
    // State label
    if (!labeled.state) {
      const stateMatch = line.match(stateLabelPattern);
      if (stateMatch && stateMatch[1]) {
        const st = stateMatch[1].trim();
        const stateCode = st.match(/^([A-Z]{2})\b/);
        if (stateCode) {
          labeled.state = stateCode[1];
        }
      }
    }
    
    // ZIP label
    if (!labeled.zip) {
      const zipMatch = line.match(zipLabelPattern);
      if (zipMatch && zipMatch[1]) {
        const zipCode = zipMatch[1].match(zipPattern);
        if (zipCode) {
          labeled.zip = zipCode[1];
        }
      }
    }
  }
  
  // If we found labeled fields, use them
  if (labeled.address && (labeled.city || labeled.state || labeled.zip)) {
    return {
      address: labeled.address,
      city: labeled.city,
      state: labeled.state,
      zip: labeled.zip
    };
  }
  
  // Fallback: Look for combined address format "Street, City, ST ZIP"
  // Common near "Address" or "Patient" sections
  const addressCandidates = [];
  
  for (let i = 0; i < Math.min(lines.length, 300); i++) {
    const line = lines[i];
    if (!line) continue;
    
    // Skip only obvious header/footer noise (be less aggressive)
    if (/^page:\s*\d+|^\d{1,2}\/\d{1,2}\/\d{4}|^fax\s*:/i.test(line)) continue;
    
    // Look for line with ZIP code (strong indicator of address line)
    const zipMatch = line.match(zipPattern);
    if (!zipMatch) continue;
    
    const zip = zipMatch[1];
    
    // Try to parse combined format: "Street, City, ST ZIP" or "Street\nCity, ST ZIP"
    // Match pattern: (street with number), (city letters/spaces), (ST) (ZIP)
    const combinedPattern = /(\d+\s+[A-Za-z0-9\s]+?),\s*([A-Za-z\s]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/;
    const combinedMatch = line.match(combinedPattern);
    
    if (combinedMatch) {
      const address = combinedMatch[1].trim();
      const city = combinedMatch[2].trim();
      const state = combinedMatch[3];
      const zipCode = combinedMatch[4];
      
      // Validate this looks like a real address
      if (address.length >= 5 && /\d/.test(address) && city.length >= 2) {
        addressCandidates.push({
          address,
          city,
          state,
          zip: zipCode,
          line: i,
          confidence: 10
        });
        continue;
      }
    }
    
    // Fallback: Parse backward from ZIP
    const beforeZip = line.substring(0, zipMatch.index);
    const stateMatch = beforeZip.match(/([A-Z]{2})\s*$/);
    if (!stateMatch) continue;
    
    const state = stateMatch[1];
    
    // Look for city before state
    const beforeState = beforeZip.substring(0, stateMatch.index).trim();
    const cityMatch = beforeState.match(/([A-Za-z\s]+)(?:,\s*)?$/);
    if (!cityMatch) continue;
    
    const city = cityMatch[1].trim();
    
    // Look for street address before city
    const beforeCity = beforeState.substring(0, cityMatch.index).trim();
    const streetMatch = beforeCity.match(/(\d+\s+[A-Za-z0-9\s]+?)(?:,\s*)?$/);
    
    if (streetMatch) {
      const address = streetMatch[1].trim();
      
      // Validate this looks like a real address
      if (address.length >= 5 && /\d/.test(address)) {
        addressCandidates.push({
          address,
          city,
          state,
          zip,
          line: i,
          confidence: 10
        });
      }
    }
  }
  
  // Return the first candidate
  if (addressCandidates.length > 0) {
    const best = addressCandidates[0];
    return {
      address: best.address,
      city: best.city,
      state: best.state,
      zip: best.zip
    };
  }
  
  // No address found
  return {
    address: null,
    city: null,
    state: null,
    zip: null
  };
}
