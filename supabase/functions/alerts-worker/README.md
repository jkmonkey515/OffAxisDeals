# Alerts Worker Edge Function

This Supabase Edge Function processes `saved_search_matches` and sends email notifications to Plus users who have enabled "New matching deals" in their notification preferences.

## Configuration

### Environment Variables

Set these in Supabase Dashboard → Edge Functions → alerts-worker → Settings:

- `RESEND_API_KEY`: Your Resend API key for sending emails
- `WEB_APP_URL`: Production web app URL (default: `https://www.offaxisdeals.com`)
- `SUPABASE_URL`: Automatically provided by Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Automatically provided by Supabase

## Deployment

```bash
# Deploy to Supabase
supabase functions deploy alerts-worker

# Or use Supabase CLI
npx supabase functions deploy alerts-worker
```

## Scheduling

Set up a pg_cron job to call this function periodically (e.g., every 5 minutes):

```sql
SELECT cron.schedule(
  'process-alerts',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/alerts-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_ANON_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

## Behavior

1. **Fetches pending matches**: Queries `saved_search_matches` where `delivery_status = 'pending'`
2. **Filters by Plus status**: Only processes matches for users where `profiles.is_paid = true`
3. **Checks preferences**: Only sends if `notification_preferences.new_matches = true` (defaults to false if no row exists)
4. **Idempotency**: Uses `notification_deliveries` table with idempotency key `{match_id}-email` to prevent duplicates
5. **Sends email**: Uses Resend API to send HTML email
6. **Updates status**: Marks delivery as 'sent' or 'failed', updates match `delivery_status` to 'notified'

## Rate Limiting

- Maximum 50 emails per run (configurable via `MAX_EMAILS_PER_RUN`)
- Processes matches in order of `created_at` (oldest first)

## Error Handling

- Single email failures don't stop processing
- Errors are logged to delivery record
- Match status remains 'pending' if delivery fails (can retry)

## Test Plan

### 1. Create Test Data

```sql
-- Create a Plus user (if not exists)
UPDATE public.profiles 
SET is_paid = true 
WHERE id = 'USER_ID_HERE';

-- Create notification preferences with new_matches enabled
INSERT INTO public.notification_preferences (user_id, new_matches)
VALUES ('USER_ID_HERE', true)
ON CONFLICT (user_id) DO UPDATE SET new_matches = true;

-- Create a saved search
INSERT INTO public.saved_searches (user_id, name, center_lat, center_lng, radius_miles)
VALUES ('USER_ID_HERE', 'Test Search', 32.2226, -110.9747, 10)
RETURNING id;

-- Create a saved_search_match (pending)
INSERT INTO public.saved_search_matches (saved_search_id, listing_id, investor_id, delivery_status)
VALUES ('SAVED_SEARCH_ID', 'LISTING_ID', 'USER_ID_HERE', 'pending')
RETURNING id;
```

### 2. Invoke Function

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/alerts-worker \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

### 3. Verify

- Check `notification_deliveries` table for new record with `status = 'sent'`
- Check email inbox for notification
- Verify `saved_search_matches.delivery_status` updated to 'notified'

### 4. Test Idempotency

- Re-run the function with the same match
- Verify no duplicate email sent
- Verify `skipReasons.alreadySent` count increases
