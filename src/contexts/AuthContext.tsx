import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabaseClient } from '../lib/supabase';
import { SUPABASE_URL } from '../config/env';
import type { User, Session } from '@supabase/supabase-js';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { getExpoPushTokenOrNull } from '../lib/push/registerForPush';
import { markPushDevicesInactive, type PushPlatform } from '../services/pushDevices';
import { handleNotificationTap } from '../lib/notifications';

export type UserRole = 'investor' | 'wholesaler' | 'admin';

export interface Profile {
  id: string;
  role: UserRole;
  is_paid?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  role: UserRole | null;
  isPaid: boolean;
  loading: boolean;
  profileLoading: boolean; // True when waiting for profile after signup (retrying)
  error: string | null;
  refreshProfile: () => Promise<void>;
  refreshPushRegistration: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// Module-level map to track push registration attempts per user ID
// Prevents duplicate registrations during account switches
const pushRegistrationAttemptedByUser = new Map<string, boolean>();

// Module-level variable to track user ID for sign-out handling
let currentUserIdForSignOut: string | null = null;

// Module-level map to store last expo push token per user ID
// Used to delete the push_devices row on sign-out to prevent unique constraint violations during account switching
const lastExpoPushTokenByUser = new Map<string, string>();

// Module-level map to track last known push_enabled value per user ID
// Used to detect preference changes and clear registration flag when needed
const lastPushEnabledByUser = new Map<string, boolean>();

// Module-level flag to prevent concurrent push registrations
let registeringRef = false;

// Module-level ref to track last registered token (prevents re-registering same token)
let lastTokenRef: string | null = null;

// Once per app launch: ensure we run push upsert exactly once when session is available
let didRegisterPushThisLaunch = false;

// Auth refresh-storm kill switch: when true, no further refresh/session recovery attempts
const authDisabledRef = { current: false };

// Populated by AuthProvider; allows handleAuthFailure to perform signed-out state reset
const authStateSettersRef: {
  setUser: ((v: User | null) => void) | null;
  setProfile: ((v: Profile | null) => void) | null;
  setLoading: ((v: boolean) => void) | null;
  setError: ((v: string | null) => void) | null;
} = { setUser: null, setProfile: null, setLoading: null, setError: null };

/** Normalize Expo push token for storage (trim, remove all whitespace). */
function normalizeExpoPushToken(token: string): string {
  return token.trim().replace(/\s+/g, '');
}

/**
 * Cleans up persisted auth keys from AsyncStorage.
 * Removes "oad-auth" and any keys containing "auth-token" (legacy default keys).
 */
async function cleanupAuthStorage(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter(
      (k) => k.includes('auth-token') || k === 'oad-auth'
    );
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      if (__DEV__) {
        console.log('[Auth] Cleaned up auth storage keys:', keysToRemove);
      }
    }
  } catch (err) {
    // Fail silently - log only in DEV
    if (__DEV__) {
      console.error('[Auth] Failed to cleanup auth storage:', err);
    }
  }
}

/**
 * Checks if an error is an auth failure (refresh token, JWT, HTTP auth errors, rate limit, network).
 */
function isRefreshTokenError(error: any): boolean {
  const errorMessage = (error?.message || error?.toString() || '').toLowerCase();
  return (
    errorMessage.includes('invalid refresh token') ||
    errorMessage.includes('refresh token not found') ||
    errorMessage.includes('invalid_grant') ||
    errorMessage.includes('jwt expired') ||
    errorMessage.includes('jwt is expired') ||
    errorMessage.includes('token has expired') ||
    errorMessage.includes('401') ||
    errorMessage.includes('403') ||
    errorMessage.includes('429') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('failed to fetch') ||
    errorMessage.includes('network request failed')
  );
}

/**
 * Auth failure kill switch: stops auto-refresh, signs out locally, cleans storage, resets state.
 * Prevents refresh storms and error overlays.
 * When authDisabledRef.current is true, still performs signed-out reset and returns (idempotent).
 */
async function handleAuthFailure(reason: string, error?: unknown): Promise<void> {
  const performSignedOutReset = () => {
    authStateSettersRef.setUser?.(null);
    authStateSettersRef.setProfile?.(null);
    authStateSettersRef.setLoading?.(false);
    authStateSettersRef.setError?.(null);
    currentUserIdForSignOut = null;
  };

  if (authDisabledRef.current) {
    performSignedOutReset();
    return;
  }
  authDisabledRef.current = true;
  try {
    supabaseClient.auth.stopAutoRefresh();
  } catch {
    // ignore
  }
  try {
    await supabaseClient.auth.signOut({ scope: 'local' });
  } catch {
    // ignore
  }
  try {
    await cleanupAuthStorage();
  } catch {
    // ignore
  }
  if (__DEV__) {
    const errMsg = error != null ? (typeof (error as any).message === 'string' ? (error as any).message : String(error)) : '';
    console.log('[Auth] Auth failure:', reason, errMsg || '(no error object)');
  }
  performSignedOutReset();
}

/**
 * Determines if automatic push registration should proceed.
 * 
 * Reads explicit feature flag from app config.
 * Defaults to false (disabled) until explicitly enabled.
 * 
 * @returns true if auto-registration should proceed, false otherwise
 */
function shouldAutoRegisterPush(): boolean {
  return Constants.expoConfig?.extra?.pushAutoEnabled === true;
}

/**
 * Sends welcome email for new signups (fire-and-forget).
 * Only sends for 'investor' or 'wholesaler' roles.
 * Endpoint is idempotent and will no-op if already delivered.
 * 
 * @param userId - User ID
 * @param role - User role ('investor' or 'wholesaler')
 */
async function sendWelcomeEmailIfNeeded(userId: string, role: UserRole | null): Promise<void> {
  // Only send for investor or wholesaler roles
  if (role !== 'investor' && role !== 'wholesaler') {
    return;
  }

  // Fire-and-forget: don't block UI
  fetch('https://www.offaxisdeals.com/api/welcome-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, role }),
  }).catch((err) => {
    // Log only in DEV on failure
    if (__DEV__) {
      console.error('[Welcome Email] Failed to send:', err);
    }
  });
}

/**
 * Internal function to register push device if enabled.
 * Called after SIGNED_IN events or after profile load.
 * 
 * Fails silently if permissions denied, token fetch fails, no valid session, or push_enabled is false.
 * Logs only in DEV mode.
 * 
 * IMPORTANT: This function checks notification_preferences.push_enabled to determine if push should be enabled.
 * Only explicit false disables push; null/undefined are treated as enabled.
 * Device deactivation happens only on explicit user toggle OFF or sign out, not here.
 * Registration is idempotent: disables any existing row for the token, then upserts keyed by expo_push_token.
 */
async function registerPushIfEnabled(): Promise<void> {
  console.log('[PUSH] registerPushIfEnabled CALLED');

  // Guard: prevent concurrent registrations
  if (registeringRef) {
    console.log('[PUSH] SKIP: concurrent registration in progress');
    return;
  }

  // Check feature flag
  if (!shouldAutoRegisterPush()) {
    console.log('[PUSH] SKIP: pushAutoEnabled is false');
    return;
  }

  // STEP 1A: Verify authenticated user exists
  const { data: userRes, error: userError } = await supabaseClient.auth.getUser();
  
  if (userError || !userRes.user?.id) {
    console.log('[PUSH] SKIP: no authenticated user');
    return;
  }

  const authedUserId = userRes.user.id;

  // STEP 1B: Check notification_preferences.push_enabled
  const { data: prefsRow, error: prefsError } = await supabaseClient
    .from('notification_preferences')
    .select('push_enabled')
    .eq('user_id', authedUserId)
    .maybeSingle();

  if (prefsError) {
    console.log('[PUSH] SKIP: preferences query error');
    return;
  }

  // Only explicit false disables push; null/undefined continue to registration
  if (prefsRow?.push_enabled === false) {
    console.log('[PUSH] SKIP: push_enabled is false');
    return;
  }

  const currentPushEnabled = prefsRow?.push_enabled === true;
  const lastPushEnabled = lastPushEnabledByUser.get(authedUserId);

  // If push_enabled changed from false to true, clear registration flag to allow re-registration
  if (lastPushEnabled === false && currentPushEnabled === true) {
    if (__DEV__) {
      console.log('[Push] Push enabled in preferences, clearing registration flag');
    }
    pushRegistrationAttemptedByUser.delete(authedUserId);
  }

  // Guard: only attempt once per user per boot (scoped to user ID for account switching)
  // This flag is cleared when push_enabled changes
  if (pushRegistrationAttemptedByUser.get(authedUserId) === true) {
    console.log('[PUSH] SKIP: already attempted for this user this session');
    lastPushEnabledByUser.set(authedUserId, currentPushEnabled);
    return;
  }

  // Guard: run push upsert only once per app launch so we guarantee one write and updated_at refresh
  if (didRegisterPushThisLaunch) {
    console.log('[PUSH] SKIP: already registered this launch');
    return;
  }

  // Store current push_enabled value
  lastPushEnabledByUser.set(authedUserId, currentPushEnabled);

  // Mark as attempted for this user (before token fetch to prevent retries on token errors)
  pushRegistrationAttemptedByUser.set(authedUserId, true);

  // Set registering flag to prevent concurrent registrations
  registeringRef = true;

  let tokenForCatch = '';
  let platformForCatch: PushPlatform = 'android';

  try {
    // Get Expo push token (returns null if permission denied or not on physical device)
    const rawToken = await getExpoPushTokenOrNull();

    if (!rawToken) {
      console.log('[PUSH] SKIP: no token (permission denied or not physical device)');
      return;
    }

    const expoPushToken = normalizeExpoPushToken(rawToken);
    if (!expoPushToken) {
      console.log('[PUSH] SKIP: token empty after normalize');
      return;
    }

    if (__DEV__) {
      console.log('[Push] token normalized', { tokenLen: expoPushToken.length, userId: authedUserId });
    }

    // Store token for sign-out cleanup
    lastTokenRef = expoPushToken;

    // Determine platform
    const platform: PushPlatform = Platform.OS === 'ios' ? 'ios' : 'android';
    platformForCatch = platform;
    tokenForCatch = expoPushToken;

    // Guard: skip if we already successfully registered this exact token for this user this session
    if (lastExpoPushTokenByUser.get(authedUserId) === expoPushToken) {
      if (__DEV__) console.log('[Push] SKIP: same token already registered for this user this session');
      return;
    }

    // Get device metadata
    const deviceName = Device.deviceName ?? null;
    const appVersion: string | null = Application.nativeApplicationVersion ?? null;
    let deviceId: string | null = null;
    try {
      if (Platform.OS === 'android') {
        try {
          deviceId = Application.getAndroidId() ?? null;
        } catch {
          deviceId = null;
        }
      } else if (Platform.OS === 'ios') {
        const iosId = await Application.getIosIdForVendorAsync();
        deviceId = iosId ?? null;
      }
    } catch (err) {
      if (__DEV__) {
        console.error('[Push] Device ID retrieval failed:', err);
      }
    }

    const nowISO = new Date().toISOString();

    const updatePayload = {
      user_id: authedUserId,
      platform,
      is_enabled: true,
      device_id: deviceId,
      device_name: deviceName,
      app_version: appVersion,
      last_seen_at: nowISO,
      updated_at: nowISO,
    };

    if (__DEV__) {
      console.log('[Push] register start', {
        userId: authedUserId,
        supabaseHost: (() => {
          try {
            return new URL(SUPABASE_URL).host;
          } catch {
            return 'bad_url';
          }
        })(),
        platform,
        nowISO,
      });
    }

    const { data: sessData, error: sessErr } = await supabaseClient.auth.getSession();
    if (__DEV__) {
      console.log('[Push] auth probe', {
        sessErr: sessErr?.message ?? null,
        hasAccessToken: !!sessData?.session?.access_token,
      });
    }

    // STEP 1: Disable any existing row with this token (avoids unique constraint on enabled token)
    const { error: disableErr } = await supabaseClient
      .from('push_devices')
      .update({ is_enabled: false })
      .eq('expo_push_token', expoPushToken)
      .eq('is_enabled', true);

    if (disableErr && __DEV__) {
      console.log('[Push] disable-by-token (non-fatal)', disableErr.message);
    }

    // STEP 1B: Dedupe rows for same user+token to prevent push_devices_user_id_expo_push_token_key violation
    const { data: dupRows } = await supabaseClient
      .from('push_devices')
      .select('id, platform, device_id, is_enabled')
      .eq('user_id', authedUserId)
      .eq('expo_push_token', expoPushToken);

    let keepRowFromDedup: { id: string } | undefined;
    if (dupRows && dupRows.length > 0) {
      const keepRow = deviceId != null
        ? dupRows.find((r) => r.device_id === deviceId) ??
          dupRows.find((r) => r.device_id != null) ??
          dupRows[0]
        : dupRows[0];
      keepRowFromDedup = keepRow ? { id: keepRow.id } : undefined;
      const idsToDelete = dupRows
        .filter((r) => r.id !== keepRow?.id)
        .map((r) => r.id);
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabaseClient
          .from('push_devices')
          .delete()
          .in('id', idsToDelete);
        if (deleteError) {
          if (__DEV__) {
            console.log('[Push] dedup delete failed', deleteError.message);
          }
          console.log('[PUSH] SKIP: dedup delete failed, skipping write to avoid unique violation');
          return;
        }
        if (__DEV__) {
          console.log('[Push] dedup user+token rows with', {
            deletedCount: idsToDelete.length,
            platform,
          });
        }
      }
    }

    // Determine target row for STEP 2A: by id when possible, else by (user_id, platform)
    let targetPushDeviceId: string | undefined = keepRowFromDedup?.id;
    if (targetPushDeviceId == null) {
      const { data: userRows } = await supabaseClient
        .from('push_devices')
        .select('id, device_id, platform')
        .eq('user_id', authedUserId);
      const preferred = (userRows ?? []).find(
        (r) => r.platform === platform || (deviceId != null && r.device_id === deviceId)
      ) ?? userRows?.[0];
      targetPushDeviceId = preferred?.id;
    }

    const baseWrite = {
      expo_push_token: expoPushToken,
      is_enabled: true,
      updated_at: nowISO,
      app_version: appVersion,
      last_seen_at: nowISO,
      platform,
    };
    const insertPayload = {
      user_id: authedUserId,
      platform,
      expo_push_token: expoPushToken,
      is_enabled: true,
      updated_at: nowISO,
      device_id: deviceId,
      device_name: deviceName,
      app_version: appVersion,
      last_seen_at: nowISO,
    };

    let updRows: { id: string }[] | null = null;
    let updErr: { message: string } | null = null;
    if (targetPushDeviceId != null) {
      const res = await supabaseClient
        .from('push_devices')
        .update(baseWrite)
        .eq('id', targetPushDeviceId)
        .select('id');
      updRows = res.data ?? null;
      updErr = res.error;
    } else {
      const res = await supabaseClient
        .from('push_devices')
        .update(baseWrite)
        .eq('user_id', authedUserId)
        .eq('platform', platform)
        .select('id');
      updRows = res.data ?? null;
      updErr = res.error;
    }

    if (updErr) {
      if (__DEV__) throw new Error(`[Push] update failed: ${updErr.message}`);
      console.log('[PUSH] SKIP: push_devices update failed', updErr.message);
      return;
    }

    let writeOk = Array.isArray(updRows) && updRows.length > 0;

    // STEP 2B: Insert fallback if no row matched
    if (!writeOk) {
      // Avoid unique violation: if a row already exists for (user_id, expo_push_token), update it instead of insert
      const { data: existingByToken } = await supabaseClient
        .from('push_devices')
        .select('id')
        .eq('user_id', authedUserId)
        .eq('expo_push_token', expoPushToken);
      if (existingByToken && existingByToken.length > 0) {
        const { error: updateByTokenErr } = await supabaseClient
          .from('push_devices')
          .update(baseWrite)
          .eq('id', existingByToken[0].id);
        if (!updateByTokenErr) {
          writeOk = true;
        }
      }
      if (!writeOk) {
        const { data: insData, error: insErr } = await supabaseClient
          .from('push_devices')
          .insert(insertPayload)
          .select('id, user_id, platform, expo_push_token, updated_at')
          .maybeSingle();

        if (insErr) {
          const isUserDeviceIdUnique = insErr.message?.includes('idx_push_devices_user_id_device_id_unique') ?? false;
        if (isUserDeviceIdUnique && deviceId != null) {
          if (__DEV__) console.log('[Push] insert dup user+device_id; updating by device_id');
          const { data: fallbackRows, error: fallbackErr } = await supabaseClient
            .from('push_devices')
            .update(baseWrite)
            .eq('user_id', authedUserId)
            .eq('device_id', deviceId)
            .select('id');
          if (!fallbackErr && Array.isArray(fallbackRows) && fallbackRows.length > 0) {
            writeOk = true;
          } else {
            if (__DEV__) throw new Error(`[Push] insert failed: ${insErr.message}`);
            console.log('[PUSH] SKIP: push_devices insert failed', insErr.message);
            return;
          }
        } else {
          if (__DEV__) throw new Error(`[Push] insert failed: ${insErr.message}`);
          console.log('[PUSH] SKIP: push_devices insert failed', insErr.message);
          return;
        }
      } else if (!insData) {
        if (__DEV__) throw new Error('[Push] insert returned no row');
        console.log('[PUSH] SKIP: push_devices insert returned no row');
        return;
      } else {
        writeOk = true;
      }
      }
    }

    didRegisterPushThisLaunch = true;
    lastExpoPushTokenByUser.set(authedUserId, expoPushToken);
    if (__DEV__) {
      console.log('[Push] register ok', { tokenLen: expoPushToken.length, userId: authedUserId, platform });
    }
  } catch (err) {
    if (__DEV__) {
      console.log('[Push] register failed', {
        userId: authedUserId,
        platform: platformForCatch,
        tokenLen: tokenForCatch.length,
      });
      console.error('[Push] Registration failed:', err);
      throw err;
    }
  } finally {
    // Always reset registering flag
    registeringRef = false;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false); // Waiting for profile after signup
  const [error, setError] = useState<string | null>(null);
  const profileRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const profileRetryCountRef = useRef<number>(0);
  const profileRetryLogDedupeRef = useRef<boolean>(false);
  const pushTapPendingPayloadRef = useRef<unknown | null>(null);
  const authReadyRef = useRef<boolean>(false);
  const isPlusRef = useRef<boolean>(false);
  const lastHandledPushTapIdRef = useRef<string | null>(null);
  const welcomeEmailSentRef = useRef<Set<string>>(new Set());
  const pushAutoRegistrationTriggeredForRef = useRef<string | null>(null);

  /**
   * Refresh push registration by clearing guards and re-evaluating push_enabled preference.
   * Called when user toggles push_enabled in notification settings.
   */
  const refreshPushRegistration = async (): Promise<void> => {
    try {
      // Get current user ID
      const { data: userRes } = await supabaseClient.auth.getUser();
      if (!userRes?.user?.id) {
        if (__DEV__) {
          console.log('[Push] Refresh skipped (no authenticated user)');
        }
        return;
      }

      const authedUserId = userRes.user.id;

      // Clear "already registered" guard to allow re-registration
      pushRegistrationAttemptedByUser.delete(authedUserId);

      // Reset last-known push_enabled tracker so it re-evaluates
      lastPushEnabledByUser.delete(authedUserId);

      // Re-evaluate and register/disable push based on current preference
      await registerPushIfEnabled();
    } catch (err) {
      // Fail silently - log only in DEV
      if (__DEV__) {
        console.error('[Push] Refresh failed:', err);
      }
    }
  };

  /**
   * Fetches profile with retry logic for missing profile after signup.
   * Uses maybeSingle() to avoid PostgREST errors when profile doesn't exist yet.
   * 
   * @param userId - User ID to fetch profile for
   * @param isRetry - Whether this is a retry attempt (affects logging)
   * @returns Profile if found, null if not found (will trigger retry)
   * @throws Error only for real database errors (not "not found")
   */
  const fetchProfile = async (userId: string, isRetry = false): Promise<Profile | null> => {
    // First attempt: try to fetch with is_paid column using maybeSingle()
    let { data: existingProfile, error: fetchError } = await supabaseClient
      .from('profiles')
      .select('id, role, is_paid')
      .eq('id', userId)
      .maybeSingle();

    // If column not found error, fallback to selecting only role
    if (fetchError && (fetchError.message.includes('column') || fetchError.message.includes('does not exist'))) {
      const { data: fallbackProfile, error: fallbackError } = await supabaseClient
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();

      if (fallbackError) {
        // Real error (not just column missing or not found)
        if (!fallbackError.message.includes('No rows') && !fallbackError.message.includes('PGRST116')) {
          throw new Error(fallbackError.message);
        }
        // Profile not found - return null (will trigger retry)
        return null;
      }

      if (fallbackProfile) {
        // Return profile with is_paid defaulted to false
        return {
          ...fallbackProfile,
          is_paid: false,
        } as Profile;
      }

      // Profile not found - return null (will trigger retry)
      return null;
    } else if (fetchError) {
      // Real error (not just "not found")
      if (!fetchError.message.includes('No rows') && !fetchError.message.includes('PGRST116')) {
        throw new Error(fetchError.message);
      }
      // Profile not found - return null (will trigger retry)
      return null;
    } else if (existingProfile) {
      // Profile exists with is_paid column
      return existingProfile as Profile;
    }

    // Profile not found - return null (will trigger retry)
    return null;
  };

  /**
   * Checks for duplicate profiles (diagnostics).
   * Only called in debug mode when profile is missing.
   */
  const checkForDuplicateProfiles = async (userId: string): Promise<void> => {
    if (!__DEV__) return;

    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId);

      if (error) {
        if (__DEV__) {
          console.error('[Profile] Error checking for duplicates:', error);
        }
        return;
      }

      if (data && data.length > 1) {
        console.error(`[Profile] duplicate rows for user_id: ${userId} (${data.length} rows found)`);
      }
    } catch (err) {
      // Fail silently - diagnostics only
      if (__DEV__) {
        console.error('[Profile] Error in duplicate check:', err);
      }
    }
  };

  /**
   * Retries profile fetch with exponential backoff.
   * Used when profile is missing after signup (waiting for trigger to create it).
   */
  const retryProfileFetch = async (userId: string, attempt: number, maxAttempts: number): Promise<void> => {
    if (attempt > maxAttempts) {
      // Max retries reached - stop retrying, show error state
      setProfileLoading(false);
      profileRetryCountRef.current = 0;
      profileRetryLogDedupeRef.current = false;
      return;
    }

    // Wait before retry (400ms delay)
    await new Promise(resolve => setTimeout(resolve, 400));

    try {
      const userProfile = await fetchProfile(userId, true);
      
      if (userProfile) {
        // Profile found! Stop retrying
        setProfile(userProfile);
        setProfileLoading(false);
        setError(null);
        profileRetryCountRef.current = 0;
        profileRetryLogDedupeRef.current = false;
        return;
      }

      // Profile still not found - continue retrying
      profileRetryCountRef.current = attempt + 1;
      
      // Retry again
      if (attempt < maxAttempts) {
        profileRetryTimeoutRef.current = setTimeout(() => {
          retryProfileFetch(userId, attempt + 1, maxAttempts);
        }, 0);
      } else {
        // Max attempts reached in initial retry loop
        // Start background retry (every 2s, max 30s)
        startBackgroundProfileRetry(userId);
      }
    } catch (err) {
      // Real error (not just "not found")
      const errorMessage = err instanceof Error ? err.message : 'Failed to load profile';
      if (__DEV__) {
        console.error('[Profile] Error in retry:', errorMessage);
      }
      setError(errorMessage);
      setProfileLoading(false);
      profileRetryCountRef.current = 0;
      profileRetryLogDedupeRef.current = false;
    }
  };

  /**
   * Background retry loop: retries every 2s for up to 30s after initial retries fail.
   * Shows "Finishing account setup..." state during this time.
   */
  const startBackgroundProfileRetry = (userId: string): void => {
    const startTime = Date.now();
    const maxDuration = 30000; // 30 seconds
    const retryInterval = 2000; // 2 seconds

    const backgroundRetry = async (): Promise<void> => {
      if (Date.now() - startTime > maxDuration) {
        // 30s elapsed - stop retrying, show "Tap to retry" state
        setProfileLoading(false);
        profileRetryCountRef.current = 0;
        profileRetryLogDedupeRef.current = false;
        return;
      }

      try {
        const userProfile = await fetchProfile(userId, true);
        
        if (userProfile) {
          // Profile found! Stop retrying
          setProfile(userProfile);
          setProfileLoading(false);
          setError(null);
          profileRetryCountRef.current = 0;
          profileRetryLogDedupeRef.current = false;
          return;
        }

        // Profile still not found - retry again in 2s
        profileRetryTimeoutRef.current = setTimeout(backgroundRetry, retryInterval);
      } catch (err) {
        // Real error - stop retrying
        const errorMessage = err instanceof Error ? err.message : 'Failed to load profile';
        if (__DEV__) {
          console.error('[Profile] Error in background retry:', errorMessage);
        }
        setError(errorMessage);
        setProfileLoading(false);
        profileRetryCountRef.current = 0;
        profileRetryLogDedupeRef.current = false;
      }
    };

    // Start background retry
    profileRetryTimeoutRef.current = setTimeout(backgroundRetry, retryInterval);
  };

  const loadProfile = async (session: Session | null) => {
    // Clear any existing retry timeouts
    if (profileRetryTimeoutRef.current) {
      clearTimeout(profileRetryTimeoutRef.current);
      profileRetryTimeoutRef.current = null;
    }
    profileRetryCountRef.current = 0;
    profileRetryLogDedupeRef.current = false;

    if (!session?.user) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      setProfileLoading(false);
      setError(null);
      // Clear user ID tracking on sign out
      currentUserIdForSignOut = null;
      return;
    }

    setUser(session.user);
    // Track user ID for sign-out handling
    currentUserIdForSignOut = session.user.id;
    setError(null);

    try {
      const userProfile = await fetchProfile(session.user.id, false);
      
      if (userProfile) {
        // Profile found immediately
        setProfile(userProfile);
        setProfileLoading(false);
      } else {
        // Profile not found - likely just after signup, start retry loop
        setProfile(null);
        setProfileLoading(true);
        
        // Log once (dedupe)
        if (!profileRetryLogDedupeRef.current) {
          if (__DEV__) {
            console.log('[Profile] profile missing after signup; retrying...');
          }
          profileRetryLogDedupeRef.current = true;
        }

        // Check for duplicates (diagnostics, dev only)
        await checkForDuplicateProfiles(session.user.id);

        // Start retry loop: 6 attempts with 400ms delay (~2.5s total)
        profileRetryCountRef.current = 1;
        profileRetryTimeoutRef.current = setTimeout(() => {
          retryProfileFetch(session.user.id, 1, 6);
        }, 400);
      }
    } catch (err) {
      // Real error (not just "not found")
      const errorMessage = err instanceof Error ? err.message : 'Failed to load profile';
      if (__DEV__) {
        console.error('[Profile] Error loading profile:', errorMessage);
      }
      setError(errorMessage);
      setProfile(null);
      setProfileLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const userProfile = await fetchProfile(user.id, false);
      if (userProfile) {
        setProfile(userProfile);
        setError(null);
        setProfileLoading(false);
      } else {
        // Profile still missing - start retry
        setProfileLoading(true);
        profileRetryCountRef.current = 1;
        profileRetryTimeoutRef.current = setTimeout(() => {
          retryProfileFetch(user.id, 1, 6);
        }, 400);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh profile';
      if (__DEV__) {
        console.error('[Profile] Error refreshing profile:', err);
      }
      setError(errorMessage);
      setProfileLoading(false);
    } finally {
      setLoading(false);
    }
  };

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (profileRetryTimeoutRef.current) {
        clearTimeout(profileRetryTimeoutRef.current);
      }
    };
  }, []);

  // Send welcome email when profile is loaded with valid role
  useEffect(() => {
    // Clear tracking when user signs out (user becomes null)
    if (!user) {
      // Keep the set for now - we only want to send once per user ever
      // The endpoint is idempotent, so it's safe to keep tracking persistent
      return;
    }

    if (!user.id || !profile?.role) {
      return;
    }

    // Only send for investor or wholesaler roles
    if (profile.role !== 'investor' && profile.role !== 'wholesaler') {
      return;
    }

    // Check if we've already sent welcome email for this user
    if (welcomeEmailSentRef.current.has(user.id)) {
      return;
    }

    // Mark as sent and trigger welcome email (fire-and-forget)
    welcomeEmailSentRef.current.add(user.id);
    sendWelcomeEmailIfNeeded(user.id, profile.role);
  }, [user?.id, profile?.role]);

  // Push auto-registration: run once per app launch when user.id is available (SIGNED_IN / session start).
  useEffect(() => {
    if (!user?.id) {
      pushAutoRegistrationTriggeredForRef.current = null;
      return;
    }
    if (pushAutoRegistrationTriggeredForRef.current === user.id) return;
    pushAutoRegistrationTriggeredForRef.current = user.id;
    registerPushIfEnabled();
  }, [user?.id]);

  // Keep auth readiness + Plus status in refs for push tap handler usage.
  useEffect(() => {
    const ready = loading === false && profileLoading === false;
    authReadyRef.current = ready;
    isPlusRef.current = profile?.is_paid === true;

    // If we deferred a push tap until auth was ready, process it now.
    if (ready && pushTapPendingPayloadRef.current) {
      const payload = pushTapPendingPayloadRef.current;
      pushTapPendingPayloadRef.current = null;
      handleNotificationTap({ payload, isPlus: isPlusRef.current, source: 'push' }).catch(() => {
        // Never crash on a tap.
      });
    }
  }, [loading, profileLoading, profile?.is_paid]);

  // Push notification tap routing (cold start + background taps).
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    const safeHandleResponse = (response: any) => {
      try {
        const identifier: string | null =
          response?.notification?.request?.identifier ??
          response?.notification?.request?.content?.data?.notificationId ??
          null;

        // Dedupe: avoid double-processing the same tap (common on cold start).
        if (identifier && lastHandledPushTapIdRef.current === identifier) {
          return;
        }
        if (identifier) {
          lastHandledPushTapIdRef.current = identifier;
        }

        const payload = response?.notification?.request?.content?.data ?? {};

        if (!authReadyRef.current) {
          pushTapPendingPayloadRef.current = payload;
          return;
        }

        handleNotificationTap({ payload, isPlus: isPlusRef.current, source: 'push' }).catch(() => {
          // Never crash on a tap.
        });
      } catch {
        // Never crash on a tap.
      }
    };

    (async () => {
      try {
        // Skip Expo Go (remote push not supported and importing can trigger red screen).
        if (Constants.appOwnership === 'expo') {
          return;
        }

        const Notifications = await import('expo-notifications');
        if (cancelled) return;

        // Handle cold-start tap (if any).
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (cancelled) return;
        if (lastResponse) {
          safeHandleResponse(lastResponse);
        }

        // Handle background/foreground taps.
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          safeHandleResponse(response);
        });
      } catch {
        // Never crash on notification wiring issues.
      }
    })();

    return () => {
      cancelled = true;
      try {
        subscription?.remove();
      } catch {
        // ignore
      }
    };
  }, []);


  useEffect(() => {
    authStateSettersRef.setUser = setUser;
    authStateSettersRef.setProfile = setProfile;
    authStateSettersRef.setLoading = setLoading;
    authStateSettersRef.setError = setError;

    // Initial session check with refresh token error recovery
    supabaseClient.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error && isRefreshTokenError(error)) {
          void handleAuthFailure('getSession', error);
          return;
        }
        loadProfile(session);
      })
      .catch((err) => {
        if (isRefreshTokenError(err)) {
          void handleAuthFailure('getSession catch', err);
        } else {
          // Other errors - log but don't crash
          if (__DEV__) {
            console.error('[Auth] Error getting session:', err);
          }
          setLoading(false);
        }
      });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      // Check for refresh token errors in the event data
      // Note: Supabase may pass errors through the session parameter or event
      if (event === 'TOKEN_REFRESHED' && !session) {
        await handleAuthFailure('TOKEN_REFRESHED');
        return;
      }
      
      // Capture user ID before loadProfile clears it on sign out
      const userIdBeforeUpdate = currentUserIdForSignOut;
      
      try {
        loadProfile(session);
      } catch (err) {
        if (isRefreshTokenError(err)) {
          await handleAuthFailure('onAuthStateChange loadProfile', err);
          return;
        }
        // Other errors - log but don't crash
        if (__DEV__) {
          console.error('[Auth] Error in onAuthStateChange:', err);
        }
      }
      
      // On SIGNED_IN, clear previous user's registration flag to allow new user registration
      // (handles account switching). Push auto-registration runs via useEffect when user.id is set.
      if (event === 'SIGNED_IN' && session?.user) {
        pushRegistrationAttemptedByUser.clear();
      }
      
      // Mark devices inactive and delete push_devices row on SIGNED_OUT event
      if (event === 'SIGNED_OUT') {
        // Use the user ID captured before session was cleared
        if (userIdBeforeUpdate) {
          // Get the last known expo push token for this user
          const lastExpoPushToken = lastExpoPushTokenByUser.get(userIdBeforeUpdate);

          // Mark devices inactive
          markPushDevicesInactive({ userId: userIdBeforeUpdate }).catch((err) => {
            // Fail silently - log only in DEV
            if (__DEV__) {
              console.error('[Push] Failed to mark devices inactive on sign out:', err);
            }
          });

          // Delete the push_devices row for this user + token to prevent unique constraint violations during account switching
          if (lastExpoPushToken) {
            supabaseClient
              .from('push_devices')
              .delete()
              .eq('user_id', userIdBeforeUpdate)
              .eq('expo_push_token', lastExpoPushToken)
              .then(({ error: deleteError }) => {
                if (deleteError) {
                  // Fail silently - log only in DEV
                  if (__DEV__) {
                    console.error('[Push] Failed to delete push device on sign out:', deleteError);
                  }
                } else if (__DEV__) {
                  console.log('[Push] Deleted push device on sign out');
                }
              });
          }
        }
        // Clear registration flags and token tracking on sign out to allow re-registration on next sign-in
        pushRegistrationAttemptedByUser.clear();
        lastExpoPushTokenByUser.clear();
        lastPushEnabledByUser.clear();
        registeringRef = false;
        lastTokenRef = null;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const value: AuthContextType = {
    user,
    profile,
    // Role comes ONLY from profile.role - no fallback to metadata
    // Ensure it's null (not string "null") when profile is missing
    role: profile?.role ?? null,
    isPaid: profile?.is_paid ?? false,
    loading,
    profileLoading,
    error,
    refreshProfile,
    refreshPushRegistration,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
