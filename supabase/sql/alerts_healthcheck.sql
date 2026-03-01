-- ============================================
-- ALERTS SYSTEM HEALTH CHECK QUERIES
-- ============================================
-- 
-- Use these queries to monitor the alerts automation system:
-- - Cron job status and recent runs
-- - Pending matches and delivery status
-- - Notification and delivery statistics
-- ============================================

-- ============================================
-- PART A: Cron Job Status
-- ============================================

-- List all active cron jobs (should show exactly one for alerts)
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  active,
  nodename,
  nodeport
FROM cron.job
WHERE active = true
ORDER BY jobid;

-- Check for alerts-related cron jobs specifically
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  CASE 
    WHEN jobname LIKE '%alert%' OR jobname LIKE '%worker%' THEN '✅ Alerts job'
    ELSE 'Other job'
  END AS job_type
FROM cron.job
WHERE active = true
ORDER BY jobname;

-- Last 20 cron job run details (most recent first)
SELECT 
  jobid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time,
  CASE 
    WHEN end_time IS NOT NULL THEN end_time - start_time
    ELSE NULL
  END AS duration
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 20;

-- Last run of alerts worker cron (if exists)
SELECT 
  j.jobname,
  j.schedule,
  j.active,
  jrd.start_time AS last_run_start,
  jrd.end_time AS last_run_end,
  jrd.status AS last_run_status,
  jrd.return_message AS last_run_message,
  CASE 
    WHEN jrd.end_time IS NOT NULL THEN jrd.end_time - jrd.start_time
    ELSE NULL
  END AS last_run_duration,
  CASE 
    WHEN jrd.start_time > NOW() - INTERVAL '10 minutes' THEN '✅ Recent'
    WHEN jrd.start_time > NOW() - INTERVAL '1 hour' THEN '⚠️ Stale (>10min)'
    ELSE '❌ Very stale (>1h)'
  END AS health_status
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT *
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE j.jobname LIKE '%alert%' OR j.jobname LIKE '%worker%'
ORDER BY jrd.start_time DESC NULLS LAST;

-- ============================================
-- PART B: Pending Matches Status
-- ============================================

-- Count of pending matches (waiting to be processed)
SELECT 
  COUNT(*) AS pending_matches,
  COUNT(DISTINCT saved_search_id) AS unique_searches,
  COUNT(DISTINCT listing_id) AS unique_listings,
  COUNT(DISTINCT investor_id) AS unique_investors,
  MIN(created_at) AS oldest_pending,
  MAX(created_at) AS newest_pending
FROM public.saved_search_matches
WHERE delivery_status = 'pending';

-- Pending matches by saved search (top 20)
SELECT 
  ss.id AS saved_search_id,
  ss.name AS search_name,
  ss.criteria->>'location_keyword' AS location,
  COUNT(m.id) AS pending_count,
  MIN(m.created_at) AS oldest_match,
  MAX(m.created_at) AS newest_match
FROM public.saved_search_matches m
JOIN public.saved_searches ss ON ss.id = m.saved_search_id
WHERE m.delivery_status = 'pending'
GROUP BY ss.id, ss.name, ss.criteria
ORDER BY pending_count DESC
LIMIT 20;

-- ============================================
-- PART C: Notifications Created (Last 24h)
-- ============================================

-- Notifications created in last 24 hours
SELECT 
  COUNT(*) AS notifications_24h,
  COUNT(*) FILTER (WHERE type = 'saved_search_match') AS saved_search_match_notifications,
  COUNT(DISTINCT user_id) AS unique_users_notified,
  MIN(created_at) AS first_notification,
  MAX(created_at) AS last_notification
FROM public.notifications
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Notifications by type (last 24h)
SELECT 
  type,
  COUNT(*) AS count,
  COUNT(DISTINCT user_id) AS unique_users
FROM public.notifications
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY type
ORDER BY count DESC;

-- ============================================
-- PART D: Delivery Status (Last 24h)
-- ============================================

-- Delivery summary for last 24 hours
SELECT 
  channel,
  status,
  COUNT(*) AS count,
  COUNT(DISTINCT user_id) AS unique_users,
  MIN(created_at) AS first_delivery,
  MAX(created_at) AS last_delivery
FROM public.notification_deliveries
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY channel, status
ORDER BY channel, status;

-- Overall delivery statistics (last 24h)
SELECT 
  COUNT(*) AS total_deliveries_24h,
  COUNT(*) FILTER (WHERE status = 'sent') AS delivered_24h,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_24h,
  COUNT(*) FILTER (WHERE status = 'queued') AS queued_24h,
  COUNT(*) FILTER (WHERE status = 'sending') AS sending_24h,
  COUNT(DISTINCT user_id) AS unique_users,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'sent') / NULLIF(COUNT(*), 0),
    2
  ) AS success_rate_pct
FROM public.notification_deliveries
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Failed deliveries with error messages (last 24h)
SELECT 
  id,
  user_id,
  channel,
  status,
  last_error,
  attempt_count,
  created_at,
  last_attempt_at
FROM public.notification_deliveries
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND status = 'failed'
ORDER BY last_attempt_at DESC
LIMIT 20;

-- ============================================
-- PART E: Alerts Worker Runs (if table exists)
-- ============================================

-- Last 20 alerts worker runs (from edge function logs)
SELECT 
  ran_at,
  source,
  note,
  CASE 
    WHEN ran_at > NOW() - INTERVAL '10 minutes' THEN '✅ Recent'
    WHEN ran_at > NOW() - INTERVAL '1 hour' THEN '⚠️ Stale'
    ELSE '❌ Old'
  END AS recency
FROM public.alerts_worker_runs
ORDER BY ran_at DESC
LIMIT 20;

-- ============================================
-- PART F: System Health Summary
-- ============================================

-- Overall health check summary
WITH cron_status AS (
  SELECT 
    COUNT(*) FILTER (WHERE j.active = true AND (j.jobname LIKE '%alert%' OR j.jobname LIKE '%worker%')) AS active_jobs,
    MAX(jrd.start_time) AS last_run
  FROM cron.job j
  LEFT JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
  WHERE j.jobname LIKE '%alert%' OR j.jobname LIKE '%worker%'
),
match_stats AS (
  SELECT COUNT(*) AS pending FROM public.saved_search_matches WHERE delivery_status = 'pending'
),
notification_stats AS (
  SELECT 
    COUNT(*) AS created_24h
  FROM public.notifications
  WHERE created_at > NOW() - INTERVAL '24 hours'
),
delivery_stats AS (
  SELECT 
    COUNT(*) FILTER (WHERE status = 'sent') AS sent_24h,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_24h
  FROM public.notification_deliveries
  WHERE created_at > NOW() - INTERVAL '24 hours'
)
SELECT 
  cs.active_jobs AS cron_jobs_active,
  cs.last_run AS cron_last_run,
  CASE 
    WHEN cs.last_run > NOW() - INTERVAL '10 minutes' THEN '✅ Running'
    WHEN cs.last_run > NOW() - INTERVAL '1 hour' THEN '⚠️ Stale'
    WHEN cs.last_run IS NULL THEN '❌ Never run'
    ELSE '❌ Very stale'
  END AS cron_health,
  ms.pending AS pending_matches,
  ns.created_24h AS notifications_24h,
  ds.sent_24h AS deliveries_sent_24h,
  ds.failed_24h AS deliveries_failed_24h
FROM cron_status cs
CROSS JOIN match_stats ms
CROSS JOIN notification_stats ns
CROSS JOIN delivery_stats ds;
