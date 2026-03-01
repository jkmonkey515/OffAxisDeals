-- ============================================
-- VERIFICATION QUERIES FOR SAVED SEARCH MATCHING
-- ============================================
-- 
-- Use these queries to validate that match_saved_searches() is working correctly
-- and respecting location_keyword and buy_box filters.
-- ============================================

-- ============================================
-- PART A: List saved searches + criteria summary
-- ============================================
-- Shows recent saved searches with their criteria
SELECT 
  id, 
  user_id, 
  name,
  is_active, 
  is_enabled, 
  criteria,
  created_at
FROM public.saved_searches 
ORDER BY created_at DESC 
LIMIT 20;

-- ============================================
-- PART B: Check matches for a specific saved search
-- ============================================
-- Replace :ss_id with the actual saved_search_id
-- This shows all matched listings and highlights potential filter violations
SELECT
  s.id AS saved_search_id,
  s.name AS search_name,
  s.criteria,
  m.listing_id,
  l.city, 
  l.state, 
  l.zip, 
  l.address,
  l.beds, 
  l.baths, 
  l.price,
  l.status,
  m.created_at AS match_created_at,
  -- Check if location keyword matches (if present)
  CASE 
    WHEN s.criteria->>'location_keyword' IS NOT NULL 
         AND s.criteria->>'location_keyword' != ''
         AND LOWER(COALESCE(l.city, '')) NOT LIKE '%' || LOWER(s.criteria->>'location_keyword') || '%'
         AND LOWER(COALESCE(l.state, '')) NOT LIKE '%' || LOWER(s.criteria->>'location_keyword') || '%'
         AND LOWER(COALESCE(l.zip, '')) NOT LIKE '%' || LOWER(s.criteria->>'location_keyword') || '%'
         AND LOWER(COALESCE(l.address, '')) NOT LIKE '%' || LOWER(s.criteria->>'location_keyword') || '%'
    THEN '⚠️ Location mismatch'
    ELSE NULL
  END AS location_warning,
  -- Check if buy box filters are violated
  CASE 
    WHEN s.criteria->'buy_box'->>'min_beds' IS NOT NULL 
         AND (l.beds IS NULL OR l.beds < (s.criteria->'buy_box'->>'min_beds')::integer)
    THEN '⚠️ Beds too low'
    WHEN s.criteria->'buy_box'->>'min_baths' IS NOT NULL 
         AND (l.baths IS NULL OR l.baths < (s.criteria->'buy_box'->>'min_baths')::numeric)
    THEN '⚠️ Baths too low'
    WHEN s.criteria->'buy_box'->>'min_price' IS NOT NULL 
         AND (l.price IS NULL OR l.price < (s.criteria->'buy_box'->>'min_price')::numeric)
    THEN '⚠️ Price too low'
    WHEN s.criteria->'buy_box'->>'max_price' IS NOT NULL 
         AND (l.price IS NULL OR l.price > (s.criteria->'buy_box'->>'max_price')::numeric)
    THEN '⚠️ Price too high'
    ELSE NULL
  END AS buy_box_warning
FROM public.saved_search_matches m
JOIN public.saved_searches s ON s.id = m.saved_search_id
JOIN public.listings l ON l.id = m.listing_id
WHERE m.saved_search_id = :ss_id  -- Replace :ss_id with actual UUID
ORDER BY m.created_at DESC
LIMIT 50;

-- ============================================
-- PART C: Check for duplicate matches (idempotency)
-- ============================================
-- Total matches vs distinct pairs should match (or total >= distinct if old dupes exist)
-- After running the migration, these should match (duplicate_count = 0)
SELECT 
  COUNT(*) AS total_matches,
  COUNT(DISTINCT (saved_search_id, listing_id)) AS distinct_pairs,
  COUNT(*) - COUNT(DISTINCT (saved_search_id, listing_id)) AS duplicate_count,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT (saved_search_id, listing_id)) THEN '✅ No duplicates'
    ELSE '⚠️ Duplicates found - run deduplication in migration'
  END AS status
FROM public.saved_search_matches;

-- Show any duplicate pairs (if they exist)
SELECT 
  saved_search_id,
  listing_id,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(id ORDER BY created_at) AS match_ids,
  ARRAY_AGG(created_at ORDER BY created_at) AS created_times
FROM public.saved_search_matches
GROUP BY saved_search_id, listing_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- ============================================
-- PART D: Summary statistics
-- ============================================
-- Overall matching statistics
SELECT 
  COUNT(DISTINCT m.saved_search_id) AS searches_with_matches,
  COUNT(DISTINCT m.listing_id) AS unique_listings_matched,
  COUNT(*) AS total_matches,
  COUNT(*) FILTER (WHERE m.delivery_status = 'pending') AS pending_delivery,
  COUNT(*) FILTER (WHERE m.delivery_status = 'notified') AS notified
FROM public.saved_search_matches m;

-- Matches by saved search (top 20)
SELECT 
  s.id,
  s.name,
  s.criteria->>'location_keyword' AS location_keyword,
  s.criteria->'buy_box' AS buy_box,
  COUNT(m.id) AS match_count,
  COUNT(m.id) FILTER (WHERE m.delivery_status = 'pending') AS pending_count
FROM public.saved_searches s
LEFT JOIN public.saved_search_matches m ON m.saved_search_id = s.id
WHERE s.is_active = true AND s.is_enabled = true
GROUP BY s.id, s.name, s.criteria
ORDER BY match_count DESC
LIMIT 20;
