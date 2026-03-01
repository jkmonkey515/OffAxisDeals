/**
 * Normalizes address_visibility values from DB or form state.
 * Ensures consistency across PostDeal, EditDeal, ListingDetails, and filtering.
 */
export type AddressVisibility = 'exact' | 'approx' | 'hidden';

export function normalizeAddressVisibility(
  value: string | null | undefined
): AddressVisibility {
  const v = (value ?? 'approx').toLowerCase();
  if (v === 'exact' || v === 'approx' || v === 'hidden') return v;
  return 'approx';
}

/** Returns true only when street address is required (exact visibility). */
export function isStreetAddressRequired(visibility: string | null | undefined): boolean {
  return normalizeAddressVisibility(visibility) === 'exact';
}

/**
 * Returns true only when street address should be displayed to the viewer.
 * Condition: address_visibility === 'exact' (normalized, lowercase) AND address is non-empty.
 * Use for listing cards, details, map tooltips, etc.
 */
export function shouldShowStreetAddress(
  visibility: string | null | undefined,
  address: string | null | undefined
): boolean {
  if (normalizeAddressVisibility(visibility) !== 'exact') return false;
  return (address ?? '').trim().length > 0;
}

/**
 * Determines the address value to include in a listing update payload.
 * Prevents accidental overwrites when address_visibility is approx/hidden.
 *
 * @returns string (trimmed) | null (explicit clear) | undefined (omit - keep DB value)
 */
export function getAddressUpdateValue(
  visibility: AddressVisibility,
  currentAddress: string,
  initialAddress: string | null | undefined
): string | null | undefined {
  const trimmed = currentAddress.trim();
  const initial = (initialAddress ?? '').trim();

  if (visibility === 'exact') {
    return trimmed || null;
  }

  // approx/hidden: only include if user modified the field
  if (trimmed === initial) {
    return undefined; // omit from payload - preserve DB value
  }
  return trimmed || null; // user cleared or entered new value
}
