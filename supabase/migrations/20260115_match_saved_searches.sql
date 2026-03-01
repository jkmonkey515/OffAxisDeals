-- ============================================
-- MATCH SAVED SEARCHES AGAINST LISTINGS
-- ============================================
-- 
-- This migration creates a function to match saved searches against listings
-- based on criteria.location_keyword and criteria.buy_box filters.
-- 
-- Features:
-- - Location keyword matching (case-insensitive) against city, state, zip, address
-- - Buy box filters: min_beds, min_baths, min_price, max_price
-- - Only processes active saved searches (is_active = true AND is_enabled = true)
-- - Requires at least one filter: location_keyword OR buy_box (prevents matching all listings)
-- - Only processes active listings (excludes sold, archived, deleted, inactive)
-- - Idempotent: uses ON CONFLICT DO NOTHING to prevent duplicates
-- 
-- Usage:
--   SELECT public.match_saved_searches();
-- 
-- Can be called by pg_cron for periodic matching.
-- ============================================

-- ============================================
-- UNIQUE INDEX: Prevent duplicate matches
-- ============================================

-- First, remove duplicate rows (keep the oldest one for each (saved_search_id, listing_id) pair)
DELETE FROM public.saved_search_matches
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY saved_search_id, listing_id 
             ORDER BY created_at ASC
           ) AS rn
    FROM public.saved_search_matches
  ) t
  WHERE t.rn > 1
);

-- Create unique index on (saved_search_id, listing_id) if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS saved_search_matches_saved_search_listing_unique
  ON public.saved_search_matches(saved_search_id, listing_id);

-- ============================================
-- FUNCTION: match_saved_searches()
-- ============================================

-- Recreate function (using CREATE OR REPLACE to avoid dropping if dependencies exist)
CREATE OR REPLACE FUNCTION public.match_saved_searches()
RETURNS TABLE(
  matches_created bigint,
  searches_processed bigint,
  listings_checked bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matches_created bigint := 0;
  v_searches_processed bigint := 0;
  v_listings_checked bigint := 0;
BEGIN
  -- Insert matches for all active saved searches
  WITH matched_listings AS (
    SELECT DISTINCT
      ss.id AS saved_search_id,
      ss.user_id AS investor_id,
      l.id AS listing_id
    FROM public.saved_searches ss
    CROSS JOIN public.listings l
    WHERE 
      -- Only active and enabled saved searches
      ss.is_active = true
      AND ss.is_enabled = true
      -- Require at least one filter: location_keyword OR buy_box
      AND (
        -- Has location keyword (non-empty)
        COALESCE(NULLIF(TRIM(ss.criteria->>'location_keyword'), ''), NULL) IS NOT NULL
        OR
        -- Has at least one buy_box filter
        (
          (ss.criteria ? 'buy_box')
          AND (
            (ss.criteria->'buy_box'->>'min_beds') IS NOT NULL
            OR (ss.criteria->'buy_box'->>'min_baths') IS NOT NULL
            OR (ss.criteria->'buy_box'->>'min_price') IS NOT NULL
            OR (ss.criteria->'buy_box'->>'max_price') IS NOT NULL
          )
        )
      )
      -- Only active listings (safe enum/text comparison - avoids casting errors)
      AND COALESCE(l.status::text, '') NOT IN ('sold', 'archived', 'deleted', 'inactive')
      -- Location keyword matching (if criteria.location_keyword exists, it must match)
      AND (
        -- If location_keyword is present, it must match
        (ss.criteria->>'location_keyword' IS NULL OR ss.criteria->>'location_keyword' = '')
        OR (
          -- Match location keyword against city, state, zip, or address (case-insensitive)
          LOWER(COALESCE(l.city, '')) LIKE '%' || LOWER(ss.criteria->>'location_keyword') || '%'
          OR LOWER(COALESCE(l.state, '')) LIKE '%' || LOWER(ss.criteria->>'location_keyword') || '%'
          OR LOWER(COALESCE(l.zip, '')) LIKE '%' || LOWER(ss.criteria->>'location_keyword') || '%'
          OR LOWER(COALESCE(l.address, '')) LIKE '%' || LOWER(ss.criteria->>'location_keyword') || '%'
        )
      )
      -- Buy box filters (if criteria.buy_box exists)
      AND (
        -- Min beds filter
        (
          ss.criteria->'buy_box'->>'min_beds' IS NULL
          OR (l.beds IS NOT NULL AND l.beds >= (ss.criteria->'buy_box'->>'min_beds')::integer)
        )
        -- Min baths filter
        AND (
          ss.criteria->'buy_box'->>'min_baths' IS NULL
          OR (l.baths IS NOT NULL AND l.baths >= (ss.criteria->'buy_box'->>'min_baths')::numeric)
        )
        -- Min price filter
        AND (
          ss.criteria->'buy_box'->>'min_price' IS NULL
          OR (l.price IS NOT NULL AND l.price >= (ss.criteria->'buy_box'->>'min_price')::numeric)
        )
        -- Max price filter
        AND (
          ss.criteria->'buy_box'->>'max_price' IS NULL
          OR (l.price IS NOT NULL AND l.price <= (ss.criteria->'buy_box'->>'max_price')::numeric)
        )
      )
  )
  INSERT INTO public.saved_search_matches (
    saved_search_id,
    listing_id,
    investor_id,
    delivery_status
  )
  SELECT
    saved_search_id,
    listing_id,
    investor_id,
    'pending'
  FROM matched_listings
  -- Use ON CONFLICT to prevent duplicates (idempotent)
  ON CONFLICT (saved_search_id, listing_id) DO NOTHING;

  -- Get count of matches created (ROW_COUNT from INSERT)
  GET DIAGNOSTICS v_matches_created = ROW_COUNT;
  
  SELECT COUNT(DISTINCT ss.id) INTO v_searches_processed
  FROM public.saved_searches ss
  WHERE ss.is_active = true AND ss.is_enabled = true;
  
  SELECT COUNT(*) INTO v_listings_checked
  FROM public.listings
  WHERE COALESCE(status::text, '') NOT IN ('sold', 'archived', 'deleted', 'inactive');

  -- Return statistics
  RETURN QUERY SELECT v_matches_created, v_searches_processed, v_listings_checked;
END;
$$;

-- Grant execute permission to service role (for cron jobs)
GRANT EXECUTE ON FUNCTION public.match_saved_searches() TO service_role;

-- Comment on function
COMMENT ON FUNCTION public.match_saved_searches() IS 
  'Matches active saved searches against live listings based on criteria.location_keyword and criteria.buy_box filters. Requires at least one filter to be present (location_keyword or buy_box) to prevent matching all listings. Returns statistics about matches created, searches processed, and listings checked. Idempotent: uses ON CONFLICT to prevent duplicate matches.';
