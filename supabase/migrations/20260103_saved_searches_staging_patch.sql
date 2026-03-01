-- ============================================
-- STAGING PATCH: Fix saved_searches schema and RLS
-- ============================================
-- 
-- STAGING ONLY: Do not apply to PROD.
-- 
-- This migration patches the STAGING saved_searches and saved_search_matches
-- tables to match Production shape and enforce Plus-only RLS policies.
-- 
-- Fixes:
-- - Adds missing columns: criteria (jsonb), is_enabled (boolean)
-- - Replaces overly broad RLS policies with Plus-only policies
-- - Blocks authenticated users from writing to saved_search_matches
-- 
-- Safe to run multiple times (idempotent).
-- ============================================

-- ============================================
-- TABLE: saved_searches - Add missing columns
-- ============================================

-- Add criteria column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'saved_searches' 
    AND column_name = 'criteria'
  ) THEN
    ALTER TABLE public.saved_searches 
      ADD COLUMN criteria jsonb NOT NULL DEFAULT '{}'::jsonb;
    
    COMMENT ON COLUMN public.saved_searches.criteria IS 'Additional search criteria stored as JSONB';
  END IF;
END $$;

-- Add is_enabled column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'saved_searches' 
    AND column_name = 'is_enabled'
  ) THEN
    ALTER TABLE public.saved_searches 
      ADD COLUMN is_enabled boolean NOT NULL DEFAULT true;
    
    COMMENT ON COLUMN public.saved_searches.is_enabled IS 'Whether this search is enabled for notifications';
  END IF;
END $$;

-- Ensure is_active has correct default (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'saved_searches' 
    AND column_name = 'is_active'
  ) THEN
    -- Set default if not already set
    ALTER TABLE public.saved_searches 
      ALTER COLUMN is_active SET DEFAULT true;
  END IF;
END $$;

-- ============================================
-- RLS POLICIES: saved_searches
-- ============================================

-- Drop existing overly broad policies
DROP POLICY IF EXISTS "saved_searches owners modify" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches owners select" ON public.saved_searches;

-- Recreate with Plus-only access

-- SELECT: Plus investors can read only their own saved searches
CREATE POLICY "saved_searches_select_plus_owner"
  ON public.saved_searches
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_paid = true
    )
  );

-- INSERT: Plus investors can create saved searches with user_id = auth.uid()
CREATE POLICY "saved_searches_insert_plus_owner"
  ON public.saved_searches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_paid = true
    )
  );

-- UPDATE: Plus investors can update only their own saved searches
CREATE POLICY "saved_searches_update_plus_owner"
  ON public.saved_searches
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_paid = true
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_paid = true
    )
  );

-- DELETE: Plus investors can delete only their own saved searches
CREATE POLICY "saved_searches_delete_plus_owner"
  ON public.saved_searches
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_paid = true
    )
  );

-- ============================================
-- RLS POLICIES: saved_search_matches
-- ============================================

-- Drop existing overly broad policies
DROP POLICY IF EXISTS "Users can insert their own matches" ON public.saved_search_matches;
DROP POLICY IF EXISTS "Users can view their own saved search matches" ON public.saved_search_matches;

-- Recreate with Plus-only access and blocked writes

-- SELECT: Plus investors can read only their own matches
CREATE POLICY "saved_search_matches_select_plus_owner"
  ON public.saved_search_matches
  FOR SELECT
  TO authenticated
  USING (
    investor_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_paid = true
    )
  );

-- INSERT: Block all authenticated users (service role will bypass RLS)
CREATE POLICY "saved_search_matches_insert_block"
  ON public.saved_search_matches
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- UPDATE: Block all authenticated users (service role will bypass RLS)
CREATE POLICY "saved_search_matches_update_block"
  ON public.saved_search_matches
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- DELETE: Block all authenticated users (service role will bypass RLS)
CREATE POLICY "saved_search_matches_delete_block"
  ON public.saved_search_matches
  FOR DELETE
  TO authenticated
  USING (false);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- 
-- Run these queries after applying the migration to verify:
-- 
-- 1. Check columns exist:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' 
--      AND table_name = 'saved_searches'
--      AND column_name IN ('criteria', 'is_enabled', 'is_active')
--    ORDER BY column_name;
-- 
-- 2. Check RLS policies on saved_searches:
--    SELECT policyname, cmd, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' 
--      AND tablename = 'saved_searches'
--    ORDER BY policyname;
-- 
-- 3. Check RLS policies on saved_search_matches:
--    SELECT policyname, cmd, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' 
--      AND tablename = 'saved_search_matches'
--    ORDER BY policyname;
-- 
-- 4. Verify is_paid checks exist in policies:
--    SELECT 
--      tablename,
--      policyname,
--      cmd,
--      CASE 
--        WHEN qual LIKE '%is_paid%' OR with_check LIKE '%is_paid%' THEN '✅ Has is_paid check'
--        ELSE '❌ Missing is_paid check'
--      END AS policy_check
--    FROM pg_policies
--    WHERE schemaname = 'public' 
--      AND tablename IN ('saved_searches', 'saved_search_matches')
--    ORDER BY tablename, policyname;
-- 
-- Expected results:
-- - saved_searches has 4 policies (select, insert, update, delete) all with is_paid checks
-- - saved_search_matches has 4 policies (select with is_paid, insert/update/delete blocked)
-- - No old policy names ("saved_searches owners modify", "Users can insert their own matches", etc.)
-- ============================================
