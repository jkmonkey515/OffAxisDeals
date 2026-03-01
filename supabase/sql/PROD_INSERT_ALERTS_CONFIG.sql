-- ============================================
-- PRODUCTION: INSERT ALERTS CONFIGURATION
-- ============================================
-- 
-- IMPORTANT: Run the migration 20260119_app_settings_for_alerts.sql FIRST
-- to create the public.app_settings table before running this script.
-- 
-- Run this SQL in PROD Supabase SQL Editor to configure alerts automation.
-- Replace the placeholder values with your actual configuration.
-- 
-- Required values:
-- 1. supabase_url: Your Supabase project URL (e.g., https://abcdefghijklmnop.supabase.co)
-- 2. alerts_worker_secret: The x-worker-secret value used by your alerts-worker edge function
-- 3. service_role_key: (Optional but recommended) Your Supabase service role key
-- 4. anon_key: (Optional fallback) Your Supabase anon key
-- ============================================

-- Insert/update required configuration
INSERT INTO public.app_settings (key, value)
VALUES 
  -- REQUIRED: Supabase project URL
  ('supabase_url', 'https://YOUR_PROJECT_REF.supabase.co'),
  
  -- REQUIRED: Worker secret (x-worker-secret header value)
  ('alerts_worker_secret', 'YOUR_WORKER_SECRET_HERE'),
  
  -- OPTIONAL (but recommended): Service role key for Authorization header
  ('service_role_key', 'YOUR_SERVICE_ROLE_KEY_HERE'),
  
  -- OPTIONAL: Anon key (fallback if service_role_key not available)
  ('anon_key', 'YOUR_ANON_KEY_HERE')
ON CONFLICT (key) 
DO UPDATE SET 
  value = EXCLUDED.value,
  updated_at = now();

-- Verify the configuration was inserted
SELECT 
  key,
  CASE 
    WHEN key = 'supabase_url' THEN value
    WHEN key = 'alerts_worker_secret' THEN '***' || RIGHT(value, 4) -- Show last 4 chars only
    WHEN key = 'service_role_key' THEN '***' || RIGHT(value, 4)
    WHEN key = 'anon_key' THEN '***' || RIGHT(value, 4)
    ELSE value
  END AS value_preview,
  updated_at
FROM public.app_settings
WHERE key IN ('supabase_url', 'alerts_worker_secret', 'service_role_key', 'anon_key')
ORDER BY key;

-- Test the cron function (should not skip if config is present)
SELECT * FROM public.run_alerts_worker_cron();
