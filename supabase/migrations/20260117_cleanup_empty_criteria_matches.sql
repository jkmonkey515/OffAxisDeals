-- ============================================
-- CLEANUP EMPTY-CRITERIA SAVED SEARCH MATCHES
-- ============================================
-- 
-- This migration cleans up pending matches created by saved searches with empty criteria.
-- Empty criteria searches (no location_keyword and no buy_box) should not match all listings.
-- 
-- Safe to re-run (idempotent).
-- ============================================

-- ============================================
-- PART A: Delete pending matches from empty-criteria searches
-- ============================================

-- Identify and delete pending matches for saved searches with empty criteria
DELETE FROM public.saved_search_matches m
USING public.saved_searches ss
WHERE m.saved_search_id = ss.id
  AND m.delivery_status = 'pending'
  AND (
    -- Criteria is null or empty object
    ss.criteria IS NULL
    OR ss.criteria = '{}'::jsonb
    OR (
      -- No location keyword (null or empty string)
      COALESCE(NULLIF(TRIM(ss.criteria->>'location_keyword'), ''), NULL) IS NULL
      AND (
        -- No buy_box or empty buy_box
        ss.criteria->'buy_box' IS NULL
        OR ss.criteria->'buy_box' = '{}'::jsonb
        OR (
          -- buy_box exists but all fields are null/empty
          (ss.criteria->'buy_box'->>'min_beds') IS NULL
          AND (ss.criteria->'buy_box'->>'min_baths') IS NULL
          AND (ss.criteria->'buy_box'->>'min_price') IS NULL
          AND (ss.criteria->'buy_box'->>'max_price') IS NULL
        )
      )
    )
  );

-- ============================================
-- PART B: Disable empty-criteria saved searches (optional but recommended)
-- ============================================

-- Disable saved searches with empty criteria to prevent future matches
UPDATE public.saved_searches
SET is_enabled = false
WHERE is_enabled = true
  AND (
    -- Criteria is null or empty object
    criteria IS NULL
    OR criteria = '{}'::jsonb
    OR (
      -- No location keyword (null or empty string)
      COALESCE(NULLIF(TRIM(criteria->>'location_keyword'), ''), NULL) IS NULL
      AND (
        -- No buy_box or empty buy_box
        criteria->'buy_box' IS NULL
        OR criteria->'buy_box' = '{}'::jsonb
        OR (
          -- buy_box exists but all fields are null/empty
          (criteria->'buy_box'->>'min_beds') IS NULL
          AND (criteria->'buy_box'->>'min_baths') IS NULL
          AND (criteria->'buy_box'->>'min_price') IS NULL
          AND (criteria->'buy_box'->>'max_price') IS NULL
        )
      )
    )
  );

-- ============================================
-- VERIFICATION QUERIES (run after cleanup)
-- ============================================

-- Check how many empty-criteria searches exist (should be disabled now)
SELECT 
  COUNT(*) AS empty_criteria_searches,
  COUNT(*) FILTER (WHERE is_enabled = true) AS still_enabled,
  COUNT(*) FILTER (WHERE is_enabled = false) AS now_disabled
FROM public.saved_searches
WHERE (
  criteria IS NULL
  OR criteria = '{}'::jsonb
  OR (
    COALESCE(NULLIF(TRIM(criteria->>'location_keyword'), ''), NULL) IS NULL
    AND (
      criteria->'buy_box' IS NULL
      OR criteria->'buy_box' = '{}'::jsonb
      OR (
        (criteria->'buy_box'->>'min_beds') IS NULL
        AND (criteria->'buy_box'->>'min_baths') IS NULL
        AND (criteria->'buy_box'->>'min_price') IS NULL
        AND (criteria->'buy_box'->>'max_price') IS NULL
      )
    )
  )
);

-- Check for any remaining pending matches from empty-criteria searches
SELECT 
  COUNT(*) AS remaining_pending_matches
FROM public.saved_search_matches m
JOIN public.saved_searches ss ON ss.id = m.saved_search_id
WHERE m.delivery_status = 'pending'
  AND (
    ss.criteria IS NULL
    OR ss.criteria = '{}'::jsonb
    OR (
      COALESCE(NULLIF(TRIM(ss.criteria->>'location_keyword'), ''), NULL) IS NULL
      AND (
        ss.criteria->'buy_box' IS NULL
        OR ss.criteria->'buy_box' = '{}'::jsonb
        OR (
          (ss.criteria->'buy_box'->>'min_beds') IS NULL
          AND (ss.criteria->'buy_box'->>'min_baths') IS NULL
          AND (ss.criteria->'buy_box'->>'min_price') IS NULL
          AND (ss.criteria->'buy_box'->>'max_price') IS NULL
        )
      )
    )
  );
