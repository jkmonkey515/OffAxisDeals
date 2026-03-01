import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useProfileWithPermissions } from '../permissions/permissions';
import { openUpgradePage } from '../utils/openUpgradePage';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import { listMySavedSearches, type SavedSearch } from '../services/savedSearches';
import type { SavedSearchesStackParamList } from '../types/navigation';
import { getLocationKeyword, getBuyBox, getRadiusCenter, getLocationData } from '../utils/savedSearchCriteria';
import { supabaseClient } from '../lib/supabase';
import { colors, spacing, typography } from '../theme';


type SavedSearchesNavigationProp = NativeStackNavigationProp<
  SavedSearchesStackParamList,
  'SavedSearchesHome'
>;

export default function SavedSearchesScreen() {
  const navigation = useNavigation<SavedSearchesNavigationProp>();
  const { profile } = useProfileWithPermissions();
  const isPaid = profile?.is_paid === true;
  const isInvestor = profile?.role === 'investor';
  const currentUserId = profile?.id ?? null;

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Mount guard: track if component is mounted and current request ID
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const lastUserIdRef = useRef<string | null>(currentUserId);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset state when userId becomes null (user signs out) or changes (switches accounts)
  useEffect(() => {
    if (currentUserId === null && lastUserIdRef.current !== null) {
      // User signed out - clear state
      if (isMountedRef.current) {
        setSavedSearches([]);
        setError(null);
        setLoading(false);
        setRefreshing(false);
      }
      lastUserIdRef.current = null;
    } else if (currentUserId !== null && lastUserIdRef.current !== currentUserId) {
      // User changed (switched accounts) - clear state and increment request ID
      if (isMountedRef.current) {
        setSavedSearches([]);
        setError(null);
      }
      lastUserIdRef.current = currentUserId;
      // Increment request ID to invalidate any in-flight requests
      requestIdRef.current += 1;
    } else {
      lastUserIdRef.current = currentUserId;
    }
  }, [currentUserId]);

  const loadSavedSearches = useCallback(
    async (requestId?: number) => {
      // Use provided requestId or generate new one
      const currentRequestId = requestId ?? ++requestIdRef.current;

      if (!isPaid || !isInvestor) {
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setSavedSearches([]);
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }

      // If userId is null, don't fetch
      if (currentUserId === null) {
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setSavedSearches([]);
          setError(null);
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }

      try {
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setError(null);
          setLoading(true);
        }

        const searches = await listMySavedSearches();

        // Only apply results if this is still the latest request and component is mounted
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setSavedSearches(searches);
          setError(null);
        }
      } catch (err) {
        // Only apply error if this is still the latest request and component is mounted
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to load saved searches';
          setError(message);
          setSavedSearches([]);
        }
      } finally {
        // Only update loading state if this is still the latest request and component is mounted
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [isPaid, isInvestor, currentUserId]
  );

  // Initial load and reload when conditions change
  useEffect(() => {
    if (currentUserId !== null && isPaid && isInvestor) {
      loadSavedSearches();
    } else if (currentUserId === null) {
      // User signed out - state already cleared in userId effect
      if (isMountedRef.current) {
        setLoading(false);
      }
    } else if (!isPaid || !isInvestor) {
      // Not eligible - clear state
      if (isMountedRef.current) {
        setSavedSearches([]);
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentUserId, isPaid, isInvestor, loadSavedSearches]);

  const handleRefresh = useCallback(async () => {
    if (isMountedRef.current) {
      setRefreshing(true);
    }
    await loadSavedSearches();
  }, [loadSavedSearches]);

  // Refresh on focus (e.g., when returning from CreateSavedSearch)
  useFocusEffect(
    useCallback(() => {
      if (currentUserId !== null && isPaid && isInvestor) {
        loadSavedSearches();
      }
    }, [currentUserId, isPaid, isInvestor, loadSavedSearches])
  );

  const handleCreateSavedSearch = () => {
    navigation.navigate('CreateSavedSearch', {});
  };

  const handleUpgradeToPlus = () => {
    openUpgradePage();
  };

  const handleDelete = useCallback((id: string) => {
    Alert.alert(
      'Delete saved search?',
      'This cannot be undone.',
      [
        { 
          text: 'Cancel', 
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(id);
            try {
              // Try deleting saved_searches first
              // Note: FK cascade will automatically delete saved_search_matches
              // and notification_deliveries (which reference matches)
              const { error: deleteError } = await supabaseClient
                .from('saved_searches')
                .delete()
                .eq('id', id);

              if (deleteError) {
                // If FK constraint error, try deleting dependent rows manually
                // (though CASCADE should handle this, we'll be defensive)
                if (deleteError.message.includes('foreign key') || deleteError.message.includes('constraint')) {
                  // Delete saved_search_matches first
                  await supabaseClient
                    .from('saved_search_matches')
                    .delete()
                    .eq('saved_search_id', id);

                  // Retry deleting saved_searches
                  const { error: retryError } = await supabaseClient
                    .from('saved_searches')
                    .delete()
                    .eq('id', id);

                  if (retryError) {
                    Alert.alert('Error', retryError.message);
                    return;
                  }
                } else {
                  Alert.alert('Error', deleteError.message);
                  return;
                }
              }

              // Optimistically remove from local list
              setSavedSearches((prev) => prev.filter((s) => s.id !== id));
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Failed to delete saved search.';
              Alert.alert('Error', message);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, []);

  // Format relative time for display
  const formatRelativeTime = (dateString: string | null): string => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 60) {
        return `${diffMins}m ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    } catch {
      return 'Unknown';
    }
  };

  /**
   * Formats buy box summary for display
   */
  const formatBuyBoxSummary = (buyBox: ReturnType<typeof getBuyBox>): string | null => {
    const parts: string[] = [];

    if (buyBox.minBeds !== undefined) {
      parts.push(`${buyBox.minBeds}+ bd`);
    }

    if (buyBox.minBaths !== undefined) {
      parts.push(`${buyBox.minBaths}+ ba`);
    }

    if (buyBox.minPrice !== undefined || buyBox.maxPrice !== undefined) {
      const minStr = buyBox.minPrice ? formatPrice(buyBox.minPrice) : '';
      const maxStr = buyBox.maxPrice ? formatPrice(buyBox.maxPrice) : '';
      if (minStr && maxStr) {
        parts.push(`${minStr}–${maxStr}`);
      } else if (minStr) {
        parts.push(`${minStr}+`);
      } else if (maxStr) {
        parts.push(`up to ${maxStr}`);
      }
    }

    return parts.length > 0 ? parts.join(' • ') : null;
  };

  /**
   * Formats price for display (e.g., 150000 -> "$150k")
   */
  const formatPrice = (price: number): string => {
    if (price >= 1000000) {
      return `$${(price / 1000000).toFixed(1)}M`;
    } else if (price >= 1000) {
      return `$${Math.round(price / 1000)}k`;
    } else {
      return `$${price}`;
    }
  };

  const renderSavedSearchItem = ({ item }: { item: SavedSearch }) => {
    const buyBox = getBuyBox(item.criteria);
    const buyBoxSummary = formatBuyBoxSummary(buyBox);
    const { center: radiusCenter, radiusMiles } = getRadiusCenter(item.criteria);
    const createdTime = formatRelativeTime(item.created_at);
    const isDeleting = deletingId === item.id;

    // Determine if location is set: center_lat and center_lng are non-null AND not 0
    const hasLocation = (item.center_lat !== null && item.center_lat !== undefined && item.center_lat !== 0) &&
                       (item.center_lng !== null && item.center_lng !== undefined && item.center_lng !== 0);

    // Determine location text with fallback order
    let locationText: string;
    if (hasLocation) {
      const locationData = getLocationData(item.criteria);
      const locationKeyword = getLocationKeyword(item);
      
      if (locationData.locationLabel) {
        locationText = `Location: ${locationData.locationLabel}`;
      } else if (locationKeyword) {
        locationText = `Location: ${locationKeyword}`;
      } else {
        locationText = 'Location set';
      }
    } else {
      locationText = 'No location set';
    }

    // Determine area display text
    // Check criteria first, then fallback to top-level columns for backward compatibility
    const hasRadius = (radiusCenter && radiusMiles) || 
                      (item.center_lat && item.center_lng && item.radius_miles);
    const displayRadius = radiusMiles || item.radius_miles;
    
    const areaText = hasRadius && displayRadius
      ? `Area: ${displayRadius} ${displayRadius === 1 ? 'mile' : 'miles'} radius`
      : 'Area: Anywhere';

    return (
      <View style={styles.searchCardRow}>
        <Pressable
          style={styles.cardPressable}
          onPress={() => {
            if (!isDeleting) {
              navigation.navigate('EditSavedSearch', { id: item.id });
            }
          }}
          disabled={isDeleting}
        >
          <View style={styles.searchCardContent}>
            <View style={styles.searchCardHeader}>
              <Text style={styles.searchCardName} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          <Text style={styles.searchCardLocation}>{locationText}</Text>
          <Text style={styles.searchCardArea}>{areaText}</Text>
            {buyBoxSummary ? (
              <Text style={styles.searchCardBuyBox}>Buy box: {buyBoxSummary}</Text>
            ) : (
              <Text style={styles.searchCardBuyBox}>No filters set</Text>
            )}
            <Text style={styles.searchCardTime}>{createdTime}</Text>
          </View>
        </Pressable>
        <Pressable
          style={[styles.deleteButton, isDeleting && styles.deleteButtonDisabled]}
          onPress={() => handleDelete(item.id)}
          disabled={isDeleting}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Delete saved search"
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#FF3B30" />
          ) : (
            <Text style={styles.deleteButtonText}>🗑️</Text>
          )}
        </Pressable>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyStateCard}>
      <Text style={styles.emptyStateTitle}>No saved searches yet</Text>
      <Text style={styles.emptyStateSubtitle}>Create a saved search to get instant alerts when new off-market deals match your criteria.</Text>
      <TouchableOpacity
        style={styles.emptyStateButton}
        onPress={handleCreateSavedSearch}
      >
        <Text style={styles.emptyStateButtonText}>Create Saved Search</Text>
      </TouchableOpacity>
    </View>
  );

  // Only show content for investors
  if (!isInvestor) {
    return (
      <SafeAreaView style={styles.container}>
        <TopHeader 
          title="Saved Searches"
          right={<HeaderRightActions />}
        />
        <View style={styles.emptyListContainer}>
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateSubtitle}>
              This feature is available for investors.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Free investor: show premium lock state (no context band to avoid redundancy)
  if (!isPaid) {
    return (
      <SafeAreaView style={styles.container}>
        <TopHeader 
          title="Saved Searches"
          right={<HeaderRightActions />}
        />
        <ScrollView 
          contentContainerStyle={styles.freeUserContentContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Premium Lock State */}
          <View style={styles.premiumLockCard}>
            <Text style={styles.premiumLockTitle}>What are saved searches?</Text>
            <Text style={styles.premiumLockText}>
              Saved searches let you set up custom criteria (location, price range, property type, etc.) and get instant alerts when new off-market deals match your requirements.
            </Text>
            <Text style={styles.premiumLockText}>
              Alerts are a Plus feature that notify you immediately when matching properties are posted.
            </Text>
            <TouchableOpacity
              style={styles.premiumLockButton}
              onPress={handleUpgradeToPlus}
            >
              <Text style={styles.premiumLockButtonText}>Upgrade to unlock access</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Plus investor: show list or empty state
  if (loading && savedSearches.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <TopHeader 
          title="Saved Searches"
          right={<HeaderRightActions />}
        />
        <View style={styles.contentContainer}>
          {/* Context Band */}
          <View style={styles.contextBand}>
            <Text style={styles.contextBandTitle}>Saved searches and instant alerts</Text>
            <Text style={styles.contextBandSubtext}>
              You'll receive instant alerts when new off-market deals match your criteria.
            </Text>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading saved searches...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TopHeader 
        title="Saved Searches"
        right={<HeaderRightActions />}
      />
      <View style={styles.contentContainer}>
        {/* Context Band */}
        <View style={styles.contextBand}>
          <Text style={styles.contextBandTitle}>Saved searches and instant alerts</Text>
          <Text style={styles.contextBandSubtext}>
            You'll receive instant alerts when new off-market deals match your criteria.
          </Text>
        </View>

        {/* Section Header */}
        {savedSearches.length > 0 && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>Your Saved Searches</Text>
          </View>
        )}
      </View>

      <FlatList
        data={savedSearches}
        renderItem={renderSavedSearchItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          savedSearches.length === 0 ? styles.emptyListContainer : styles.listContainer
        }
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />

      <View style={styles.createButtonContainer}>
        <TouchableOpacity style={styles.createButton} onPress={handleCreateSavedSearch}>
          <Text style={styles.createButtonText}>Create Saved Search</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  freeUserContentContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  contextBand: {
    backgroundColor: '#f8f8f8',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.md,
  },
  contextBandTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  contextBandSubtext: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  contextBandCTA: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  sectionHeader: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionHeaderText: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  premiumLockCard: {
    backgroundColor: colors.backgroundElevated,
    padding: spacing.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  premiumLockTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  premiumLockText: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  premiumLockButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  premiumLockButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  listContainer: {
    padding: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: 80, // Space for create button
  },
  emptyListContainer: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchCardRow: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  cardPressable: {
    flex: 1,
  },
  searchCardContent: {
    flex: 1,
    padding: spacing.md,
  },
  searchCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  deleteButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    zIndex: 10,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteButtonText: {
    fontSize: 18,
  },
  searchCardName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  searchCardStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  searchCardStatusActive: {
    backgroundColor: '#e8f5e9',
  },
  searchCardStatusDisabled: {
    backgroundColor: '#f5f5f5',
  },
  searchCardStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchCardStatusTextActive: {
    color: '#2e7d32',
  },
  searchCardStatusTextDisabled: {
    color: '#666',
  },
  searchCardLocation: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  searchCardArea: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  searchCardBuyBox: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  searchCardTime: {
    fontSize: typography.fontSize.xs,
    color: colors.textTertiary,
  },
  emptyStateCard: {
    backgroundColor: colors.backgroundElevated,
    padding: spacing.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    alignItems: 'center',
    maxWidth: 300,
  },
  emptyStateTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  emptyStateButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyStateButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  createButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  createButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
  },
  createButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
