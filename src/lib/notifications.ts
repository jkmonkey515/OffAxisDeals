import { supabaseClient } from './supabase';
import { navigationRef } from '../navigation/navigationRef';

type NotificationTapRouteType = 'listing' | 'message';

type ExtractedNotificationFields = {
  type: string | null;
  refId: string | null;
  listingId: string | null;
};

type PendingTap = {
  payload: unknown;
  isPlus: boolean;
  source?: 'push' | 'in_app' | 'unknown';
};

let pendingTap: PendingTap | null = null;
let lastHandledTapKey: string | null = null;

function getTapKey(payload: unknown): string {
  const { type, refId, listingId } = extractNotificationFields(payload);
  const t = (type ?? '').toString().toLowerCase().trim();
  const r = (refId ?? '').toString().trim();
  const l = (listingId ?? '').toString().trim();
  return `${t}:${r}:${l}`;
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extractNotificationFields(payload: unknown): ExtractedNotificationFields {
  if (!payload || typeof payload !== 'object') {
    return { type: null, refId: null, listingId: null };
  }

  const raw = payload as Record<string, unknown>;
  const data = raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;

  // Prefer top-level fields, fall back to `data` (Expo push payloads).
  const merged: Record<string, unknown> = {
    ...(data ?? {}),
    ...raw,
  };

  const type = normalizeString(merged.type);
  const refId = normalizeString(merged.ref_id ?? merged.refId);
  const listingId = normalizeString(merged.listing_id ?? merged.listingId);

  return { type, refId, listingId };
}

function normalizeRouteType(type: string | null): NotificationTapRouteType | null {
  if (!type) return null;
  const t = type.toLowerCase();

  if (t === 'listing' || t === 'saved_search_match' || t === 'alert' || t === 'match') {
    return 'listing';
  }
  if (t === 'message' || t === 'lead_message' || t === 'thread' || t === 'conversation') {
    return 'message';
  }
  return null;
}

function navigateToListingsFallback(): void {
  try {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('Tabs', {
      screen: 'Listings',
      params: { screen: 'ListingsBrowse' },
    });
  } catch {
    // Never crash on a tap.
  }
}

function navigateToSavedSearchesPaywall(): void {
  try {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('Tabs', {
      screen: 'SavedSearches',
      params: { screen: 'SavedSearchesHome' },
    });
  } catch {
    // Never crash on a tap; also don't allow a no-op.
    navigateToListingsFallback();
  }
}

function navigateToListingDetails(listingId: string): void {
  try {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('Tabs', {
      screen: 'Listings',
      params: { screen: 'ListingDetails', params: { listingId } },
    });
  } catch {
    // Never crash on a tap; also don't allow a no-op.
    navigateToListingsFallback();
  }
}

function navigateToConversation(conversationId: string, listingId: string): void {
  try {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('Tabs', {
      screen: 'Messages',
      params: {
        screen: 'Conversation',
        params: { conversationId, listingId },
      },
    });
  } catch {
    // Never crash on a tap; also don't allow a no-op.
    navigateToListingsFallback();
  }
}

/**
 * If a notification tap arrives before navigation is ready, it is stored and can be flushed later.
 * This is primarily for cold-start push taps.
 */
export function flushPendingNotificationTap(): void {
  if (!pendingTap) return;
  const next = pendingTap;
  pendingTap = null;
  void handleNotificationTap(next);
}

/**
 * Central notification tap router.
 *
 * Requirements:
 * - Parses `{ type, ref_id }`
 * - Plus-gates before deep navigation
 * - Routes listing → ListingDetails(ref_id), message → Conversation(ref_id)
 * - Falls back safely to Listings on missing/invalid ref_id or errors
 */
export async function handleNotificationTap(args: PendingTap): Promise<void> {
  try {
    const key = getTapKey(args.payload);
    const hasIdentity = key !== '::';
    if (hasIdentity && key === lastHandledTapKey) {
      return;
    }
    if (hasIdentity) lastHandledTapKey = key;

    if (!navigationRef.isReady()) {
      pendingTap = args;
      return;
    }

    const { payload, isPlus } = args;
    const { type, refId, listingId } = extractNotificationFields(payload);
    const routeType = normalizeRouteType(type);

    // Minimal guard: if missing type/refId, never no-op.
    if (!routeType || !refId) {
      navigateToListingsFallback();
      return;
    }

    // Missing/invalid ref_id => safe fallback.
    if (routeType === 'listing') {
      // Plus gate BEFORE navigation.
      if (!isPlus) {
        navigateToSavedSearchesPaywall();
        return;
      }

      const parsed = await parseNotificationRefId(refId, type);
      const targetListingId = parsed.listingId ?? (isUuid(refId) ? refId : null) ?? listingId;

      if (!targetListingId || !isUuid(targetListingId)) {
        navigateToListingsFallback();
        return;
      }

      navigateToListingDetails(targetListingId);
      return;
    }

    // routeType === 'message'
    const parsed = await parseNotificationRefId(refId, type);
    const conversationId =
      parsed.conversationId ??
      (refId.startsWith('conversation:') ? refId.replace('conversation:', '').trim() : null) ??
      (isUuid(refId) ? refId : null);

    // Missing/invalid ref_id => safe fallback.
    if (!conversationId) {
      navigateToListingsFallback();
      return;
    }

    // Plus gate BEFORE navigation.
    if (!isPlus) {
      // Navigate to Conversation anyway so the screen can show the "Messaging is a Plus feature" copy.
      // listingId is required by navigation types; pass empty string when unknown.
      navigateToConversation(conversationId, (parsed.listingId ?? listingId ?? '').toString());
      return;
    }

    // Paid: deep link to conversation. listingId can be resolved server-side in ConversationScreen;
    // we still pass best-effort to satisfy params shape.
    navigateToConversation(conversationId, (parsed.listingId ?? listingId ?? '').toString());
  } catch {
    // Minimal guard: never crash or no-op.
    navigateToListingsFallback();
  }
}

/**
 * Parse ref_id to extract listing ID, saved search match info, or conversation info
 * Supports multiple patterns:
 * - listing:<uuid>
 * - saved_search_match:<match_id>
 * - conversation:<uuid>
 * - thread:<uuid>
 * - message:<uuid>
 * - listing_conversation:<uuid>
 * - Direct UUID (assumed to be listing ID)
 */
export async function parseNotificationRefId(
  refId: string | null,
  notificationType: string | null = null
): Promise<{
  type: 'listing' | 'saved_search_match' | 'conversation' | null;
  listingId: string | null;
  conversationId: string | null;
  savedSearchId: string | null;
}> {
  if (!refId) {
    return { type: null, listingId: null, conversationId: null, savedSearchId: null };
  }

  // Explicitly handle lead_message type - always treat as conversation
  if (notificationType === 'lead_message' && refId) {
    // Extract conversationId directly from "conversation:<uuid>" format
    // DO NOT regex-validate, DO NOT reject this format
    const conversationId = refId.startsWith('conversation:') 
      ? refId.replace('conversation:', '').trim()
      : refId.trim();
    
    // Always return conversation type for lead_message, even if UUID format is invalid
    // The navigation will handle validation if needed
    return {
      type: 'conversation',
      listingId: null, // listingId will be provided via notification.listing_id
      conversationId: conversationId || null,
      savedSearchId: null,
    };
  }

  // Handle conversation: prefix for other notification types
  if (refId.startsWith('conversation:')) {
    const uuid = refId.substring(12).trim();
    
    if (uuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      // Try to fetch listing_id from conversations table
      try {
        const { data, error } = await supabaseClient
          .from('conversations')
          .select('listing_id')
          .eq('id', uuid)
          .single();

        if (!error && data) {
          return {
            type: 'conversation',
            listingId: data.listing_id || null,
            conversationId: uuid,
            savedSearchId: null,
          };
        } else {
          // Still return conversation type even if we can't fetch listing_id
          return {
            type: 'conversation',
            listingId: null,
            conversationId: uuid,
            savedSearchId: null,
          };
        }
      } catch (err) {
        // Return conversation type with the ID we have
        return {
          type: 'conversation',
          listingId: null,
          conversationId: uuid,
          savedSearchId: null,
        };
      }
    }
  }

  // Pattern 1: listing:<uuid>
  if (refId.startsWith('listing:')) {
    const uuid = refId.substring(8).trim();
    if (uuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return { type: 'listing', listingId: uuid, conversationId: null, savedSearchId: null };
    }
  }

  // Pattern 2: saved_search_match:<match_id>
  // This should navigate to the matched listing, NOT to Saved Searches
  if (refId.startsWith('saved_search_match:')) {
    const parts = refId.split(':');
    if (parts.length >= 2) {
      const matchId = parts[1]?.trim();
      if (matchId && matchId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        try {
          // Fetch listing_id from saved_search_matches (this is what we need to navigate to)
          const { data, error } = await supabaseClient
            .from('saved_search_matches')
            .select('listing_id, saved_search_id')
            .eq('id', matchId)
            .single();

          if (!error && data) {
            return {
              type: 'saved_search_match',
              listingId: data.listing_id || null,
              conversationId: null,
              savedSearchId: data.saved_search_id || null,
            };
          }
        } catch (err) {
          // Silently fail - return null
        }
      }
    }
  }

  // Pattern 3: conversation:<uuid> or thread:<uuid> or message:<uuid> or listing_conversation:<uuid>
  const conversationPatterns = ['thread:', 'message:', 'listing_conversation:'];
  for (const pattern of conversationPatterns) {
    if (refId.startsWith(pattern)) {
      const uuid = refId.substring(pattern.length).trim();
      if (uuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        // Try to fetch listing_id from conversations table
        try {
          const { data, error } = await supabaseClient
            .from('conversations')
            .select('listing_id')
            .eq('id', uuid)
            .single();

          if (!error && data) {
            return {
              type: 'conversation',
              listingId: data.listing_id || null,
              conversationId: uuid,
              savedSearchId: null,
            };
          } else {
            // Still return conversation type even if we can't fetch listing_id
            return {
              type: 'conversation',
              listingId: null,
              conversationId: uuid,
              savedSearchId: null,
            };
          }
        } catch (err) {
          // Return conversation type with the ID we have
          return {
            type: 'conversation',
            listingId: null,
            conversationId: uuid,
            savedSearchId: null,
          };
        }
      }
    }
  }

  // Pattern 4: Direct UUID (assume listing ID)
  if (refId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return { type: 'listing', listingId: refId, conversationId: null, savedSearchId: null };
  }

  return { type: null, listingId: null, conversationId: null, savedSearchId: null };
}

/**
 * Mark notification as read
 * Handles both is_read and read_at fields gracefully
 */
export async function markNotificationAsRead(
  notificationId: string
): Promise<{ error: Error | null }> {
  try {
    const nowISO = new Date().toISOString();
    
    // Try to update both fields (one may not exist, that's ok)
    const { error } = await supabaseClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: nowISO,
      })
      .eq('id', notificationId);

    if (error) {
      return { error };
    }

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Unknown error') };
  }
}
