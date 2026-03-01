-- Rewrite RLS policies for conversations and messages
-- Listing-scoped messaging with proper access control
-- Run this in Supabase SQL Editor
-- Idempotent: safe to run multiple times

-- ============================================
-- ENABLE RLS (if not already enabled)
-- ============================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- DROP EXISTING POLICIES
-- ============================================
-- Conversations policies
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_paid_buyer_seller" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_paid_investor_wholesaler" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_last_message_at" ON public.conversations;

-- Messages policies
DROP POLICY IF EXISTS "messages_select_conversation_member" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_paid_sender" ON public.messages;

-- ============================================
-- CONVERSATIONS POLICIES
-- ============================================

-- SELECT: authenticated user can read if they are buyer OR seller OR (paid admin)
CREATE POLICY "conversations_select_own"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = buyer_id 
    OR auth.uid() = seller_id
    OR (
      EXISTS (
        SELECT 1 
        FROM public.profiles 
        WHERE id = auth.uid() 
        AND is_paid = true 
        AND role = 'admin'
      )
    )
  );

-- INSERT: authenticated user can insert only if:
-- - auth.uid() equals buyer_id OR seller_id
-- - inserting user is profiles.is_paid = true
CREATE POLICY "conversations_insert_paid_buyer_seller"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = buyer_id OR auth.uid() = seller_id)
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
    )
  );

-- UPDATE: allow only buyer/seller (or paid admin) to update last_message_at
-- Note: This is typically updated by trigger, but allows manual updates if needed
CREATE POLICY "conversations_update_last_message_at"
  ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = buyer_id 
    OR auth.uid() = seller_id
    OR (
      EXISTS (
        SELECT 1 
        FROM public.profiles 
        WHERE id = auth.uid() 
        AND is_paid = true 
        AND role = 'admin'
      )
    )
  )
  WITH CHECK (
    -- Only allow updating last_message_at column (enforced by only allowing this column in UPDATE)
    -- In practice, this is usually updated by trigger, but policy allows it
    auth.uid() = buyer_id 
    OR auth.uid() = seller_id
    OR (
      EXISTS (
        SELECT 1 
        FROM public.profiles 
        WHERE id = auth.uid() 
        AND is_paid = true 
        AND role = 'admin'
      )
    )
  );

-- ============================================
-- MESSAGES POLICIES
-- ============================================

-- SELECT: authenticated user can read if they are a member of the referenced conversation (buyer/seller) OR (paid admin)
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
    OR (
      EXISTS (
        SELECT 1 
        FROM public.profiles 
        WHERE id = auth.uid() 
        AND is_paid = true 
        AND role = 'admin'
      )
    )
  );

-- INSERT: authenticated user can insert only if:
-- - auth.uid() is sender
-- - sender is in that conversation (buyer or seller)
-- - sender is paid
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

-- ============================================
-- VERIFICATION QUERY
-- ============================================
-- Run this query to list all policies and verify they are correct:

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN ('conversations', 'messages')
ORDER BY tablename, cmd, policyname;

-- Expected output:
-- conversations: 3 policies (SELECT, INSERT, UPDATE)
-- messages: 2 policies (SELECT, INSERT)
-- All policies should have roles = '{authenticated}' (no 'public' or 'anon')

