-- Migration: Listing-scoped messaging system
-- Creates conversations and messages tables with RLS policies
-- Run this in Supabase SQL Editor

-- ============================================
-- TABLES
-- ============================================

-- Drop any previous versions of these relations so schema is consistent
-- (Safe to do while messaging is in development and no production data exists yet)
DROP TABLE IF EXISTS public.messages CASCADE;
DROP VIEW IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP VIEW IF EXISTS public.conversations CASCADE;

-- Conversations table: links buyers and sellers for a specific listing
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Enforce 1 conversation per buyer per listing
  CONSTRAINT conversations_listing_buyer_unique UNIQUE (listing_id, buyer_id),
  
  -- Prevent buyer from messaging themselves
  CONSTRAINT conversations_buyer_seller_different CHECK (buyer_id <> seller_id)
);

-- Messages table: individual messages within a conversation
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL
);

-- ============================================
-- INDEXES
-- ============================================

-- Index for efficient message retrieval within a conversation (ordered by newest first)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
  ON public.messages(conversation_id, created_at DESC);

-- Index for seller's conversations (ordered by newest first)
CREATE INDEX IF NOT EXISTS idx_conversations_seller_created 
  ON public.conversations(seller_id, created_at DESC);

-- Index for buyer's conversations (ordered by newest first)
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_created 
  ON public.conversations(buyer_id, created_at DESC);

-- Index for listing lookups
CREATE INDEX IF NOT EXISTS idx_conversations_listing 
  ON public.conversations(listing_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on both tables
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- CONVERSATIONS POLICIES
-- ============================================

-- Drop existing policies if they exist (for safe re-runs)
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_paid_buyer_seller" ON public.conversations;

-- SELECT: authenticated user can read if they are buyer or seller
CREATE POLICY "conversations_select_own"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id
  );

-- INSERT: authenticated user can insert only if:
-- - buyer_id = auth.uid()
-- - seller_id matches listing owner
-- - buyer is paid (is_paid = true)
-- - seller is paid (is_paid = true)
-- - buyer role is investor
-- - seller role is wholesaler OR admin
CREATE POLICY "conversations_insert_paid_buyer_seller"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    buyer_id = auth.uid()
    AND seller_id = (
      SELECT owner_id 
      FROM public.listings 
      WHERE id = listing_id
    )
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = buyer_id 
      AND is_paid = true 
      AND role = 'investor'
    )
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = seller_id 
      AND is_paid = true 
      AND role IN ('wholesaler', 'admin')
    )
  );

-- UPDATE and DELETE: not allowed (no policies created)

-- ============================================
-- MESSAGES POLICIES
-- ============================================

-- Drop existing policies if they exist (for safe re-runs)
DROP POLICY IF EXISTS "messages_select_conversation_member" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_paid_sender" ON public.messages;

-- SELECT: authenticated user can read if they are in the parent conversation (buyer or seller)
CREATE POLICY "messages_select_conversation_member"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.conversations 
      WHERE id = conversation_id 
      AND (buyer_id = auth.uid() OR seller_id = auth.uid())
    )
  );

-- INSERT: authenticated user can insert only if:
-- - sender_id = auth.uid()
-- - sender is in the parent conversation (buyer or seller)
-- - sender profile is_paid = true
CREATE POLICY "messages_insert_paid_sender"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.conversations 
      WHERE id = conversation_id 
      AND (buyer_id = auth.uid() OR seller_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
    )
  );

-- UPDATE and DELETE: not allowed (no policies created)

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.conversations IS 'Conversations between buyers and sellers for specific listings';
COMMENT ON TABLE public.messages IS 'Individual messages within conversations';
COMMENT ON COLUMN public.conversations.listing_id IS 'The listing this conversation is about';
COMMENT ON COLUMN public.conversations.buyer_id IS 'The investor/buyer in this conversation';
COMMENT ON COLUMN public.conversations.seller_id IS 'The wholesaler/seller (listing owner) in this conversation';
COMMENT ON COLUMN public.messages.read_at IS 'Timestamp when the message was read by the recipient (null if unread)';

