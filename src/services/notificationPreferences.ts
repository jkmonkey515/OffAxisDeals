import { supabaseClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Notification preferences model
 */
export interface NotificationPreferences {
  user_id: string;
  new_matches: boolean;
  price_drops: boolean;
  status_changes: boolean;
  daily_digest: boolean;
  instant_alerts: boolean;
  updated_at: string | null;
}

/**
 * Partial preferences for updates (all fields optional except user_id)
 */
export interface PartialNotificationPreferences {
  new_matches?: boolean;
  price_drops?: boolean;
  status_changes?: boolean;
  daily_digest?: boolean;
  instant_alerts?: boolean;
}

/**
 * Default preferences (all OFF)
 */
const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'user_id' | 'updated_at'> = {
  new_matches: false,
  price_drops: false,
  status_changes: false,
  daily_digest: false,
  instant_alerts: false,
};

/**
 * Fetch notification preferences for a user
 * 
 * @param userId - User ID to fetch preferences for
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 * @returns Notification preferences, or null if not found
 * @throws Error with message including 'notification preferences fetch failed' on failure
 */
export async function getNotificationPreferences(
  userId: string,
  supabase: SupabaseClient = supabaseClient
): Promise<NotificationPreferences | null> {
  try {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // If row doesn't exist (PGRST116), return null (not an error)
      if (error.code === 'PGRST116' || error.message.includes('No rows')) {
        return null;
      }
      throw new Error(`notification preferences fetch failed: ${error.message}`);
    }

    return data as NotificationPreferences;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'notification preferences fetch failed: Unknown error';
    throw new Error(message);
  }
}

/**
 * Upsert notification preferences for a user
 * 
 * Creates a row if it doesn't exist, updates if it does.
 * 
 * @param userId - User ID to upsert preferences for
 * @param preferences - Partial preferences to update
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 * @returns Updated notification preferences
 * @throws Error with message including 'notification preferences upsert failed' on failure
 */
export async function upsertNotificationPreferences(
  userId: string,
  preferences: PartialNotificationPreferences,
  supabase: SupabaseClient = supabaseClient
): Promise<NotificationPreferences> {
  try {
    // First, try to get existing preferences
    const existing = await getNotificationPreferences(userId, supabase);

    // Prepare the update/insert payload
    const payload: Partial<NotificationPreferences> = {
      user_id: userId,
      ...(existing ? existing : DEFAULT_PREFERENCES),
      ...preferences,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(payload, {
        onConflict: 'user_id',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`notification preferences upsert failed: ${error.message}`);
    }

    return data as NotificationPreferences;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'notification preferences upsert failed: Unknown error';
    throw new Error(message);
  }
}
