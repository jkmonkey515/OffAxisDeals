import { supabaseClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Check if error indicates table is missing
 */
function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const message = error.message || String(error);
  const code = error.code || '';
  return (
    message.includes('Could not find the table') ||
    message.includes('does not exist') ||
    message.includes('relation') ||
    code === '42P01' ||
    code === 'PGRST116'
  );
}

/**
 * Fetch all seen alert IDs for a user
 * 
 * If the read-state table doesn't exist in PROD, returns empty Set and logs QA message.
 * 
 * @param userId - User ID to fetch seen alert IDs for
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 * @returns Set of seen alert match IDs (empty if table missing)
 */
export async function getSeenAlertIds(
  userId: string,
  supabase: SupabaseClient = supabaseClient
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('notification_reads')
      .select('match_id')
      .eq('user_id', userId);

    if (error) {
      if (isTableMissingError(error)) {
        if (__DEV__) {
          console.log('[QA] read-state table missing; treating all alerts as unread');
        }
        return new Set<string>();
      }
      throw new Error(`notification reads fetch failed: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return new Set<string>();
    }

    return new Set(data.map((row: { match_id: string }) => row.match_id));
  } catch (err) {
    if (isTableMissingError(err)) {
      if (__DEV__) {
        console.log('[QA] read-state table missing; treating all alerts as unread');
      }
      return new Set<string>();
    }
    // Re-throw unexpected errors
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`notification reads fetch failed: ${message}`);
  }
}

/**
 * Mark a single alert as seen
 * 
 * If the read-state table doesn't exist in PROD, silently succeeds (no-op).
 * 
 * @param userId - User ID
 * @param matchId - Alert match ID (from saved_search_matches.id)
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 */
export async function markAlertSeen(
  userId: string,
  matchId: string,
  supabase: SupabaseClient = supabaseClient
): Promise<void> {
  try {
    const { error } = await supabase
      .from('notification_reads')
      .upsert(
        {
          user_id: userId,
          match_id: matchId,
          seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,match_id',
        }
      );

    if (error) {
      if (isTableMissingError(error)) {
        // Silently succeed (no-op) if table doesn't exist
        return;
      }
      throw new Error(`notification read mark failed: ${error.message}`);
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      // Silently succeed (no-op) if table doesn't exist
      return;
    }
    // Re-throw unexpected errors
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`notification read mark failed: ${message}`);
  }
}

/**
 * Mark multiple alerts as seen in a single operation
 * 
 * If the read-state table doesn't exist in PROD, silently succeeds (no-op).
 * 
 * @param userId - User ID
 * @param matchIds - Array of alert match IDs
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 */
export async function markAllAlertsSeen(
  userId: string,
  matchIds: string[],
  supabase: SupabaseClient = supabaseClient
): Promise<void> {
  if (matchIds.length === 0) {
    return;
  }

  try {
    const now = new Date().toISOString();
    const rows = matchIds.map((matchId) => ({
      user_id: userId,
      match_id: matchId,
      seen_at: now,
    }));

    const { error } = await supabase
      .from('notification_reads')
      .upsert(rows, {
        onConflict: 'user_id,match_id',
      });

    if (error) {
      if (isTableMissingError(error)) {
        // Silently succeed (no-op) if table doesn't exist
        return;
      }
      throw new Error(`notification reads mark failed: ${error.message}`);
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      // Silently succeed (no-op) if table doesn't exist
      return;
    }
    // Re-throw unexpected errors
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`notification reads mark failed: ${message}`);
  }
}
