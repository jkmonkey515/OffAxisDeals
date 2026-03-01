/**
 * Result of parsing a price input string.
 */
export type ParsePriceResult = {
  value: number | null;
  error: string | null;
};

/**
 * Parses a price input string into integer dollars.
 * 
 * Rules:
 * - Trims whitespace; if empty => { value: null, error: null } (optional field)
 * - Removes "$", ",", spaces
 * - If remaining contains more than one ".", error
 * - If contains ".", allow only two decimals and they must be "00" (or allow "0"/"00" only); otherwise error
 * - Ensures numeric; ensures finite
 * - Returns integer dollars
 * 
 * @param input - Raw input string (e.g., "$250,000", "250000", "250000.00", "250000.50")
 * @returns ParsePriceResult with integer dollars or error message
 * 
 * @example
 * parsePriceToIntDollars("$250,000") // { value: 250000, error: null }
 * parsePriceToIntDollars("250000.00") // { value: 250000, error: null }
 * parsePriceToIntDollars("250000.50") // { value: null, error: "Price must be whole dollars (no cents)" }
 * parsePriceToIntDollars("900") // { value: null, error: "Price must be at least $1,000" }
 * parsePriceToIntDollars("") // { value: null, error: null }
 */
export function parsePriceToIntDollars(input: string): ParsePriceResult {
  // Trim whitespace
  const trimmed = input.trim();
  
  // If empty, return null (optional field)
  if (trimmed.length === 0) {
    return { value: null, error: null };
  }
  
  // Remove "$", ",", and spaces
  let cleaned = trimmed.replace(/[$,\s]/g, '');
  
  // Check for multiple decimal points
  const decimalCount = (cleaned.match(/\./g) || []).length;
  if (decimalCount > 1) {
    return { value: null, error: 'Invalid price format' };
  }
  
  // Handle decimal case
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    const integerPart = parts[0];
    const decimalPart = parts[1] || '';
    
    // Decimal part must be exactly "00" or "0" (or empty, but that's handled above)
    if (decimalPart.length > 2) {
      return { value: null, error: 'Price must be whole dollars (no cents)' };
    }
    
    // Check if decimal part is not "00" or "0"
    if (decimalPart.length === 2 && decimalPart !== '00') {
      return { value: null, error: 'Price must be whole dollars (no cents)' };
    }
    if (decimalPart.length === 1 && decimalPart !== '0') {
      return { value: null, error: 'Price must be whole dollars (no cents)' };
    }
    
    // If decimal is valid (.00 or .0), use integer part
    cleaned = integerPart;
  }
  
  // Convert to number
  const num = Number(cleaned);
  
  // Check if NaN
  if (Number.isNaN(num)) {
    return { value: null, error: 'Invalid price format' };
  }
  
  // Check if finite
  if (!Number.isFinite(num)) {
    return { value: null, error: 'Price must be a valid number' };
  }
  
  // Convert to integer (round to nearest dollar for .00 case, but we already validated decimals)
  const intValue = Math.round(num);
  
  // Return integer dollars
  return { value: intValue, error: null };
}

/**
 * Validates min and max price relationship.
 * 
 * Rules:
 * - If min != null and min < 1000 => minError
 * - If max != null and max < 1000 => maxError
 * - If both present and min > max => maxError (or both)
 * 
 * @param min - Parsed min price (integer dollars or null)
 * @param max - Parsed max price (integer dollars or null)
 * @returns Object with minError and maxError strings (null if valid)
 * 
 * @example
 * validateMinMax(500, null) // { minError: "Price must be at least $1,000", maxError: null }
 * validateMinMax(null, 500) // { minError: null, maxError: "Price must be at least $1,000" }
 * validateMinMax(200000, 100000) // { minError: null, maxError: "Max price must be greater than or equal to min price" }
 * validateMinMax(100000, 200000) // { minError: null, maxError: null }
 */
export function validateMinMax(
  min: number | null,
  max: number | null
): { minError: string | null; maxError: string | null } {
  let minError: string | null = null;
  let maxError: string | null = null;
  
  // Validate min >= 1000
  if (min !== null && min < 1000) {
    minError = 'Price must be at least $1,000';
  }
  
  // Validate max >= 1000
  if (max !== null && max < 1000) {
    maxError = 'Price must be at least $1,000';
  }
  
  // Validate min <= max (only if both are present and both are valid)
  if (min !== null && max !== null && min > max) {
    // Set error on max price field
    maxError = 'Max price must be greater than or equal to min price';
  }
  
  return { minError, maxError };
}

/**
 * Dev-only sanity check function with examples.
 * Uncomment and call this in a dev screen to verify parsing logic.
 */
export function __devPriceParsingExamples() {
  const examples = [
    { input: '$250,000', expected: 250000 },
    { input: '250000', expected: 250000 },
    { input: '250000.00', expected: 250000 },
    { input: '250000.0', expected: 250000 },
    { input: '250000.50', shouldError: true },
    { input: '900', shouldError: true },
    { input: '', expected: null },
    { input: '  100000  ', expected: 100000 },
  ];
  
  console.log('Price parsing examples:');
  examples.forEach((ex) => {
    const result = parsePriceToIntDollars(ex.input);
    if (ex.shouldError) {
      console.log(`  "${ex.input}" => ERROR: ${result.error || 'none'}`);
    } else {
      const match = result.value === ex.expected && result.error === null;
      console.log(`  "${ex.input}" => ${result.value} (error: ${result.error || 'none'}) ${match ? '✓' : '✗'}`);
    }
  });
}
