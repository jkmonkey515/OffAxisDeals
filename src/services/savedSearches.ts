import { supabaseClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Saved search model matching Production/Staging schema
 */
export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean | null;
  is_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
  center_lat: number;
  center_lng: number;
  radius_miles: number | null;
  radius_km: number | null;
  min_price: string | null; // numeric comes back as string from PostgREST
  max_price: string | null; // numeric comes back as string from PostgREST
  min_beds: number | null;
  max_beds: number | null;
  min_baths: number | null;
  max_baths: number | null;
  property_types: string[] | null;
  last_notified_at: string | null;
  criteria: Record<string, unknown>; // jsonb returns as object
}

/**
 * Fetch the current user's saved searches
 * 
 * @param supabase - Supabase client instance (defaults to supabaseClient)
 * @returns Array of saved searches, empty array if none or on error
 * @throws Error with message including 'saved_searches list failed' on failure
 */
export async function listMySavedSearches(
  supabase: SupabaseClient = supabaseClient
): Promise<SavedSearch[]> {
  try {
    const { data, error } = await supabase
      .from('saved_searches')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`saved_searches list failed: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return [];
    }

    return data as SavedSearch[];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'saved_searches list failed: Unknown error';
    throw new Error(message);
  }
}
