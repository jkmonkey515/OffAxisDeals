--
-- PostgreSQL database dump
--

\restrict VgE4hGCf5Ldt9wHTF8DwwXLX7ATy20r5LHCTdRyQNztGKIqsoZ9x1w3NJ2Nim90

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: ai_usage_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_usage_cleanup() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    AS $$
  DELETE FROM public.ai_usage
  WHERE month_start < (current_date - interval '365 days');
$$;


--
-- Name: assign_trial_and_cohort(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_trial_and_cohort(p_user_id uuid) RETURNS TABLE(trial_type text, trial_batch integer, discount_cohort text, count_30d integer, count_early14 integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_trial_type TEXT;
  v_trial_batch INTEGER;
  v_discount_cohort TEXT;
  v_count_30d INTEGER;
  v_count_early14 INTEGER;
  v_granted BOOLEAN := FALSE;
BEGIN
  -- Check if user already has a trial_type assigned
  SELECT trial_type INTO v_trial_type
  FROM public.profiles
  WHERE id = p_user_id;

  -- If user already has a trial_type, return current values
  IF v_trial_type IS NOT NULL THEN
    SELECT 
      trial_type,
      trial_batch,
      discount_cohort,
      (SELECT COUNT(*) FROM public.profiles WHERE trial_type = '30_day'),
      (SELECT COUNT(*) FROM public.profiles WHERE discount_cohort = 'early_14d')
    INTO v_trial_type, v_trial_batch, v_discount_cohort, v_count_30d, v_count_early14
    FROM public.profiles
    WHERE id = p_user_id;
    
    RETURN QUERY SELECT v_trial_type, v_trial_batch, v_discount_cohort, v_count_30d, v_count_early14;
    RETURN;
  END IF;

  -- Count existing 30_day trials
  SELECT COUNT(*) INTO v_count_30d
  FROM public.profiles
  WHERE trial_type = '30_day';

  -- Assign trial_type based on count
  IF v_count_30d < 1000 THEN
    -- User 1-1000: 30-day trial
    v_trial_type := '30_day';
    v_trial_batch := FLOOR(v_count_30d / 250) + 1; -- Batch 1-4
    v_discount_cohort := 'early_30d';
  ELSE
    -- User 1001+: 14-day trial
    v_trial_type := '14_day';
    v_trial_batch := NULL; -- No batches for 14-day trials
  END IF;

  -- If 14-day trial, determine discount cohort
  IF v_trial_type = '14_day' THEN
    -- Count existing early_14d cohort members
    SELECT COUNT(*) INTO v_count_early14
    FROM public.profiles
    WHERE discount_cohort = 'early_14d';

    -- Assign discount cohort for users 1001-2000
    IF v_count_early14 < 1000 THEN
      v_discount_cohort := 'early_14d';
    ELSE
      v_discount_cohort := 'none';
    END IF;
  END IF;

  -- Atomically update the user's profile
  -- This UPDATE will only succeed if trial_type is still NULL (race condition protection)
  UPDATE public.profiles
  SET 
    trial_type = v_trial_type,
    trial_granted_at = NOW(),
    trial_batch = v_trial_batch,
    discount_cohort = v_discount_cohort
  WHERE id = p_user_id
    AND trial_type IS NULL
  RETURNING TRUE INTO v_granted;

  -- If update succeeded, increment counts
  IF v_granted THEN
    IF v_trial_type = '30_day' THEN
      v_count_30d := v_count_30d + 1;
    END IF;
    IF v_discount_cohort = 'early_14d' THEN
      v_count_early14 := v_count_early14 + 1;
    END IF;
  ELSE
    -- If update failed (race condition), fetch current values
    SELECT 
      trial_type,
      trial_batch,
      discount_cohort,
      (SELECT COUNT(*) FROM public.profiles WHERE trial_type = '30_day'),
      (SELECT COUNT(*) FROM public.profiles WHERE discount_cohort = 'early_14d')
    INTO v_trial_type, v_trial_batch, v_discount_cohort, v_count_30d, v_count_early14
    FROM public.profiles
    WHERE id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_trial_type, v_trial_batch, v_discount_cohort, v_count_30d, v_count_early14;
END;
$$;


--
-- Name: can_user_perform_action(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_user_perform_action(user_uuid uuid, action_type text, action_count integer DEFAULT 1) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  tier TEXT;
  current_usage INTEGER;
  tier_limits JSONB;
BEGIN
  -- Get user's subscription tier
  tier := get_user_subscription_tier(user_uuid);
  
  -- Get current month usage
  SELECT 
    CASE action_type
      WHEN 'contacts' THEN contacts_used
      WHEN 'ai_analyses' THEN ai_analyses_used
      WHEN 'listings' THEN listings_created
      ELSE 0
    END
  INTO current_usage
  FROM subscription_usage
  WHERE user_id = user_uuid
    AND month_year = TO_CHAR(NOW(), 'YYYY-MM');
  
  -- Define tier limits
  tier_limits := CASE tier
    WHEN 'free' THEN '{"contacts": 5, "ai_analyses": 0, "listings": 0}'::JSONB
    WHEN 'pro' THEN '{"contacts": -1, "ai_analyses": 50, "listings": -1}'::JSONB
    WHEN 'enterprise' THEN '{"contacts": -1, "ai_analyses": -1, "listings": -1}'::JSONB
    ELSE '{"contacts": 5, "ai_analyses": 0, "listings": 0}'::JSONB
  END;
  
  -- Check if user can perform action
  IF tier_limits->>action_type = '-1' THEN
    RETURN TRUE; -- Unlimited
  END IF;
  
  RETURN (current_usage + action_count) <= (tier_limits->>action_type)::INTEGER;
END;
$$;


--
-- Name: find_matching_buyers(text, text, integer, integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_matching_buyers(listing_city text, listing_state text, listing_price integer, listing_beds integer, listing_baths integer, listing_sqft integer, listing_type text DEFAULT 'single_family'::text) RETURNS TABLE(buyer_id uuid, buyer_name text, buyer_email text, buyer_phone text, buyer_company text, match_score integer, match_reasons text[])
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.name,
    b.email,
    b.phone,
    b.company,
    -- Calculate match score (0-100)
    (
      CASE WHEN b.city = listing_city AND b.state = listing_state THEN 30 ELSE 0 END +
      CASE WHEN listing_price BETWEEN b.price_range_min AND b.price_range_max THEN 25 ELSE 0 END +
      CASE WHEN listing_beds BETWEEN b.bed_min AND b.bed_max THEN 15 ELSE 0 END +
      CASE WHEN listing_baths BETWEEN b.bath_min AND b.bath_max THEN 10 ELSE 0 END +
      CASE WHEN listing_sqft BETWEEN b.sqft_min AND b.sqft_max THEN 10 ELSE 0 END +
      CASE WHEN listing_type = ANY(b.property_types) THEN 10 ELSE 0 END
    ) as match_score,
    ARRAY[
      CASE WHEN b.city = listing_city AND b.state = listing_state THEN 'Same city/state' END,
      CASE WHEN listing_price BETWEEN b.price_range_min AND b.price_range_max THEN 'Price range match' END,
      CASE WHEN listing_beds BETWEEN b.bed_min AND b.bed_max THEN 'Bedroom count match' END,
      CASE WHEN listing_baths BETWEEN b.bath_min AND b.bath_max THEN 'Bathroom count match' END,
      CASE WHEN listing_sqft BETWEEN b.sqft_min AND b.sqft_max THEN 'Square footage match' END,
      CASE WHEN listing_type = ANY(b.property_types) THEN 'Property type match' END
    ] as match_reasons
  FROM buyers b
  WHERE b.is_active = TRUE
    AND (
      (b.city = listing_city AND b.state = listing_state) OR
      (b.max_distance_miles >= 25) -- National buyers
    )
    AND listing_price BETWEEN b.price_range_min AND b.price_range_max
    AND listing_beds BETWEEN b.bed_min AND b.bed_max
    AND listing_baths BETWEEN b.bath_min AND b.bath_max
    AND listing_sqft BETWEEN b.sqft_min AND b.sqft_max
    AND listing_type = ANY(b.property_types)
  ORDER BY match_score DESC, b.created_at DESC;
END;
$$;


--
-- Name: fn_add_listing_image(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_add_listing_image(p_listing_id uuid, p_url text) RETURNS TABLE(id uuid, listing_id uuid, url text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.listing_images(listing_id, url)
  select l.id, p_url
  from public.listings l
  where l.id = p_listing_id
    and l.owner_id = auth.uid()
  returning id, listing_id, url;
$$;


--
-- Name: get_buyer_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_buyer_stats() RETURNS TABLE(total_buyers bigint, active_buyers bigint, buyers_by_state jsonb, buyers_by_focus jsonb, avg_price_range jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_buyers,
    COUNT(*) FILTER (WHERE is_active = TRUE) as active_buyers,
    jsonb_object_agg(state, state_count) as buyers_by_state,
    jsonb_object_agg(focus, focus_count) as buyers_by_focus,
    jsonb_build_object(
      'min', AVG(price_range_min),
      'max', AVG(price_range_max)
    ) as avg_price_range
  FROM (
    SELECT 
      state,
      COUNT(*) as state_count
    FROM buyers
    WHERE is_active = TRUE
    GROUP BY state
  ) state_stats,
  (
    SELECT 
      unnest(investment_focus) as focus,
      COUNT(*) as focus_count
    FROM buyers
    WHERE is_active = TRUE
    GROUP BY unnest(investment_focus)
  ) focus_stats;
END;
$$;


--
-- Name: get_user_subscription_tier(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_subscription_tier(user_uuid uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  tier TEXT;
BEGIN
  SELECT 
    CASE 
      WHEN s.status = 'active' AND s.stripe_price_id = 'price_pro_monthly' THEN 'pro'
      WHEN s.status = 'active' AND s.stripe_price_id = 'price_enterprise_monthly' THEN 'enterprise'
      ELSE 'free'
    END
  INTO tier
  FROM subscriptions s
  WHERE s.user_id = user_uuid
    AND s.status = 'active'
    AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
  ORDER BY s.created_at DESC
  LIMIT 1;
  
  RETURN COALESCE(tier, 'free');
END;
$$;


--
-- Name: grant_30_day_trial_if_eligible(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grant_30_day_trial_if_eligible(p_user_id uuid) RETURNS TABLE(trial_granted boolean, trial_batch integer, current_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_trial_type TEXT;
  v_current_count INTEGER;
  v_batch INTEGER;
  v_granted BOOLEAN := FALSE;
BEGIN
  -- Set session variable to indicate this is a service operation
  -- This allows the trigger to permit the update
  PERFORM set_config('app.allow_trial_update', 'true', true);
  
  -- Check if user already has a trial
  SELECT trial_type INTO v_trial_type
  FROM public.profiles
  WHERE id = p_user_id;

  -- If user already has a trial, return early
  IF v_trial_type IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM public.profiles
    WHERE trial_type = '30_day';
    
    PERFORM set_config('app.allow_trial_update', 'false', true);
    RETURN QUERY SELECT FALSE, NULL::INTEGER, v_current_count;
    RETURN;
  END IF;

  -- Count existing 30_day trials
  SELECT COUNT(*) INTO v_current_count
  FROM public.profiles
  WHERE trial_type = '30_day';

  -- If we've reached 1000, don't grant
  IF v_current_count >= 1000 THEN
    PERFORM set_config('app.allow_trial_update', 'false', true);
    RETURN QUERY SELECT FALSE, NULL::INTEGER, v_current_count;
    RETURN;
  END IF;

  -- Calculate batch (1-4, each batch is 250 users)
  -- Batch 1: users 0-249, Batch 2: 250-499, Batch 3: 500-749, Batch 4: 750-999
  v_batch := FLOOR(v_current_count / 250) + 1;

  -- Atomically update the user's profile
  -- This UPDATE will only succeed if trial_type is still NULL (race condition protection)
  UPDATE public.profiles
  SET 
    trial_type = '30_day',
    trial_granted_at = NOW(),
    trial_batch = v_batch,
    discount_eligible = FALSE
  WHERE id = p_user_id
    AND trial_type IS NULL
  RETURNING TRUE INTO v_granted;

  -- Clear session variable
  PERFORM set_config('app.allow_trial_update', 'false', true);

  -- If update succeeded, increment count
  IF v_granted THEN
    v_current_count := v_current_count + 1;
  END IF;

  RETURN QUERY SELECT v_granted, v_batch, v_current_count;
END;
$$;


--
-- Name: handle_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;


--
-- Name: increment_listing_view(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_listing_view(listing_uuid uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_view_count INTEGER;
BEGIN
  -- Atomically increment views only for live listings
  UPDATE public.listings 
  SET views = COALESCE(views, 0) + 1,
      updated_at = NOW()
  WHERE id = listing_uuid 
    AND status = 'live'
  RETURNING views INTO new_view_count;
  
  -- Return the new view count (or 0 if listing not found/not live)
  RETURN COALESCE(new_view_count, 0);
END;
$$;


--
-- Name: FUNCTION increment_listing_view(listing_uuid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.increment_listing_view(listing_uuid uuid) IS 'Safely increments the view count for a live listing. Only updates the views column and only for listings with status = ''live''. Returns the new view count.';


--
-- Name: increment_subscription_usage(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_subscription_usage(user_uuid uuid, action_type text, action_count integer DEFAULT 1) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  current_month TEXT;
BEGIN
  current_month := TO_CHAR(NOW(), 'YYYY-MM');
  
  INSERT INTO subscription_usage (user_id, month_year, contacts_used, ai_analyses_used, listings_created)
  VALUES (
    user_uuid,
    current_month,
    CASE WHEN action_type = 'contacts' THEN action_count ELSE 0 END,
    CASE WHEN action_type = 'ai_analyses' THEN action_count ELSE 0 END,
    CASE WHEN action_type = 'listings' THEN action_count ELSE 0 END
  )
  ON CONFLICT (user_id, month_year)
  DO UPDATE SET
    contacts_used = subscription_usage.contacts_used + CASE WHEN action_type = 'contacts' THEN action_count ELSE 0 END,
    ai_analyses_used = subscription_usage.ai_analyses_used + CASE WHEN action_type = 'ai_analyses' THEN action_count ELSE 0 END,
    listings_created = subscription_usage.listings_created + CASE WHEN action_type = 'listings' THEN action_count ELSE 0 END,
    updated_at = NOW();
END;
$$;


--
-- Name: increment_usage(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_usage(p_user_id uuid, p_metric text, p_delta integer DEFAULT 1) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  current_count INTEGER;
  new_count INTEGER;
BEGIN
  -- Get current month start
  INSERT INTO usage_counters (user_id, period_start, metric, count)
  VALUES (p_user_id, DATE_TRUNC('month', NOW())::DATE, p_metric, p_delta)
  ON CONFLICT (user_id, period_start, metric)
  DO UPDATE SET count = usage_counters.count + p_delta;
  
  -- Return new count
  SELECT count INTO new_count
  FROM usage_counters
  WHERE user_id = p_user_id 
    AND period_start = DATE_TRUNC('month', NOW())::DATE 
    AND metric = p_metric;
  
  RETURN new_count;
END;
$$;


--
-- Name: listings_in_bbox(text, double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_in_bbox(q text, minx double precision, miny double precision, maxx double precision, maxy double precision) RETURNS TABLE(id text, title text, price numeric, beds integer, baths numeric, sqft integer, lot_size integer, address text, contact_phone text, contact_email text, lon double precision, lat double precision)
    LANGUAGE sql STABLE
    AS $$
  select
    l.id::text,
    l.title,
    l.price,
    l.beds,
    l.baths,
    l.sqft,
    l.lot_size,
    l.address,
    l.contact_phone,
    l.contact_email,
    ST_X(l.geom) as lon,
    ST_Y(l.geom) as lat
  from public.listings l
  where l.geom is not null
    and (
      coalesce(q, '') = ''
      or l.title   ilike '%'||q||'%'
      or l.address ilike '%'||q||'%'
    )
    and (
      minx is null or miny is null or maxx is null or maxy is null
      or l.geom && ST_MakeEnvelope(minx, miny, maxx, maxy, 4326)
    )
  limit 5000;
$$;


--
-- Name: listings_in_bbox(text, double precision, double precision, double precision, double precision, numeric, numeric, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_in_bbox(q text, minx double precision, miny double precision, maxx double precision, maxy double precision, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, min_beds integer DEFAULT NULL::integer, min_baths numeric DEFAULT NULL::numeric) RETURNS TABLE(id text, title text, price numeric, beds integer, baths integer, sqft integer, lot_size integer, address text, contact_phone text, contact_email text, lon double precision, lat double precision, arv numeric, repairs numeric, image_url text)
    LANGUAGE sql STABLE
    AS $$
  select
    l.id::text, l.title, l.price, l.beds, l.baths, l.sqft, l.lot_size,
    l.address, l.contact_phone, l.contact_email,
    ST_X(l.geom) as lon, ST_Y(l.geom) as lat,
    l.arv, l.repairs, l.image_url
  from public.listings l
  where l.geom is not null
    and (coalesce(q,'') = '' or l.title ilike '%'||q||'%' or l.address ilike '%'||q||'%')
    and (
      minx is null or miny is null or maxx is null or maxy is null
      or l.geom && ST_MakeEnvelope(minx, miny, maxx, maxy, 4326)
    )
    and (min_price is null or l.price >= min_price)
    and (max_price is null or l.price <= max_price)
    and (min_beds  is null or l.beds  >= min_beds)
    and (min_baths is null or l.baths >= min_baths)
  limit 5000;
$$;


--
-- Name: log_user_activity(text, jsonb, inet, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_user_activity(activity_type text, activity_data jsonb DEFAULT NULL::jsonb, ip_address inet DEFAULT NULL::inet, user_agent text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO user_activity_logs (user_id, activity_type, activity_data, ip_address, user_agent)
  VALUES (auth.uid(), activity_type, activity_data, ip_address, user_agent);
END;
$$;


--
-- Name: prevent_trial_field_updates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_trial_field_updates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_allow_update TEXT;
BEGIN
  -- Check if trial fields are being changed
  IF (
    (OLD.trial_type IS DISTINCT FROM NEW.trial_type)
    OR (OLD.trial_granted_at IS DISTINCT FROM NEW.trial_granted_at)
    OR (OLD.trial_batch IS DISTINCT FROM NEW.trial_batch)
    OR (OLD.discount_eligible IS DISTINCT FROM NEW.discount_eligible)
  ) THEN
    -- Check session variable set by RPC function
    v_allow_update := current_setting('app.allow_trial_update', true);
    
    -- If not allowed, revert trial fields to original values
    IF v_allow_update IS DISTINCT FROM 'true' THEN
      NEW.trial_type := OLD.trial_type;
      NEW.trial_granted_at := OLD.trial_granted_at;
      NEW.trial_batch := OLD.trial_batch;
      NEW.discount_eligible := OLD.discount_eligible;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: promote_to_admin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_to_admin(user_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  target_user_id UUID;
BEGIN
  -- Find user by email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Update profile to admin
  UPDATE profiles 
  SET role = 'admin', membership_tier = 'enterprise', verified = true
  WHERE id = target_user_id;
  
  -- Log the promotion
  INSERT INTO user_activity_logs (user_id, activity_type, activity_data)
  VALUES (target_user_id, 'subscription_changed', '{"promoted_to": "admin"}');
  
END;
$$;


--
-- Name: sync_geom_from_latlon(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_geom_from_latlon() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if NEW.latitude is not null and NEW.longitude is not null then
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  else
    NEW.geom := null;
  end if;
  return NEW;
end; $$;


--
-- Name: update_admin_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_admin_metrics() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  today_date DATE := CURRENT_DATE;
  investor_count INTEGER;
  wholesaler_count INTEGER;
  admin_count INTEGER;
  revenue_monthly DECIMAL(12,2);
  listings_today INTEGER;
  featured_today INTEGER;
  ai_analyses_today INTEGER;
  contacts_today INTEGER;
BEGIN
  -- Count active users by role
  SELECT COUNT(*) INTO investor_count
  FROM profiles 
  WHERE role = 'investor' AND last_login >= CURRENT_DATE - INTERVAL '30 days';
  
  SELECT COUNT(*) INTO wholesaler_count
  FROM profiles 
  WHERE role = 'wholesaler' AND last_login >= CURRENT_DATE - INTERVAL '30 days';
  
  SELECT COUNT(*) INTO admin_count
  FROM profiles 
  WHERE role = 'admin' AND last_login >= CURRENT_DATE - INTERVAL '30 days';
  
  -- Calculate monthly revenue (placeholder - integrate with Stripe)
  SELECT COALESCE(SUM(price_monthly), 0) INTO revenue_monthly
  FROM subscription_plans sp
  JOIN subscriptions s ON s.stripe_price_id = sp.stripe_price_id_monthly
  WHERE s.status = 'active';
  
  -- Count today's activity
  SELECT COUNT(*) INTO listings_today
  FROM listings 
  WHERE created_at >= CURRENT_DATE;
  
  SELECT COUNT(*) INTO featured_today
  FROM listings 
  WHERE featured = true AND created_at >= CURRENT_DATE;
  
  SELECT COUNT(*) INTO ai_analyses_today
  FROM ai_analysis_logs 
  WHERE created_at >= CURRENT_DATE;
  
  SELECT COUNT(*) INTO contacts_today
  FROM contact_logs 
  WHERE created_at >= CURRENT_DATE;
  
  -- Insert or update metrics for today
  INSERT INTO admin_metrics (
    date, active_users_investor, active_users_wholesaler, active_users_admin,
    revenue_monthly, listings_posted, listings_featured, ai_analyses_run, contacts_made
  ) VALUES (
    today_date, investor_count, wholesaler_count, admin_count,
    revenue_monthly, listings_today, featured_today, ai_analyses_today, contacts_today
  )
  ON CONFLICT (date) DO UPDATE SET
    active_users_investor = EXCLUDED.active_users_investor,
    active_users_wholesaler = EXCLUDED.active_users_wholesaler,
    active_users_admin = EXCLUDED.active_users_admin,
    revenue_monthly = EXCLUDED.revenue_monthly,
    listings_posted = EXCLUDED.listings_posted,
    listings_featured = EXCLUDED.listings_featured,
    ai_analyses_run = EXCLUDED.ai_analyses_run,
    contacts_made = EXCLUDED.contacts_made;
END;
$$;


--
-- Name: update_closed_deals_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_closed_deals_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_flags_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_flags_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;


--
-- Name: update_listing_geom(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_listing_geom() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  ELSE
    NEW.geom = NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_listing_geom(uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_listing_geom(listing_id uuid, lng numeric, lat numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE listings
  SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
  WHERE id = listing_id
    AND lng IS NOT NULL
    AND lat IS NOT NULL;
END;
$$;


--
-- Name: update_subscription_usage(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_subscription_usage(action_type text, action_count integer DEFAULT 1) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  current_month_year TEXT := TO_CHAR(NOW(), 'YYYY-MM');
BEGIN
  -- Insert or update usage for current month
  INSERT INTO subscription_usage (user_id, subscription_id, month_year, contacts_used, ai_analyses_used, listings_created)
  SELECT 
    s.user_id,
    s.id,
    current_month_year,
    CASE WHEN action_type = 'contacts' THEN action_count ELSE 0 END,
    CASE WHEN action_type = 'ai_analyses' THEN action_count ELSE 0 END,
    CASE WHEN action_type = 'listings' THEN action_count ELSE 0 END
  FROM subscriptions s
  WHERE s.user_id = auth.uid() AND s.status = 'active'
  ON CONFLICT (user_id, month_year) DO UPDATE SET
    contacts_used = subscription_usage.contacts_used + CASE WHEN action_type = 'contacts' THEN action_count ELSE 0 END,
    ai_analyses_used = subscription_usage.ai_analyses_used + CASE WHEN action_type = 'ai_analyses' THEN action_count ELSE 0 END,
    listings_created = subscription_usage.listings_created + CASE WHEN action_type = 'listings' THEN action_count ELSE 0 END,
    updated_at = NOW();
END;
$$;


--
-- Name: update_user_alerts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_alerts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metric_name text NOT NULL,
    metric_value jsonb NOT NULL,
    date_recorded timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: admin_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    active_users_investor integer DEFAULT 0,
    active_users_wholesaler integer DEFAULT 0,
    active_users_admin integer DEFAULT 0,
    revenue_monthly numeric(12,2) DEFAULT 0.00,
    revenue_yearly numeric(12,2) DEFAULT 0.00,
    listings_posted integer DEFAULT 0,
    listings_featured integer DEFAULT 0,
    ai_analyses_run integer DEFAULT 0,
    contacts_made integer DEFAULT 0,
    google_maps_api_calls integer DEFAULT 0,
    storage_used_mb integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_analysis_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    listing_id uuid,
    analysis_type text NOT NULL,
    input_data jsonb,
    output_data jsonb,
    cost_cents integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ai_analysis_logs_analysis_type_check CHECK ((analysis_type = ANY (ARRAY['arv'::text, 'repairs'::text, 'mao'::text, 'comps'::text])))
);


--
-- Name: ai_analysis_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tool text DEFAULT 'deal_analyzer'::text NOT NULL,
    property_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_summary jsonb
);


--
-- Name: TABLE ai_analysis_usage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_analysis_usage IS 'Tracks monthly AI analysis usage per user for subscription tier enforcement';


--
-- Name: COLUMN ai_analysis_usage.tool; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_analysis_usage.tool IS 'Tool identifier (e.g., deal_analyzer, repair_estimator)';


--
-- Name: COLUMN ai_analysis_usage.property_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_analysis_usage.property_id IS 'Optional reference to the listing/property analyzed';


--
-- Name: ai_plan_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_plan_limits (
    plan text NOT NULL,
    monthly_requests integer NOT NULL
);


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    user_id uuid NOT NULL,
    month_start date NOT NULL,
    requests integer DEFAULT 0 NOT NULL
);


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    type text NOT NULL,
    criteria jsonb NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT alerts_type_check CHECK ((type = ANY (ARRAY['price'::text, 'location'::text, 'property_type'::text, 'custom'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    resource_type text,
    resource_id uuid,
    details jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: buyers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    company text,
    city text,
    state text,
    zip text,
    investment_focus text[],
    price_range_min integer,
    price_range_max integer,
    property_types text[],
    bed_min integer,
    bed_max integer,
    bath_min integer,
    bath_max integer,
    sqft_min integer,
    sqft_max integer,
    max_distance_miles integer DEFAULT 25,
    investment_criteria jsonb,
    tags text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: closed_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.closed_deals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    listing_id uuid NOT NULL,
    wholesaler_id uuid NOT NULL,
    sold_to_name text NOT NULL,
    sold_price numeric,
    wholesale_fee numeric,
    closed_at timestamp with time zone DEFAULT now(),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sold_to_profile_id uuid
);


--
-- Name: TABLE closed_deals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.closed_deals IS 'Tracks when wholesalers mark their listings as sold for internal analytics';


--
-- Name: COLUMN closed_deals.listing_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.listing_id IS 'Foreign key to the listing that was sold';


--
-- Name: COLUMN closed_deals.wholesaler_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.wholesaler_id IS 'Foreign key to the wholesaler who owns the listing';


--
-- Name: COLUMN closed_deals.sold_to_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.sold_to_name IS 'Name or company the listing was sold to (required)';


--
-- Name: COLUMN closed_deals.sold_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.sold_price IS 'Final sale price (optional)';


--
-- Name: COLUMN closed_deals.wholesale_fee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.wholesale_fee IS 'Wholesale fee earned (optional)';


--
-- Name: COLUMN closed_deals.closed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.closed_at IS 'Date/time the deal closed (defaults to now)';


--
-- Name: COLUMN closed_deals.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.notes IS 'Additional notes about the sale (optional)';


--
-- Name: COLUMN closed_deals.sold_to_profile_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.closed_deals.sold_to_profile_id IS 'Optional reference to the investor profile who purchased the listing';


--
-- Name: contact_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    listing_id uuid,
    contact_type text NOT NULL,
    contact_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contact_logs_contact_type_check CHECK ((contact_type = ANY (ARRAY['call'::text, 'email'::text, 'text'::text])))
);


--
-- Name: crm_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_exports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    org_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    rows integer DEFAULT 0,
    format text NOT NULL,
    CONSTRAINT crm_exports_format_check CHECK ((format = ANY (ARRAY['csv'::text, 'json'::text, 'pdf'::text])))
);


--
-- Name: flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flags (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT flags_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT flags_target_type_check CHECK ((target_type = ANY (ARRAY['listing'::text, 'user'::text, 'message'::text, 'profile'::text])))
);


--
-- Name: listing_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    url text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    address text NOT NULL,
    city text,
    state text,
    zip text,
    price numeric(12,2) NOT NULL,
    arv numeric(12,2),
    repairs numeric(12,2),
    image_url text,
    contact_name text,
    contact_email text,
    contact_phone text,
    status text DEFAULT 'live'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    owner_id uuid,
    garage_spaces smallint,
    lot_sqft integer,
    description text,
    title text,
    beds integer,
    baths numeric,
    sqft integer,
    latitude double precision,
    longitude double precision,
    geom public.geometry(Point,4326),
    images text[],
    year_built integer,
    cover_image_url text,
    featured boolean DEFAULT false,
    featured_until timestamp with time zone,
    verified boolean DEFAULT false,
    views integer DEFAULT 0,
    property_type text,
    age_restricted boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    country text DEFAULT 'US'::text NOT NULL,
    seller_acknowledged_at timestamp with time zone,
    CONSTRAINT listings_currency_check CHECK ((currency = ANY (ARRAY['USD'::text, 'CAD'::text, 'GBP'::text, 'AUD'::text]))),
    CONSTRAINT listings_status_check CHECK ((status = ANY (ARRAY['live'::text, 'archived'::text, 'sold'::text])))
);


--
-- Name: COLUMN listings.country; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listings.country IS 'Country code or name for the listing location';


--
-- Name: COLUMN listings.seller_acknowledged_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listings.seller_acknowledged_at IS 'Timestamp when seller acknowledged listing accuracy and that Off Axis Deals does not verify listings';


--
-- Name: market_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_snapshots (
    "RegionID" text NOT NULL,
    "SizeRank" text,
    "RegionName" text,
    "RegionType" text,
    "StateName" text,
    zhvi_mid_all double precision,
    snapshot_date_zhvi_mid_all text,
    zhvi_mid_all_raw double precision,
    snapshot_date_zhvi_mid_all_raw text,
    zhvi_mid_sfr double precision,
    snapshot_date_zhvi_mid_sfr text,
    zhvi_mid_condo double precision,
    snapshot_date_zhvi_mid_condo text,
    zhvi_bottom_all double precision,
    snapshot_date_zhvi_bottom_all text,
    zhvi_top_all double precision,
    snapshot_date_zhvi_top_all text,
    zhvi_mid_1br double precision,
    snapshot_date_zhvi_mid_1br text,
    zhvi_mid_2br double precision,
    snapshot_date_zhvi_mid_2br text,
    zhvi_mid_3br double precision,
    snapshot_date_zhvi_mid_3br text,
    zhvi_mid_4br double precision,
    snapshot_date_zhvi_mid_4br text,
    zhvi_mid_5br double precision,
    snapshot_date_zhvi_mid_5br text,
    zori_rent_index double precision,
    snapshot_date_zori_rent_index text,
    inventory_for_sale numeric,
    snapshot_date_inventory_for_sale text,
    new_listings numeric,
    snapshot_date_new_listings text,
    new_pending numeric,
    snapshot_date_new_pending text,
    sales_count text,
    snapshot_date_sales_count text,
    new_construction_sales_count text,
    snapshot_date_new_construction_sales_count text,
    median_sale_price_now numeric,
    snapshot_date_median_sale_price_now text,
    median_sale_to_list double precision,
    snapshot_date_median_sale_to_list text,
    pct_sold_above_list double precision,
    snapshot_date_pct_sold_above_list text,
    pct_listings_price_cut double precision,
    snapshot_date_pct_listings_price_cut text,
    median_days_to_close numeric,
    snapshot_date_median_days_to_close text,
    market_temp_index numeric,
    snapshot_date_market_temp_index text,
    income_needed_to_buy_20pct_mid double precision,
    snapshot_date_income_needed_to_buy_20pct_mid text,
    income_needed_to_rent_mid double precision,
    snapshot_date_income_needed_to_rent_mid text,
    zhvf_base_date text,
    zhvf_growth_1m text,
    zhvf_growth_3m double precision,
    zhvf_growth_12m double precision
);


--
-- Name: market_snapshots_scored; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.market_snapshots_scored AS
 WITH base AS (
         SELECT market_snapshots."RegionID" AS region_id,
            market_snapshots."SizeRank" AS size_rank,
            market_snapshots."RegionName" AS region_name,
            market_snapshots."RegionType" AS region_type,
            market_snapshots."StateName" AS state_name,
            market_snapshots.zhvi_mid_sfr,
            market_snapshots.zori_rent_index,
            market_snapshots.inventory_for_sale,
            market_snapshots.new_listings,
            market_snapshots.new_pending,
            market_snapshots.sales_count,
            market_snapshots.median_sale_price_now,
            market_snapshots.median_sale_to_list,
            market_snapshots.pct_sold_above_list,
            market_snapshots.pct_listings_price_cut,
            market_snapshots.median_days_to_close,
            market_snapshots.market_temp_index,
            market_snapshots.income_needed_to_buy_20pct_mid,
            market_snapshots.income_needed_to_rent_mid,
            market_snapshots.zhvf_growth_1m,
            market_snapshots.zhvf_growth_3m,
            market_snapshots.zhvf_growth_12m
           FROM public.market_snapshots
          WHERE (market_snapshots."RegionType" = ANY (ARRAY['msa'::text, 'country'::text]))
        ), base_with_yield AS (
         SELECT base.region_id,
            base.size_rank,
            base.region_name,
            base.region_type,
            base.state_name,
            base.zhvi_mid_sfr,
            base.zori_rent_index,
            base.inventory_for_sale,
            base.new_listings,
            base.new_pending,
            base.sales_count,
            base.median_sale_price_now,
            base.median_sale_to_list,
            base.pct_sold_above_list,
            base.pct_listings_price_cut,
            base.median_days_to_close,
            base.market_temp_index,
            base.income_needed_to_buy_20pct_mid,
            base.income_needed_to_rent_mid,
            base.zhvf_growth_1m,
            base.zhvf_growth_3m,
            base.zhvf_growth_12m,
                CASE
                    WHEN ((base.zhvi_mid_sfr IS NULL) OR (base.zhvi_mid_sfr = (0)::double precision)) THEN NULL::double precision
                    ELSE (base.zori_rent_index / base.zhvi_mid_sfr)
                END AS rental_yield
           FROM base
        ), pcts AS (
         SELECT base_with_yield.region_id,
            percent_rank() OVER (ORDER BY base_with_yield.zhvf_growth_12m) AS growth_pct,
            percent_rank() OVER (ORDER BY base_with_yield.pct_sold_above_list) AS pct_sold_above_list_pct,
            percent_rank() OVER (ORDER BY base_with_yield.median_sale_to_list) AS median_sale_to_list_pct,
            percent_rank() OVER (ORDER BY base_with_yield.market_temp_index) AS market_temp_index_pct,
            percent_rank() OVER (ORDER BY base_with_yield.pct_listings_price_cut) AS price_cuts_pct,
            percent_rank() OVER (ORDER BY base_with_yield.sales_count) AS sales_count_pct,
            percent_rank() OVER (ORDER BY base_with_yield.median_days_to_close) AS median_days_to_close_pct,
            percent_rank() OVER (ORDER BY base_with_yield.zhvi_mid_sfr) AS zhvi_mid_sfr_pct,
            percent_rank() OVER (ORDER BY base_with_yield.income_needed_to_buy_20pct_mid) AS income_to_buy_pct,
            percent_rank() OVER (ORDER BY base_with_yield.income_needed_to_rent_mid) AS income_to_rent_pct,
            percent_rank() OVER (ORDER BY base_with_yield.rental_yield) AS rental_yield_pct
           FROM base_with_yield
        ), joined AS (
         SELECT b.region_id,
            b.size_rank,
            b.region_name,
            b.region_type,
            b.state_name,
            b.zhvi_mid_sfr,
            b.zori_rent_index,
            b.inventory_for_sale,
            b.new_listings,
            b.new_pending,
            b.sales_count,
            b.median_sale_price_now,
            b.median_sale_to_list,
            b.pct_sold_above_list,
            b.pct_listings_price_cut,
            b.median_days_to_close,
            b.market_temp_index,
            b.income_needed_to_buy_20pct_mid,
            b.income_needed_to_rent_mid,
            b.zhvf_growth_1m,
            b.zhvf_growth_3m,
            b.zhvf_growth_12m,
            b.rental_yield,
            COALESCE(p.growth_pct, (0.5)::double precision) AS growth_pct,
            COALESCE(p.pct_sold_above_list_pct, (0.5)::double precision) AS pct_sold_above_list_pct,
            COALESCE(p.median_sale_to_list_pct, (0.5)::double precision) AS median_sale_to_list_pct,
            COALESCE(p.market_temp_index_pct, (0.5)::double precision) AS market_temp_index_pct,
            COALESCE(p.price_cuts_pct, (0.5)::double precision) AS price_cuts_pct,
            COALESCE(p.sales_count_pct, (0.5)::double precision) AS sales_count_pct,
            COALESCE(p.median_days_to_close_pct, (0.5)::double precision) AS median_days_to_close_pct,
            COALESCE(p.zhvi_mid_sfr_pct, (0.5)::double precision) AS zhvi_mid_sfr_pct,
            COALESCE(p.income_to_buy_pct, (0.5)::double precision) AS income_to_buy_pct,
            COALESCE(p.income_to_rent_pct, (0.5)::double precision) AS income_to_rent_pct,
            COALESCE(p.rental_yield_pct, (0.5)::double precision) AS rental_yield_pct
           FROM (base_with_yield b
             LEFT JOIN pcts p USING (region_id))
        ), scores AS (
         SELECT joined.region_id,
            joined.size_rank,
            joined.region_name,
            joined.region_type,
            joined.state_name,
            joined.zhvi_mid_sfr,
            joined.zori_rent_index,
            joined.inventory_for_sale,
            joined.new_listings,
            joined.new_pending,
            joined.sales_count,
            joined.median_sale_price_now,
            joined.median_sale_to_list,
            joined.pct_sold_above_list,
            joined.pct_listings_price_cut,
            joined.median_days_to_close,
            joined.market_temp_index,
            joined.income_needed_to_buy_20pct_mid,
            joined.income_needed_to_rent_mid,
            joined.zhvf_growth_1m,
            joined.zhvf_growth_3m,
            joined.zhvf_growth_12m,
            joined.rental_yield,
            joined.growth_pct,
            joined.pct_sold_above_list_pct,
            joined.median_sale_to_list_pct,
            joined.market_temp_index_pct,
            joined.price_cuts_pct,
            joined.sales_count_pct,
            joined.median_days_to_close_pct,
            joined.zhvi_mid_sfr_pct,
            joined.income_to_buy_pct,
            joined.income_to_rent_pct,
            joined.rental_yield_pct,
            ((((joined.pct_sold_above_list_pct + joined.median_sale_to_list_pct) + joined.market_temp_index_pct) + ((1)::double precision - joined.price_cuts_pct)) / (4.0)::double precision) AS competition_pct,
            ((joined.sales_count_pct + ((1)::double precision - joined.median_days_to_close_pct)) / (2.0)::double precision) AS liquidity_pct,
            (((((1)::double precision - joined.zhvi_mid_sfr_pct) + ((1)::double precision - joined.income_to_buy_pct)) + ((1)::double precision - joined.income_to_rent_pct)) / (3.0)::double precision) AS affordability_pct
           FROM joined
        )
 SELECT region_id,
    size_rank,
    region_name,
    region_type,
    state_name,
    zhvi_mid_sfr,
    zori_rent_index,
    inventory_for_sale,
    new_listings,
    new_pending,
    sales_count,
    median_sale_price_now,
    median_sale_to_list,
    pct_sold_above_list,
    pct_listings_price_cut,
    median_days_to_close,
    market_temp_index,
    income_needed_to_buy_20pct_mid,
    income_needed_to_rent_mid,
    zhvf_growth_1m,
    zhvf_growth_3m,
    zhvf_growth_12m,
    growth_pct,
    competition_pct,
    liquidity_pct,
    affordability_pct,
    rental_yield_pct,
    (round(((100)::double precision * growth_pct)))::integer AS growth_score,
    (round(((100)::double precision * competition_pct)))::integer AS competition_score,
    (round(((100)::double precision * liquidity_pct)))::integer AS liquidity_score,
    (round(((100)::double precision * affordability_pct)))::integer AS affordability_score,
    (round(((100)::double precision * rental_yield_pct)))::integer AS rental_yield_score,
    (round(((100)::double precision * (((((0.4)::double precision * growth_pct) + ((0.25)::double precision * competition_pct)) + ((0.20)::double precision * liquidity_pct)) + ((0.15)::double precision * rental_yield_pct)))))::integer AS market_strength_score,
    (round(((100)::double precision * ((((0.5)::double precision * liquidity_pct) + ((0.3)::double precision * competition_pct)) + ((0.2)::double precision * growth_pct)))))::integer AS flip_score,
    (round(((100)::double precision * ((((0.45)::double precision * rental_yield_pct) + ((0.35)::double precision * affordability_pct)) + ((0.2)::double precision * growth_pct)))))::integer AS rental_score
   FROM scores s;


--
-- Name: market_trends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_trends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    region text NOT NULL,
    period_end date NOT NULL,
    median_sale_price numeric NOT NULL,
    homes_sold integer,
    median_days_on_market integer,
    avg_sale_to_list numeric,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    thread_id uuid NOT NULL,
    from_id uuid,
    to_id uuid,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    listing_id uuid
);


--
-- Name: moderation_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_actions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    moderator_id uuid NOT NULL,
    action_type text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason text,
    notes text,
    duration_days integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT moderation_actions_action_type_check CHECK ((action_type = ANY (ARRAY['suspend'::text, 'ban'::text, 'verify'::text, 'unverify'::text, 'delete_listing'::text, 'hide_listing'::text, 'warn'::text]))),
    CONSTRAINT moderation_actions_target_type_check CHECK ((target_type = ANY (ARRAY['user'::text, 'listing'::text, 'message'::text])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    buyer_interest boolean DEFAULT true NOT NULL,
    lead_message boolean DEFAULT true NOT NULL,
    listing_performance boolean DEFAULT true NOT NULL,
    repair_estimate_ready boolean DEFAULT true NOT NULL,
    property_verification boolean DEFAULT true NOT NULL,
    market_trend boolean DEFAULT true NOT NULL,
    subscription_renewal boolean DEFAULT true NOT NULL,
    feedback_rating boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    listing_id uuid,
    metadata jsonb,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    ref_id text,
    read_at timestamp with time zone,
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['buyer_interest'::text, 'lead_message'::text, 'listing_performance'::text, 'repair_estimate_ready'::text, 'property_verification'::text, 'market_trend'::text, 'subscription_renewal'::text, 'feedback_rating'::text, 'new_listing_alert'::text])))
);


--
-- Name: org_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_members (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT org_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


--
-- Name: orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orgs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    owner_id uuid,
    plan text DEFAULT 'basic'::text,
    seats integer DEFAULT 1,
    branding jsonb DEFAULT '{}'::jsonb,
    custom_domain text,
    support_level text DEFAULT 'standard'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT orgs_plan_check CHECK ((plan = ANY (ARRAY['basic'::text, 'pro'::text, 'enterprise'::text]))),
    CONSTRAINT orgs_support_level_check CHECK ((support_level = ANY (ARRAY['standard'::text, 'priority'::text, 'dedicated'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    company text,
    phone text,
    role text DEFAULT 'user'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    type text,
    company_name text,
    city text,
    state text,
    investment_preferences text,
    budget_range text,
    bio text,
    experience_years integer,
    specialties text,
    subscription_tier text DEFAULT 'free'::text,
    subscription_status text DEFAULT 'active'::text,
    membership_tier text DEFAULT 'free'::text,
    joined_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone DEFAULT now(),
    listings_count integer DEFAULT 0,
    ai_uses integer DEFAULT 0,
    credits_used integer DEFAULT 0,
    verified boolean DEFAULT false,
    region text,
    total_listings integer DEFAULT 0,
    avg_listing_views integer DEFAULT 0,
    avg_time_to_offer integer DEFAULT 0,
    conversion_rate numeric(5,2) DEFAULT 0.00,
    lead_count integer DEFAULT 0,
    rating numeric(3,2) DEFAULT 0.00,
    offers_made integer DEFAULT 0,
    avg_offer_value numeric(12,2) DEFAULT 0.00,
    saved_properties integer DEFAULT 0,
    contacted_wholesalers integer DEFAULT 0,
    ai_reports_used integer DEFAULT 0,
    segment text,
    tier text DEFAULT 'free'::text,
    stripe_customer_id text,
    active_price_id text,
    current_period_end timestamp with time zone,
    profile_photo_url text,
    phone_verified boolean DEFAULT false NOT NULL,
    is_pro_subscriber boolean DEFAULT false NOT NULL,
    license_info text,
    buy_markets text[] DEFAULT '{}'::text[],
    buy_property_types text[] DEFAULT '{}'::text[],
    buy_price_min numeric,
    buy_price_max numeric,
    buy_strategy text,
    buy_condition text,
    capital_available numeric,
    wholesale_markets text[] DEFAULT '{}'::text[],
    deal_arbands text[] DEFAULT '{}'::text[],
    deal_discount_target numeric,
    assignment_methods text[] DEFAULT '{}'::text[],
    avg_days_to_buyer integer,
    suspended boolean DEFAULT false,
    suspended_until timestamp with time zone,
    suspended_reason text,
    banned boolean DEFAULT false,
    banned_at timestamp with time zone,
    banned_reason text,
    verified_by_admin boolean DEFAULT false,
    verified_at timestamp with time zone,
    verified_by_user_id uuid,
    profile_complete boolean DEFAULT false NOT NULL,
    profile_strength integer DEFAULT 0 NOT NULL,
    trial_type text,
    trial_granted_at timestamp with time zone,
    trial_batch integer,
    discount_eligible boolean DEFAULT true NOT NULL,
    trial_consumed_at timestamp with time zone,
    annual_discount_redeemed_at timestamp with time zone,
    annual_discount_expires_at timestamp with time zone,
    discount_cohort text,
    CONSTRAINT profiles_discount_cohort_check CHECK (((discount_cohort IS NULL) OR (discount_cohort = ANY (ARRAY['early_30d'::text, 'early_14d'::text, 'none'::text])))),
    CONSTRAINT profiles_membership_tier_check CHECK ((membership_tier = ANY (ARRAY['free'::text, 'basic'::text, 'pro'::text, 'enterprise'::text]))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['wholesaler'::text, 'investor'::text, 'admin'::text]))),
    CONSTRAINT profiles_segment_check CHECK (((segment IS NULL) OR (segment = ANY (ARRAY['wholesaler'::text, 'investor'::text])))),
    CONSTRAINT profiles_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'basic'::text, 'pro'::text, 'enterprise'::text]))),
    CONSTRAINT profiles_trial_type_check CHECK (((trial_type IS NULL) OR (trial_type = ANY (ARRAY['30_day'::text, '14_day'::text]))))
);


--
-- Name: saved_search_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_search_matches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    saved_search_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    investor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivery_status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT saved_search_matches_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'notified'::text])))
);


--
-- Name: saved_searches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_searches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
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
    last_notified_at timestamp with time zone
);


--
-- Name: COLUMN saved_searches.center_lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.center_lat IS 'Latitude of the search center point for radius-based matching';


--
-- Name: COLUMN saved_searches.center_lng; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.center_lng IS 'Longitude of the search center point for radius-based matching';


--
-- Name: COLUMN saved_searches.radius_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.radius_km IS 'Radius in kilometers for location-based alerts. NULL means fallback to city/state matching.';


--
-- Name: COLUMN saved_searches.radius_miles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.radius_miles IS 'Radius in miles for location-based matching. Default is 10 miles.';


--
-- Name: COLUMN saved_searches.min_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.min_price IS 'Minimum price filter (nullable)';


--
-- Name: COLUMN saved_searches.max_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.max_price IS 'Maximum price filter (nullable)';


--
-- Name: COLUMN saved_searches.min_beds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.min_beds IS 'Minimum bedrooms filter (nullable)';


--
-- Name: COLUMN saved_searches.max_beds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.max_beds IS 'Maximum bedrooms filter (nullable)';


--
-- Name: COLUMN saved_searches.min_baths; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.min_baths IS 'Minimum bathrooms filter (nullable)';


--
-- Name: COLUMN saved_searches.max_baths; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.max_baths IS 'Maximum bathrooms filter (nullable)';


--
-- Name: COLUMN saved_searches.property_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.property_types IS 'Array of property types to match (nullable)';


--
-- Name: COLUMN saved_searches.last_notified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.saved_searches.last_notified_at IS 'Timestamp of last notification sent for this search';


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id text NOT NULL,
    name text NOT NULL,
    price_monthly integer NOT NULL,
    price_yearly integer NOT NULL,
    stripe_price_id_monthly text,
    stripe_price_id_yearly text,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    limitations jsonb DEFAULT '[]'::jsonb NOT NULL,
    max_listings_per_month integer DEFAULT 0 NOT NULL,
    max_active_listings integer DEFAULT 0 NOT NULL,
    has_contact_access boolean DEFAULT false,
    has_ai_tools boolean DEFAULT false,
    ai_analysis_limit integer DEFAULT 0,
    has_analytics boolean DEFAULT false,
    has_chat boolean DEFAULT false,
    featured boolean DEFAULT false,
    has_team boolean DEFAULT false,
    has_branding boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscription_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    subscription_id uuid,
    month_year text NOT NULL,
    contacts_used integer DEFAULT 0,
    ai_analyses_used integer DEFAULT 0,
    listings_created integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_price_id text,
    status text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'canceled'::text, 'incomplete'::text, 'incomplete_expired'::text, 'past_due'::text, 'trialing'::text, 'unpaid'::text])))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_email text,
    subject text NOT NULL,
    description text,
    status text DEFAULT 'open'::text,
    priority text DEFAULT 'medium'::text,
    category text DEFAULT 'general'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT support_tickets_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT support_tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    setting_key text NOT NULL,
    setting_value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_counters (
    user_id uuid NOT NULL,
    period_start date NOT NULL,
    metric text NOT NULL,
    count integer DEFAULT 0
);


--
-- Name: user_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    activity_type text NOT NULL,
    activity_data jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_activity_logs_activity_type_check CHECK ((activity_type = ANY (ARRAY['login'::text, 'logout'::text, 'listing_created'::text, 'listing_updated'::text, 'listing_deleted'::text, 'contact_made'::text, 'ai_analysis'::text, 'subscription_changed'::text, 'payment_made'::text])))
);


--
-- Name: user_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    alert_type text NOT NULL,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_alerts_role_check CHECK ((role = ANY (ARRAY['investor'::text, 'wholesaler'::text])))
);


--
-- Name: user_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_email text,
    title text NOT NULL,
    description text,
    type text DEFAULT 'general'::text,
    status text DEFAULT 'new'::text,
    priority text DEFAULT 'medium'::text,
    votes integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'under_review'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text]))),
    CONSTRAINT user_feedback_type_check CHECK ((type = ANY (ARRAY['bug'::text, 'feature_request'::text, 'improvement'::text, 'general'::text])))
);


--
-- Name: user_watchlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_watchlists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    description text,
    watchlist_type text DEFAULT 'property'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: watchlist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    watchlist_id uuid,
    listing_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: watchlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlists (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    property_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: admin_analytics admin_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_analytics
    ADD CONSTRAINT admin_analytics_pkey PRIMARY KEY (id);


--
-- Name: admin_metrics admin_metrics_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_metrics
    ADD CONSTRAINT admin_metrics_date_key UNIQUE (date);


--
-- Name: admin_metrics admin_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_metrics
    ADD CONSTRAINT admin_metrics_pkey PRIMARY KEY (id);


--
-- Name: ai_analysis_logs ai_analysis_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_logs
    ADD CONSTRAINT ai_analysis_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_analysis_usage ai_analysis_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_usage
    ADD CONSTRAINT ai_analysis_usage_pkey PRIMARY KEY (id);


--
-- Name: ai_plan_limits ai_plan_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_plan_limits
    ADD CONSTRAINT ai_plan_limits_pkey PRIMARY KEY (plan);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (user_id, month_start);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: buyers buyers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_email_key UNIQUE (email);


--
-- Name: buyers buyers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_pkey PRIMARY KEY (id);


--
-- Name: closed_deals closed_deals_listing_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closed_deals
    ADD CONSTRAINT closed_deals_listing_id_unique UNIQUE (listing_id);


--
-- Name: closed_deals closed_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closed_deals
    ADD CONSTRAINT closed_deals_pkey PRIMARY KEY (id);


--
-- Name: contact_logs contact_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_logs
    ADD CONSTRAINT contact_logs_pkey PRIMARY KEY (id);


--
-- Name: crm_exports crm_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_exports
    ADD CONSTRAINT crm_exports_pkey PRIMARY KEY (id);


--
-- Name: flags flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flags
    ADD CONSTRAINT flags_pkey PRIMARY KEY (id);


--
-- Name: listing_images listing_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT listing_images_pkey PRIMARY KEY (id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: market_snapshots market_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_snapshots
    ADD CONSTRAINT market_snapshots_pkey PRIMARY KEY ("RegionID");


--
-- Name: market_trends market_trends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trends
    ADD CONSTRAINT market_trends_pkey PRIMARY KEY (id);


--
-- Name: market_trends market_trends_region_period_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_trends
    ADD CONSTRAINT market_trends_region_period_unique UNIQUE (region, period_end);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: moderation_actions moderation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_unique UNIQUE (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: org_members org_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_pkey PRIMARY KEY (org_id, user_id);


--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);


--
-- Name: orgs orgs_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: saved_search_matches saved_search_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_search_matches
    ADD CONSTRAINT saved_search_matches_pkey PRIMARY KEY (id);


--
-- Name: saved_searches saved_searches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_searches
    ADD CONSTRAINT saved_searches_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscription_usage subscription_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_usage
    ADD CONSTRAINT subscription_usage_pkey PRIMARY KEY (id);


--
-- Name: subscription_usage subscription_usage_user_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_usage
    ADD CONSTRAINT subscription_usage_user_id_month_year_key UNIQUE (user_id, month_year);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: subscriptions subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: usage_counters usage_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_counters
    ADD CONSTRAINT usage_counters_pkey PRIMARY KEY (user_id, period_start, metric);


--
-- Name: user_activity_logs user_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_logs
    ADD CONSTRAINT user_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: user_alerts user_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_pkey PRIMARY KEY (id);


--
-- Name: user_alerts user_alerts_user_id_role_alert_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_user_id_role_alert_type_key UNIQUE (user_id, role, alert_type);


--
-- Name: user_feedback user_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_pkey PRIMARY KEY (id);


--
-- Name: user_watchlists user_watchlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_watchlists
    ADD CONSTRAINT user_watchlists_pkey PRIMARY KEY (id);


--
-- Name: watchlist_items watchlist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items
    ADD CONSTRAINT watchlist_items_pkey PRIMARY KEY (id);


--
-- Name: watchlist_items watchlist_items_watchlist_id_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items
    ADD CONSTRAINT watchlist_items_watchlist_id_listing_id_key UNIQUE (watchlist_id, listing_id);


--
-- Name: watchlists watchlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_pkey PRIMARY KEY (id);


--
-- Name: watchlists watchlists_user_id_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_user_id_property_id_key UNIQUE (user_id, property_id);


--
-- Name: ai_analysis_logs_listing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_analysis_logs_listing_id_idx ON public.ai_analysis_logs USING btree (listing_id);


--
-- Name: ai_analysis_logs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_analysis_logs_user_id_idx ON public.ai_analysis_logs USING btree (user_id);


--
-- Name: buyers_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyers_active_idx ON public.buyers USING btree (is_active);


--
-- Name: buyers_city_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyers_city_state_idx ON public.buyers USING btree (city, state);


--
-- Name: buyers_price_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyers_price_range_idx ON public.buyers USING btree (price_range_min, price_range_max);


--
-- Name: buyers_property_types_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyers_property_types_idx ON public.buyers USING gin (property_types);


--
-- Name: buyers_tags_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyers_tags_idx ON public.buyers USING gin (tags);


--
-- Name: contact_logs_listing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_logs_listing_id_idx ON public.contact_logs USING btree (listing_id);


--
-- Name: contact_logs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_logs_user_id_idx ON public.contact_logs USING btree (user_id);


--
-- Name: idx_admin_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_metrics_date ON public.admin_metrics USING btree (date);


--
-- Name: idx_ai_analysis_usage_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_analysis_usage_user_created ON public.ai_analysis_usage USING btree (user_id, created_at DESC);


--
-- Name: idx_ai_analysis_usage_user_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_analysis_usage_user_tool ON public.ai_analysis_usage USING btree (user_id, tool, created_at DESC);


--
-- Name: idx_alerts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_user_id ON public.alerts USING btree (user_id);


--
-- Name: idx_audit_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_resource ON public.audit_logs USING btree (resource_type, resource_id);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_closed_deals_closed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_closed_deals_closed_at ON public.closed_deals USING btree (closed_at DESC);


--
-- Name: idx_closed_deals_listing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_closed_deals_listing_id ON public.closed_deals USING btree (listing_id);


--
-- Name: idx_closed_deals_sold_to_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_closed_deals_sold_to_profile_id ON public.closed_deals USING btree (sold_to_profile_id);


--
-- Name: idx_closed_deals_wholesaler_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_closed_deals_wholesaler_id ON public.closed_deals USING btree (wholesaler_id);


--
-- Name: idx_crm_exports_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_exports_org_id ON public.crm_exports USING btree (org_id);


--
-- Name: idx_crm_exports_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_exports_user_id ON public.crm_exports USING btree (user_id);


--
-- Name: idx_flags_reporter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flags_reporter ON public.flags USING btree (reporter_id);


--
-- Name: idx_flags_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flags_status ON public.flags USING btree (status);


--
-- Name: idx_flags_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flags_target ON public.flags USING btree (target_type, target_id);


--
-- Name: idx_listings_arv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_arv ON public.listings USING btree (arv) WHERE (arv IS NOT NULL);


--
-- Name: idx_listings_baths; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_baths ON public.listings USING btree (baths) WHERE (baths IS NOT NULL);


--
-- Name: idx_listings_beds; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_beds ON public.listings USING btree (beds) WHERE (beds IS NOT NULL);


--
-- Name: idx_listings_city_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_city_state ON public.listings USING btree (city, state) WHERE ((city IS NOT NULL) AND (state IS NOT NULL));


--
-- Name: idx_listings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_created_at ON public.listings USING btree (created_at);


--
-- Name: idx_listings_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_featured ON public.listings USING btree (featured);


--
-- Name: idx_listings_featured_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_featured_created ON public.listings USING btree (featured DESC NULLS LAST, created_at DESC);


--
-- Name: idx_listings_featured_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_featured_price ON public.listings USING btree (featured DESC, price) WHERE ((featured = true) AND (price IS NOT NULL));


--
-- Name: idx_listings_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_geom ON public.listings USING gist (public.st_makepoint(longitude, latitude));


--
-- Name: idx_listings_geom_column; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_geom_column ON public.listings USING gist (geom) WHERE (geom IS NOT NULL);


--
-- Name: idx_listings_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_location ON public.listings USING btree (state, city) WHERE ((state IS NOT NULL) AND (city IS NOT NULL));


--
-- Name: idx_listings_lot_sqft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_lot_sqft ON public.listings USING btree (lot_sqft) WHERE (lot_sqft IS NOT NULL);


--
-- Name: idx_listings_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_owner_id ON public.listings USING btree (owner_id) WHERE (owner_id IS NOT NULL);


--
-- Name: idx_listings_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_owner_status ON public.listings USING btree (owner_id, status) WHERE (owner_id IS NOT NULL);


--
-- Name: idx_listings_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_price ON public.listings USING btree (price) WHERE (price IS NOT NULL);


--
-- Name: idx_listings_price_beds; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_price_beds ON public.listings USING btree (price, beds) WHERE ((price IS NOT NULL) AND (beds IS NOT NULL));


--
-- Name: idx_listings_sqft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_sqft ON public.listings USING btree (sqft) WHERE (sqft IS NOT NULL);


--
-- Name: idx_listings_state_baths; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_state_baths ON public.listings USING btree (state, baths) WHERE ((state IS NOT NULL) AND (baths IS NOT NULL));


--
-- Name: idx_listings_state_beds; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_state_beds ON public.listings USING btree (state, beds) WHERE ((state IS NOT NULL) AND (beds IS NOT NULL));


--
-- Name: idx_listings_state_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_state_price ON public.listings USING btree (state, price) WHERE ((state IS NOT NULL) AND (price IS NOT NULL));


--
-- Name: idx_listings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_status ON public.listings USING btree (status);


--
-- Name: idx_listings_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_verified ON public.listings USING btree (verified) WHERE (verified = true);


--
-- Name: idx_listings_views; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_views ON public.listings USING btree (views);


--
-- Name: idx_listings_year_built; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_year_built ON public.listings USING btree (year_built) WHERE (year_built IS NOT NULL);


--
-- Name: idx_messages_from_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_from_id ON public.messages USING btree (from_id);


--
-- Name: idx_messages_from_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_from_to ON public.messages USING btree (from_id, to_id);


--
-- Name: idx_messages_listing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_listing_id ON public.messages USING btree (listing_id);


--
-- Name: idx_messages_listing_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_listing_user ON public.messages USING btree (listing_id, created_at) WHERE (listing_id IS NOT NULL);


--
-- Name: idx_messages_listing_user_thread_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_listing_user_thread_time ON public.messages USING btree (listing_id, thread_id, created_at) WHERE ((listing_id IS NOT NULL) AND (thread_id IS NOT NULL));


--
-- Name: idx_messages_thread_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_thread_created_at ON public.messages USING btree (thread_id, created_at) WHERE (thread_id IS NOT NULL);


--
-- Name: idx_messages_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_thread_id ON public.messages USING btree (thread_id);


--
-- Name: idx_messages_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_to_id ON public.messages USING btree (to_id);


--
-- Name: idx_messages_to_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_to_unread ON public.messages USING btree (to_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_messages_user_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_user_created_at ON public.messages USING btree (created_at DESC) WHERE ((from_id IS NOT NULL) OR (to_id IS NOT NULL));


--
-- Name: idx_messages_user_listing_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_user_listing_participant ON public.messages USING btree (listing_id, created_at) WHERE ((from_id IS NOT NULL) OR (to_id IS NOT NULL));


--
-- Name: idx_messages_user_listing_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_user_listing_time ON public.messages USING btree (listing_id, created_at DESC) WHERE ((from_id IS NOT NULL) OR (to_id IS NOT NULL));


--
-- Name: idx_moderation_actions_moderator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_actions_moderator ON public.moderation_actions USING btree (moderator_id);


--
-- Name: idx_moderation_actions_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_actions_target ON public.moderation_actions USING btree (target_type, target_id);


--
-- Name: idx_notifications_read_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_read_at ON public.notifications USING btree (read_at) WHERE (read_at IS NULL);


--
-- Name: idx_notifications_ref_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_ref_id ON public.notifications USING btree (ref_id) WHERE (ref_id IS NOT NULL);


--
-- Name: idx_org_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_members_user_id ON public.org_members USING btree (user_id);


--
-- Name: idx_orgs_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_owner_id ON public.orgs USING btree (owner_id);


--
-- Name: idx_orgs_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_slug ON public.orgs USING btree (slug);


--
-- Name: idx_profiles_annual_discount_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_annual_discount_expires_at ON public.profiles USING btree (annual_discount_expires_at);


--
-- Name: idx_profiles_annual_discount_redeemed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_annual_discount_redeemed_at ON public.profiles USING btree (annual_discount_redeemed_at);


--
-- Name: idx_profiles_banned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_banned ON public.profiles USING btree (banned) WHERE (banned = true);


--
-- Name: idx_profiles_discount_cohort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_discount_cohort ON public.profiles USING btree (discount_cohort);


--
-- Name: idx_profiles_membership_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_membership_tier ON public.profiles USING btree (membership_tier);


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);


--
-- Name: idx_profiles_stripe_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_stripe_customer_id ON public.profiles USING btree (stripe_customer_id);


--
-- Name: idx_profiles_suspended; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_suspended ON public.profiles USING btree (suspended) WHERE (suspended = true);


--
-- Name: idx_profiles_trial_consumed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_trial_consumed_at ON public.profiles USING btree (trial_consumed_at);


--
-- Name: idx_profiles_trial_granted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_trial_granted_at ON public.profiles USING btree (trial_granted_at);


--
-- Name: idx_profiles_trial_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_trial_type ON public.profiles USING btree (trial_type);


--
-- Name: idx_saved_search_matches_delivery_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_search_matches_delivery_status ON public.saved_search_matches USING btree (delivery_status) WHERE (delivery_status = 'pending'::text);


--
-- Name: idx_saved_search_matches_investor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_search_matches_investor_id ON public.saved_search_matches USING btree (investor_id);


--
-- Name: idx_saved_search_matches_listing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_search_matches_listing_id ON public.saved_search_matches USING btree (listing_id);


--
-- Name: idx_saved_search_matches_saved_search_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_search_matches_saved_search_id ON public.saved_search_matches USING btree (saved_search_id);


--
-- Name: idx_saved_searches_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_searches_active ON public.saved_searches USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_saved_searches_active_center; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_searches_active_center ON public.saved_searches USING btree (is_active, center_lat, center_lng) WHERE ((is_active = true) AND (center_lat IS NOT NULL) AND (center_lng IS NOT NULL));


--
-- Name: idx_saved_searches_center_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_searches_center_coords ON public.saved_searches USING btree (center_lat, center_lng) WHERE ((center_lat IS NOT NULL) AND (center_lng IS NOT NULL) AND (is_active = true));


--
-- Name: idx_saved_searches_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_searches_user_id ON public.saved_searches USING btree (user_id);


--
-- Name: idx_subscription_usage_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_usage_subscription_id ON public.subscription_usage USING btree (subscription_id);


--
-- Name: idx_support_tickets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_user_id ON public.support_tickets USING btree (user_id);


--
-- Name: idx_system_settings_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_updated_by ON public.system_settings USING btree (updated_by);


--
-- Name: idx_usage_counters_user_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_counters_user_period ON public.usage_counters USING btree (user_id, period_start);


--
-- Name: idx_user_activity_logs_activity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activity_logs_activity_type ON public.user_activity_logs USING btree (activity_type);


--
-- Name: idx_user_activity_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activity_logs_created_at ON public.user_activity_logs USING btree (created_at);


--
-- Name: idx_user_activity_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activity_logs_user_id ON public.user_activity_logs USING btree (user_id);


--
-- Name: idx_user_alerts_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_alerts_user_role ON public.user_alerts USING btree (user_id, role);


--
-- Name: idx_user_feedback_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_feedback_user_id ON public.user_feedback USING btree (user_id);


--
-- Name: idx_user_watchlists_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_watchlists_user_id ON public.user_watchlists USING btree (user_id);


--
-- Name: idx_watchlist_items_listing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlist_items_listing_id ON public.watchlist_items USING btree (listing_id);


--
-- Name: idx_watchlist_items_watchlist_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlist_items_watchlist_id ON public.watchlist_items USING btree (watchlist_id);


--
-- Name: idx_watchlists_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlists_listing ON public.watchlists USING btree (property_id);


--
-- Name: idx_watchlists_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlists_property_id ON public.watchlists USING btree (property_id);


--
-- Name: idx_watchlists_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlists_user ON public.watchlists USING btree (user_id, created_at DESC);


--
-- Name: idx_watchlists_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlists_user_id ON public.watchlists USING btree (user_id);


--
-- Name: idx_watchlists_user_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlists_user_property ON public.watchlists USING btree (user_id, property_id);


--
-- Name: listing_images_listing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_images_listing_id_idx ON public.listing_images USING btree (listing_id);


--
-- Name: listings_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_city_idx ON public.listings USING btree (city);


--
-- Name: listings_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_country_idx ON public.listings USING btree (country);


--
-- Name: listings_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_created_at_idx ON public.listings USING btree (created_at DESC);


--
-- Name: listings_created_price_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_created_price_idx ON public.listings USING btree (created_at DESC, price DESC);


--
-- Name: listings_currency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_currency_idx ON public.listings USING btree (currency);


--
-- Name: listings_geom_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_geom_gix ON public.listings USING gist (geom);


--
-- Name: listings_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_owner_idx ON public.listings USING btree (owner_id);


--
-- Name: listings_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_state_idx ON public.listings USING btree (state);


--
-- Name: listings_status_city_price_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_status_city_price_idx ON public.listings USING btree (status, city, price);


--
-- Name: listings_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_status_idx ON public.listings USING btree (status);


--
-- Name: profiles_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_type_idx ON public.profiles USING btree (type);


--
-- Name: subscription_usage_month_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_usage_month_year_idx ON public.subscription_usage USING btree (month_year);


--
-- Name: subscription_usage_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_usage_user_id_idx ON public.subscription_usage USING btree (user_id);


--
-- Name: subscription_usage_user_id_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_usage_user_id_month_idx ON public.subscription_usage USING btree (user_id, month_year);


--
-- Name: subscriptions_stripe_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_stripe_customer_id_idx ON public.subscriptions USING btree (stripe_customer_id);


--
-- Name: subscriptions_stripe_subscription_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_stripe_subscription_id_idx ON public.subscriptions USING btree (stripe_subscription_id);


--
-- Name: subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_user_id_idx ON public.subscriptions USING btree (user_id);


--
-- Name: closed_deals closed_deals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER closed_deals_updated_at BEFORE UPDATE ON public.closed_deals FOR EACH ROW EXECUTE FUNCTION public.update_closed_deals_updated_at();


--
-- Name: flags flags_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER flags_updated_at BEFORE UPDATE ON public.flags FOR EACH ROW EXECUTE FUNCTION public.update_flags_updated_at();


--
-- Name: listings handle_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: market_trends market_trends_handle_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER market_trends_handle_updated_at BEFORE UPDATE ON public.market_trends FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: notification_preferences notification_preferences_handle_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notification_preferences_handle_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: profiles prevent_trial_field_updates_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_trial_field_updates_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_trial_field_updates();


--
-- Name: listings trg_sync_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_geom BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.sync_geom_from_latlon();


--
-- Name: listings trigger_update_listing_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_listing_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.listings FOR EACH ROW EXECUTE FUNCTION public.update_listing_geom();


--
-- Name: user_alerts trigger_update_user_alerts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_user_alerts_updated_at BEFORE UPDATE ON public.user_alerts FOR EACH ROW EXECUTE FUNCTION public.update_user_alerts_updated_at();


--
-- Name: ai_analysis_logs ai_analysis_logs_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_logs
    ADD CONSTRAINT ai_analysis_logs_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: ai_analysis_logs ai_analysis_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_logs
    ADD CONSTRAINT ai_analysis_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_analysis_usage ai_analysis_usage_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_usage
    ADD CONSTRAINT ai_analysis_usage_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: ai_analysis_usage ai_analysis_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_usage
    ADD CONSTRAINT ai_analysis_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_usage ai_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: closed_deals closed_deals_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closed_deals
    ADD CONSTRAINT closed_deals_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: closed_deals closed_deals_sold_to_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closed_deals
    ADD CONSTRAINT closed_deals_sold_to_profile_id_fkey FOREIGN KEY (sold_to_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: closed_deals closed_deals_wholesaler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closed_deals
    ADD CONSTRAINT closed_deals_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: contact_logs contact_logs_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_logs
    ADD CONSTRAINT contact_logs_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: contact_logs contact_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_logs
    ADD CONSTRAINT contact_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: crm_exports crm_exports_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_exports
    ADD CONSTRAINT crm_exports_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE SET NULL;


--
-- Name: crm_exports crm_exports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_exports
    ADD CONSTRAINT crm_exports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: flags flags_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flags
    ADD CONSTRAINT flags_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: flags flags_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flags
    ADD CONSTRAINT flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: listing_images listing_images_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT listing_images_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: messages messages_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_from_id_fkey FOREIGN KEY (from_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: messages messages_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: messages messages_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_to_id_fkey FOREIGN KEY (to_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: moderation_actions moderation_actions_moderator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: org_members org_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_members org_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: orgs orgs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_verified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: saved_search_matches saved_search_matches_investor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_search_matches
    ADD CONSTRAINT saved_search_matches_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: saved_search_matches saved_search_matches_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_search_matches
    ADD CONSTRAINT saved_search_matches_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: saved_search_matches saved_search_matches_saved_search_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_search_matches
    ADD CONSTRAINT saved_search_matches_saved_search_id_fkey FOREIGN KEY (saved_search_id) REFERENCES public.saved_searches(id) ON DELETE CASCADE;


--
-- Name: saved_searches saved_searches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_searches
    ADD CONSTRAINT saved_searches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: subscription_usage subscription_usage_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_usage
    ADD CONSTRAINT subscription_usage_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: subscription_usage subscription_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_usage
    ADD CONSTRAINT subscription_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: usage_counters usage_counters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_counters
    ADD CONSTRAINT usage_counters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_activity_logs user_activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_logs
    ADD CONSTRAINT user_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_alerts user_alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_feedback user_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_watchlists user_watchlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_watchlists
    ADD CONSTRAINT user_watchlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: watchlist_items watchlist_items_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items
    ADD CONSTRAINT watchlist_items_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: watchlist_items watchlist_items_watchlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items
    ADD CONSTRAINT watchlist_items_watchlist_id_fkey FOREIGN KEY (watchlist_id) REFERENCES public.user_watchlists(id) ON DELETE CASCADE;


--
-- Name: watchlists watchlists_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: watchlists watchlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: moderation_actions Admins can create moderation actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can create moderation actions" ON public.moderation_actions FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text))))) AND (auth.uid() = moderator_id)));


--
-- Name: system_settings Admins can manage system settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage system settings" ON public.system_settings USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'admin'::text)))));


--
-- Name: flags Admins can update flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update flags" ON public.flags FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text))))));


--
-- Name: ai_analysis_usage Admins can view all AI analysis usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all AI analysis usage" ON public.ai_analysis_usage FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: user_activity_logs Admins can view all activity logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all activity logs" ON public.user_activity_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'admin'::text)))));


--
-- Name: admin_analytics Admins can view all analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all analytics" ON public.admin_analytics FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'admin'::text)))));


--
-- Name: flags Admins can view all flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all flags" ON public.flags FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text))))));


--
-- Name: admin_metrics Admins can view all metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all metrics" ON public.admin_metrics FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'admin'::text)))));


--
-- Name: audit_logs Admins can view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text))))));


--
-- Name: moderation_actions Admins can view moderation actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view moderation actions" ON public.moderation_actions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text))))));


--
-- Name: closed_deals Admins have full access to closed deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to closed deals" ON public.closed_deals USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text) OR (profiles.tier = 'enterprise'::text) OR (profiles.membership_tier = 'enterprise'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.segment = 'admin'::text) OR (profiles.tier = 'enterprise'::text) OR (profiles.membership_tier = 'enterprise'::text))))));


--
-- Name: profiles Allow authenticated users to insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated users to insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));


--
-- Name: profiles Allow authenticated users to update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated users to update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: buyers Anyone can view active buyers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active buyers" ON public.buyers FOR SELECT USING ((is_active = true));


--
-- Name: buyers Authenticated users can insert buyers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert buyers" ON public.buyers FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));


--
-- Name: notification_preferences Notification preferences insert own rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Notification preferences insert own rows" ON public.notification_preferences FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: notification_preferences Notification preferences select own rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Notification preferences select own rows" ON public.notification_preferences FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notification_preferences Notification preferences update own rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Notification preferences update own rows" ON public.notification_preferences FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: notifications Notifications select own rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Notifications select own rows" ON public.notifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notifications Notifications update own rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Notifications update own rows" ON public.notifications FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: orgs Owners can manage their orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage their orgs" ON public.orgs USING ((owner_id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscription_plans Public can view subscription plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view subscription plans" ON public.subscription_plans FOR SELECT USING (true);


--
-- Name: audit_logs System can create audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can create audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);


--
-- Name: flags Users can create flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create flags" ON public.flags FOR INSERT WITH CHECK ((auth.uid() = reporter_id));


--
-- Name: crm_exports Users can create their own exports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own exports" ON public.crm_exports FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles Users can delete their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own profile" ON public.profiles FOR DELETE USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: watchlist_items Users can delete their own watchlist items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own watchlist items" ON public.watchlist_items FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.user_watchlists
  WHERE ((user_watchlists.id = watchlist_items.watchlist_id) AND (user_watchlists.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: user_watchlists Users can delete their own watchlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own watchlists" ON public.user_watchlists FOR DELETE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ai_analysis_logs Users can insert their own AI analysis logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own AI analysis logs" ON public.ai_analysis_logs FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ai_analysis_usage Users can insert their own AI analysis usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own AI analysis usage" ON public.ai_analysis_usage FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: contact_logs Users can insert their own contact logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own contact logs" ON public.contact_logs FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_feedback Users can insert their own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own feedback" ON public.user_feedback FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: saved_search_matches Users can insert their own matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own matches" ON public.saved_search_matches FOR INSERT WITH CHECK ((auth.uid() = investor_id));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscriptions Users can insert their own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own subscription" ON public.subscriptions FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: support_tickets Users can insert their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own tickets" ON public.support_tickets FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscription_usage Users can insert their own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own usage" ON public.subscription_usage FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: watchlist_items Users can insert their own watchlist items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own watchlist items" ON public.watchlist_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.user_watchlists
  WHERE ((user_watchlists.id = watchlist_items.watchlist_id) AND (user_watchlists.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: user_watchlists Users can insert their own watchlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own watchlists" ON public.user_watchlists FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: alerts Users can manage their own alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own alerts" ON public.alerts USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_alerts Users can manage their own alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own alerts" ON public.user_alerts USING ((auth.uid() = user_id));


--
-- Name: messages Users can send messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can send messages" ON public.messages FOR INSERT WITH CHECK ((from_id = ( SELECT auth.uid() AS uid)));


--
-- Name: messages Users can update messages they received; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update messages they received" ON public.messages FOR UPDATE USING ((to_id = ( SELECT auth.uid() AS uid)));


--
-- Name: buyers Users can update their own buyers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own buyers" ON public.buyers FOR UPDATE USING ((auth.uid() = id));


--
-- Name: user_feedback Users can update their own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own feedback" ON public.user_feedback FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscriptions Users can update their own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own subscription" ON public.subscriptions FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: support_tickets Users can update their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own tickets" ON public.support_tickets FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscription_usage Users can update their own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own usage" ON public.subscription_usage FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: usage_counters Users can update their own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own usage" ON public.usage_counters FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_watchlists Users can update their own watchlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own watchlists" ON public.user_watchlists FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles Users can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);


--
-- Name: messages Users can view messages they sent or received or own listing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view messages they sent or received or own listing" ON public.messages FOR SELECT USING (((from_id = ( SELECT auth.uid() AS uid)) OR (to_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = messages.listing_id) AND (listings.owner_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: org_members Users can view org members of their orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view org members of their orgs" ON public.org_members FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orgs
  WHERE ((orgs.id = org_members.org_id) AND ((orgs.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.org_members om2
          WHERE ((om2.org_id = orgs.id) AND (om2.user_id = ( SELECT auth.uid() AS uid))))))))));


--
-- Name: orgs Users can view orgs they belong to; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view orgs they belong to" ON public.orgs FOR SELECT USING (((owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.org_members
  WHERE ((org_members.org_id = orgs.id) AND (org_members.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: user_activity_logs Users can view own activity logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own activity logs" ON public.user_activity_logs FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ai_analysis_logs Users can view their own AI analysis logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own AI analysis logs" ON public.ai_analysis_logs FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ai_analysis_usage Users can view their own AI analysis usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own AI analysis usage" ON public.ai_analysis_usage FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: contact_logs Users can view their own contact logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own contact logs" ON public.contact_logs FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: crm_exports Users can view their own exports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own exports" ON public.crm_exports FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_feedback Users can view their own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own feedback" ON public.user_feedback FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: flags Users can view their own flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own flags" ON public.flags FOR SELECT USING ((auth.uid() = reporter_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: saved_search_matches Users can view their own saved search matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own saved search matches" ON public.saved_search_matches FOR SELECT USING ((auth.uid() = investor_id));


--
-- Name: subscriptions Users can view their own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own subscription" ON public.subscriptions FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: support_tickets Users can view their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own tickets" ON public.support_tickets FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscription_usage Users can view their own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own usage" ON public.subscription_usage FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: usage_counters Users can view their own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own usage" ON public.usage_counters FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: watchlist_items Users can view their own watchlist items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own watchlist items" ON public.watchlist_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_watchlists
  WHERE ((user_watchlists.id = watchlist_items.watchlist_id) AND (user_watchlists.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: user_watchlists Users can view their own watchlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own watchlists" ON public.user_watchlists FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: closed_deals Wholesalers can manage their own closed deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Wholesalers can manage their own closed deals" ON public.closed_deals USING (((wholesaler_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = closed_deals.listing_id) AND (listings.owner_id = auth.uid())))))) WITH CHECK (((wholesaler_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = closed_deals.listing_id) AND (listings.owner_id = auth.uid()))))));


--
-- Name: admin_analytics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_analysis_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_analysis_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_analysis_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_analysis_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage ai_usage owner read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ai_usage owner read" ON public.ai_usage FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: buyers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;

--
-- Name: closed_deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.closed_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.flags ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_images listing_images_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_images_delete_own ON public.listing_images FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = listing_images.listing_id) AND (listings.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: listing_images listing_images_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_images_insert_own ON public.listing_images FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = listing_images.listing_id) AND (listings.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: listing_images listing_images_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_images_select_own ON public.listing_images FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = listing_images.listing_id) AND (listings.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: listing_images listing_images_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_images_update_own ON public.listing_images FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = listing_images.listing_id) AND (listings.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

--
-- Name: listings listings_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_owner_write ON public.listings USING ((owner_id = ( SELECT auth.uid() AS uid)));


--
-- Name: listings listings_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_read_all ON public.listings FOR SELECT USING (true);


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: moderation_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: org_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

--
-- Name: orgs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_search_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_search_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_searches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_searches saved_searches owners modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "saved_searches owners modify" ON public.saved_searches USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: saved_searches saved_searches owners select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "saved_searches owners select" ON public.saved_searches FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: subscription_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: user_activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: user_watchlists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_watchlists ENABLE ROW LEVEL SECURITY;

--
-- Name: watchlist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: watchlists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.watchlists ENABLE ROW LEVEL SECURITY;

--
-- Name: watchlists watchlists_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY watchlists_delete_own ON public.watchlists FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: watchlists watchlists_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY watchlists_insert_own ON public.watchlists FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: watchlists watchlists_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY watchlists_select_own ON public.watchlists FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: watchlists watchlists_service_role_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY watchlists_service_role_all ON public.watchlists TO service_role USING (true) WITH CHECK (true);


--
-- Name: watchlists watchlists_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY watchlists_update_own ON public.watchlists FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- PostgreSQL database dump complete
--

\unrestrict VgE4hGCf5Ldt9wHTF8DwwXLX7ATy20r5LHCTdRyQNztGKIqsoZ9x1w3NJ2Nim90

