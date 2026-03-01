import { supabaseClient } from '../lib/supabase';

/**
 * Checks if a string is an HTTP/HTTPS URL.
 */
export function isHttpUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://');
}

/**
 * Converts a listing image input (URL or storage path) to a public URL.
 * 
 * Rules:
 * - Returns null if input is empty/null/undefined
 * - Returns input as-is if it's already an HTTP/HTTPS URL
 * - Otherwise treats input as a storage object key in bucket 'listing-images'
 *   and returns the public URL via getPublicUrl()
 * 
 * @param input - Image URL or storage path
 * @returns Public URL string or null
 */
export function toListingImagePublicUrl(input: string | null | undefined): string | null {
  // Return null if empty
  if (!input || input.trim().length === 0) {
    return null;
  }

  const trimmed = input.trim();

  // If already an HTTP/HTTPS URL, return as-is
  if (isHttpUrl(trimmed)) {
    return trimmed;
  }

  // Otherwise, treat as storage object key and get public URL
  try {
    const { data } = supabaseClient.storage
      .from('listing-images')
      .getPublicUrl(trimmed);

    return data?.publicUrl || null;
  } catch (err) {
    if (__DEV__) {
      console.error('[listingImages] Error getting public URL for path:', trimmed, err);
    }
    return null;
  }
}

/**
 * Converts a listing image URL to a storage path.
 * 
 * Rules:
 * - If input is already a path (no http), return as-is
 * - If it's a full Supabase public URL containing /storage/v1/object/public/listing-images/,
 *   strip everything up to and including /listing-images/ and return the remaining path
 * - If it's a /storage/v1/render/image/... URL, convert to the underlying object path
 *   the same way (strip to /listing-images/)
 * 
 * @param input - Image URL or storage path
 * @returns Storage path string
 */
export function toListingImagePath(input: string): string {
  if (!input || input.trim().length === 0) {
    return '';
  }

  const trimmed = input.trim();

  // If already a path (no http), return as-is
  if (!isHttpUrl(trimmed)) {
    return trimmed;
  }

  // Check for Supabase storage URL patterns
  // Pattern 1: /storage/v1/object/public/listing-images/...
  const publicPattern = '/storage/v1/object/public/listing-images/';
  const publicIndex = trimmed.indexOf(publicPattern);
  if (publicIndex !== -1) {
    return trimmed.substring(publicIndex + publicPattern.length);
  }

  // Pattern 2: /storage/v1/render/image/listing-images/...
  const renderPattern = '/storage/v1/render/image/listing-images/';
  const renderIndex = trimmed.indexOf(renderPattern);
  if (renderIndex !== -1) {
    return trimmed.substring(renderIndex + renderPattern.length);
  }

  // If no pattern matches, try to extract from any /listing-images/ occurrence
  const listingImagesIndex = trimmed.indexOf('/listing-images/');
  if (listingImagesIndex !== -1) {
    return trimmed.substring(listingImagesIndex + '/listing-images/'.length);
  }

  // If we can't parse it, return empty string (or could return original, but empty is safer)
  if (__DEV__) {
    console.warn('[listingImages] Could not extract path from URL:', trimmed);
  }
  return '';
}
