import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, NavigationProp, useFocusEffect } from '@react-navigation/native';
import { supabaseClient } from '../lib/supabase';
import { useProfileWithPermissions } from '../permissions/permissions';
import { useUnreadMessages } from '../contexts/UnreadMessagesContext';
import { MessagingDisclaimer } from '../components/ComplianceText';
import { qalog, qaError } from '../utils/qalog';
import type { MessagesStackParamList } from '../types/navigation';
import { colors, spacing, typography } from '../theme';

// TypeScript type for RPC response matching get_conversations_inbox() return shape (staging schema)
interface ConversationInboxRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  created_at: string;
  listing_title: string | null;
  other_participant_id: string;
  other_full_name: string | null;
  last_message_body: string | null;
  last_message_created_at: string | null;
  unread_count: number;
}

export default function MessagingScreen() {
  const { profile, permissions } = useProfileWithPermissions();
  const navigation = useNavigation<NavigationProp<MessagesStackParamList, 'MessagesHome'>>();
  const { refresh: refreshUnreadCount } = useUnreadMessages();
  const [conversations, setConversations] = useState<ConversationInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = profile?.id;
  const refreshDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const loadConversations = useCallback(async () => {
    if (!currentUserId) {
      return;
    }

    try {
      setError(null);
      setLoading(true);

      // Call RPC to get enriched conversation data in a single query
      const { data, error: rpcError } = await supabaseClient.rpc('get_conversations_inbox');

      if (rpcError) {
        qaError('load conversations failed', rpcError);
        setError(rpcError.message);
        setConversations([]);
        return;
      }

      // RPC already returns sorted data (by last_message_created_at DESC, then created_at DESC)
      setConversations((data ?? []) as ConversationInboxRow[]);

      qalog('conversations loaded', {
        count: (data ?? []).length,
        conversationIds: (data ?? []).map((c: ConversationInboxRow) => c.id),
      });
    } catch (err) {
      qaError('load conversations exception', err);
      const message = err instanceof Error ? err.message : 'Failed to load conversations';
      setError(message);
      setConversations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  // Refresh conversations and unread count when screen is focused
  useFocusEffect(
    useCallback(() => {
      loadConversations();
      refreshUnreadCount();
    }, [loadConversations, refreshUnreadCount])
  );

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    loadConversations();
  }, [currentUserId, loadConversations]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    // Subscribe to new message inserts
    // On INSERT that involves current user, debounce-refresh by calling RPC + refreshUnreadCount()
    const messagesSubscription = supabaseClient
      .channel('messages_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          // Staging schema: conversation_id, sender_id, to_id, created_at, body
          const newMessage = payload.new as {
            id: string;
            conversation_id: string;
            sender_id: string | null;
            to_id: string | null;
            body: string;
            created_at: string;
          };

          // Check if message involves current user
          const involvesUser =
            newMessage.to_id === currentUserId || newMessage.sender_id === currentUserId;

          if (involvesUser) {
            // Debounce refresh to avoid spam from rapid inserts
            if (refreshDebounceRef.current) {
              clearTimeout(refreshDebounceRef.current);
            }
            refreshDebounceRef.current = setTimeout(() => {
              loadConversations();
              refreshUnreadCount();
            }, 400);
          }
        }
      )
      .subscribe();

    qalog('messages subscription active', {
      conversationCount: conversations.length,
    });

    return () => {
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }
      messagesSubscription.unsubscribe();
      qalog('messages subscription unsubscribed');
    };
  }, [currentUserId, loadConversations, refreshUnreadCount]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    await refreshUnreadCount();
  }, [loadConversations, refreshUnreadCount]);

  const handleConversationPress = (conversation: ConversationInboxRow) => {
    navigation.navigate('Conversation', {
      conversationId: conversation.id,
      listingId: conversation.listing_id,
    });
  };

  const formatTime = (timestamp: string | null | undefined): string => {
    if (!timestamp) {
      return '';
    }

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffMins < 1440) {
      return `${Math.floor(diffMins / 60)}h ago`;
    }
    return date.toLocaleDateString();
  };

  const renderConversationItem = ({ item }: { item: ConversationInboxRow }) => {
    const displayName = item.other_full_name ?? 'Unknown User';
    const listingTitle = item.listing_title ?? 'Untitled Listing';
    const lastMessage = item.last_message_body ?? 'No messages yet';
    const timeText = formatTime(item.last_message_created_at);
    const unreadCount = item.unread_count || 0;
    const hasUnread = unreadCount > 0;
    const badgeText = unreadCount > 99 ? '99+' : unreadCount.toString();

    return (
      <TouchableOpacity
        style={styles.conversationItem}
        onPress={() => handleConversationPress(item)}
      >
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <Text style={styles.conversationTitle} numberOfLines={1}>
              {listingTitle}
            </Text>
            <View style={styles.headerRight}>
              {timeText && <Text style={styles.conversationTime}>{timeText}</Text>}
              {hasUnread && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{badgeText}</Text>
                </View>
              )}
            </View>
          </View>
          <Text style={styles.conversationParticipant} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.conversationPreview} numberOfLines={2}>
            {lastMessage}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No conversations yet</Text>
      <Text style={styles.emptySubtitle}>
        Start a conversation by messaging a seller from a listing.
      </Text>
    </View>
  );

  if (loading && conversations.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </View>
    );
  }

  if (error && conversations.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadConversations}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        renderItem={renderConversationItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          conversations.length === 0 ? styles.emptyListContainer : styles.listContainer
        }
        ListEmptyComponent={renderEmptyState}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      />

      {/* Compliance disclaimer footer */}
      <View style={styles.disclaimerContainer}>
        <MessagingDisclaimer />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  listContainer: {
    padding: spacing.md,
  },
  emptyListContainer: {
    flex: 1,
  },
  conversationItem: {
    backgroundColor: colors.backgroundElevated,
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  conversationTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  conversationTime: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  unreadBadge: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  conversationParticipant: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  conversationPreview: {
    fontSize: typography.fontSize.sm,
    color: colors.text,
    lineHeight: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  emptyTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  disclaimerContainer: {
    padding: spacing.md,
    backgroundColor: colors.backgroundElevated,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
