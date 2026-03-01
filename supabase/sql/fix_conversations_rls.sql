-- Fix RLS policies for conversations table
-- This script ensures INSERT works for paid investors messaging paid wholesaler listing owners
-- Run this in Supabase SQL Editor

-- ============================================
-- VERIFY SCHEMA
-- ============================================
-- Expected columns:
--   - id (uuid, primary key)
--   - listing_id (uuid, references listings.id)
--   - buyer_id (uuid, references profiles.id)
--   - seller_id (uuid, references profiles.id)
--   - created_at (timestamptz)

-- ============================================
-- ENABLE RLS (if not already enabled)
-- ============================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- DROP EXISTING POLICIES
-- ============================================
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_paid_buyer_seller" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_paid_investor_wholesaler" ON public.conversations;

-- ============================================
-- SELECT POLICY
-- ============================================
-- Allow authenticated users to read conversations where they are buyer OR seller
CREATE POLICY "conversations_select_own"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id
  );

-- ============================================
-- INSERT POLICY (Fixed)
-- ============================================
-- Allow INSERT only when:
--   1. auth.uid() = buyer_id (buyer must be the authenticated user)
--   2. Buyer profile exists and is_paid = true
--   3. listing_id exists in listings (enforced by FK, but we verify explicitly)
--   4. seller_id = listing's owner_id (seller must be the listing owner)
--   5. buyer_id != seller_id (prevent self-chat, enforced by CHECK constraint)
CREATE POLICY "conversations_insert_paid_buyer_seller"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- 1. Buyer must be the authenticated user
    buyer_id = auth.uid()
    
    -- 2. Buyer profile exists and is paid
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = buyer_id 
      AND is_paid = true
    )
    
    -- 3. Listing exists (FK ensures this, but we verify explicitly)
    AND EXISTS (
      SELECT 1 
      FROM public.listings 
      WHERE id = listing_id
    )
    
    -- 4. Seller must be the listing owner
    AND seller_id = (
      SELECT owner_id 
      FROM public.listings 
      WHERE id = listing_id
    )
    
    -- 5. Prevent self-chat (also enforced by CHECK constraint, but explicit here)
    AND buyer_id <> seller_id
  );

-- ============================================
-- VERIFICATION QUERIES (optional, for testing)
-- ============================================
-- Run these after applying to verify:
--
-- 1. Check policies exist:
--    SELECT schemaname, tablename, policyname, cmd, qual, with_check
--    FROM pg_policies
--    WHERE tablename = 'conversations';
--
-- 2. Test as authenticated user (replace with actual user id):
--    -- Should return rows where user is buyer or seller
--    SELECT * FROM public.conversations WHERE buyer_id = auth.uid() OR seller_id = auth.uid();
--
-- 3. Test insert (as paid investor, replace listing_id with real value):
--    INSERT INTO public.conversations (listing_id, buyer_id, seller_id)
--    VALUES (
--      'listing-uuid-here',
--      auth.uid(),
--      (SELECT owner_id FROM public.listings WHERE id = 'listing-uuid-here')
--    );

