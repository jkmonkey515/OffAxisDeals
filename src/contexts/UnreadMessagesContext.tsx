import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabaseClient } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface UnreadMessagesContextValue {
  count: number;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const UnreadMessagesContext = createContext<UnreadMessagesContextValue | undefined>(undefined);

interface UnreadMessagesProviderProps {
  children: ReactNode;
}

export function UnreadMessagesProvider({ children }: UnreadMessagesProviderProps) {
  const { user } = useAuth();
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchUnreadCount = useCallback(async () => {
    if (!user?.id) {
      setCount(0);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      // Count unread messages where current user is the recipient
      const { count: unreadCount, error } = await supabaseClient
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('to_id', user.id)
        .is('read_at', null);

      if (error) {
        if (__DEV__) {
          console.error('Failed to fetch unread message count:', error);
        }
        setCount(0);
        return;
      }

      // Store raw count (capping at 99 should be done in UI)
      setCount(unreadCount ?? 0);
    } catch (err) {
      if (__DEV__) {
        console.error('Error fetching unread count:', err);
      }
      setCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Register ONE AppState listener to refresh when app becomes active
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        fetchUnreadCount();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [fetchUnreadCount]);

  // Initial fetch on mount / when user changes
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  const value: UnreadMessagesContextValue = {
    count,
    isLoading,
    refresh: fetchUnreadCount,
  };

  return (
    <UnreadMessagesContext.Provider value={value}>
      {children}
    </UnreadMessagesContext.Provider>
  );
}

export function useUnreadMessages(): UnreadMessagesContextValue {
  const context = useContext(UnreadMessagesContext);
  if (context === undefined) {
    throw new Error('useUnreadMessages must be used within an UnreadMessagesProvider');
  }
  return context;
}
