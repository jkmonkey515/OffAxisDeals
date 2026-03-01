// Supabase Edge Function: Alerts Worker
// Processes saved_search_matches and creates notifications + notification_deliveries
// Sends email notifications via Resend and push notifications via Expo Push API
//
// DEPLOYMENT:
// Run: supabase functions deploy alerts-worker
//
// VALIDATION STEPS (after deploy):
// 1. Run one manual invoke (or wait for cron) and confirm logs show:
//    [alerts-worker] start { version: 'alerts-worker v2026-01-05-deliveries', deployment: <non-null or changed> }
// 2. Confirm NO PGRST204 errors
// 3. Confirm queued/failed decrease and sent increases
// 4. Confirm no delivery stuck in 'sending' beyond 2 minutes (only briefly during active run)
// 5. Check pushEligible, pushSent, pushFailed, pushSkippedNoDevice counts in summary

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WORKER_VERSION = 'alerts-worker v2026-01-05-deliveries';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EXPO_PUSH_ACCESS_TOKEN = Deno.env.get('EXPO_PUSH_ACCESS_TOKEN') || '';
const WEB_APP_URL = Deno.env.get('WEB_APP_URL') || 'https://www.offaxisdeals.com';
const MAX_DELIVERIES_PER_RUN = 20; // Recommended: keep runs short
const MAX_ATTEMPTS = 10; // Maximum delivery attempts before canceling
const RETRY_BASE_MINUTES = 5; // Base retry interval for exponential backoff
const STUCK_SENDING_THRESHOLD_MINUTES = 2; // Treat 'sending' as stuck if older than 2 minutes
const SEND_SPACING_MS = 600; // Throttle to stay under 2 requests/sec (600ms = ~1.67 req/sec)

// Helper for rate limiting
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Helper for exponential backoff: baseMinutes * 2^(min(6, attemptCount - 1))
// First retry (attemptCount=1) uses exponent 0 = 5 minutes
const calculateBackoffMinutes = (attemptCount: number): number => {
  const safeAttemptIndex = Math.max(0, attemptCount - 1);
  const exponent = Math.min(6, safeAttemptIndex);
  return RETRY_BASE_MINUTES * Math.pow(2, exponent);
};

interface SavedSearchMatch {
  id: string;
  saved_search_id: string;
  listing_id: string;
  investor_id: string;
  delivery_status: string;
  created_at: string;
  // Joined data
  saved_search_name: string | null;
  listing_title: string | null;
  listing_address: string | null;
  listing_city: string | null;
  listing_state: string | null;
  listing_zip: string | null;
  listing_price: number | null;
  user_id: string; // from saved_searches
  listing_status: string | null; // from listings
}

serve(async (req: Request) => {
  // Statistics
  let picked = 0;
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let skippedReasons: Record<string, number> = {}; // Track skip reasons
  let firstError: string | null = null; // Track first error encountered
  let supabase: ReturnType<typeof createClient> | null = null;
  // Push-specific statistics
  let pushEligible = 0;
  let pushSent = 0;
  let pushFailed = 0;
  let pushSkippedNoDevice = 0;

  // Log start with deployment ID
  const deploymentId = Deno.env.get('DENO_DEPLOYMENT_ID') ?? null;
  console.log('[alerts-worker] start', { 
    version: WORKER_VERSION, 
    deployment: deploymentId,
    now: new Date().toISOString() 
  });

  try {
    // Initialize Supabase client with service role (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    // Startup diagnostics: log which keys are present (boolean only, never log actual key values)
    const hasServiceRoleKey = Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const hasAnonKey = Boolean(Deno.env.get('SUPABASE_ANON_KEY'));
    console.log('[alerts-worker] startup config', {
      hasServiceRoleKey,
      hasAnonKey,
      supabaseUrl: supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : 'missing',
    });

    // Hard error if service role key is missing
    if (!supabaseServiceKey) {
      const error = 'Missing SUPABASE_SERVICE_ROLE_KEY';
      console.error('[alerts-worker] FATAL:', error);
      
      // Try to write FATAL row (may fail if we don't have a client, but try anyway)
      // We can't create a client without the key, so skip the FATAL row write here
      
      return new Response(
        JSON.stringify({ 
          ok: false,
          version: WORKER_VERSION,
          picked: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          error 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!supabaseUrl) {
      const error = 'Missing SUPABASE_URL';
      console.error('[alerts-worker] FATAL:', error);
      
      // Try to write FATAL row (may fail if we don't have a client, but try anyway)
      // We can't create a client without the URL, so skip the FATAL row write here
      
      return new Response(
        JSON.stringify({ 
          ok: false,
          version: WORKER_VERSION,
          picked: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          error 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create client with service role key (bypasses RLS)
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false, // Edge functions don't need session persistence
        autoRefreshToken: false,
      },
    });

    // Write START row immediately after client creation (before any queries)
    try {
      const { error: startError } = await supabase
        .from('alerts_worker_runs')
        .insert({
          source: 'edge_function',
          note: `START ${WORKER_VERSION} authorized=${hasServiceRoleKey}`,
        });
      
      if (startError) {
        console.error('[alerts-worker] runlog insert failed', startError);
      }
    } catch (err) {
      console.error('[alerts-worker] runlog insert failed', err);
    }

    // Pickup query: Get pending saved_search_matches with joins (only relationships PostgREST can resolve)
    const { data: pendingMatches, error: pickupError } = await supabase
      .from('saved_search_matches')
      .select(`
        id,
        saved_search_id,
        listing_id,
        investor_id,
        delivery_status,
        created_at,
        saved_searches!inner(
          user_id,
          name
        ),
        listings!inner(
          title,
          address,
          city,
          state,
          zip,
          price,
          status
        )
      `)
      .eq('delivery_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(MAX_DELIVERIES_PER_RUN);

    if (pickupError) {
      const error = `Failed to fetch pending matches: ${pickupError.message}`;
      console.error('[alerts-worker] Error fetching pending matches:', pickupError);
      
      // Write FATAL row before returning
      try {
        const { error: fatalError } = await supabase
          .from('alerts_worker_runs')
          .insert({
            source: 'edge_function',
            note: `FATAL ${error}`,
          });
        if (fatalError) {
          console.error('[alerts-worker] runlog insert failed', fatalError);
        }
      } catch (err) {
        console.error('[alerts-worker] runlog insert failed', err);
      }
      
      return new Response(
        JSON.stringify({ 
          ok: false,
          version: WORKER_VERSION,
          picked: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          error
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Filter matches: ensure listing is active
    // Note: We'll fetch notification_preferences separately per match, or hardcode for debugging
    const validMatches = (pendingMatches || []).filter((match: any) => {
      // Ensure listing exists and is active
      if (!match.listings || !match.listings.status) {
        return false;
      }
      const listingStatus = match.listings.status.toString().toLowerCase();
      if (listingStatus === 'sold' || listingStatus === 'archived' || listingStatus === 'deleted' || listingStatus === 'inactive') {
        return false;
      }
      return true;
    }).map((match: any) => ({
      id: match.id,
      saved_search_id: match.saved_search_id,
      listing_id: match.listing_id,
      investor_id: match.investor_id,
      delivery_status: match.delivery_status,
      created_at: match.created_at,
      saved_search_name: match.saved_searches?.name || null,
      listing_title: match.listings?.title || null,
      listing_address: match.listings?.address || null,
      listing_city: match.listings?.city || null,
      listing_state: match.listings?.state || null,
      listing_zip: match.listings?.zip || null,
      listing_price: match.listings?.price || null,
      user_id: match.saved_searches?.user_id || match.investor_id,
      listing_status: match.listings?.status || null,
    } as SavedSearchMatch));

    picked = validMatches.length;

    console.log(`[alerts-worker] PICKUP matches=${picked}`);

    // Write PICKUP row after pickup query (even if count is 0)
    try {
      const { error: pickupLogError } = await supabase
        .from('alerts_worker_runs')
        .insert({
          source: 'edge_function',
          note: `PICKUP matches=${picked}`,
        });
      
      if (pickupLogError) {
        console.error('[alerts-worker] runlog insert failed', pickupLogError);
      }
    } catch (err) {
      console.error('[alerts-worker] runlog insert failed', err);
    }

    if (picked === 0) {
      return new Response(
        JSON.stringify({ 
          ok: true,
          version: WORKER_VERSION,
          picked: 0,
          sent: 0,
          failed: 0,
          skipped: 0
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Process each match
    for (const match of validMatches) {
      processed++;
      
      try {
        const matchId = match.id;
        const savedSearchId = match.saved_search_id;
        const listingId = match.listing_id;
        const userId = match.user_id;
        
        // Check if user is Plus (required for push notifications)
        let isPlusUser = false;
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_paid')
            .eq('id', userId)
            .single();
          isPlusUser = profile?.is_paid === true;
        } catch (err) {
          // Silently handle profile fetch errors - default to false (no push for non-Plus)
          // Log only in dev mode (check deployment ID to detect local/dev)
          if (!deploymentId || deploymentId.includes('dev')) {
            console.error(`[alerts-worker] Match ${matchId}: failed to fetch profile for Plus check:`, err);
          }
        }
        
        // Fetch notification_preferences to check channel enablement
        let emailEnabled = true; // Default to true if no preferences row exists
        let inAppEnabled = true; // Default to true if no preferences row exists
        let pushEnabledPref = false; // Default to false - must be explicitly enabled
        
        try {
          const { data: prefs } = await supabase
            .from('notification_preferences')
            .select('email_enabled, saved_search_match_email, push_enabled')
            .eq('user_id', userId)
            .maybeSingle();
          
          if (prefs) {
            emailEnabled = prefs.email_enabled ?? true;
            inAppEnabled = prefs.saved_search_match_email ?? true;
            pushEnabledPref = prefs.push_enabled === true;
          }
        } catch (err) {
          // Silently handle preferences fetch errors - use defaults
          if (!deploymentId || deploymentId.includes('dev')) {
            console.error(`[alerts-worker] Match ${matchId}: failed to fetch notification preferences:`, err);
          }
        }
        
        // Push is enabled only if user is Plus AND push_enabled preference is true
        const pushEnabled = isPlusUser && pushEnabledPref;
        const enabledChannels: string[] = [];
        if (emailEnabled) enabledChannels.push('email');
        if (inAppEnabled) enabledChannels.push('in_app');
        if (pushEnabled) enabledChannels.push('push');
        
        console.log(`[alerts-worker] PROCESS match=${matchId} channels=${enabledChannels.join(',') || 'none'}`);
        
        if (enabledChannels.length === 0) {
          const skipReason = 'no_channels_enabled';
          skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
          skipped++;
          continue;
        }
        
        // Create or upsert notification row
        const refId = `saved_search_match:${matchId}`;
        const notificationTitle = match.saved_search_name 
          ? `New match for "${match.saved_search_name}"`
          : 'New saved search match';
        const notificationBody = match.listing_title 
          ? `A new listing "${match.listing_title}" matches your saved search.`
          : 'A new listing matches your saved search.';
        
        // Defensive check: ensure user_id and ref_id are present
        if (!userId || !refId) {
          const skipReason = `missing_user_id_or_ref_id: userId=${!!userId} refId=${!!refId}`;
          console.error(`[alerts-worker] Match ${matchId}: ${skipReason}`);
          skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
          if (!firstError) firstError = skipReason;
          skipped++;
          continue;
        }
        
        // Try insert first
        const insertRes = await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            ref_id: refId,
            type: 'saved_search_match',
            title: notificationTitle,
            body: notificationBody,
            listing_id: listingId,
          })
          .select('id')
          .single();
        
        let notificationId: string | null = null;
        let notificationSource: 'insert' | 'existing' = 'insert';
        
        if (insertRes.data && insertRes.data.id) {
          // Insert succeeded
          notificationId = insertRes.data.id;
        } else if (insertRes.error) {
          // Check if it's a duplicate key error (Postgres 23505)
          const isDuplicateKey = insertRes.error.code === '23505' || 
                                 insertRes.error.message?.toLowerCase().includes('duplicate key');
          
          if (isDuplicateKey) {
            // Fetch existing notification
            const existingRes = await supabase
              .from('notifications')
              .select('id')
              .eq('user_id', userId)
              .eq('ref_id', refId)
              .single();
            
            if (existingRes.data && existingRes.data.id) {
              notificationId = existingRes.data.id;
              notificationSource = 'existing';
            } else {
              const skipReason = `notification_fetch_after_duplicate_failed: ${existingRes.error?.message || 'no_data'}`;
              console.error(`[alerts-worker] Match ${matchId}: duplicate key but failed to fetch existing:`, existingRes.error);
              skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
              if (!firstError) firstError = skipReason;
              skipped++;
              continue;
            }
          } else {
            // Other insert error - skip with current behavior
            const skipReason = `notification_insert_failed: ${insertRes.error.message || 'unknown'}`;
            console.error(`[alerts-worker] Match ${matchId}: failed to insert notification:`, insertRes.error);
            skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
            if (!firstError) firstError = skipReason;
            skipped++;
            continue;
          }
        } else {
          // No data and no error (shouldn't happen, but handle defensively)
          const skipReason = 'notification_insert_no_data_no_error';
          console.error(`[alerts-worker] Match ${matchId}: insert returned no data and no error`);
          skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
          if (!firstError) firstError = skipReason;
          skipped++;
          continue;
        }
        
        // Log notification creation for debugging
        try {
          await supabase
            .from('alerts_worker_runs')
            .insert({
              source: 'edge_function',
              note: `NOTE notification_id=${notificationId} source=${notificationSource}`,
            });
        } catch (err) {
          console.error('[alerts-worker] runlog insert failed', err);
        }
        
        // Create notification_deliveries rows for enabled channels with idempotency keys
        const emailIdempotencyKey = `email:${savedSearchId}:saved_search_match:${matchId}:${userId}`;
        const inAppIdempotencyKey = `in_app:${savedSearchId}:saved_search_match:${matchId}:${userId}`;
        
        let emailDeliveryId: string | null = null;
        let inAppDeliveryId: string | null = null;
        let pushDeliveryIds: string[] = []; // Push can have multiple devices, so array of delivery IDs
        let pushDevicesToSend: Array<{ id: string; expo_push_token: string; platform: string; delivery_id: string }> = []; // Store device info with delivery IDs for sending
        
        // Create email delivery if enabled
        if (emailEnabled) {
          const nowISO = new Date().toISOString();
          const { data: emailDelivery, error: emailDeliveryError } = await supabase
            .from('notification_deliveries')
            .upsert({
              notification_id: notificationId,
              match_id: matchId,
              user_id: userId,
              channel: 'email',
              status: 'queued',
              idempotency_key: emailIdempotencyKey,
              attempt_count: 0,
              next_attempt_at: nowISO,
              last_error: null,
              last_attempt_at: null,
            }, {
              onConflict: 'channel,idempotency_key',
            })
            .select('id')
            .single();
          
          if (emailDeliveryError) {
            const skipReason = `email_delivery_create_failed: ${emailDeliveryError.message}`;
            console.error(`[alerts-worker] Match ${matchId}: failed to create email delivery:`, emailDeliveryError);
            skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
            if (!firstError) firstError = skipReason;
          } else {
            emailDeliveryId = emailDelivery.id;
            
            // Log email delivery creation for debugging
            try {
              await supabase
                .from('alerts_worker_runs')
                .insert({
                  source: 'edge_function',
                  note: `NOTE delivery channel=email id=${emailDeliveryId} notification_id=${notificationId}`,
                });
            } catch (err) {
              console.error('[alerts-worker] runlog insert failed', err);
            }
          }
        }
        
        // Create in_app delivery if enabled
        if (inAppEnabled) {
          const nowISO = new Date().toISOString();
          const { data: inAppDelivery, error: inAppDeliveryError } = await supabase
            .from('notification_deliveries')
            .upsert({
              notification_id: notificationId,
              match_id: matchId,
              user_id: userId,
              channel: 'in_app',
              status: 'queued',
              idempotency_key: inAppIdempotencyKey,
              attempt_count: 0,
              next_attempt_at: nowISO,
              last_error: null,
              last_attempt_at: null,
            }, {
              onConflict: 'channel,idempotency_key',
            })
            .select('id')
            .single();
          
          if (inAppDeliveryError) {
            const skipReason = `in_app_delivery_create_failed: ${inAppDeliveryError.message}`;
            console.error(`[alerts-worker] Match ${matchId}: failed to create in_app delivery:`, inAppDeliveryError);
            skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
            if (!firstError) firstError = skipReason;
          } else {
            inAppDeliveryId = inAppDelivery.id;
            
            // Log in_app delivery creation for debugging
            try {
              await supabase
                .from('alerts_worker_runs')
                .insert({
                  source: 'edge_function',
                  note: `NOTE delivery channel=in_app id=${inAppDeliveryId} notification_id=${notificationId}`,
                });
            } catch (err) {
              console.error('[alerts-worker] runlog insert failed', err);
            }
          }
        }
        
        // Create push deliveries if push enabled (user is Plus AND push_enabled preference is true)
        if (pushEnabled) {
          pushEligible++;
          
          try {
            // Fetch all enabled push devices for this user
            const { data: pushDevices, error: pushDevicesError } = await supabase
              .from('push_devices')
              .select('id, expo_push_token, platform')
              .eq('user_id', userId)
              .eq('is_enabled', true)
              .not('expo_push_token', 'is', null);
            
            if (pushDevicesError) {
              // Silently handle push device fetch errors - no user-facing alerts
              // Log only in dev mode (check deployment ID to detect local/dev)
              if (!deploymentId || deploymentId.includes('dev')) {
                console.error(`[alerts-worker] Match ${matchId}: failed to fetch push devices:`, pushDevicesError);
              }
              pushSkippedNoDevice++;
            } else if (!pushDevices || pushDevices.length === 0) {
              pushSkippedNoDevice++;
            } else {
              // Filter to devices with valid tokens
              const validPushDevices = pushDevices.filter((device: any) => device.expo_push_token && device.expo_push_token.trim().length > 0);
              
              if (validPushDevices.length === 0) {
                pushSkippedNoDevice++;
              } else {
                // Create notification_deliveries row for each push device
                // Idempotency key: push:${matchId}:${expo_push_token} (unique per match + token)
                for (const device of validPushDevices) {
                  const pushIdempotencyKey = `push:${matchId}:${device.expo_push_token}`;
                  const nowISO = new Date().toISOString();
                  
                  const { data: pushDelivery, error: pushDeliveryError } = await supabase
                    .from('notification_deliveries')
                    .upsert({
                      notification_id: notificationId,
                      match_id: matchId,
                      user_id: userId,
                      channel: 'push',
                      status: 'queued',
                      idempotency_key: pushIdempotencyKey,
                      attempt_count: 0,
                      next_attempt_at: nowISO,
                      last_error: null,
                      last_attempt_at: null,
                    }, {
                      onConflict: 'channel,idempotency_key',
                    })
                    .select('id')
                    .single();
                  
                  if (pushDeliveryError) {
                    // Silently handle push delivery creation errors - no user-facing alerts
                    // Log only in dev mode (check deployment ID to detect local/dev)
                    if (!deploymentId || deploymentId.includes('dev')) {
                      console.error(`[alerts-worker] Match ${matchId}: failed to create push delivery for token ${device.expo_push_token.substring(0, 20)}...:`, pushDeliveryError);
                    }
                  } else if (pushDelivery && pushDelivery.id) {
                    pushDeliveryIds.push(pushDelivery.id);
                    // Store device info with delivery ID for sending later
                    pushDevicesToSend.push({
                      id: device.id,
                      expo_push_token: device.expo_push_token,
                      platform: device.platform || 'unknown',
                      delivery_id: pushDelivery.id,
                    });
                  }
                }
              }
            }
          } catch (err) {
            // Silently handle push delivery creation errors - no user-facing alerts
            // Log only in dev mode (check deployment ID to detect local/dev)
            if (!deploymentId || deploymentId.includes('dev')) {
              console.error(`[alerts-worker] Match ${matchId}: Exception creating push deliveries:`, err);
            }
            pushSkippedNoDevice++;
          }
        }
        
        // Send email if email delivery was created
        let emailSent = false;
        let emailError: string | null = null;
        
        if (emailDeliveryId) {
          // Get recipient email using Admin API
          let userEmail: string | null = null;
          try {
            const adminResponse = await fetch(
              `${supabaseUrl}/auth/v1/admin/users/${userId}`,
              {
                headers: {
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'apikey': supabaseServiceKey,
                },
              }
            );
            
            if (adminResponse.ok) {
              const adminUser = await adminResponse.json() as { user?: { email?: string }; email?: string };
              userEmail = adminUser.user?.email || adminUser.email || null;
            } else {
              const errorText = await adminResponse.text();
              emailError = `admin_api_error_${adminResponse.status}: ${errorText.substring(0, 100)}`;
              console.error(`[alerts-worker] Admin API error for user ${userId}: ${adminResponse.status} - ${errorText}`);
            }
          } catch (err) {
            emailError = `exception_fetching_email: ${err instanceof Error ? err.message : 'unknown'}`;
            console.error(`[alerts-worker] Exception fetching email for user ${userId}:`, err);
          }
          
          if (userEmail && RESEND_API_KEY) {
            // Update delivery to 'sending' before attempting Resend
            const attemptNow = new Date();
            const attemptNowISO = attemptNow.toISOString();
            
            // Read current attempt_count, then increment atomically
            const { data: currentDelivery } = await supabase
              .from('notification_deliveries')
              .select('attempt_count')
              .eq('id', emailDeliveryId)
              .single();
            
            const currentAttemptCount = (currentDelivery?.attempt_count ?? 0) + 1;
            
            await supabase
              .from('notification_deliveries')
              .update({
                status: 'sending',
                last_attempt_at: attemptNowISO,
                attempt_count: currentAttemptCount,
                provider: 'resend',
              })
              .eq('id', emailDeliveryId);
            
            try {
              // Prepare email content
              const emailSubject = notificationTitle;
              let emailBody = `<h2>${notificationTitle}</h2>`;
              emailBody += `<p>${notificationBody}</p>`;
              
              if (listingId) {
                const listingUrl = `${WEB_APP_URL}/listings/${listingId}`;
                emailBody += `<p><a href="${listingUrl}" style="background-color: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 16px;">View Listing</a></p>`;
              }
              
              emailBody += `<hr style="margin: 32px 0; border: none; border-top: 1px solid #e0e0e0;">`;
              emailBody += `<p style="color: #666; font-size: 12px;">`;
              emailBody += `You're receiving this email because you have notifications enabled.<br>`;
              emailBody += `<a href="${WEB_APP_URL}/settings/notifications" style="color: #007AFF;">Manage notification preferences</a>`;
              emailBody += `</p>`;
              
              const resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: 'Off Axis Deals <alerts@offaxisdeals.com>',
                  to: [userEmail],
                  subject: emailSubject,
                  html: emailBody,
                }),
              });
              
              if (resendResponse.ok) {
                const resendData = await resendResponse.json() as { id?: string };
                emailSent = true;
                
                // Update email delivery to sent
                await supabase
                  .from('notification_deliveries')
                  .update({
                    status: 'sent',
                    provider_message_id: resendData.id || null,
                    last_error: null,
                  })
                  .eq('id', emailDeliveryId);
                
                sent++;
              } else {
                const errorData = await resendResponse.text();
                emailError = `Resend API error: ${resendResponse.status} - ${errorData}`;
                
                // Update email delivery to failed with backoff
                const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
                const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
                const nextAttemptISO = nextAttempt.toISOString();
                
                await supabase
                  .from('notification_deliveries')
                  .update({
                    status: 'failed',
                    last_error: emailError,
                    next_attempt_at: nextAttemptISO,
                  })
                  .eq('id', emailDeliveryId);
                
                failed++;
              }
            } catch (err) {
              emailError = err instanceof Error ? err.message : 'Unknown error';
              
              // Update email delivery to failed with backoff
              const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
              const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
              const nextAttemptISO = nextAttempt.toISOString();
              
              await supabase
                .from('notification_deliveries')
                .update({
                  status: 'failed',
                  last_error: emailError,
                  next_attempt_at: nextAttemptISO,
                })
                .eq('id', emailDeliveryId);
              
              failed++;
            }
            
            // Rate limiting
            await sleep(SEND_SPACING_MS);
          } else if (!userEmail) {
            emailError = 'no_email_found';
            
            // Read current attempt_count for backoff calculation
            const { data: currentDelivery } = await supabase
              .from('notification_deliveries')
              .select('attempt_count')
              .eq('id', emailDeliveryId)
              .single();
            
            const currentAttemptCount = currentDelivery?.attempt_count ?? 0;
            const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
            const attemptNow = new Date();
            const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
            const nextAttemptISO = nextAttempt.toISOString();
            
            await supabase
              .from('notification_deliveries')
              .update({
                status: 'failed',
                last_error: emailError,
                next_attempt_at: nextAttemptISO,
              })
              .eq('id', emailDeliveryId);
            failed++;
          } else {
            emailError = 'RESEND_API_KEY not configured';
            
            // Read current attempt_count for backoff calculation
            const { data: currentDelivery } = await supabase
              .from('notification_deliveries')
              .select('attempt_count')
              .eq('id', emailDeliveryId)
              .single();
            
            const currentAttemptCount = currentDelivery?.attempt_count ?? 0;
            const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
            const attemptNow = new Date();
            const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
            const nextAttemptISO = nextAttempt.toISOString();
            
            await supabase
              .from('notification_deliveries')
              .update({
                status: 'failed',
                last_error: emailError,
                next_attempt_at: nextAttemptISO,
              })
              .eq('id', emailDeliveryId);
            failed++;
          }
        }
        
        // Mark in_app delivery as sent (in_app doesn't require external API call)
        if (inAppDeliveryId) {
          await supabase
            .from('notification_deliveries')
            .update({
              status: 'sent',
              last_error: null,
            })
            .eq('id', inAppDeliveryId);
          sent++;
        }
        
        // Send push notifications if we have devices with deliveries created
        let pushSentCount = 0;
        let pushFailedCount = 0;
        
        // Send push notifications if we have devices with deliveries created
        if (pushDeliveryIds.length > 0 && pushDevicesToSend.length > 0 && pushDeliveryIds.length === pushDevicesToSend.length) {
          try {
            // Prepare push notifications array for batch sending
            const pushMessages = pushDevicesToSend.map((device) => ({
              to: device.expo_push_token,
              sound: 'default',
              title: notificationTitle,
              body: notificationBody,
              data: {
                type: 'saved_search_match',
                match_id: matchId,
                listing_id: listingId,
              },
            }));
            
            // Update all push deliveries to 'sending' before API call (status transition: queued → sending)
            const attemptNow = new Date();
            const attemptNowISO = attemptNow.toISOString();
            
            // Update each delivery to 'sending' and increment attempt_count
            for (const device of pushDevicesToSend) {
              const { data: currentDelivery } = await supabase
                .from('notification_deliveries')
                .select('attempt_count')
                .eq('id', device.delivery_id)
                .single();
              
              const currentAttemptCount = (currentDelivery?.attempt_count ?? 0) + 1;
              
              await supabase
                .from('notification_deliveries')
                .update({
                  status: 'sending',
                  last_attempt_at: attemptNowISO,
                  attempt_count: currentAttemptCount,
                  provider: 'expo',
                })
                .eq('id', device.delivery_id);
            }
            
            // Send batch push via Expo Push API
            const expoHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip, deflate',
            };
            
            // Add Authorization header if EXPO_PUSH_ACCESS_TOKEN is configured
            if (EXPO_PUSH_ACCESS_TOKEN) {
              expoHeaders['Authorization'] = `Bearer ${EXPO_PUSH_ACCESS_TOKEN}`;
            }
            
            const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: expoHeaders,
              body: JSON.stringify(pushMessages),
            });
            
            if (expoResponse.ok) {
              const expoData = await expoResponse.json() as { data?: Array<{ status: string; id?: string; message?: string }> };
              
              // Process responses - Expo returns array matching input order
              if (expoData.data && Array.isArray(expoData.data) && expoData.data.length === pushDevicesToSend.length) {
                for (let i = 0; i < pushDevicesToSend.length; i++) {
                  const device = pushDevicesToSend[i];
                  const expoResult = expoData.data[i];
                  
                  if (expoResult.status === 'ok') {
                    // Push sent successfully (status transition: sending → sent)
                    await supabase
                      .from('notification_deliveries')
                      .update({
                        status: 'sent',
                        provider: 'expo',
                        provider_message_id: expoResult.id || null,
                        last_error: null,
                      })
                      .eq('id', device.delivery_id);
                    pushSentCount++;
                    pushSent++;
                    sent++;
                  } else {
                    // Push failed (status transition: sending → failed)
                    const pushError = expoResult.message || 'Expo push API error';
                    const { data: currentDelivery } = await supabase
                      .from('notification_deliveries')
                      .select('attempt_count')
                      .eq('id', device.delivery_id)
                      .single();
                    
                    const currentAttemptCount = currentDelivery?.attempt_count ?? 1;
                    const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
                    const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
                    const nextAttemptISO = nextAttempt.toISOString();
                    
                    await supabase
                      .from('notification_deliveries')
                      .update({
                        status: 'failed',
                        provider: 'expo',
                        last_error: pushError,
                        next_attempt_at: nextAttemptISO,
                      })
                      .eq('id', device.delivery_id);
                    pushFailedCount++;
                    pushFailed++;
                    failed++;
                  }
                }
              } else {
                // Unexpected response format - mark all as failed
                const pushError = 'Expo API returned unexpected response format';
                for (const device of pushDevicesToSend) {
                  const { data: currentDelivery } = await supabase
                    .from('notification_deliveries')
                    .select('attempt_count')
                    .eq('id', device.delivery_id)
                    .single();
                  
                  const currentAttemptCount = currentDelivery?.attempt_count ?? 1;
                  const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
                  const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
                  const nextAttemptISO = nextAttempt.toISOString();
                  
                  await supabase
                    .from('notification_deliveries')
                    .update({
                      status: 'failed',
                      provider: 'expo',
                      last_error: pushError,
                      next_attempt_at: nextAttemptISO,
                    })
                    .eq('id', device.delivery_id);
                  pushFailedCount++;
                  pushFailed++;
                  failed++;
                }
              }
            } else {
              // Expo API request failed - mark all as failed
              const errorText = await expoResponse.text();
              const pushError = `Expo API error: ${expoResponse.status} - ${errorText.substring(0, 100)}`;
              
              for (const device of pushDevicesToSend) {
                const { data: currentDelivery } = await supabase
                  .from('notification_deliveries')
                  .select('attempt_count')
                  .eq('id', device.delivery_id)
                  .single();
                
                const currentAttemptCount = currentDelivery?.attempt_count ?? 1;
                const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
                const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
                const nextAttemptISO = nextAttempt.toISOString();
                
                await supabase
                  .from('notification_deliveries')
                  .update({
                    status: 'failed',
                    provider: 'expo',
                    last_error: pushError,
                    next_attempt_at: nextAttemptISO,
                  })
                  .eq('id', device.delivery_id);
                pushFailedCount++;
                pushFailed++;
                failed++;
              }
              
              // Silently handle Expo API errors - no user-facing alerts
              // Log only in dev mode (check deployment ID to detect local/dev)
              if (!deploymentId || deploymentId.includes('dev')) {
                console.error(`[alerts-worker] Match ${matchId}: Expo Push API error:`, pushError);
              }
            }
            
            // Rate limiting after push batch
            await sleep(SEND_SPACING_MS);
          } catch (err) {
            // Exception during push sending - mark all as failed
            const pushError = err instanceof Error ? err.message : 'Unknown error';
            
            for (const device of pushDevicesToSend) {
              const { data: currentDelivery } = await supabase
                .from('notification_deliveries')
                .select('attempt_count')
                .eq('id', device.delivery_id)
                .single();
              
              const currentAttemptCount = currentDelivery?.attempt_count ?? 1;
              const backoffMinutes = calculateBackoffMinutes(currentAttemptCount);
              const attemptNow = new Date();
              const nextAttempt = new Date(attemptNow.getTime() + backoffMinutes * 60 * 1000);
              const nextAttemptISO = nextAttempt.toISOString();
              
              await supabase
                .from('notification_deliveries')
                .update({
                  status: 'failed',
                  provider: 'expo',
                  last_error: pushError,
                  next_attempt_at: nextAttemptISO,
                })
                .eq('id', device.delivery_id);
              pushFailedCount++;
              pushFailed++;
              failed++;
            }
            
            // Silently handle push sending exceptions - no user-facing alerts
            // Log only in dev mode (check deployment ID to detect local/dev)
            if (!deploymentId || deploymentId.includes('dev')) {
              console.error(`[alerts-worker] Match ${matchId}: Exception sending push:`, err);
            }
          }
        }
        
        // Update saved_search_matches.delivery_status to 'notified' ONLY after all channels are handled
        // If only some channels enabled, update after those succeed
        const emailSucceeded = !emailDeliveryId || emailSent;
        const inAppSucceeded = !inAppDeliveryId || (inAppDeliveryId !== null); // in_app always succeeds if created
        const pushSucceeded = !pushEnabled || pushDeliveryIds.length === 0 || pushSentCount > 0; // Push succeeded if no devices or at least one sent
        
        if (emailSucceeded && inAppSucceeded && pushSucceeded) {
          await supabase
            .from('saved_search_matches')
            .update({
              delivery_status: 'notified',
            })
            .eq('id', matchId);
        }
      } catch (err) {
        // Log error but continue processing other matches
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        const skipReason = `exception: ${errorMessage.substring(0, 100)}`;
        console.error(`[alerts-worker] Error processing match ${match.id}:`, err);
        skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
        if (!firstError) firstError = skipReason;
        skipped++;
      }
    }

    // Log per-run summary
    const summaryNote = `DONE picked=${picked} processed=${processed} sent=${sent} failed=${failed} skipped=${skipped} pushEligible=${pushEligible} pushSent=${pushSent} pushFailed=${pushFailed} pushSkippedNoDevice=${pushSkippedNoDevice}${firstError ? ` firstError=${firstError}` : ''}${Object.keys(skippedReasons).length > 0 ? ` skippedReasons=${JSON.stringify(skippedReasons)}` : ''}`;
    console.log('[alerts-worker] done', { 
      version: WORKER_VERSION, 
      picked, 
      processed, 
      sent, 
      failed, 
      skipped,
      pushEligible,
      pushSent,
      pushFailed,
      pushSkippedNoDevice,
      skippedReasons,
      firstError
    });

    // Write DONE row with summary
    try {
      const { error: doneError } = await supabase
        .from('alerts_worker_runs')
        .insert({
          source: 'edge_function',
          note: summaryNote,
        });
      if (doneError) {
        console.error('[alerts-worker] runlog insert failed', doneError);
      }
    } catch (err) {
      console.error('[alerts-worker] runlog insert failed', err);
    }

    // Return summary
    return new Response(
      JSON.stringify({
        ok: true,
        version: WORKER_VERSION,
        picked,
        processed,
        sent,
        failed,
        skipped,
        pushEligible,
        pushSent,
        pushFailed,
        pushSkippedNoDevice,
        skippedReasons,
        firstError
      }),
      { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  } catch (err) {
    // Capture fatal error
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[alerts-worker] Fatal error:', err);

    // Write FATAL row if we have a supabase client
    if (supabase) {
      try {
        const { error: fatalError } = await supabase
          .from('alerts_worker_runs')
          .insert({
            source: 'edge_function',
            note: `FATAL ${errorMessage}`,
          });
        if (fatalError) {
          console.error('[alerts-worker] runlog insert failed', fatalError);
        }
      } catch (err) {
        console.error('[alerts-worker] runlog insert failed', err);
      }
    }

    return new Response(
      JSON.stringify({ 
        ok: false,
        version: WORKER_VERSION,
        picked: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        error: errorMessage
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
