import { openExternalUrl } from './openExternalUrl';
import { PRICING_URL } from '../config/env';

/**
 * Opens the pricing/upgrade page on the website.
 * Uses the PRICING_URL from app config (single source of truth).
 * 
 * @param queryParams - Optional query string parameters (e.g., '?upgrade=messaging')
 */
export function openUpgradePage(queryParams?: string): void {
  try {
    const url = queryParams ? `${PRICING_URL}${queryParams}` : PRICING_URL;
    openExternalUrl(url);
  } catch (err) {
    if (__DEV__) {
      console.error('[openUpgradePage] Failed to open upgrade page:', err);
    }
    // openExternalUrl already handles user-facing errors, so we just log here
  }
}
