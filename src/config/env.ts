type EnvName = 'staging' | 'production';

interface EnvConfig {
  ENV_NAME: EnvName;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TERMS_URL: string;
  PRIVACY_URL: string;
  DISCLAIMER_URL: string;
  REFUND_POLICY_URL: string;
  ACCOUNT_DELETION_URL: string;
  PRICING_URL: string;
}

function getEnvConfig(): EnvConfig {
  // Read APP_ENV from EXPO_PUBLIC_APP_ENV (defaults to 'staging')
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV || 'staging').trim().toLowerCase() as EnvName;

  // Validate APP_ENV
  if (appEnv !== 'staging' && appEnv !== 'production') {
    throw new Error(
      `❌ Invalid EXPO_PUBLIC_APP_ENV: "${process.env.EXPO_PUBLIC_APP_ENV}". Must be either "staging" or "production".`
    );
  }

  // Select Supabase credentials based on APP_ENV
  const supabaseUrl = appEnv === 'production'
    ? process.env.EXPO_PUBLIC_SUPABASE_URL_PROD
    : process.env.EXPO_PUBLIC_SUPABASE_URL_STAGING;

  const supabaseAnonKey = appEnv === 'production'
    ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_PROD
    : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY_STAGING;

  // Validate SUPABASE_URL
  if (!supabaseUrl || typeof supabaseUrl !== 'string' || supabaseUrl.trim() === '') {
    throw new Error(
      `❌ EXPO_PUBLIC_SUPABASE_URL_${appEnv.toUpperCase()} is missing or empty. Please set it in your environment.`
    );
  }

  // Validate SUPABASE_ANON_KEY
  if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string' || supabaseAnonKey.trim() === '') {
    throw new Error(
      `❌ EXPO_PUBLIC_SUPABASE_ANON_KEY_${appEnv.toUpperCase()} is missing or empty. Please set it in your environment.`
    );
  }

  // Read optional URL overrides (fallback to defaults if not provided)
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL?.trim() || 'https://offaxisdeals.com/terms';
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL?.trim() || 'https://offaxisdeals.com/privacy';
  const disclaimerUrl = process.env.EXPO_PUBLIC_DISCLAIMER_URL?.trim() || 'https://offaxisdeals.com/disclaimer';
  const refundPolicyUrl = process.env.EXPO_PUBLIC_REFUND_POLICY_URL?.trim() || 'https://offaxisdeals.com/refund-policy';
  const accountDeletionUrl = process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL?.trim() || 'https://offaxisdeals.com/account-deletion';
  const pricingUrl = process.env.EXPO_PUBLIC_PRICING_URL?.trim() || 'https://www.offaxisdeals.com/pricing';

  return {
    ENV_NAME: appEnv,
    SUPABASE_URL: supabaseUrl.trim(),
    SUPABASE_ANON_KEY: supabaseAnonKey.trim(),
    TERMS_URL: termsUrl,
    PRIVACY_URL: privacyUrl,
    DISCLAIMER_URL: disclaimerUrl,
    REFUND_POLICY_URL: refundPolicyUrl,
    ACCOUNT_DELETION_URL: accountDeletionUrl,
    PRICING_URL: pricingUrl,
  };
}

// Export the resolved config
export const env = getEnvConfig();

// Export individual values for convenience
export const ENV_NAME = env.ENV_NAME;
export const SUPABASE_URL = env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
export const TERMS_URL = env.TERMS_URL;
export const PRIVACY_URL = env.PRIVACY_URL;
export const DISCLAIMER_URL = env.DISCLAIMER_URL;
export const REFUND_POLICY_URL = env.REFUND_POLICY_URL;
export const ACCOUNT_DELETION_URL = env.ACCOUNT_DELETION_URL;
export const PRICING_URL = env.PRICING_URL;

// Export type for use in other files
export type { EnvName, EnvConfig };

