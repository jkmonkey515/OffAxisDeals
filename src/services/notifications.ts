import { supabaseClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Notification/alert item from saved_search_matches
 * 
 * Note: `isUnread` is computed client-side based on local session state.
 * It is NOT persisted to the database.
 */
export interface NotificationItem {
  id: string;
  saved_search_id: string;
  listing_id: string;
  investor_id: string;
  created_at: string;
  delivery_status: string;
  // Joined data
  saved_search_name: string | null;
  listing_title: string | null;
  // Client-side unread state (computed locally, not from DB)
  isUnread: boolean;
}

/**
 * Fetch user's recent notifications/alerts (read-only).
 * 
 * Returns saved_search_matches joined with saved_searches and listings
 * for display purposes.
 * 
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 * @returns Array of notification items, empty array if none
 * @throws Error with message including 'notifications list failed' on failure
 */
export async function listMyNotifications(
  supabase: SupabaseClient = supabaseClient
): Promise<NotificationItem[]> {
  try {
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      return [];
    }

    const { data, error } = await supabase
      .from('saved_search_matches')
      .select(`
        id,
        saved_search_id,
        listing_id,
        investor_id,
        created_at,
        delivery_status,
        saved_searches(name),
        listings(title)
      `)
      .eq('investor_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      throw new Error(`notifications list failed: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Map the joined data structure to NotificationItem
    return data.map((row: any) => ({
      id: row.id,
      saved_search_id: row.saved_search_id,
      listing_id: row.listing_id,
      investor_id: row.investor_id,
      created_at: row.created_at,
      delivery_status: row.delivery_status,
      saved_search_name: row.saved_searches?.name ?? null,
      listing_title: row.listings?.title ?? null,
      isUnread: true, // Default to unread (client-side state)
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'notifications list failed: Unknown error';
    throw new Error(message);
  }
}
