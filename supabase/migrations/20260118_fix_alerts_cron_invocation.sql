-- ============================================
-- FIX ALERTS WORKER CRON INVOCATION
-- ============================================
-- 
-- This migration updates run_alerts_worker_cron() to:
-- 1. Call match_saved_searches() first to create new matches
-- 2. Invoke alerts-worker edge function using pg_net
-- 3. Try multiple configuration sources (vault, app_settings, database settings)
-- 4. Prefer service role key, fallback to anon key (matches README approach)
-- 5. Keep the same return type and signature (jsonb)
-- 6. Ensure only one active cron job exists
-- 7. Create cron job if it doesn't exist
-- ============================================

-- ============================================
-- FUNCTION: run_alerts_worker_cron() (updated)
-- ============================================

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
  v_service_role_key text;
  v_request_id bigint;
BEGIN
  -- Use advisory lock to prevent concurrent execution
  v_lock_key := hashtext('run_alerts_worker_cron');
  
  -- Try to acquire lock (non-blocking)
  IF NOT pg_try_advisory_lock(v_lock_key) THEN
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
    -- Get configuration from multiple sources (in order of preference)
    
    -- Get Supabase URL
    BEGIN
      v_supabase_url := current_setting('app.settings.supabase_url', true);
    EXCEPTION
      WHEN OTHERS THEN
        -- Try to construct from database name (fallback)
        -- In Supabase, the URL format is: https://{project_ref}.supabase.co
        -- This is a fallback - should be configured explicitly in production
        v_supabase_url := 'https://' || current_database() || '.supabase.co';
    END;
    
    -- Get auth key (try service role first, then anon key as fallback)
    -- Service role key (preferred - more secure, same as edge function uses internally)
    BEGIN
      SELECT decrypted_secret INTO v_service_role_key
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_service_role_key'
      LIMIT 1;
    EXCEPTION
      WHEN OTHERS THEN
        BEGIN
          SELECT value INTO v_service_role_key
          FROM public.app_settings
          WHERE key = 'supabase_service_role_key'
          LIMIT 1;
        EXCEPTION
          WHEN OTHERS THEN
            BEGIN
              v_service_role_key := current_setting('app.settings.supabase_service_role_key', true);
            EXCEPTION
              WHEN OTHERS THEN
                v_service_role_key := NULL;
            END;
        END;
    END;
    
    -- Fallback to anon key if service role key not available
    -- (Matches the approach shown in alerts-worker README)
    IF v_service_role_key IS NULL THEN
      BEGIN
        v_service_role_key := current_setting('app.settings.supabase_anon_key', true);
      EXCEPTION
        WHEN OTHERS THEN
          v_service_role_key := NULL;
      END;
    END IF;
    
    -- Invoke edge function if we have URL and auth key
    IF v_supabase_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
      BEGIN
        -- Call alerts-worker edge function via pg_net extension
        -- Uses Authorization header with Bearer token (service role or anon key)
        SELECT request_id INTO v_request_id
        FROM net.http_post(
          url := v_supabase_url || '/functions/v1/alerts-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_role_key
          ),
          body := '{}'::jsonb
        );
        
        -- net.http_post returns request_id immediately (async execution)
        v_http_result := jsonb_build_object(
          'request_id', v_request_id,
          'status', 'queued',
          'url', v_supabase_url || '/functions/v1/alerts-worker'
        );
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'Failed to invoke alerts-worker edge function: %', SQLERRM;
          v_http_result := jsonb_build_object('error', SQLERRM);
      END;
    ELSE
      -- Configuration missing - skip edge function call
      RAISE NOTICE 'Supabase URL or auth key not configured. Skipping edge function call. Matching completed successfully.';
      v_http_result := jsonb_build_object(
        'skipped', true, 
        'reason', 'Configuration missing',
        'note', 'Configure supabase_url and supabase_service_role_key (or supabase_anon_key) in app.settings.*'
      );
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
  'Runs the complete alerts pipeline: (1) matches saved searches against listings via match_saved_searches(), (2) invokes alerts-worker edge function to process pending matches. Uses advisory lock to prevent concurrent execution. Requires supabase_url and auth key (service role preferred, anon key fallback) in vault.decrypted_secrets, public.app_settings, or app.settings.*';

-- ============================================
-- CRON JOB MANAGEMENT
-- ============================================

-- Check for duplicate cron jobs (run this to see what exists)
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE '%alert%' OR jobname LIKE '%worker%';

-- Disable duplicate cron jobs (uncomment and adjust jobnames as needed)
-- UPDATE cron.job 
-- SET active = false 
-- WHERE jobname IN ('old-alerts-job', 'duplicate-worker-job')
--   AND jobname != 'run-alerts-worker';

-- Ensure only one active alerts cron job exists
-- This will disable all alerts-related jobs except 'run-alerts-worker'
DO $$
DECLARE
  v_keep_jobname text := 'run-alerts-worker';
  v_disabled_count int;
BEGIN
  -- Disable all alerts/worker jobs except the one we want to keep
  UPDATE cron.job
  SET active = false
  WHERE (jobname LIKE '%alert%' OR jobname LIKE '%worker%')
    AND jobname != v_keep_jobname
    AND active = true;
  
  GET DIAGNOSTICS v_disabled_count = ROW_COUNT;
  
  IF v_disabled_count > 0 THEN
    RAISE NOTICE 'Disabled % duplicate alerts/worker cron job(s)', v_disabled_count;
  END IF;
END $$;

-- ============================================
-- CRON JOB SETUP (if not exists)
-- ============================================

-- Create the cron job if it doesn't exist
-- Run this manually in production if the job doesn't exist yet
DO $$
BEGIN
  -- Check if job already exists
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'run-alerts-worker'
  ) THEN
    -- Create the cron job (every minute)
    PERFORM cron.schedule(
      'run-alerts-worker',
      '* * * * *', -- Every minute
      $$SELECT public.run_alerts_worker_cron();$$
    );
    RAISE NOTICE 'Created cron job: run-alerts-worker (every minute)';
  ELSE
    RAISE NOTICE 'Cron job run-alerts-worker already exists';
  END IF;
END $$;
