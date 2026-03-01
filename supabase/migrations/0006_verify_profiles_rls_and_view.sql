-- Verification queries for profiles RLS and profile_cards view
-- IMPORTANT: RLS only applies to non-superuser roles
-- If you run queries as 'postgres' superuser, RLS is bypassed
-- To test RLS properly, use the Supabase client or run queries as an authenticated user

-- ============================================
-- VERIFICATION 0: Check if RLS is enabled on profiles
-- ============================================
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'profiles';

-- Expected result: rowsecurity = true (RLS is enabled)

-- ============================================
-- VERIFICATION 1: Check profiles RLS policies
-- ============================================
-- This should show only the "Users can view their own profile" policy
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
WHERE schemaname = 'public'
  AND tablename = 'profiles'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Expected result: Only one policy named "Users can view their own profile"
-- with roles containing 'authenticated' and qual containing 'auth.uid()'

-- ============================================
-- VERIFICATION 2: Test profiles SELECT (own profile only)
-- ============================================
-- IMPORTANT: This test only works when run as an authenticated user (not as postgres superuser)
-- In Supabase SQL Editor, RLS is bypassed for superuser queries
-- To test properly, use the Supabase client library or REST API as an authenticated user
-- 
-- Run this as an authenticated user (via client/API):
-- SELECT * FROM public.profiles;

-- Expected result: Only returns the current user's row (where id = auth.uid())
-- Should NOT return other users' profiles
-- 
-- Note: If you see multiple rows, you're likely running as superuser (postgres role)
-- which bypasses RLS. This is expected behavior - RLS only applies to non-superuser roles.

-- ============================================
-- VERIFICATION 3: Check profile_cards view exists
-- ============================================
SELECT 
  table_schema,
  table_name,
  view_definition
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name = 'profile_cards';

-- Expected result: One row showing the view definition with columns:
-- id, full_name, profile_photo_url, role, segment, city, state

-- ============================================
-- VERIFICATION 4: Check get_profile_cards function exists
-- ============================================
SELECT 
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_profile_cards';

-- Expected result: One row showing function exists with SECURITY DEFINER

-- ============================================
-- VERIFICATION 5: Test profile_cards via function (all users)
-- ============================================
-- Run this as an authenticated user (via client/API or SQL Editor)
-- SELECT * FROM public.get_profile_cards() LIMIT 10;

-- Expected result: Returns up to 10 profile cards from any user
-- Should include other users' cards (not just your own)
-- This function uses SECURITY DEFINER so it bypasses RLS

-- ============================================
-- VERIFICATION 6: Test profile_cards view directly (may be limited by RLS)
-- ============================================
-- Run this as an authenticated user (via client/API)
-- SELECT * FROM public.profile_cards LIMIT 10;

-- Note: This will respect RLS from underlying profiles table
-- As an authenticated user, you'll only see your own row
-- Use get_profile_cards() function instead to see all cards

-- ============================================
-- VERIFICATION 6: Verify profile_cards columns
-- ============================================
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profile_cards'
ORDER BY ordinal_position;

-- Expected result: Only these columns:
-- id, full_name, profile_photo_url, role, segment, city, state
-- Should NOT include: email, phone, stripe_customer_id, etc.

-- ============================================
-- VERIFICATION 7: Compare profiles vs profile_cards
-- ============================================
-- Run both queries as an authenticated user and compare results

-- Query 1: SELECT from profiles (should only return your row)
-- SELECT id, role, email FROM public.profiles;

-- Query 2: SELECT from profile_cards (should return multiple rows)
-- SELECT id, role FROM public.profile_cards LIMIT 5;

-- Expected: 
-- - profiles query returns 1 row (your own)
-- - profile_cards query returns up to 5 rows (can include others)

