// Supabase Edge Function: Test Push
// Dev-only function to send a test push notification to the current user's devices
//
// Usage: POST /functions/v1/test-push
// Headers: Authorization: Bearer <anon_key or service_role_key>
//
// This function:
// 1. Gets the authenticated user from the request
// 2. Fetches all enabled push devices for that user
// 3. Sends a test push notification via Expo Push API
// 4. Returns success/failure status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WORKER_VERSION = 'test-push v1.0.0';

serve(async (req: Request) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || (!supabaseAnonKey && !supabaseServiceKey)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing Supabase configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create client with service role (bypasses RLS) or anon key
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey || supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.substring(7);
    
    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Fetch enabled push devices for this user
    const { data: pushDevices, error: devicesError } = await supabase
      .from('push_devices')
      .select('id, expo_push_token, platform')
      .eq('user_id', userId)
      .eq('is_enabled', true)
      .not('expo_push_token', 'is', null);

    if (devicesError) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: `Failed to fetch push devices: ${devicesError.message}` 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!pushDevices || pushDevices.length === 0) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: 'No enabled push devices found for this user',
          devicesCount: 0
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Filter to devices with valid tokens
    const validDevices = pushDevices.filter(
      (device: any) => device.expo_push_token && device.expo_push_token.trim().length > 0
    );

    if (validDevices.length === 0) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: 'No valid push tokens found',
          devicesCount: pushDevices.length
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Prepare push messages
    const pushMessages = validDevices.map((device: any) => ({
      to: device.expo_push_token,
      sound: 'default',
      title: 'Test Push',
      body: 'Test push from Off Axis Deals',
      data: {
        type: 'test',
        timestamp: new Date().toISOString(),
      },
    }));

    // Send push via Expo Push API
    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(pushMessages),
    });

    if (!expoResponse.ok) {
      const errorText = await expoResponse.text();
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: `Expo API error: ${expoResponse.status} - ${errorText.substring(0, 200)}`,
          devicesCount: validDevices.length
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const expoData = await expoResponse.json() as { 
      data?: Array<{ status: string; id?: string; message?: string }> 
    };

    // Check results
    if (expoData.data && Array.isArray(expoData.data)) {
      const successCount = expoData.data.filter((r) => r.status === 'ok').length;
      const failureCount = expoData.data.length - successCount;
      const failures = expoData.data
        .filter((r) => r.status !== 'ok')
        .map((r) => r.message || 'Unknown error');

      return new Response(
        JSON.stringify({
          ok: successCount > 0,
          version: WORKER_VERSION,
          devicesCount: validDevices.length,
          successCount,
          failureCount,
          failures: failures.length > 0 ? failures : undefined,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: 'Unexpected response format from Expo API',
        devicesCount: validDevices.length
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: `Exception: ${errorMessage}` 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
