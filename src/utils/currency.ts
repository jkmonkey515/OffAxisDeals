/**
 * Currency formatting utilities for multi-currency support
 */

export type SupportedCurrency = 'USD' | 'AUD' | 'CAD' | 'GBP';

export const SUPPORTED_CURRENCIES: SupportedCurrency[] = ['USD', 'AUD', 'CAD', 'GBP'];

/**
 * Normalizes a currency string to a supported currency type.
 * Defaults to USD if input is null, undefined, or not recognized.
 */
export function normalizeCurrency(input: string | null | undefined): SupportedCurrency {
  if (!input) {
    return 'USD';
  }
  const upper = input.toUpperCase();
  if (SUPPORTED_CURRENCIES.includes(upper as SupportedCurrency)) {
    return upper as SupportedCurrency;
  }
  return 'USD';
}

/**
 * Returns the currency symbol for a supported currency.
 */
export function currencySymbol(c: SupportedCurrency): string {
  switch (c) {
    case 'USD':
      return '$';
    case 'AUD':
      return 'A$';
    case 'CAD':
      return 'C$';
    case 'GBP':
      return '£';
    default:
      return '$';
  }
}

/**
 * Formats a monetary amount with the appropriate currency symbol and formatting.
 * Rounds to whole dollars and uses comma separators.
 * 
 * @param amount - The amount to format (number)
 * @param currency - The currency code (string | null | undefined)
 * @returns Formatted string like "A$250,000" or "£250,000"
 */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const normalized = normalizeCurrency(currency);
  const symbol = currencySymbol(normalized);
  const rounded = Math.round(amount);
  return `${symbol}${rounded.toLocaleString()}`;
}

/**
 * Formats a monetary amount or returns "N/A" if the amount is null, undefined, or NaN.
 * 
 * @param amount - The amount to format (number | null | undefined)
 * @param currency - The currency code (string | null | undefined)
 * @returns Formatted string like "A$250,000" or "N/A"
 */
export function formatMoneyOrNA(
  amount: number | null | undefined,
  currency: string | null | undefined
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return 'N/A';
  }
  return formatMoney(amount, currency);
}
