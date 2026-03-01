import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { supabaseClient } from '../lib/supabase';
import type { AppTabsParamList } from '../types/navigation';
import { formatMoney } from '../utils/currency';
import { shouldShowStreetAddress } from '../utils/addressVisibility';
import { useAuth } from '../contexts/AuthContext';
import UpgradeRequired from '../components/UpgradeRequired';
import { colors, spacing, typography } from '../theme';

interface WatchlistListing {
  id: string;
  title?: string;
  address?: string;
  address_visibility?: 'exact' | 'approx' | 'hidden' | null;
  city?: string;
  state?: string;
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  lot_sqft?: number;
  cover_image_url?: string | null;
  images?: string[] | null;
  arv?: number | null;
  repairs?: number | null;
  currency?: string | null;
  watchlist_item_id: string;
}

type WatchlistsScreenNavigationProp = NativeStackNavigationProp<{
  WatchlistsHome: undefined;
}>;

export default function WatchlistsScreen() {
  const navigation = useNavigation<WatchlistsScreenNavigationProp>();
  const { profile } = useAuth();
  const [listings, setListings] = useState<WatchlistListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Gate: Only investors can access watchlists
  if (profile?.role !== 'investor') {
    return null;
  }

  // Gate: Paid investors only
  if (profile?.is_paid !== true) {
    return (
      <SafeAreaView style={styles.container}>
        <UpgradeRequired />
      </SafeAreaView>
    );
  }

  const findOrCreateDefaultWatchlist = useCallback(async (userId: string): Promise<string | null> => {
    try {
      // Try to find existing 'Favorites' watchlist
      const { data: existing, error: findError } = await supabaseClient
        .from('user_watchlists')
        .select('id')
        .eq('user_id', userId)
        .eq('name', 'Favorites')
        .maybeSingle();

      if (findError && findError.code !== 'PGRST116') {
        // PGRST116 is "not found" which is fine, other errors are real errors
        setError(findError.message);
        return null;
      }

      if (existing) {
        return existing.id;
      }

      // Create new 'Favorites' watchlist
      const { data: created, error: createError } = await supabaseClient
        .from('user_watchlists')
        .insert({
          user_id: userId,
          name: 'Favorites',
          description: null,
          watchlist_type: 'favorites',
        })
        .select('id')
        .single();

      if (createError) {
        setError(createError.message);
        return null;
      }

      return created?.id ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to find or create watchlist.';
      setError(message);
      return null;
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser();

      if (userError) {
        setError(userError.message);
        setListings([]);
        return;
      }

      if (!user) {
        setError('Not authenticated.');
        setListings([]);
        return;
      }

      // Find or create default watchlist
      const wlId = await findOrCreateDefaultWatchlist(user.id);
      if (!wlId) {
        setListings([]);
        return;
      }

      setWatchlistId(wlId);

      // Fetch watchlist items with joined listing data
      const { data, error: itemsError } = await supabaseClient
        .from('watchlist_items')
        .select(
          `
          id,
          listing_id,
          listings (
            id,
            title,
            address,
            address_visibility,
            city,
            state,
            price,
            beds,
            baths,
            sqft,
            lot_sqft,
            cover_image_url,
            images,
            arv,
            repairs,
            currency
          )
        `
        )
        .eq('watchlist_id', wlId)
        .order('created_at', { ascending: false });

      if (itemsError) {
        setError(itemsError.message);
        setListings([]);
        return;
      }

      // Transform the data to flatten the nested listing structure
      const transformedListings: WatchlistListing[] = [];
      for (const item of data ?? []) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const itemObj = item as { id?: unknown; listing_id?: unknown; listings?: unknown };
        const listing = itemObj.listings;
        if (!listing || typeof listing !== 'object') {
          continue;
        }
        const listingObj = listing as Record<string, unknown>;
        const addrVis = listingObj.address_visibility;
        const addrVisNorm =
          typeof addrVis === 'string' && ['exact', 'approx', 'hidden'].includes(addrVis.toLowerCase())
            ? (addrVis.toLowerCase() as 'exact' | 'approx' | 'hidden')
            : undefined;
        transformedListings.push({
          id: typeof listingObj.id === 'string' ? listingObj.id : '',
          title: typeof listingObj.title === 'string' ? listingObj.title : undefined,
          address: typeof listingObj.address === 'string' ? listingObj.address : undefined,
          address_visibility: addrVisNorm ?? undefined,
          city: typeof listingObj.city === 'string' ? listingObj.city : undefined,
          state: typeof listingObj.state === 'string' ? listingObj.state : undefined,
          price: typeof listingObj.price === 'number' ? listingObj.price : undefined,
          beds: typeof listingObj.beds === 'number' ? listingObj.beds : undefined,
          baths: typeof listingObj.baths === 'number' ? listingObj.baths : undefined,
          sqft: typeof listingObj.sqft === 'number' ? listingObj.sqft : undefined,
          lot_sqft: typeof listingObj.lot_sqft === 'number' ? listingObj.lot_sqft : undefined,
          cover_image_url: typeof listingObj.cover_image_url === 'string' ? listingObj.cover_image_url : null,
          images: Array.isArray(listingObj.images) ? listingObj.images as string[] : null,
          arv: typeof listingObj.arv === 'number' ? listingObj.arv : null,
          repairs: typeof listingObj.repairs === 'number' ? listingObj.repairs : null,
          currency: typeof listingObj.currency === 'string' ? listingObj.currency : null,
          watchlist_item_id: typeof itemObj.id === 'string' ? itemObj.id : '',
        });
      }

      setListings(transformedListings);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load favorites.';
      setError(errorMessage);
      setListings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [findOrCreateDefaultWatchlist]);

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [loadFavorites])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadFavorites();
  }, [loadFavorites]);

  /**
   * Navigate to ListingDetails in the Listings tab.
   * Uses parent tab navigator to navigate across stacks.
   */
  const handleListingPress = (listingId: string) => {
    // Get the parent tab navigator
    const parentNav = navigation.getParent<BottomTabNavigationProp<AppTabsParamList>>();
    
    if (parentNav) {
      try {
        // Navigate to Listings tab with nested screen params
        parentNav.navigate('Listings', {
          screen: 'ListingDetails',
          params: { listingId },
        } as never);
      } catch (err) {
        // If navigation fails, show alert instead of throwing
        Alert.alert('Unable to open listing right now.', 'Please try again.');
        if (__DEV__) {
          console.error('[Watchlists] Navigation error:', err);
        }
      }
    } else {
      // If parent cannot be resolved, show alert
      Alert.alert('Unable to open listing right now.', 'Please try again.');
      if (__DEV__) {
        console.error('[Watchlists] Could not resolve parent tab navigator');
      }
    }
  };

  const handleRemove = async (item: WatchlistListing) => {
    setRemovingId(item.watchlist_item_id);
    try {
      const { error } = await supabaseClient
        .from('watchlist_items')
        .delete()
        .eq('id', item.watchlist_item_id);

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      // Refresh the list
      await loadFavorites();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove from favorites.';
      Alert.alert('Error', message);
    } finally {
      setRemovingId(null);
    }
  };

  const renderListingItem = ({ item }: { item: WatchlistListing }) => {
    const imageUrl =
      (item.cover_image_url && item.cover_image_url.length > 0
        ? item.cover_image_url
        : Array.isArray(item.images) && item.images.length > 0
        ? item.images[0]
        : null) || null;

    const cityState =
      item.city && item.state ? `${item.city}, ${item.state}` : item.city || item.state || '';
    const streetLine = shouldShowStreetAddress(item.address_visibility, item.address)
      ? (item.address ?? '').trim()
      : null;

    const hasBedsBathsSqft =
      (typeof item.beds === 'number' && !Number.isNaN(item.beds)) ||
      (typeof item.baths === 'number' && !Number.isNaN(item.baths)) ||
      (typeof item.sqft === 'number' && !Number.isNaN(item.sqft));

    const bedsText =
      typeof item.beds === 'number' && !Number.isNaN(item.beds) ? `${item.beds} Beds` : '';
    const bathsText =
      typeof item.baths === 'number' && !Number.isNaN(item.baths) ? `${item.baths} Baths` : '';
    const sqftText =
      typeof item.sqft === 'number' && !Number.isNaN(item.sqft) ? `${item.sqft} Sqft` : '';

    const lotText =
      typeof item.lot_sqft === 'number' && !Number.isNaN(item.lot_sqft)
        ? `Lot: ${item.lot_sqft.toLocaleString()} sqft`
        : '';

    const metaParts = [bedsText, bathsText, sqftText].filter((part) => part.length > 0);
    const metaLine = metaParts.join(' · ');

    const isRemoving = removingId === item.watchlist_item_id;

    return (
      <TouchableOpacity
        style={styles.listingItem}
        onPress={() => handleListingPress(item.id)}
        activeOpacity={0.7}
        disabled={isRemoving}
      >
        <View style={styles.listingContent}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.listingImage} />
          ) : (
            <View style={styles.listingImagePlaceholder}>
              <Text style={styles.listingImagePlaceholderText}>No image</Text>
            </View>
          )}

          <View style={styles.listingHeaderRow}>
            <View style={styles.listingTextContent}>
              <Text style={styles.listingTitle}>{item.title || 'Untitled Listing'}</Text>
              {streetLine && <Text style={styles.listingAddress}>{streetLine}</Text>}
              {cityState && <Text style={styles.listingAddress}>{cityState}</Text>}
              {typeof item.price === 'number' && !Number.isNaN(item.price) && (
                <Text style={styles.listingPrice}>{formatMoney(item.price, item.currency)}</Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.savedPillButton, styles.savedPillButtonActive]}
              onPress={(e) => {
                e.stopPropagation();
                if (isRemoving) return;
                handleRemove(item);
              }}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.savedPillIcon}>⭐</Text>
                  <Text style={styles.savedPillText}>Remove</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {hasBedsBathsSqft && <Text style={styles.listingMeta}>{metaLine}</Text>}
          {lotText && <Text style={styles.listingMeta}>{lotText}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  const handleBrowseDeals = () => {
    const parentNav = navigation.getParent<BottomTabNavigationProp<AppTabsParamList>>();
    if (parentNav) {
      parentNav.navigate('Listings', { screen: 'ListingsBrowse' });
    }
  };

  const renderEmptyState = () => {
    if (loading || listings.length > 0) {
      return null;
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No saved deals yet</Text>
        <Text style={styles.emptySubtitle}>Tap ☆ Save on a deal to track it here.</Text>
        <TouchableOpacity style={styles.emptyPrimaryButton} onPress={handleBrowseDeals}>
          <Text style={styles.emptyPrimaryButtonText}>Browse deals</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading && listings.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading favorites...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadFavorites}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={listings}
          renderItem={renderListingItem}
          keyExtractor={(item) => item.watchlist_item_id}
          contentContainerStyle={listings.length === 0 ? styles.emptyListContainer : styles.listContainer}
          ListEmptyComponent={renderEmptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
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
    marginBottom: 16,
    textAlign: 'center',
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
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  emptyTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyPrimaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  emptyPrimaryButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textInverse,
  },
  listingItem: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  listingContent: {
    padding: 12,
  },
  listingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  listingTextContent: {
    flex: 1,
    minWidth: 0,
  },
  listingImage: {
    width: '100%',
    height: 160,
    backgroundColor: colors.border,
  },
  listingImagePlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingImagePlaceholderText: {
    fontSize: typography.fontSize.xs,
    color: colors.textTertiary,
  },
  listingTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  listingAddress: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  listingPrice: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  listingMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  savedPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 16,
    gap: spacing.xs,
    minWidth: 70,
  },
  savedPillButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  savedPillIcon: {
    fontSize: typography.fontSize.sm,
  },
  savedPillText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.textInverse,
  },
});
