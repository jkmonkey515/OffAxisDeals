-- Verification SQL for profiles defaults and handle_new_user() function
-- Run these queries in Supabase SQL Editor after applying migration 0003

-- 1. Show column defaults for role, tier, is_paid, and segment
SELECT 
  column_name,
  column_default,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name IN ('role', 'tier', 'is_paid', 'segment')
ORDER BY column_name;

-- Expected results:
-- role: default should be 'investor'::text
-- tier: default should be 'free'::text (if column exists)
-- is_paid: default should be false (if column exists)
-- segment: default should be 'investor'::text (if column exists)

-- 2. Confirm the trigger exists on auth.users
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'auth'
  AND event_object_table = 'users'
  AND trigger_name = 'on_auth_user_created';

-- Expected result: One row showing on_auth_user_created trigger

-- 3. Verify handle_new_user() function exists and is correct
SELECT 
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'handle_new_user';

-- Expected result: One row showing function exists with SECURITY DEFINER

-- 4. After signup, verify profile was created correctly
-- Run this as the authenticated user after signing up:
-- SELECT id, role, tier, is_paid, segment 
-- FROM public.profiles 
-- WHERE id = auth.uid();

-- Expected result: One row with:
-- - id: matches auth.uid()
-- - role: 'investor'
-- - tier: 'free' (if column exists)
-- - is_paid: false (if column exists)
-- - segment: 'investor' (if column exists)

-- Alternative (for admin testing with a specific user ID):
-- SELECT id, role, tier, is_paid, segment 
-- FROM public.profiles 
-- WHERE id = '<user-id-here>';

