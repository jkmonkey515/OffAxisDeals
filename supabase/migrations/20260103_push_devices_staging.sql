-- ============================================
-- STAGING: Push Devices Table
-- ============================================
-- 
-- STAGING ONLY: Do not apply to PROD.
-- 
-- Creates push_devices table for push notification device registration.
-- This table stores Expo push tokens and device metadata for future
-- push notification delivery.
-- 
-- Features:
-- - Plus-only RLS policies (requires profiles.is_paid = true)
-- - Unique constraint on expo_push_token
-- - Partial unique index on (user_id, device_id) where device_id is not null
-- - Updated_at trigger for automatic timestamp management
-- 
-- Safe to run multiple times (idempotent).
-- ============================================

-- ============================================
-- HELPER FUNCTION: updated_at trigger
-- ============================================

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- ============================================
-- TABLE: push_devices
-- ============================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  expo_push_token text NOT NULL,
  device_id text NULL,
  device_name text NULL,
  app_version text NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add foreign key constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'push_devices' 
    AND constraint_name = 'push_devices_user_id_fkey'
  ) THEN
    ALTER TABLE public.push_devices
      ADD CONSTRAINT push_devices_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add unique constraint on expo_push_token if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'push_devices' 
    AND constraint_name = 'push_devices_expo_push_token_key'
  ) THEN
    ALTER TABLE public.push_devices
      ADD CONSTRAINT push_devices_expo_push_token_key 
      UNIQUE (expo_push_token);
  END IF;
END $$;

-- ============================================
-- INDEXES
-- ============================================

-- Index on user_id for efficient lookups
CREATE INDEX IF NOT EXISTS idx_push_devices_user_id 
  ON public.push_devices(user_id);

-- Partial unique index on (user_id, device_id) where device_id is not null
-- This allows multiple devices per user but prevents duplicate device_id per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_user_id_device_id_unique
  ON public.push_devices(user_id, device_id)
  WHERE device_id IS NOT NULL;

-- ============================================
-- TRIGGERS
-- ============================================

-- Add updated_at trigger if missing
DROP TRIGGER IF EXISTS push_devices_updated_at ON public.push_devices;
CREATE TRIGGER push_devices_updated_at
  BEFORE UPDATE ON public.push_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on push_devices
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: push_devices
-- ============================================

-- Drop existing policies if they exist (for safe re-runs)
DROP POLICY IF EXISTS "push_devices_select_plus_owner" ON public.push_devices;
DROP POLICY IF EXISTS "push_devices_insert_plus_owner" ON public.push_devices;
DROP POLICY IF EXISTS "push_devices_update_plus_owner" ON public.push_devices;
DROP POLICY IF EXISTS "push_devices_delete_plus_owner" ON public.push_devices;

-- SELECT: Plus users can read only their own push devices
CREATE POLICY "push_devices_select_plus_owner"
  ON public.push_devices
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

-- INSERT: Plus users can create push devices with user_id = auth.uid()
CREATE POLICY "push_devices_insert_plus_owner"
  ON public.push_devices
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

-- UPDATE: Plus users can update only their own push devices
CREATE POLICY "push_devices_update_plus_owner"
  ON public.push_devices
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

-- DELETE: Plus users can delete only their own push devices
CREATE POLICY "push_devices_delete_plus_owner"
  ON public.push_devices
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
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.push_devices IS 'Push notification device registrations for Expo push tokens';
COMMENT ON COLUMN public.push_devices.user_id IS 'User who owns this device registration';
COMMENT ON COLUMN public.push_devices.platform IS 'Platform: ios, android, or web';
COMMENT ON COLUMN public.push_devices.expo_push_token IS 'Expo push notification token (unique)';
COMMENT ON COLUMN public.push_devices.device_id IS 'Optional device identifier for deduplication';
COMMENT ON COLUMN public.push_devices.device_name IS 'Optional human-readable device name';
COMMENT ON COLUMN public.push_devices.app_version IS 'Optional app version string';
COMMENT ON COLUMN public.push_devices.is_enabled IS 'Whether push notifications are enabled for this device';
COMMENT ON COLUMN public.push_devices.last_seen_at IS 'Last time this device was seen/updated';
COMMENT ON COLUMN public.push_devices.created_at IS 'When this device registration was created';
COMMENT ON COLUMN public.push_devices.updated_at IS 'When this device registration was last updated';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- 
-- Run these queries after applying the migration to verify:
-- 
-- 1. Check table exists and columns:
--    SELECT 
--      column_name,
--      data_type,
--      is_nullable,
--      column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' 
--      AND table_name = 'push_devices'
--    ORDER BY ordinal_position;
-- 
-- 2. Check constraints:
--    SELECT
--      tc.constraint_name,
--      tc.constraint_type,
--      kcu.column_name
--    FROM information_schema.table_constraints tc
--    JOIN information_schema.key_column_usage kcu
--      ON tc.constraint_name = kcu.constraint_name
--    WHERE tc.table_schema = 'public'
--      AND tc.table_name = 'push_devices'
--    ORDER BY tc.constraint_type, tc.constraint_name;
-- 
-- 3. Check indexes:
--    SELECT 
--      indexname,
--      indexdef
--    FROM pg_indexes
--    WHERE schemaname = 'public' 
--      AND tablename = 'push_devices'
--    ORDER BY indexname;
-- 
-- 4. Check RLS is enabled:
--    SELECT 
--      tablename,
--      rowsecurity
--    FROM pg_tables
--    WHERE schemaname = 'public' 
--      AND tablename = 'push_devices';
-- 
-- 5. Check RLS policies:
--    SELECT 
--      policyname,
--      cmd,
--      qual,
--      with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' 
--      AND tablename = 'push_devices'
--    ORDER BY policyname;
-- 
-- 6. Verify is_paid checks exist in policies:
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
--      AND tablename = 'push_devices'
--    ORDER BY policyname;
-- 
-- Expected results:
-- - Table has 11 columns (id, user_id, platform, expo_push_token, device_id, device_name, app_version, is_enabled, last_seen_at, created_at, updated_at)
-- - Unique constraint on expo_push_token
-- - Foreign key constraint on user_id -> profiles(id)
-- - Index on user_id
-- - Partial unique index on (user_id, device_id) where device_id IS NOT NULL
-- - RLS enabled
-- - 4 policies (select, insert, update, delete) all with is_paid checks
-- ============================================
