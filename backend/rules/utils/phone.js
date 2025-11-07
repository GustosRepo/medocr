/**
 * NANP (North American Numbering Plan) phone validation
 * Valid: 10 digits, area code 200-999, exchange 200-999
 */

export function isValidNANP(num) {
  if (typeof num !== 'string') return false;
  
  // Extract only digits
  const digits = num.replace(/\D/g, '');
  
  // Must be exactly 10 digits
  if (digits.length !== 10) return false;
  
  const areaCode = parseInt(digits.substring(0, 3), 10);
  const exchange = parseInt(digits.substring(3, 6), 10);
  
  // Area code must be 200-999
  if (areaCode < 200 || areaCode > 999) return false;
  
  // Exchange must be 200-999
  if (exchange < 200 || exchange > 999) return false;
  
  return true;
}
