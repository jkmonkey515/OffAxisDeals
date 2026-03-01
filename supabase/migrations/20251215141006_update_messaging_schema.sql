-- Migration: Update messaging schema for listing-scoped conversations
-- Ensures conversations have last_message_at and correct unique constraint
-- Idempotent: safe to run multiple times
-- Run this in Supabase SQL Editor

-- ============================================
-- CONVERSATIONS TABLE UPDATES
-- ============================================

-- Add last_message_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'conversations' 
    AND column_name = 'last_message_at'
  ) THEN
    ALTER TABLE public.conversations 
    ADD COLUMN last_message_at timestamptz NULL;
  END IF;
END $$;

-- Drop old unique constraint if it exists
ALTER TABLE public.conversations 
DROP CONSTRAINT IF EXISTS conversations_listing_buyer_unique;

-- Add new unique constraint on (listing_id, buyer_id, seller_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'conversations_listing_buyer_seller_unique'
    AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations 
    ADD CONSTRAINT conversations_listing_buyer_seller_unique 
    UNIQUE (listing_id, buyer_id, seller_id);
  END IF;
END $$;

-- ============================================
-- INDEXES
-- ============================================

-- Index for buyer_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_id 
  ON public.conversations(buyer_id);

-- Index for seller_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_conversations_seller_id 
  ON public.conversations(seller_id);

-- Index for listing_id (if not exists - may already exist as idx_conversations_listing)
CREATE INDEX IF NOT EXISTS idx_conversations_listing_id 
  ON public.conversations(listing_id);

-- Drop old listing index if it has a different name and create the standard one
DROP INDEX IF EXISTS idx_conversations_listing;
CREATE INDEX IF NOT EXISTS idx_conversations_listing_id 
  ON public.conversations(listing_id);

-- Index for last_message_at (for sorting conversations by most recent message)
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at 
  ON public.conversations(last_message_at DESC NULLS LAST);

-- Keep existing composite indexes for efficient queries
-- Index for seller's conversations (ordered by newest first)
CREATE INDEX IF NOT EXISTS idx_conversations_seller_created 
  ON public.conversations(seller_id, created_at DESC);

-- Index for buyer's conversations (ordered by newest first)
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_created 
  ON public.conversations(buyer_id, created_at DESC);

-- ============================================
-- MESSAGES TABLE VERIFICATION
-- ============================================

-- Ensure messages table has required columns
-- (These should already exist, but we verify for idempotency)

DO $$
BEGIN
  -- Verify conversation_id foreign key exists
  -- Check if any foreign key constraint exists on conversation_id column
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.table_schema = 'public' 
    AND tc.table_name = 'messages'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'conversation_id'
  ) THEN
    -- Add foreign key if missing (shouldn't happen, but for idempotency)
    ALTER TABLE public.messages 
    ADD CONSTRAINT messages_conversation_id_fkey 
    FOREIGN KEY (conversation_id) 
    REFERENCES public.conversations(id) 
    ON DELETE CASCADE;
  END IF;

  -- Verify sender_id exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'messages' 
    AND column_name = 'sender_id'
  ) THEN
    ALTER TABLE public.messages 
    ADD COLUMN sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  -- Verify body exists and is NOT NULL
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'messages' 
    AND column_name = 'body'
  ) THEN
    ALTER TABLE public.messages 
    ADD COLUMN body text NOT NULL;
  END IF;

  -- Verify created_at exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'messages' 
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.messages 
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Ensure messages has index on conversation_id and created_at
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
  ON public.messages(conversation_id, created_at DESC);

-- ============================================
-- TRIGGER: Update last_message_at on message insert
-- ============================================

-- Function to update last_message_at when a new message is inserted
CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_update_conversation_last_message_at ON public.messages;
CREATE TRIGGER trigger_update_conversation_last_message_at
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_last_message_at();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN public.conversations.last_message_at IS 'Timestamp of the most recent message in this conversation (updated automatically)';

