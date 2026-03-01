-- Restrict profiles RLS and create profile_cards view
-- This migration:
-- 1. Removes any broad SELECT policies on profiles (keep only own-profile access)
-- 2. Creates profile_cards view with limited columns
-- 3. Grants authenticated users SELECT access to profile_cards

-- Step 1: Ensure RLS is enabled on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop ALL existing SELECT policies on profiles (we'll recreate the correct one)
-- This ensures we remove any broad policies that allow viewing all rows
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'profiles' 
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', r.policyname);
  END LOOP;
END $$;

-- Step 3: Create the correct own-profile SELECT policy
-- This is the ONLY SELECT policy that should exist
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Step 4: Create profile_cards view with limited columns
-- Only expose safe, public-facing columns
-- Note: If any of these columns don't exist, the view creation will fail
-- Add missing columns to profiles table first if needed
CREATE OR REPLACE VIEW public.profile_cards AS
SELECT 
  id,
  full_name,
  profile_photo_url,
  role,
  segment,
  city,
  state
FROM public.profiles;

-- Step 5: Create a SECURITY DEFINER function to query profile_cards
-- This function runs with elevated privileges to bypass RLS on the underlying table
-- and allows authenticated users to see all profile cards
CREATE OR REPLACE FUNCTION public.get_profile_cards()
RETURNS TABLE (
  id uuid,
  full_name text,
  profile_photo_url text,
  role text,
  segment text,
  city text,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.full_name,
    p.profile_photo_url,
    p.role,
    p.segment,
    p.city,
    p.state
  FROM public.profiles p;
END;
$$;

-- Step 6: Grant execute permission on the function to authenticated users
GRANT EXECUTE ON FUNCTION public.get_profile_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_cards() TO anon;

-- Step 7: Also grant direct SELECT on the view (for cases where RLS allows it)
-- The view will respect RLS from the underlying table, but the function bypasses it
GRANT SELECT ON public.profile_cards TO authenticated;
GRANT SELECT ON public.profile_cards TO anon;

