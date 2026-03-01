-- ============================================
-- ADD RADIUS MODE SUPPORT TO match_saved_searches()
-- ============================================
-- 
-- Updates match_saved_searches() to support radius mode area filtering.
-- If area_mode = 'radius' and center/radius present, uses distance calculation.
-- Falls back to keyword match if listing lacks coordinates.
-- ============================================

-- Recreate function with radius mode support
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
      -- Require at least one filter: location_keyword OR buy_box OR area
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
        OR
        -- Has area mode (radius or polygon)
        (
          (ss.criteria->>'area_mode' = 'radius' 
           AND (ss.criteria->'center' IS NOT NULL OR ss.center_lat IS NOT NULL)
           AND (ss.criteria->>'radius_miles' IS NOT NULL OR ss.radius_miles IS NOT NULL))
          OR
          (ss.criteria->'geo'->'bounds' IS NOT NULL)
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
      -- Area mode filtering
      AND (
        -- No area mode or area_mode = 'any' - no geographic filtering
        (ss.criteria->>'area_mode' IS NULL OR ss.criteria->>'area_mode' = 'any')
        OR
        -- Radius mode: check if listing is within radius
        (
          ss.criteria->>'area_mode' = 'radius'
          AND (
            -- Get center from criteria.center or top-level columns
            (
              (ss.criteria->'center'->>'lat' IS NOT NULL AND ss.criteria->'center'->>'lng' IS NOT NULL)
              OR (ss.center_lat IS NOT NULL AND ss.center_lng IS NOT NULL)
            )
            AND (
              -- Get radius from criteria.radius_miles or top-level column
              (ss.criteria->>'radius_miles' IS NOT NULL OR ss.radius_miles IS NOT NULL)
            )
            AND (
              -- Listing has coordinates (using latitude/longitude columns)
              (l.latitude IS NOT NULL AND l.longitude IS NOT NULL)
              AND (
                -- Calculate distance using Haversine formula (approximate)
                -- Distance in miles = 3959 * acos(cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1)) + sin(radians(lat1)) * sin(radians(lat2)))
                -- We use COALESCE to prefer criteria values, fallback to top-level columns
                3959 * acos(
                  LEAST(1.0, 
                    cos(radians(COALESCE((ss.criteria->'center'->>'lat')::numeric, ss.center_lat))) *
                    cos(radians(l.latitude)) *
                    cos(radians(l.longitude) - radians(COALESCE((ss.criteria->'center'->>'lng')::numeric, ss.center_lng))) +
                    sin(radians(COALESCE((ss.criteria->'center'->>'lat')::numeric, ss.center_lat))) *
                    sin(radians(l.latitude))
                  )
                ) <= COALESCE((ss.criteria->>'radius_miles')::numeric, ss.radius_miles)
              )
              -- Fallback: if listing lacks coordinates, use keyword match only
              OR (l.latitude IS NULL OR l.longitude IS NULL)
            )
          )
        )
        OR
        -- Polygon mode: check if listing is within bounds (existing logic)
        (
          ss.criteria->'geo'->'bounds' IS NOT NULL
          AND (
            -- Listing has coordinates and is within bounds (using latitude/longitude columns)
            (l.latitude IS NOT NULL AND l.longitude IS NOT NULL
             AND l.latitude >= (ss.criteria->'geo'->'bounds'->'sw'->>'lat')::numeric
             AND l.latitude <= (ss.criteria->'geo'->'bounds'->'ne'->>'lat')::numeric
             AND l.longitude >= (ss.criteria->'geo'->'bounds'->'sw'->>'lng')::numeric
             AND l.longitude <= (ss.criteria->'geo'->'bounds'->'ne'->>'lng')::numeric)
            -- Fallback: if listing lacks coordinates, use keyword match only
            OR (l.latitude IS NULL OR l.longitude IS NULL)
          )
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

  -- Diagnostics: log that we're using latitude/longitude columns
  RAISE NOTICE 'match_saved_searches() using listings.latitude and listings.longitude columns';

  -- Return statistics
  RETURN QUERY SELECT v_matches_created, v_searches_processed, v_listings_checked;
END;
$$;

-- Comment on function
COMMENT ON FUNCTION public.match_saved_searches() IS 
  'Matches active saved searches against live listings based on criteria.location_keyword, criteria.buy_box filters, and area mode (any/radius/polygon). Radius mode uses Haversine distance calculation with listings.latitude and listings.longitude columns. Requires at least one filter to be present (location_keyword, buy_box, or area) to prevent matching all listings. Returns statistics about matches created, searches processed, and listings checked. Idempotent: uses ON CONFLICT to prevent duplicate matches.';
