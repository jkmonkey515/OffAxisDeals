/**
 * Canonical list of property types used throughout the app.
 * This ensures consistency across PostDeal, EditDeal, ListingDetails, and filtering.
 */
export const PROPERTY_TYPES = [
  'Single Family',
  'Condo',
  'Townhouse',
  'Multi-Family',
  'Land',
  'Manufactured',
  'Commercial',
  '55+ Community',
  'Other',
] as const;

export type PropertyType = typeof PROPERTY_TYPES[number];

/**
 * Get display label for a property type value.
 * Handles null/undefined and returns the value as-is if valid, otherwise null.
 */
export function getPropertyTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return PROPERTY_TYPES.includes(value as PropertyType) ? value : null;
}
