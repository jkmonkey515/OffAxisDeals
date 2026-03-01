import { Platform } from 'react-native';
import { supabaseClient } from '../lib/supabase';

export type PushPlatform = 'ios' | 'android';

export interface UpsertPushDeviceArgs {
  userId: string;
  platform: PushPlatform;
  expoPushToken: string;
  deviceId: string | null;
  deviceName: string | null;
  appVersion: string | null;
}

export interface MarkDeviceInactiveArgs {
  userId: string;
  expoPushToken?: string;
}

/**
 * Upsert a push device registration for the current user.
 * 
 * Uses the expo_push_token as the conflict resolution key.
 * Updates updated_at (via trigger) and is_enabled on existing records.
 * Idempotent: same user+token updates updated_at.
 * 
 * @param args - Device registration arguments
 * @throws Error with message including 'push_devices upsert failed' on failure
 */
export async function upsertMyPushDevice(args: UpsertPushDeviceArgs): Promise<void> {
  const { userId, platform, expoPushToken, deviceId, deviceName, appVersion } = args;

  try {
    const { error } = await supabaseClient
      .from('push_devices')
      .upsert(
        {
          user_id: userId,
          platform: platform,
          expo_push_token: expoPushToken,
          device_id: deviceId,
          device_name: deviceName,
          app_version: appVersion,
          is_enabled: true,
        },
        {
          onConflict: 'expo_push_token',
        }
      );

    if (error) {
      throw new Error(`push_devices upsert failed: ${error.message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'push_devices upsert failed: Unknown error';
    throw new Error(message);
  }
}

/**
 * Mark push devices as inactive for a user on sign out.
 * 
 * If expoPushToken is provided, marks only that device inactive.
 * Otherwise, marks all devices for the user inactive.
 * 
 * @param args - Device inactivation arguments
 * @throws Error with message including 'push_devices update failed' on failure
 */
export async function markPushDevicesInactive(args: MarkDeviceInactiveArgs): Promise<void> {
  const { userId, expoPushToken } = args;

  try {
    let query = supabaseClient
      .from('push_devices')
      .update({ is_enabled: false })
      .eq('user_id', userId);

    if (expoPushToken) {
      query = query.eq('expo_push_token', expoPushToken);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`push_devices update failed: ${error.message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'push_devices update failed: Unknown error';
    throw new Error(message);
  }
}
