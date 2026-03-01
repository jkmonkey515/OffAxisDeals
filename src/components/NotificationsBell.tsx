import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabaseClient } from '../lib/supabase';

interface NotificationsBellProps {
  onPress: () => void;
}

export default function NotificationsBell({ onPress }: NotificationsBellProps) {
  const navigation = useNavigation();
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const loadUnreadCount = useCallback(async () => {
    try {
      // Get current user ID
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) {
        setUnreadCount(0);
        return;
      }

      // Query for unread notifications for current user only
      // is_read = false OR is_read IS NULL (treats null as unread)
      const { count, error } = await supabaseClient
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or('is_read.eq.false,is_read.is.null');

      if (error) {
        // Silently fail - don't show badge if query fails
        if (__DEV__) {
          console.log('Failed to load unread count:', error.message);
        }
        setUnreadCount(0);
        return;
      }

      setUnreadCount(count ?? 0);
    } catch (err) {
      // Silently fail
      if (__DEV__) {
        console.log('Error loading unread count:', err);
      }
      setUnreadCount(0);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadUnreadCount();
  }, [loadUnreadCount]);

  // Refresh when screen gains focus (useFocusEffect for reliable refresh)
  useFocusEffect(
    useCallback(() => {
      loadUnreadCount();
    }, [loadUnreadCount])
  );

  // Also refresh when navigation focus event fires (backup)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadUnreadCount();
    });

    return unsubscribe;
  }, [navigation, loadUnreadCount]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.bellButton}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <View style={styles.bellContainer}>
        {/* Bell icon using text (Unicode bell character) */}
        <Text style={styles.bellIcon}>🔔</Text>
        {unreadCount > 0 && (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellButton: {
    padding: 10,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellContainer: {
    position: 'relative',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellIcon: {
    fontSize: 22,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
