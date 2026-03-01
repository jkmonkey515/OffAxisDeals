import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config/env';

/**
 * Supabase client instance configured for Expo React Native.
 * 
 * Features:
 * - Uses environment-specific configuration (staging/production)
 * - Session persistence via AsyncStorage (supports larger payloads)
 * - Stable storage key "oad-auth" for consistent session storage
 * - Sessions persist across app reloads
 * - Hard singleton pattern: only one client instance exists
 * 
 * @example
 * ```typescript
 * import { supabaseClient } from './src/lib/supabase/client';
 * 
 * // Sign in
 * const { data, error } = await supabaseClient.auth.signInWithPassword({
 *   email: 'user@example.com',
 *   password: 'password123'
 * });
 * 
 * // Query data
 * const { data: posts, error } = await supabaseClient
 *   .from('posts')
 *   .select('*');
 * ```
 */
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    storageKey: 'oad-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Disable for React Native (no URL-based auth)
  },
});

