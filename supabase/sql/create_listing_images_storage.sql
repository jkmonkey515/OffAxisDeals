-- Create listing-images storage bucket and RLS policies for OffAxisDealsMobile
-- 
-- How to run in Supabase SQL editor:
-- 1) Open your project in Supabase.
-- 2) Go to SQL → New query.
-- 3) Paste the contents of this file.
-- 4) Run the script (staging first, then production when ready).
--
-- This script:
-- - Creates the 'listing-images' storage bucket (public read OK for v1)
-- - Defines RLS policies so:
--     * Anyone (anon + authenticated) can read images
--     * Only the listing owner (matching owner_id in path) or paid admin can upload/update/delete
--
-- Assumptions:
-- - public.profiles has: id uuid, role text, is_paid boolean

-- =========================
-- Create storage bucket
-- =========================

-- Insert bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-images',
  'listing-images',
  true, -- public read OK for v1
  52428800, -- 50MB file size limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- =========================
-- RLS Policies for Storage
-- =========================

-- Enable RLS on storage.objects (should already be enabled, but ensure it)
-- Note: Storage RLS is managed via policies on storage.objects

-- Policy: Authenticated users can read images
DROP POLICY IF EXISTS "Listing images read authenticated" ON storage.objects;

CREATE POLICY "Listing images read authenticated"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'listing-images'
);

-- Policy: Anonymous users can read images (since bucket is public)
DROP POLICY IF EXISTS "Listing images read anon" ON storage.objects;

CREATE POLICY "Listing images read anon"
ON storage.objects
FOR SELECT
TO anon
USING (
  bucket_id = 'listing-images'
);

-- Policy: Only listing owner or paid admin can upload
DROP POLICY IF EXISTS "Listing images upload owner or paid admin" ON storage.objects;

CREATE POLICY "Listing images upload owner or paid admin"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'listing-images'
  AND (
    -- Owner can upload into their own folder: ${owner_id}/${listing_id}/...
    split_part(name, '/', 1) = auth.uid()::text
    OR
    -- Paid admin can upload anywhere
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_paid = true
        AND p.role = 'admin'
    )
  )
);

-- Policy: Only listing owner or paid admin can update objects
DROP POLICY IF EXISTS "Listing images update owner or paid admin" ON storage.objects;

CREATE POLICY "Listing images update owner or paid admin"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'listing-images'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_paid = true
        AND p.role = 'admin'
    )
  )
)
WITH CHECK (
  bucket_id = 'listing-images'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_paid = true
        AND p.role = 'admin'
    )
  )
);

-- Policy: Only listing owner or paid admin can delete objects
DROP POLICY IF EXISTS "Listing images delete owner or paid admin" ON storage.objects;

CREATE POLICY "Listing images delete owner or paid admin"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'listing-images'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_paid = true
        AND p.role = 'admin'
    )
  )
);

