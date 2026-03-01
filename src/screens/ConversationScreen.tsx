import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { AppTabsParamList } from '../types/navigation';
import { supabaseClient } from '../lib/supabase';
import { useProfileWithPermissions, has } from '../permissions/permissions';
import { useUnreadMessages } from '../contexts/UnreadMessagesContext';
import Guard from '../components/Guard';
import UpgradeRequired from '../components/UpgradeRequired';
import { openUpgradePage } from '../utils/openUpgradePage';
import { qalog, qaError } from '../utils/qalog';
import { colors, spacing, typography } from '../theme';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUuidMaybe(value: string | null | undefined): string | null {
  const s = (value ?? '').trim();
  if (!s) return null;
  const lastSegment = s.includes(':') ? s.split(':').pop() ?? s : s;
  const trimmed = lastSegment.trim();
  return UUID_V4_REGEX.test(trimmed) ? trimmed : null;
}

function isLeadMessageRef(raw: string): boolean {
  return raw.startsWith('lead_message:');
}

function navigateToMessagesTab(navigation: unknown) {
  const nav = navigation as { getParent?: () => unknown; navigate?: (name: never) => void; canGoBack?: () => boolean; goBack?: () => void };

  // Conversation is usually: Tabs -> MessagesStack -> Conversation
  // So parent is stack, parent.parent is tabs.
  const parent1 = nav.getParent?.() as { getParent?: () => unknown; navigate?: (name: never) => void } | undefined;
  const parent2 = parent1?.getParent?.() as { navigate?: (name: never) => void } | undefined;

  // Try tabs first
  if (parent2?.navigate) {
    parent2.navigate('Messages' as never);
    return;
  }

  // Fallback: try immediate parent
  if (parent1?.navigate) {
    parent1.navigate('Messages' as never);
    return;
  }

  // Fallback: try current navigator
  if (nav.navigate) {
    nav.navigate('Messages' as never);
    return;
  }

  // Last resort
  if (nav.canGoBack?.()) {
    nav.goBack?.();
  }
}

interface ConversationScreenProps {
  route: { params: { conversationId?: string; listingId?: string } };
}

interface Message {
  id: string;
  thread_id: string;
  from_id: string | null;
  to_id: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

interface ConversationInfo {
  id: string;
  listing_id: string;
  participant_one: string;
  participant_two: string;
}

export default function ConversationScreen({ route }: ConversationScreenProps) {
  const params = route.params as Record<string, unknown>;
  const rawThreadId =
    (typeof params?.threadId === 'string' ? params.threadId : null) ??
    (typeof params?.thread_id === 'string' ? params.thread_id : null) ??
    (typeof params?.id === 'string' ? params.id : null) ??
    (typeof params?.ref_id === 'string' ? params.ref_id : null) ??
    (typeof params?.conversationId === 'string' ? params.conversationId : null) ??
    '';
  const rawStr = typeof rawThreadId === 'string' ? rawThreadId : '';
  const initialId = normalizeUuidMaybe(rawStr);
  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(
    isLeadMessageRef(rawStr) ? null : initialId
  );
  const listingId = typeof params?.listingId === 'string' ? params.listingId : '';
  const { profile, permissions } = useProfileWithPermissions();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isMissingThread, setIsMissingThread] = useState(false);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);
  const shouldAutoScrollRef = useRef<boolean>(true);
  const [composerHeight, setComposerHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const canMessage = has(permissions, 'message');
  const currentUserId = profile?.id;
  const { refresh: refreshUnreadCount } = useUnreadMessages();

  // Resolve lead_message:<messageId> to thread_id before loading
  useEffect(() => {
    if (isLeadMessageRef(rawStr)) {
      if (!canMessage) return;
      const messageId = initialId;
      if (!messageId) {
        setResolvedThreadId(null);
        navigateToMessagesTab(navigation);
        return;
      }
      (async () => {
        const { data, error } = await supabaseClient
          .from('messages')
          .select('thread_id')
          .eq('id', messageId)
          .single<{ thread_id: string }>();
        if (!error && data?.thread_id && UUID_V4_REGEX.test(data.thread_id)) {
          setResolvedThreadId(data.thread_id);
        } else {
          setResolvedThreadId(initialId); // leave as-is, will fall back to unavailable
        }
      })();
    } else {
      setResolvedThreadId(initialId);
    }
  }, [rawStr, initialId, navigation, canMessage]);

  // Hard guard: invalid thread id -> navigate to Messages (skip when resolving lead_message ref)
  useEffect(() => {
    if (!resolvedThreadId && !isLeadMessageRef(rawStr)) {
      navigateToMessagesTab(navigation);
    }
  }, [resolvedThreadId, rawStr, navigation]);

  const handleUpgrade = () => {
    openUpgradePage('?upgrade=messaging');
  };

  const handleBackToListings = () => {
    const parentNav = navigation.getParent<BottomTabNavigationProp<AppTabsParamList>>();
    if (parentNav) {
      parentNav.navigate('Listings' as never);
    } else {
      // Fallback: try to go back
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    }
  };

  const handleBackToMessages = () => {
    navigation.navigate('MessagesHome' as never);
  };

  const loadMessages = useCallback(async () => {
    if (!resolvedThreadId) return;
    try {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabaseClient
        .from('messages')
        .select('id, thread_id, from_id, to_id, body, created_at, read_at')
        .eq('thread_id', resolvedThreadId)
        .order('created_at', { ascending: true });

      if (queryError) {
        setError(queryError.message);
        setMessages([]);
        return;
      }

      shouldAutoScrollRef.current = true;
      setMessages((data ?? []) as Message[]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load messages.';
      setError(message);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [resolvedThreadId]);

  /**
   * Mark all unread messages in this thread as read for the current user
   */
  const markThreadAsRead = useCallback(async () => {
    if (!currentUserId || !resolvedThreadId) return;

    try {
      // Update all messages where to_id = currentUserId and read_at IS NULL
      const { error } = await supabaseClient
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('thread_id', resolvedThreadId)
        .eq('to_id', currentUserId)
        .is('read_at', null);

      if (error) {
        qaError('markThreadAsRead failed', error);
        if (__DEV__) {
          console.warn('Failed to mark messages as read. Error:', error.message);
        }
        return;
      }

      // Refresh unread count after marking as read
      await refreshUnreadCount();

      // Re-fetch messages to update UI with read_at timestamps
      await loadMessages();
    } catch (err) {
      qaError('markThreadAsRead exception', err);
      if (__DEV__) {
        console.warn('Exception marking messages as read:', err);
      }
    }
  }, [currentUserId, resolvedThreadId, refreshUnreadCount, loadMessages]);

  // Mark messages as read when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (canMessage && currentUserId && resolvedThreadId) {
        markThreadAsRead();
      }
    }, [canMessage, currentUserId, resolvedThreadId, markThreadAsRead])
  );

  useEffect(() => {
    if (!canMessage || !currentUserId || !resolvedThreadId) {
      return;
    }

    loadConversation();
    loadMessages();

    // Subscribe to new messages
    const messagesSubscription = supabaseClient
      .channel(`messages:${resolvedThreadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${resolvedThreadId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          shouldAutoScrollRef.current = true;
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage].sort(
              (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        }
      )
      .subscribe();

    return () => {
      messagesSubscription.unsubscribe();
    };
  }, [resolvedThreadId, canMessage, currentUserId, loadMessages]);

  const loadConversation = async () => {
    if (!resolvedThreadId) return;
    try {
      const { data, error: queryError } = await supabaseClient
        .from('conversations')
        .select('id, listing_id, participant_one, participant_two')
        .eq('id', resolvedThreadId)
        .single<ConversationInfo>();

      setConversationLoaded(true);

      if (queryError) {
        // Check if this is a "not found" error
        // PostgREST returns PGRST116 for "No rows returned" when using .single()
        const isNotFound = 
          queryError.code === 'PGRST116' ||
          queryError.message?.toLowerCase().includes('no rows') ||
          queryError.message?.toLowerCase().includes('not found') ||
          queryError.message?.toLowerCase().includes('does not exist');
        
        if (isNotFound) {
          setIsMissingThread(true);
          setConversation(null);
          setError(null); // Don't show error message for missing threads
          return;
        }

        // Other errors: show error but don't mark as missing thread
        setError(queryError.message);
        setConversation(null);
        setIsMissingThread(false);
        return;
      }

      // Check if data is null/undefined (shouldn't happen with .single() but be safe)
      if (!data) {
        setIsMissingThread(true);
        setConversation(null);
        setError(null);
        return;
      }

      // Conversation found
      setConversation(data);
      setIsMissingThread(false);
      setError(null);
    } catch (err) {
      setConversationLoaded(true);
      const message =
        err instanceof Error ? err.message : 'Failed to load conversation.';
      
      // Check if error message suggests "not found"
      const isNotFound = 
        message.toLowerCase().includes('no rows') ||
        message.toLowerCase().includes('not found') ||
        message.toLowerCase().includes('does not exist');
      
      if (isNotFound) {
        setIsMissingThread(true);
        setError(null);
      } else {
        setError(message);
        setIsMissingThread(false);
      }
      setConversation(null);
    }
  };


  const handleSendMessage = async () => {
    if (!messageText.trim() || !currentUserId || !resolvedThreadId || sending) {
      return;
    }

    // Guard: conversation must be loaded to compute otherUserId
    if (!conversation) {
      Alert.alert('Error', 'Conversation not loaded. Please try again.');
      return;
    }

    const bodyText = messageText.trim();
    setMessageText('');
    setSending(true);

    // Determine recipient ID (otherUserId) from conversation
    const otherUserId = conversation.participant_one === currentUserId
      ? conversation.participant_two
      : conversation.participant_one;

    // QA log: message send attempt
    qalog('message send attempt', {
      conversationId: resolvedThreadId,
      senderId: currentUserId,
      recipientId: otherUserId,
      listingId,
    });

    try {
      const { data, error: insertError } = await supabaseClient
        .from('messages')
        .insert({
          thread_id: resolvedThreadId,
          from_id: currentUserId,
          to_id: otherUserId,
          body: bodyText,
          listing_id: conversation.listing_id ?? null,
        })
        .select('id, thread_id, from_id, to_id, body, created_at, read_at')
        .single<Message>();

      if (insertError) {
        qaError('message send failed', insertError);
        Alert.alert('Error', insertError.message);
        setMessageText(bodyText); // Restore message text on error
        return;
      }

      // QA log: message sent successfully
      qalog('message sent', {
        conversationId: resolvedThreadId,
        senderId: currentUserId,
        recipientId: otherUserId,
        listingId,
        messageId: data?.id,
      });

      // After insert, immediately query latest messages for that conversation and log count
      const { data: latestMessages, error: queryError } = await supabaseClient
        .from('messages')
        .select('id')
        .eq('thread_id', resolvedThreadId);

      if (!queryError && latestMessages) {
        qalog('message count after send', { conversationId: resolvedThreadId, messageCount: latestMessages.length });
      } else if (queryError) {
        qaError('message count query failed', queryError);
      }

      // Add message to list (subscription will also handle this, but update immediately)
      if (data) {
        shouldAutoScrollRef.current = true;
        setMessages((prev) => [...prev, data]);
      }
    } catch (err) {
      qaError('message send exception', err);
      const message =
        err instanceof Error ? err.message : 'Failed to send message.';
      Alert.alert('Error', message);
      setMessageText(bodyText); // Restore message text on error
    } finally {
      setSending(false);
    }
  };

  const formatTime = (timestamp: string): string => {
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

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwnMessage = item.from_id === currentUserId;
    return (
      <View
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.messageContainerOwn : styles.messageContainerOther,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isOwnMessage ? styles.messageTextOwn : styles.messageTextOther,
            ]}
          >
            {item.body}
          </Text>
          <Text
            style={[
              styles.messageTime,
              isOwnMessage ? styles.messageTimeOwn : styles.messageTimeOther,
            ]}
          >
            {formatTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  // Gate: Invalid thread id or resolving lead_message - show placeholder
  if (!resolvedThreadId) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Gate: Return early for free users - no data fetching, no sensitive info displayed
  if (!canMessage) {
    return (
      <UpgradeRequired
        title="Messaging is a Plus feature"
        message="Upgrade to message sellers and view conversations."
        buttonText="Upgrade to unlock access"
        onPress={handleUpgrade}
        secondaryButtonText="Back to Listings"
        onSecondaryPress={handleBackToListings}
      />
    );
  }

  // Gate: Show missing thread fallback if conversation is missing/deleted
  // Check after conversation load completes to avoid showing fallback during initial load
  if (conversationLoaded && isMissingThread) {
    return (
      <View style={[styles.container, styles.centered]}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Conversation unavailable</Text>
          <Text style={styles.fallbackMessage}>This conversation is no longer available.</Text>
          <View style={styles.fallbackButtonContainer}>
            <TouchableOpacity style={styles.fallbackPrimaryButton} onPress={handleBackToMessages}>
              <Text style={styles.fallbackPrimaryButtonText}>Back to Messages</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fallbackSecondaryButton} onPress={handleBackToListings}>
              <Text style={styles.fallbackSecondaryButtonText}>Go to Listings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (loading && messages.length === 0 && !conversationLoaded) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </View>
    );
  }

  if (error && messages.length === 0 && !isMissingThread) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadMessages}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Guard permission="message">
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
        >
          <View style={{ flex: 1 }}>
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              style={styles.messagesListContainer}
              contentContainerStyle={[
                styles.messagesList,
                { paddingBottom: composerHeight + 12 + (Platform.OS === 'ios' ? insets.bottom : 0) },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onContentSizeChange={() => {
                if (shouldAutoScrollRef.current) {
                  flatListRef.current?.scrollToEnd({ animated: false });
                  shouldAutoScrollRef.current = false;
                }
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No messages yet. Start the conversation!</Text>
                </View>
              }
            />

            <View
              style={{
                transform: [{
                  translateY: Platform.OS === 'android'
                    ? (keyboardHeight > 0 ? Math.min(0, -(keyboardHeight - 267)) : 0)
                    : 0,
                }],
              }}
            >
              <View
                style={[styles.inputContainer, { paddingBottom: insets.bottom }]}
                onLayout={(e: LayoutChangeEvent) => setComposerHeight(e.nativeEvent.layout.height)}
              >
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Type a message..."
                placeholderTextColor="#999"
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={2000}
                editable={!sending}
                textAlignVertical={Platform.OS === 'android' ? 'top' : 'center'}
              />
              <TouchableOpacity
                style={[styles.sendButton, (!messageText.trim() || sending) && styles.sendButtonDisabled]}
                onPress={handleSendMessage}
                disabled={!messageText.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.sendButtonText}>Send</Text>
                )}
              </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Guard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesListContainer: {
    flex: 1,
  },
  messagesList: {
    padding: spacing.md,
    paddingTop: spacing.md,
  },
  messageContainer: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
  },
  messageContainerOwn: {
    justifyContent: 'flex-end',
  },
  messageContainerOther: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 16,
  },
  messageBubbleOwn: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    backgroundColor: '#e5e5ea',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  messageTextOwn: {
    color: colors.textInverse,
  },
  messageTextOther: {
    color: colors.text,
  },
  messageTime: {
    fontSize: typography.fontSize.xs,
    marginTop: spacing.xs,
  },
  messageTimeOwn: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  messageTimeOther: {
    color: colors.textSecondary,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.backgroundElevated,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    backgroundColor: colors.borderLight,
    borderRadius: 20,
    fontSize: typography.fontSize.sm,
    color: colors.text,
    marginRight: spacing.sm,
    includeFontPadding: false,
  },
  sendButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  sendButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.md,
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
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  fallbackContainer: {
    maxWidth: 400,
    alignItems: 'center',
    padding: spacing.lg,
  },
  fallbackTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.md,
    color: colors.text,
    textAlign: 'center',
  },
  fallbackMessage: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  fallbackButtonContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  fallbackPrimaryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  fallbackPrimaryButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  fallbackSecondaryButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fallbackSecondaryButtonText: {
    color: colors.text,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
