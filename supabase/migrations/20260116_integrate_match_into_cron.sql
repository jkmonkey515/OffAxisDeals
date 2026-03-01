-- ============================================
-- INTEGRATE MATCHER INTO ALERTS WORKER CRON
-- ============================================
-- 
-- This migration creates/updates run_alerts_worker_cron() to:
-- 1. Call match_saved_searches() to create new matches
-- 2. Then invoke the alerts-worker edge function to process pending matches
-- 
-- Features:
-- - Uses advisory lock to prevent concurrent execution
-- - Idempotent: safe to call multiple times
-- - Integrates matching into existing alerts pipeline
-- ============================================

-- ============================================
-- FUNCTION: run_alerts_worker_cron()
-- ============================================

-- Create or replace the cron function
CREATE OR REPLACE FUNCTION public.run_alerts_worker_cron()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lock_key bigint;
  v_match_result record;
  v_http_result jsonb;
  v_supabase_url text;
  v_anon_key text;
BEGIN
  -- Use advisory lock to prevent concurrent execution
  -- Hash the function name to create a unique lock key
  v_lock_key := hashtext('run_alerts_worker_cron');
  
  -- Try to acquire lock (non-blocking)
  IF NOT pg_try_advisory_lock(v_lock_key) THEN
    -- Another instance is already running, return early
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Another instance is already running',
      'skipped', true
    );
  END IF;

  BEGIN
    -- Step 1: Run matching to create new saved_search_matches
    SELECT * INTO v_match_result
    FROM public.match_saved_searches();
    
    -- Step 2: Invoke alerts-worker edge function to process pending matches
    -- Note: The edge function URL and anon key should be configured via Supabase dashboard
    -- or passed as function parameters. For now, we'll attempt to call it if pg_net is available.
    -- 
    -- In production, you may need to:
    -- 1. Set app.settings.supabase_url and app.settings.supabase_anon_key via ALTER DATABASE
    -- 2. Or modify this function to accept them as parameters
    -- 3. Or use a different method to invoke the edge function
    
    -- Try to get configuration (this is a placeholder - adjust based on your setup)
    BEGIN
      v_supabase_url := current_setting('app.settings.supabase_url', true);
      v_anon_key := current_setting('app.settings.supabase_anon_key', true);
    EXCEPTION
      WHEN OTHERS THEN
        -- Settings not configured, skip edge function call
        v_supabase_url := NULL;
        v_anon_key := NULL;
    END;
    
    -- Only invoke edge function if pg_net is available and configured
    IF v_supabase_url IS NOT NULL AND v_anon_key IS NOT NULL THEN
      BEGIN
        -- Call alerts-worker edge function via pg_net extension
        -- This requires pg_net extension to be enabled
        SELECT content::jsonb INTO v_http_result
        FROM net.http_post(
          url := v_supabase_url || '/functions/v1/alerts-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_anon_key
          ),
          body := '{}'::jsonb
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- pg_net not available or call failed - log but don't fail
          RAISE WARNING 'Failed to invoke alerts-worker edge function: %', SQLERRM;
          v_http_result := jsonb_build_object('error', SQLERRM);
      END;
    ELSE
      -- Configuration missing - skip edge function call
      -- The edge function can still be called separately via existing cron job
      RAISE NOTICE 'Supabase URL or anon key not configured. Skipping edge function call. Matching completed successfully.';
      v_http_result := jsonb_build_object('skipped', true, 'reason', 'Configuration missing');
    END IF;

    -- Release advisory lock
    PERFORM pg_advisory_unlock(v_lock_key);

    -- Return summary
    RETURN jsonb_build_object(
      'success', true,
      'matching', jsonb_build_object(
        'matches_created', v_match_result.matches_created,
        'searches_processed', v_match_result.searches_processed,
        'listings_checked', v_match_result.listings_checked
      ),
      'worker', v_http_result
    );
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Release lock on error
      PERFORM pg_advisory_unlock(v_lock_key);
      -- Re-raise the exception
      RAISE;
  END;
END;
$$;

-- Grant execute permission to service role (for cron jobs)
GRANT EXECUTE ON FUNCTION public.run_alerts_worker_cron() TO service_role;

-- Comment on function
COMMENT ON FUNCTION public.run_alerts_worker_cron() IS 
  'Runs the complete alerts pipeline: (1) matches saved searches against listings, (2) invokes alerts-worker edge function to process pending matches. Uses advisory lock to prevent concurrent execution.';

-- ============================================
-- CRON JOB SETUP (commented out - run manually in production)
-- ============================================
-- 
-- To set up the cron job, run this in production:
-- 
-- SELECT cron.schedule(
--   'run-alerts-worker',
--   '*/5 * * * *', -- Every 5 minutes
--   $$SELECT public.run_alerts_worker_cron();$$
-- );
-- 
-- To check existing cron jobs:
-- SELECT * FROM cron.job;
-- 
-- To unschedule:
-- SELECT cron.unschedule('run-alerts-worker');
-- 
-- ============================================
