import { supabaseClient } from '../lib/supabase';
import { qalog, qaError } from './qalog';

interface ListingOwnerRow {
  id: string;
  owner_id: string;
}

interface ConversationRow {
  id: string;
}

export async function getOrCreateConversationForListing(
  listingId: string
): Promise<{ conversationId: string }> {
  if (!listingId) {
    throw new Error('Listing id is required to start a conversation.');
  }

  // Get current authenticated user id
  const { data: authData } = await supabaseClient.auth.getUser();
  const currentUserId = authData?.user?.id;

  if (!currentUserId) {
    throw new Error('You must be signed in to message a seller.');
  }

  // Fetch listing to get owner_id
  const {
    data: listing,
    error: listingError,
  } = await supabaseClient
    .from('listings')
    .select('id, owner_id')
    .eq('id', listingId)
    .single<ListingOwnerRow>();

  if (listingError || !listing) {
    qaError('getOrCreateConversation: listing fetch failed', listingError);
    throw new Error(listingError?.message ?? 'Listing not found.');
  }

  const ownerId = listing.owner_id;

  if (ownerId === currentUserId) {
    throw new Error("You can't message your own listing.");
  }

  // QA log: starting get-or-create
  qalog('getOrCreateConversation: start', {
    listingId,
    currentUserId,
    ownerId,
  });

  // Check if a conversation already exists for this (listing_id, participant_one, participant_two)
  // Check both orderings in a single query
  const {
    data: existingConversation,
    error: existingError,
  } = await supabaseClient
    .from('conversations')
    .select('id')
    .eq('listing_id', listingId)
    .or(`and(participant_one.eq.${currentUserId},participant_two.eq.${ownerId}),and(participant_one.eq.${ownerId},participant_two.eq.${currentUserId})`)
    .limit(1)
    .maybeSingle<ConversationRow>();

  if (existingError && existingError.code !== 'PGRST116') {
    // PGRST116 is "Results contain 0 rows" for maybeSingle
    qaError('getOrCreateConversation: existing conversation query failed', existingError);
    throw new Error(existingError.message);
  }

  if (existingConversation && existingConversation.id) {
    // QA log: found existing conversation
    qalog('getOrCreateConversation: found existing', {
      conversationId: existingConversation.id,
      listingId,
      currentUserId,
      ownerId,
    });
    return { conversationId: existingConversation.id };
  }

  // Create a new conversation
  qalog('getOrCreateConversation: creating new', {
    listingId,
    currentUserId,
    ownerId,
  });

  const {
    data: insertedConversation,
    error: insertError,
  } = await supabaseClient
    .from('conversations')
    .insert({
      listing_id: listingId,
      participant_one: currentUserId,
      participant_two: ownerId,
      created_by: currentUserId,
    })
    .select('id')
    .single<ConversationRow>();

  if (insertError || !insertedConversation) {
    qaError('getOrCreateConversation: insert failed', insertError);
    throw new Error(insertError?.message ?? 'Failed to create conversation. Please try again.');
  }

  // QA log: created new conversation
  qalog('getOrCreateConversation: created new', {
    conversationId: insertedConversation.id,
    listingId,
    currentUserId,
    ownerId,
  });

  return { conversationId: insertedConversation.id };
}


