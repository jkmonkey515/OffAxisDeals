/**
 * Check if a listing is actively featured.
 * A listing is considered actively featured only if:
 * - listing.featured === true
 * - listing.featured_until exists
 * - featured_until (timestamp) is in the future vs Date.now()
 */
export function isFeaturedActive(listing: {
  featured?: boolean | null;
  featured_until?: string | null;
}): boolean {
  if (!listing.featured || listing.featured !== true) {
    return false;
  }

  if (!listing.featured_until) {
    return false;
  }

  try {
    const featuredUntilDate = new Date(listing.featured_until);
    const now = new Date();
    return featuredUntilDate > now;
  } catch {
    // Invalid date format
    return false;
  }
}
