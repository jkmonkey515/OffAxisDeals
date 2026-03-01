import type { SupabaseClient } from '@supabase/supabase-js';

// In-module cache for favorites watchlist IDs by user
const favoritesIdByUser: Record<string, string> = {};

/**
 * Ensures the default "Favorites" watchlist exists for a user.
 * Returns the watchlist ID, or null if there was an error.
 * Uses an in-module cache to avoid repeated lookups.
 */
export async function ensureFavoritesWatchlistId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  // Check cache first
  if (favoritesIdByUser[userId]) {
    return favoritesIdByUser[userId];
  }

  try {
    // First select: find existing 'Favorites' watchlist
    const { data: existing, error: findError } = await supabase
      .from('user_watchlists')
      .select('id')
      .eq('user_id', userId)
      .or('watchlist_type.eq.favorites,name.eq.Favorites')
      .limit(1)
      .maybeSingle();

    if (findError && findError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is fine, other errors are real errors
      if (__DEV__) {
        console.error('[watchlists] Error finding watchlist:', findError);
      }
      return null;
    }

    if (existing) {
      // Cache and return
      favoritesIdByUser[userId] = existing.id;
      return existing.id;
    }

    // Not found: insert new 'Favorites' watchlist
    const { data: created, error: createError } = await supabase
      .from('user_watchlists')
      .insert({
        user_id: userId,
        name: 'Favorites',
        description: null,
        watchlist_type: 'favorites',
      })
      .select('id')
      .single();

    if (createError) {
      // If insert fails with 23505 (unique constraint), re-select and return existing id
      if (createError.code === '23505') {
        const { data: existingAfterConflict, error: reselectError } = await supabase
          .from('user_watchlists')
          .select('id')
          .eq('user_id', userId)
          .or('watchlist_type.eq.favorites,name.eq.Favorites')
          .limit(1)
          .maybeSingle();

        if (reselectError) {
          if (__DEV__) {
            console.error('[watchlists] Error re-selecting after conflict:', reselectError);
          }
          return null;
        }

        if (existingAfterConflict) {
          // Cache and return
          favoritesIdByUser[userId] = existingAfterConflict.id;
          return existingAfterConflict.id;
        }
      }

      if (__DEV__) {
        console.error('[watchlists] Error creating watchlist:', createError);
      }
      return null;
    }

    if (created) {
      // Cache and return
      favoritesIdByUser[userId] = created.id;
      return created.id;
    }

    return null;
  } catch (err) {
    if (__DEV__) {
      console.error('[watchlists] Exception in ensureFavoritesWatchlistId:', err);
    }
    return null;
  }
}

/**
 * Checks if a listing is favorited by the user.
 */
export async function isListingFavorited(
  supabase: SupabaseClient,
  userId: string,
  listingId: string
): Promise<boolean> {
  try {
    // First ensure the watchlist exists
    const watchlistId = await ensureFavoritesWatchlistId(supabase, userId);
    if (!watchlistId) {
      return false;
    }

    // Check if the listing is in the watchlist
    const { data, error } = await supabase
      .from('watchlist_items')
      .select('id')
      .eq('watchlist_id', watchlistId)
      .eq('listing_id', listingId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" which is fine
      if (__DEV__) {
        console.error('[watchlists] Error checking favorite status:', error);
      }
      return false;
    }

    return data !== null;
  } catch (err) {
    if (__DEV__) {
      console.error('[watchlists] Exception in isListingFavorited:', err);
    }
    return false;
  }
}

/**
 * Batch checks favorite status for multiple listings efficiently.
 * Returns a map of listingId -> boolean (true if favorited).
 */
export async function getFavoriteStatusBatch(
  supabase: SupabaseClient,
  userId: string,
  listingIds: string[]
): Promise<Record<string, boolean>> {
  const statusMap: Record<string, boolean> = {};

  if (listingIds.length === 0) {
    return statusMap;
  }

  try {
    // Ensure the watchlist exists (once)
    const watchlistId = await ensureFavoritesWatchlistId(supabase, userId);
    if (!watchlistId) {
      // If watchlist doesn't exist, all listings are not favorited
      return statusMap;
    }

    // Query watchlist_items with .in('listing_id', listingIds) for that watchlist id
    const { data, error } = await supabase
      .from('watchlist_items')
      .select('listing_id')
      .eq('watchlist_id', watchlistId)
      .in('listing_id', listingIds);

    if (error) {
      if (__DEV__) {
        console.error('[watchlists] Error batch checking favorite status:', error);
      }
      return statusMap;
    }

    // Build a map {[listingId]: true} from the results
    if (data) {
      for (const item of data) {
        if (item.listing_id) {
          statusMap[item.listing_id] = true;
        }
      }
    }

    return statusMap;
  } catch (err) {
    if (__DEV__) {
      console.error('[watchlists] Exception in getFavoriteStatusBatch:', err);
    }
    return statusMap;
  }
}

/**
 * Toggles the favorite status of a listing for a user.
 * @param makeFavorite - true to add to favorites, false to remove
 */
export async function toggleFavorite(
  supabase: SupabaseClient,
  userId: string,
  listingId: string,
  makeFavorite: boolean
): Promise<void> {
  try {
    // Ensure the watchlist exists
    const watchlistId = await ensureFavoritesWatchlistId(supabase, userId);
    if (!watchlistId) {
      throw new Error('Failed to find or create favorites watchlist');
    }

    if (makeFavorite) {
      // Insert into watchlist_items
      const { error } = await supabase.from('watchlist_items').insert({
        watchlist_id: watchlistId,
        listing_id: listingId,
      });

      if (error) {
        // If it's a unique constraint violation, treat as "already saved" (success)
        if (error.code === '23505') {
          // Unique constraint violation - already saved
          return;
        }
        throw error;
      }
    } else {
      // Delete from watchlist_items
      const { error } = await supabase
        .from('watchlist_items')
        .delete()
        .eq('watchlist_id', watchlistId)
        .eq('listing_id', listingId);

      if (error) {
        throw error;
      }
    }
  } catch (err) {
    if (__DEV__) {
      console.error('[watchlists] Exception in toggleFavorite:', err);
    }
    throw err;
  }
}
