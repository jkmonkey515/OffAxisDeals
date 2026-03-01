import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Get Expo push token for the current device.
 * 
 * Returns null if:
 * - Running in Expo Go (remote push not supported since SDK 53)
 * - Not running on a physical device
 * - Permissions are denied
 * - projectId is missing (dev build)
 * - Any error occurs during token retrieval
 * 
 * Never throws for permission denial or Expo Go; only throws for unexpected errors
 * when not in Expo Go and projectId is available.
 * 
 * @returns Expo push token string, or null if unavailable
 */
export async function getExpoPushTokenOrNull(): Promise<string | null> {
  try {
    // Skip Expo Go (remote push not supported since SDK 53)
    // This check must happen before any dynamic import to prevent red error screen
    if (Constants.appOwnership === 'expo') {
      return null;
    }

    // Check if running on a physical device
    if (!Device.isDevice) {
      return null;
    }

    // Read projectId from EAS config
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

    // If projectId is missing, return null (no throw)
    if (!projectId) {
      return null;
    }

    // Dynamically import expo-notifications only after passing guards
    // This prevents red error screen in Expo Go
    const Notifications = await import('expo-notifications');

    // Configure Android notification channel (required for Android 8.0+)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    // Check current permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;

    // Request permissions if not already granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    // If permission denied, return null (silent no-op)
    if (finalStatus !== 'granted') {
      return null;
    }

    // Get the Expo push token with projectId
    // Wrap in try/catch to handle Firebase initialization errors gracefully
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      return tokenData.data;
    } catch (tokenError) {
      // Handle Firebase initialization errors gracefully
      const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
      if (
        errorMessage.includes('Default FirebaseApp is not initialized') ||
        errorMessage.includes('Make sure to complete the guide')
      ) {
        return null;
      }
      // Re-throw other unexpected errors
      throw tokenError;
    }
  } catch (err) {
    // Only throw for unexpected errors when not in Expo Go and we have projectId
    // Permission denials and Expo Go are handled above and return null
    if (Constants.appOwnership !== 'expo') {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (projectId) {
        throw err;
      }
    }
    // If we're here, we're in Expo Go or missing projectId - return null instead of throwing
    return null;
  }
}
