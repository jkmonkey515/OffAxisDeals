import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage adapter for Supabase using AsyncStorage.
 * 
 * This adapter stores authentication session data using AsyncStorage,
 * which supports larger payloads than SecureStore's 2048 byte limit.
 * 
 * Sessions will persist across app restarts.
 * 
 * Note: This is React Native only and should not be used in SSR/web contexts.
 */
export const secureStorageAdapter = {
  /**
   * Get an item from storage
   */
  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      if (__DEV__) {
        console.error(`Error getting item from storage (${key}):`, error);
      }
      return null;
    }
  },

  /**
   * Set an item in storage
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      if (__DEV__) {
        console.error(`Error setting item in storage (${key}):`, error);
      }
      throw error;
    }
  },

  /**
   * Remove an item from storage
   */
  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      if (__DEV__) {
        console.error(`Error removing item from storage (${key}):`, error);
      }
      throw error;
    }
  },
};

