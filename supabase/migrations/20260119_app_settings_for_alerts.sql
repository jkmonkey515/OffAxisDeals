-- ============================================
-- APP SETTINGS TABLE FOR ALERTS CONFIGURATION
-- ============================================
-- 
-- This migration creates public.app_settings table to store configuration
-- for alerts automation (Supabase URL, service role key, worker secret).
-- 
-- Features:
-- - Simple key/value store
-- - RLS enabled, only service_role can access
-- - Updated_at trigger for audit trail
-- - Updates run_alerts_worker_cron() to read from app_settings
-- - Updates existing cron job to use run_alerts_worker_cron()
-- ============================================

-- ============================================
-- TABLE: app_settings
-- ============================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.handle_app_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- Add updated_at trigger
DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_app_settings_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "app_settings_service_role_only" ON public.app_settings;

-- Only service_role can read/write (revoke from anon/authenticated)
CREATE POLICY "app_settings_service_role_only"
  ON public.app_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Revoke all permissions from anon and authenticated
REVOKE ALL ON public.app_settings FROM anon;
REVOKE ALL ON public.app_settings FROM authenticated;

-- Grant to service_role only
GRANT ALL ON public.app_settings TO service_role;

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
  v_worker_secret text;
  v_service_role_key text;
  v_request_id bigint;
  v_headers jsonb;
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
    
    -- Step 2: Get configuration from app_settings
    SELECT value INTO v_supabase_url
    FROM public.app_settings
    WHERE key = 'supabase_url'
    LIMIT 1;
    
    SELECT value INTO v_worker_secret
    FROM public.app_settings
    WHERE key = 'alerts_worker_secret'
    LIMIT 1;
    
    -- Service role key is optional (preferred if available)
    SELECT value INTO v_service_role_key
    FROM public.app_settings
    WHERE key = 'service_role_key'
    LIMIT 1;
    
    -- Check if required configuration is present
    IF v_supabase_url IS NULL OR v_worker_secret IS NULL THEN
      -- Configuration missing - skip edge function call
      RAISE NOTICE 'Required configuration missing from app_settings. Need: supabase_url, alerts_worker_secret';
      v_http_result := jsonb_build_object(
        'skipped', true, 
        'reason', 'Configuration missing',
        'note', 'Configure supabase_url and alerts_worker_secret in public.app_settings'
      );
    ELSE
      -- Invoke alerts-worker edge function via pg_net
      BEGIN
        -- Build headers with x-worker-secret (required) and optional Authorization
        v_headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', v_worker_secret
        );
        
        -- Add Authorization header if service role key is available
        IF v_service_role_key IS NOT NULL THEN
          v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_service_role_key);
        END IF;
        
        -- Call alerts-worker edge function
        -- net.http_post returns bigint directly (request_id), not a record
        v_request_id := net.http_post(
          url := v_supabase_url || '/functions/v1/alerts-worker',
          headers := v_headers,
          body := '{}'::jsonb
        );
        
        -- net.http_post returns request_id immediately (async execution)
        v_http_result := jsonb_build_object(
          'skipped', false,
          'request_id', v_request_id,
          'status', 'queued',
          'url', v_supabase_url || '/functions/v1/alerts-worker',
          'method', 'http_post'
        );
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'Failed to invoke alerts-worker edge function: %', SQLERRM;
          v_http_result := jsonb_build_object('error', SQLERRM);
      END;
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
  'Runs the complete alerts pipeline: (1) matches saved searches against listings via match_saved_searches(), (2) invokes alerts-worker edge function to process pending matches. Uses advisory lock to prevent concurrent execution. Reads configuration from public.app_settings (supabase_url, alerts_worker_secret, service_role_key).';

-- ============================================
-- CRON JOB MANAGEMENT
-- ============================================

-- Update existing cron job to use run_alerts_worker_cron() if it doesn't already
DO $$
DECLARE
  v_job_id bigint;
  v_current_command text;
  v_new_command text := $cmd$SELECT public.run_alerts_worker_cron();$cmd$;
BEGIN
  -- Find existing alerts/worker cron job
  SELECT jobid, command INTO v_job_id, v_current_command
  FROM cron.job
  WHERE (jobname LIKE '%alert%' OR jobname LIKE '%worker%')
    AND active = true
  ORDER BY jobid
  LIMIT 1;
  
  IF v_job_id IS NOT NULL THEN
    -- Check if command already calls run_alerts_worker_cron
    IF v_current_command IS NULL OR v_current_command !~* 'run_alerts_worker_cron' THEN
      -- Update the command (may fail if no UPDATE permission on cron.job)
      BEGIN
        UPDATE cron.job
        SET command = v_new_command
        WHERE jobid = v_job_id;
        
        RAISE NOTICE 'Updated cron job % to call run_alerts_worker_cron()', v_job_id;
      EXCEPTION
        WHEN insufficient_privilege OR OTHERS THEN
          RAISE WARNING 'Could not update cron job % command (permission denied). Manual update may be required.', v_job_id;
      END;
    ELSE
      RAISE NOTICE 'Cron job % already calls run_alerts_worker_cron()', v_job_id;
    END IF;
    
    -- Disable any other alerts/worker jobs (ensure only one active)
    -- This may fail if no UPDATE permission on cron.job - that's okay
    BEGIN
      UPDATE cron.job
      SET active = false
      WHERE (jobname LIKE '%alert%' OR jobname LIKE '%worker%')
        AND jobid != v_job_id
        AND active = true;
    EXCEPTION
      WHEN insufficient_privilege OR OTHERS THEN
        RAISE WARNING 'Could not disable duplicate cron jobs (permission denied). Manual cleanup may be required.';
    END;
  ELSE
    -- No existing job found, create one
    BEGIN
      PERFORM cron.schedule(
        'run-alerts-worker',
        '* * * * *', -- Every minute
        v_new_command
      );
      RAISE NOTICE 'Created new cron job: run-alerts-worker (every minute)';
    EXCEPTION
      WHEN insufficient_privilege OR OTHERS THEN
        RAISE WARNING 'Could not create cron job (permission denied). Manual creation may be required.';
    END;
  END IF;
END $$;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.app_settings IS 'Application settings key/value store. Used for alerts automation configuration (Supabase URL, worker secret, service role key). Only accessible by service_role.';
COMMENT ON COLUMN public.app_settings.key IS 'Setting key (e.g., supabase_url, alerts_worker_secret)';
COMMENT ON COLUMN public.app_settings.value IS 'Setting value (e.g., https://project.supabase.co, secret-token)';
COMMENT ON COLUMN public.app_settings.updated_at IS 'Timestamp of last update (auto-updated by trigger)';
