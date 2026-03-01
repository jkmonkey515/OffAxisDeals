import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabaseClient } from '../lib/supabase';
import TopHeader from '../components/TopHeader';
import type { AppStackParamList } from '../types/navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { markNotificationAsRead, handleNotificationTap } from '../lib/notifications';
import { useAuth } from '../contexts/AuthContext';

interface NotificationsScreenProps {
  navigation: NativeStackNavigationProp<AppStackParamList, 'Notifications'>;
}

interface NotificationRow {
  id: string;
  title: string | null;
  body: string | null;
  created_at: string;
  is_read: boolean | null;
  read_at: string | null;
  type: string | null;
  ref_id: string | null;
  listing_id: string | null;
}

interface Cursor {
  createdAt: string;
  id: string;
}

const PAGE_SIZE = 25;

/**
 * Format relative time for display
 * - < 60m => "Xm"
 * - < 24h => "Xh"
 * - < 7d => "Xd"
 * - Else => "MMM D"
 */
function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function NotificationsScreen(_props: NotificationsScreenProps) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { isPaid } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const cursorRef = useRef<Cursor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Get current user ID
  useEffect(() => {
    supabaseClient.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  // Keep cursor ref in sync with state
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  // Load first page or refresh
  // NOTE: This function ONLY queries notifications - it does NOT mark them as read
  const loadNotifications = useCallback(
    async (isRefresh = false) => {
      if (!userId) {
        setError('Not signed in');
        setLoadingInitial(false);
        setRefreshing(false);
        return;
      }

      try {
        if (isRefresh) {
          setRefreshing(true);
          setCursor(null);
          cursorRef.current = null;
        } else if (notifications.length === 0) {
          setLoadingInitial(true);
        }
        setError(null);

        let query = supabaseClient
          .from('notifications')
          .select('id, title, body, created_at, is_read, read_at, type, ref_id, listing_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(PAGE_SIZE);

        // For pagination, use cursor from ref
        const currentCursor = cursorRef.current;
        if (!isRefresh && currentCursor) {
          query = query.lt('created_at', currentCursor.createdAt);
        }

        const { data, error: queryError } = await query;

        if (queryError) {
          throw new Error(queryError.message);
        }

        if (data) {
          if (isRefresh) {
            setNotifications(data);
            setHasMore(data.length === PAGE_SIZE);
            if (data.length > 0) {
              setCursor({
                createdAt: data[data.length - 1].created_at,
                id: data[data.length - 1].id,
              });
            } else {
              setCursor(null);
            }
          } else {
            setNotifications((prev) => {
              const newItems = [...prev, ...data];
              return newItems;
            });
            setHasMore(data.length === PAGE_SIZE);
            if (data.length > 0) {
              const newCursor = {
                createdAt: data[data.length - 1].created_at,
                id: data[data.length - 1].id,
              };
              setCursor(newCursor);
              cursorRef.current = newCursor;
            } else {
              setCursor(null);
              cursorRef.current = null;
            }
          }
        } else {
          if (isRefresh) {
            setNotifications([]);
            setCursor(null);
            cursorRef.current = null;
          }
          setHasMore(false);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load notifications';
        setError(errorMessage);
        if (isRefresh) {
          setNotifications([]);
          setCursor(null);
          cursorRef.current = null;
        }
      } finally {
        setLoadingInitial(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [userId, notifications.length]
  );

  // Load more (pagination)
  // NOTE: This function ONLY queries notifications - it does NOT mark them as read
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loadingInitial || !userId) {
      return;
    }

    const currentCursor = cursorRef.current;
    if (!currentCursor) {
      return;
    }

    setLoadingMore(true);
    try {
      setError(null);

      const { data, error: queryError } = await supabaseClient
        .from('notifications')
        .select('id, title, body, created_at, is_read, read_at, type, ref_id, listing_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .lt('created_at', currentCursor.createdAt)
        .limit(PAGE_SIZE);

      if (queryError) {
        throw new Error(queryError.message);
      }

      if (data && data.length > 0) {
        setNotifications((prev) => [...prev, ...data]);
        setHasMore(data.length === PAGE_SIZE);
        const newCursor = {
          createdAt: data[data.length - 1].created_at,
          id: data[data.length - 1].id,
        };
        setCursor(newCursor);
        cursorRef.current = newCursor;
      } else {
        setHasMore(false);
        setCursor(null);
        cursorRef.current = null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load more notifications';
      setError(errorMessage);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loadingInitial, userId]);

  // Initial load
  useEffect(() => {
    if (userId) {
      loadNotifications(true);
    }
  }, [userId]);

  // Refresh on focus - ONLY refreshes the list, does NOT mark as read
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        loadNotifications(true);
      }
    }, [userId, loadNotifications])
  );

  const handleRefresh = useCallback(async () => {
    await loadNotifications(true);
  }, [loadNotifications]);

  // Mark a single notification as read ONLY when user taps it
  const handleNotificationPress = useCallback(
    async (notification: NotificationRow) => {
      // DEV: Log notification row shape for debugging
      if (__DEV__) {
        console.log('[Notifications] Tapped notification:', {
          id: notification.id,
          type: notification.type,
          ref_id: notification.ref_id,
          title: notification.title,
          listing_id: notification.listing_id,
          is_read: notification.is_read,
        });
      }

      // Mark as read ONLY when user explicitly taps (optimistic update)
      const wasUnread = notification.is_read !== true;
      
      if (wasUnread) {
        const nowISO = new Date().toISOString();
        
        // Optimistically update UI
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, is_read: true, read_at: nowISO } : n
          )
        );

        // Update in database (fire and forget)
        markNotificationAsRead(notification.id).catch(() => {
          // Silently fail
        });
      }

      // Attempt to navigate based on ref_id and type
      try {
        // Centralized routing for ALL notification tap types.
        await handleNotificationTap({
          payload: {
            type: notification.type,
            ref_id: notification.ref_id,
            listing_id: notification.listing_id,
          },
          isPlus: isPaid === true,
          source: 'in_app',
        });
      } catch (err) {
        // Silently fail navigation - mark as read but don't crash
        if (__DEV__) {
          console.log('[Notifications] Navigation error:', err);
        }
      }
    },
    [navigation, isPaid]
  );

  const renderNotificationItem = ({ item }: { item: NotificationRow }) => {
    const isUnread = item.is_read !== true;
    const timeAgo = formatRelativeTime(item.created_at);
    const title = item.title || 'Notification';

    return (
      <TouchableOpacity
        style={[styles.notificationItem, isUnread && styles.notificationItemUnread]}
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.notificationContent}>
          <View style={styles.notificationTitleRow}>
            <Text
              style={[styles.notificationTitle, isUnread && styles.notificationTitleUnread]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
            {timeAgo ? <Text style={styles.notificationTime}>{timeAgo}</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No notifications yet</Text>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorContainer}>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  };

  if (loadingInitial && notifications.length === 0) {
    return (
      <View style={styles.container}>
        <TopHeader title="Notifications" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </View>
    );
  }

  if (error && notifications.length === 0) {
    return (
      <View style={styles.container}>
        <TopHeader title="Notifications" />
        {renderErrorState()}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopHeader title="Notifications" />

      <FlatList
        data={notifications}
        renderItem={renderNotificationItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          notifications.length === 0 ? styles.emptyListContainer : styles.listContainer
        }
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={renderFooter}
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#007AFF" />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  list: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  emptyListContainer: {
    flex: 1,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  notificationItem: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  notificationItemUnread: {
    backgroundColor: '#f9f9f9',
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '400',
    color: '#000',
    flex: 1,
    marginRight: 8,
  },
  notificationTitleUnread: {
    fontWeight: '700',
  },
  notificationTime: {
    fontSize: 12,
    color: '#999',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
});
