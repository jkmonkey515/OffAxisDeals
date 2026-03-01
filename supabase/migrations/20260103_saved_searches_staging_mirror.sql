-- ============================================
-- STAGING MIRROR OF PROD SAVED SEARCH SCHEMA
-- ============================================
-- 
-- STAGING ONLY: Do not apply to PROD.
-- 
-- This migration mirrors the Production saved_searches and saved_search_matches
-- tables into STAGING with Plus-only RLS policies.
-- 
-- Features:
-- - Creates tables if missing, or ALTERs to match Production shape
-- - Adds indexes for performance
-- - Enables RLS with Plus-only access policies
-- - Includes updated_at trigger for saved_searches
-- 
-- RLS Rules:
-- - saved_searches: Plus investors can CRUD only their own searches
-- - saved_search_matches: Plus investors can read their own matches only
-- - No authenticated user can write to saved_search_matches (service role only)
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
-- TABLE: saved_searches
-- ============================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  radius_km double precision,
  radius_miles double precision DEFAULT 10 NOT NULL,
  min_price numeric,
  max_price numeric,
  min_beds integer,
  max_beds integer,
  min_baths integer,
  max_baths integer,
  property_types text[],
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_notified_at timestamptz
);

-- Add columns if table exists but columns are missing
DO $$
BEGIN
  -- Add is_enabled if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'saved_searches' 
    AND column_name = 'is_enabled'
  ) THEN
    ALTER TABLE public.saved_searches ADD COLUMN is_enabled boolean DEFAULT true NOT NULL;
  END IF;

  -- Add criteria if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'saved_searches' 
    AND column_name = 'criteria'
  ) THEN
    ALTER TABLE public.saved_searches ADD COLUMN criteria jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;

  -- Ensure other columns exist and have correct types/defaults
  -- Note: This is idempotent - will only alter if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'saved_searches'
  ) THEN
    -- Ensure is_active has default
    ALTER TABLE public.saved_searches 
      ALTER COLUMN is_active SET DEFAULT true,
      ALTER COLUMN is_active SET NOT NULL;

    -- Ensure updated_at has default
    ALTER TABLE public.saved_searches 
      ALTER COLUMN updated_at SET DEFAULT now();

    -- Ensure radius_miles has default
    ALTER TABLE public.saved_searches 
      ALTER COLUMN radius_miles SET DEFAULT 10,
      ALTER COLUMN radius_miles SET NOT NULL;
  END IF;
END $$;

-- Add foreign key constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'saved_searches' 
    AND constraint_name = 'saved_searches_user_id_fkey'
  ) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add updated_at trigger if missing
DROP TRIGGER IF EXISTS saved_searches_updated_at ON public.saved_searches;
CREATE TRIGGER saved_searches_updated_at
  BEFORE UPDATE ON public.saved_searches
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- TABLE: saved_search_matches
-- ============================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.saved_search_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_search_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  investor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivery_status text NOT NULL DEFAULT 'pending'
);

-- Add check constraint for delivery_status if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'saved_search_matches' 
    AND constraint_name = 'saved_search_matches_delivery_status_check'
  ) THEN
    ALTER TABLE public.saved_search_matches
      ADD CONSTRAINT saved_search_matches_delivery_status_check 
      CHECK (delivery_status = ANY (ARRAY['pending'::text, 'notified'::text]));
  END IF;
END $$;

-- Add foreign key constraints if missing
DO $$
BEGIN
  -- saved_search_id foreign key
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'saved_search_matches' 
    AND constraint_name = 'saved_search_matches_saved_search_id_fkey'
  ) THEN
    ALTER TABLE public.saved_search_matches
      ADD CONSTRAINT saved_search_matches_saved_search_id_fkey 
      FOREIGN KEY (saved_search_id) REFERENCES public.saved_searches(id) ON DELETE CASCADE;
  END IF;

  -- listing_id foreign key
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'saved_search_matches' 
    AND constraint_name = 'saved_search_matches_listing_id_fkey'
  ) THEN
    ALTER TABLE public.saved_search_matches
      ADD CONSTRAINT saved_search_matches_listing_id_fkey 
      FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;
  END IF;

  -- investor_id foreign key
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'saved_search_matches' 
    AND constraint_name = 'saved_search_matches_investor_id_fkey'
  ) THEN
    ALTER TABLE public.saved_search_matches
      ADD CONSTRAINT saved_search_matches_investor_id_fkey 
      FOREIGN KEY (investor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================
-- INDEXES
-- ============================================

-- Indexes for saved_searches
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id 
  ON public.saved_searches(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id_is_enabled 
  ON public.saved_searches(user_id, is_enabled);

-- Indexes for saved_search_matches
CREATE INDEX IF NOT EXISTS idx_saved_search_matches_investor_id 
  ON public.saved_search_matches(investor_id);

CREATE INDEX IF NOT EXISTS idx_saved_search_matches_saved_search_id 
  ON public.saved_search_matches(saved_search_id);

CREATE INDEX IF NOT EXISTS idx_saved_search_matches_listing_id 
  ON public.saved_search_matches(listing_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on both tables
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_search_matches ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: saved_searches
-- ============================================

-- Drop existing policies if they exist (for safe re-runs)
DROP POLICY IF EXISTS "saved_searches_select_plus_owner" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches_insert_plus_owner" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches_update_plus_owner" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches_delete_plus_owner" ON public.saved_searches;

-- SELECT: Plus investors can read only their own saved searches
CREATE POLICY "saved_searches_select_plus_owner"
  ON public.saved_searches
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
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
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
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
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
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
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
    )
  );

-- ============================================
-- RLS POLICIES: saved_search_matches
-- ============================================

-- Drop existing policies if they exist (for safe re-runs)
DROP POLICY IF EXISTS "saved_search_matches_select_plus_owner" ON public.saved_search_matches;
DROP POLICY IF EXISTS "saved_search_matches_insert_block" ON public.saved_search_matches;
DROP POLICY IF EXISTS "saved_search_matches_update_block" ON public.saved_search_matches;
DROP POLICY IF EXISTS "saved_search_matches_delete_block" ON public.saved_search_matches;

-- SELECT: Plus investors can read only their own matches
CREATE POLICY "saved_search_matches_select_plus_owner"
  ON public.saved_search_matches
  FOR SELECT
  TO authenticated
  USING (
    investor_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM public.profiles 
      WHERE id = auth.uid() 
      AND is_paid = true
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
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.saved_searches IS 'Saved search criteria for investors to receive alerts on matching listings';
COMMENT ON TABLE public.saved_search_matches IS 'Matches between saved searches and listings (service-managed)';
COMMENT ON COLUMN public.saved_searches.center_lat IS 'Latitude of the search center point for radius-based matching';
COMMENT ON COLUMN public.saved_searches.center_lng IS 'Longitude of the search center point for radius-based matching';
COMMENT ON COLUMN public.saved_searches.radius_km IS 'Radius in kilometers for location-based alerts. NULL means fallback to city/state matching.';
COMMENT ON COLUMN public.saved_searches.radius_miles IS 'Radius in miles for location-based matching. Default is 10 miles.';
COMMENT ON COLUMN public.saved_searches.min_price IS 'Minimum price filter (nullable)';
COMMENT ON COLUMN public.saved_searches.max_price IS 'Maximum price filter (nullable)';
COMMENT ON COLUMN public.saved_searches.min_beds IS 'Minimum bedrooms filter (nullable)';
COMMENT ON COLUMN public.saved_searches.max_beds IS 'Maximum bedrooms filter (nullable)';
COMMENT ON COLUMN public.saved_searches.min_baths IS 'Minimum bathrooms filter (nullable)';
COMMENT ON COLUMN public.saved_searches.max_baths IS 'Maximum bathrooms filter (nullable)';
COMMENT ON COLUMN public.saved_searches.property_types IS 'Array of property types to match (nullable)';
COMMENT ON COLUMN public.saved_searches.criteria IS 'Additional search criteria stored as JSONB';
COMMENT ON COLUMN public.saved_searches.is_active IS 'Whether this search is currently active';
COMMENT ON COLUMN public.saved_searches.is_enabled IS 'Whether this search is enabled for notifications';
COMMENT ON COLUMN public.saved_searches.last_notified_at IS 'Timestamp of last notification sent for this search';
COMMENT ON COLUMN public.saved_search_matches.delivery_status IS 'Status of match delivery: pending or notified';
