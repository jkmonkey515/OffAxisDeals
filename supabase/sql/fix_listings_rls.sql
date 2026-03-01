-- Fix listings RLS for OffAxisDealsMobile
-- 
-- How to run in Supabase SQL editor:
-- 1) Open your project in Supabase.
-- 2) Go to SQL → New query.
-- 3) Paste the contents of this file.
-- 4) Run the script (staging first, then production when ready).
--
-- This script:
-- - Ensures RLS is enabled on public.listings
-- - Defines policies so:
--     * Any authenticated user can SELECT all listings
--     * Only paid wholesalers/admins can insert/update/delete their own listings
--     * Admins can update/delete any listing
--
-- Assumptions (verify before relying on these policies):
-- - public.listings has a column owner_id uuid that references the auth user id
-- - public.profiles has: id uuid, role text, is_paid boolean
--
-- You can quickly verify with:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'listings';
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles';

-- Ensure RLS is enabled on listings
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

-- Helper expression (used inline in policies):
-- A user is a paid wholesaler or admin if their profile row matches:
--   is_paid = true AND role IN ('wholesaler', 'admin')

-- =========================
-- SELECT policy
-- =========================

DROP POLICY IF EXISTS "Listings select all" ON public.listings;

CREATE POLICY "Listings select all"
ON public.listings
FOR SELECT
TO authenticated
USING (true);

-- =========================
-- INSERT policy
-- =========================

DROP POLICY IF EXISTS "Listings insert owner paid wholesaler or admin" ON public.listings;

CREATE POLICY "Listings insert owner paid wholesaler or admin"
ON public.listings
FOR INSERT
TO authenticated
WITH CHECK (
  -- Must own the listing row
  owner_id = auth.uid()
  AND
  -- Must be paid wholesaler or admin
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role IN ('wholesaler', 'admin')
  )
);

-- =========================
-- UPDATE policies
-- =========================

DROP POLICY IF EXISTS "Listings update owner paid wholesaler or admin" ON public.listings;
DROP POLICY IF EXISTS "Listings update admin any" ON public.listings;

-- Paid wholesaler/admin can update their own listings
CREATE POLICY "Listings update owner paid wholesaler or admin"
ON public.listings
FOR UPDATE
TO authenticated
USING (
  owner_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role IN ('wholesaler', 'admin')
  )
)
WITH CHECK (
  owner_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role IN ('wholesaler', 'admin')
  )
);

-- Admin can update any listing
CREATE POLICY "Listings update admin any"
ON public.listings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role = 'admin'
  )
);

-- =========================
-- DELETE policies
-- =========================

DROP POLICY IF EXISTS "Listings delete owner paid wholesaler or admin" ON public.listings;
DROP POLICY IF EXISTS "Listings delete admin any" ON public.listings;

-- Paid wholesaler/admin can delete their own listings
CREATE POLICY "Listings delete owner paid wholesaler or admin"
ON public.listings
FOR DELETE
TO authenticated
USING (
  owner_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role IN ('wholesaler', 'admin')
  )
);

-- Admin can delete any listing
CREATE POLICY "Listings delete admin any"
ON public.listings
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_paid = true
      AND p.role = 'admin'
  )
);


