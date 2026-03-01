import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Alert,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Linking } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { MyListingsStackParamList, AppTabsParamList } from '../types/navigation';
import { supabaseClient } from '../lib/supabase';
import { formatMoney } from '../utils/currency';
import { colors, spacing, typography } from '../theme';
import MarkAsSoldModal from '../components/MarkAsSoldModal';
import MakeFeaturedModal from '../components/MakeFeaturedModal';
import { isFeaturedActive } from '../utils/featured';
import { toListingImagePublicUrl } from '../utils/listingImages';
import { shouldShowStreetAddress } from '../utils/addressVisibility';

interface MyListing {
  id: string;
  owner_id: string;
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
  created_at?: string;
  arv?: number | null;
  repairs?: number | null;
  currency?: string | null;
  status?: string | null;
  featured?: boolean | null;
  featured_until?: string | null;
}

type MyListingsScreenNavigationProp = NativeStackNavigationProp<MyListingsStackParamList, 'MyListingsHome'>;

export default function MyListingsScreen() {
  const navigation = useNavigation<MyListingsScreenNavigationProp>();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [markSoldModalVisible, setMarkSoldModalVisible] = useState(false);
  const [selectedListingForSold, setSelectedListingForSold] = useState<MyListing | null>(null);
  const [makeFeaturedModalVisible, setMakeFeaturedModalVisible] = useState(false);
  const [selectedListingForFeatured, setSelectedListingForFeatured] = useState<MyListing | null>(null);
  // Precomputed thumbnail URLs by listing ID (resolved from DB fields)
  const [thumbUrlByListingId, setThumbUrlByListingId] = useState<Record<string, string | null>>({});

  const loadListings = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser();

      if (userError) {
        setError(userError.message);
        setListings([]);
        setCurrentUserId(null);
        return;
      }

      if (!user) {
        setError('Not authenticated.');
        setListings([]);
        setCurrentUserId(null);
        return;
      }

      setCurrentUserId(user.id);

      const { data, error: queryError } = await supabaseClient
        .from('listings')
        .select(
          [
            'id',
            'owner_id',
            'title',
            'address',
            'city',
            'state',
            'price',
            'beds',
            'baths',
            'sqft',
            'lot_sqft',
            'cover_image_url',
            'images',
            'created_at',
            'arv',
            'repairs',
          'currency',
          'status',
          'featured',
          'featured_until',
          'address_visibility',
        ].join(', ')
        )
        .eq('owner_id', user.id)
        .in('status', ['active', 'sold'])
        .order('created_at', { ascending: false });

      if (queryError) {
        setError(queryError.message);
        setListings([]);
        return;
      }

      const typedData = (data ?? []) as unknown as MyListing[];
      
      // Sort: featured listings first, then by created_at (newest first)
      const sortedData = [...typedData].sort((a, b) => {
        const aFeatured = isFeaturedActive(a);
        const bFeatured = isFeaturedActive(b);
        
        if (aFeatured && !bFeatured) return -1;
        if (!aFeatured && bFeatured) return 1;
        
        // Both featured or both not featured - sort by created_at
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate; // Newest first
      });
      
      setListings(sortedData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load listings';
      setError(errorMessage);
      setListings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useFocusEffect(
    useCallback(() => {
      loadListings();
    }, [loadListings])
  );

  // Precompute thumbnail URLs when listings change (effect-driven, no render-time setState)
  useEffect(() => {
    if (listings.length === 0) {
      setThumbUrlByListingId({});
      return;
    }

    // Compute thumbnail URLs for all listings synchronously
    const nextMap: Record<string, string | null> = {};
    
    for (const listing of listings) {
      // Thumbnail selection rule:
      // 1. If listing has cover_image_url, resolve via toListingImagePublicUrl
      // 2. Else if listing has images[0], resolve via toListingImagePublicUrl
      // 3. Else null
      const rawImageUrl =
        (listing.cover_image_url && listing.cover_image_url.length > 0
          ? listing.cover_image_url
          : Array.isArray(listing.images) && listing.images.length > 0
          ? listing.images[0]
          : null) || null;

      nextMap[listing.id] = toListingImagePublicUrl(rawImageUrl);
    }

    // Single setState update for all thumbnails
    setThumbUrlByListingId(nextMap);
  }, [listings]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadListings();
  }, [loadListings]);

  /**
   * Navigate to the PostDeal tab (not the nested PostDeal screen in MyListingsStack).
   * This switches to the PostDeal tab which is the proper place to create a new listing.
   */
  const goToPostDealTab = () => {
    // Get the parent tab navigator to navigate to the PostDeal tab
    const parentNav = navigation.getParent<BottomTabNavigationProp<AppTabsParamList>>();
    if (parentNav) {
      parentNav.navigate('PostDeal' as never);
    } else {
      // Fallback: try direct navigation (shouldn't happen in normal flow)
      try {
        navigation.navigate('PostDeal' as never);
      } catch (err) {
        // If navigation fails, log error but don't crash
        if (__DEV__) {
          console.error('Failed to navigate to PostDeal tab:', err);
        }
      }
    }
  };

  const handleCreateListing = () => {
    goToPostDealTab();
  };

  const ensureOwner = (listing: MyListing): boolean => {
    if (!currentUserId || listing.owner_id !== currentUserId) {
      Alert.alert('Not allowed', 'You can only manage your own listings.');
      return false;
    }
    return true;
  };

  const handleEdit = (listing: MyListing) => {
    if (!ensureOwner(listing)) {
      return;
    }
    navigation.navigate('EditDeal', { listingId: listing.id });
  };

  const handleDelete = (listing: MyListing) => {
    if (!ensureOwner(listing)) {
      return;
    }

    Alert.alert(
      'Delete listing',
      'Are you sure you want to delete this listing?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setActionLoadingId(listing.id);
            try {
              const { error: deleteError } = await supabaseClient
                .from('listings')
                .delete()
                .eq('id', listing.id);

              if (deleteError) {
                Alert.alert('Error', deleteError.message);
                return;
              }

              await loadListings();
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Failed to delete listing.';
              Alert.alert('Error', message);
            } finally {
              setActionLoadingId(null);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleMarkSold = (listing: MyListing) => {
    if (!ensureOwner(listing)) {
      return;
    }

    setSelectedListingForSold(listing);
    setMarkSoldModalVisible(true);
  };

  const handleMarkSoldSave = useCallback(async () => {
    await loadListings();
  }, [loadListings]);

  const handleMakeFeatured = (listing: MyListing) => {
    if (!ensureOwner(listing)) {
      return;
    }

    setSelectedListingForFeatured(listing);
    setMakeFeaturedModalVisible(true);
  };

  const startFeaturedCheckout = useCallback(async (listingId: string) => {
    try {
      // Get Supabase session access token
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      
      if (sessionError || !session?.access_token) {
        Alert.alert('Error', 'Unable to authenticate. Please try logging in again.');
        if (__DEV__) {
          console.error('[MyListingsScreen] Session error:', sessionError);
        }
        return;
      }

      // Call the API to create Stripe Checkout session
      const response = await fetch('https://www.offaxisdeals.com/api/listings/featured-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ listingId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (__DEV__) {
          console.error('[MyListingsScreen] Featured checkout API error:', {
            status: response.status,
            statusText: response.statusText,
            body: errorText,
          });
        }
        Alert.alert(
          'Error',
          'Unable to start checkout. Please try again later.'
        );
        return;
      }

      const data = await response.json();
      
      if (!data.url || typeof data.url !== 'string') {
        if (__DEV__) {
          console.error('[MyListingsScreen] Invalid response format:', data);
        }
        Alert.alert('Error', 'Invalid response from server. Please try again.');
        return;
      }

      // Open the Stripe Checkout URL
      const canOpen = await Linking.canOpenURL(data.url);
      if (!canOpen) {
        Alert.alert('Error', 'Unable to open checkout link.');
        return;
      }

      await Linking.openURL(data.url);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (__DEV__) {
        console.error('[MyListingsScreen] Featured checkout exception:', err);
      }
      Alert.alert('Error', `Failed to start checkout: ${errorMessage}`);
    }
  }, []);

  const renderListingItem = ({ item }: { item: MyListing }) => {
    const cityState =
      item.city && item.state ? `${item.city}, ${item.state}` : item.city || item.state || '';
    const streetLine = shouldShowStreetAddress(item.address_visibility, item.address)
      ? (item.address ?? '').trim()
      : null;

    const bedsText =
      typeof item.beds === 'number' && !Number.isNaN(item.beds)
        ? `${item.beds} Beds`
        : '';
    const bathsText =
      typeof item.baths === 'number' && !Number.isNaN(item.baths)
        ? `${item.baths} Baths`
        : '';
    const sqftText =
      typeof item.sqft === 'number' && !Number.isNaN(item.sqft)
        ? `${item.sqft} Sqft`
        : '';

    const lotText =
      typeof item.lot_sqft === 'number' && !Number.isNaN(item.lot_sqft)
        ? `Lot: ${item.lot_sqft.toLocaleString()} sqft`
        : '';

    const metaParts = [bedsText, bathsText, sqftText].filter((part) => part.length > 0);
    const metaLine = metaParts.join(' · ');

    // Use precomputed thumbnail URL (no setState during render)
    const imageUrl = thumbUrlByListingId[item.id] || null;

    const isBusy = actionLoadingId === item.id;
    const isSold = item.status === 'sold';
    const isFeatured = isFeaturedActive(item);

    // Format featured_until date for display
    const formatFeaturedUntil = (dateString: string | null | undefined): string | null => {
      if (!dateString) return null;
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch {
        return null;
      }
    };

    const featuredUntilText = isFeatured && item.featured_until
      ? formatFeaturedUntil(item.featured_until)
      : null;

    return (
      <View style={styles.card}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.cardImage}
            onError={(e) => {
              if (__DEV__) {
                console.error('[MyListingsScreen] Image load error:', imageUrl, e.nativeEvent.error);
              }
            }}
          />
        ) : (
          <View style={styles.cardImagePlaceholder}>
            <Text style={styles.cardImagePlaceholderText}>No image</Text>
          </View>
        )}

        <View style={styles.cardContent}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>{item.title || 'Untitled Listing'}</Text>
            <View style={styles.badgeContainer}>
              {isSold ? (
                <Text style={styles.cardBadgeSold}>Sold</Text>
              ) : isFeatured ? (
                <Text style={styles.cardBadgeFeatured}>Featured (active)</Text>
              ) : (
                <Text style={styles.cardBadge}>My Listing</Text>
              )}
            </View>
          </View>
          {isFeatured && featuredUntilText && (
            <Text style={styles.featuredUntilText}>Featured until: {featuredUntilText}</Text>
          )}
          {streetLine && <Text style={styles.cardAddress}>{streetLine}</Text>}
          {cityState && <Text style={styles.cardAddress}>{cityState}</Text>}
          {typeof item.price === 'number' && !Number.isNaN(item.price) && (
            <Text style={styles.cardPrice}>{formatMoney(item.price, item.currency)}</Text>
          )}
          {metaLine.length > 0 && <Text style={styles.cardMeta}>{metaLine}</Text>}
          {lotText && <Text style={styles.cardMeta}>{lotText}</Text>}

          <View style={styles.cardActionsRow}>
            <TouchableOpacity
              style={styles.cardActionButton}
              onPress={() => handleEdit(item)}
              disabled={isBusy}
            >
              <Text style={styles.cardActionText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cardActionButton}
              onPress={() => handleDelete(item)}
              disabled={isBusy}
            >
              <Text style={[styles.cardActionText, styles.cardActionTextDanger]}>Delete</Text>
            </TouchableOpacity>
            {!isSold && (
              <>
                <TouchableOpacity
                  style={styles.cardActionButton}
                  onPress={() => handleMarkSold(item)}
                  disabled={isBusy}
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.cardActionText}>Mark Sold</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cardActionButton}
                  onPress={() => handleMakeFeatured(item)}
                  disabled={isBusy}
                >
                  <Text style={styles.cardActionText}>Make Featured</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No listings yet</Text>
      <Text style={styles.emptySubtitle}>Create your first listing to get started.</Text>
      <TouchableOpacity style={styles.createButton} onPress={handleCreateListing}>
        <Text style={styles.createButtonText}>Create Listing</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your listings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadListings}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={listings}
          renderItem={renderListingItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            listings.length === 0 ? styles.emptyListContainer : styles.listContainer
          }
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}
      {selectedListingForSold && (
        <MarkAsSoldModal
          visible={markSoldModalVisible}
          listingId={selectedListingForSold.id}
          onClose={() => {
            setMarkSoldModalVisible(false);
            setSelectedListingForSold(null);
          }}
          onSave={handleMarkSoldSave}
        />
      )}
      {selectedListingForFeatured && (
        <MakeFeaturedModal
          visible={makeFeaturedModalVisible}
          listingId={selectedListingForFeatured.id}
          onStartCheckout={startFeaturedCheckout}
          onClose={() => {
            setMakeFeaturedModalVisible(false);
            setSelectedListingForFeatured(null);
          }}
        />
      )}
    </SafeAreaView>
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  listContainer: {
    padding: spacing.md,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: 10,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 160,
    backgroundColor: colors.border,
  },
  cardImagePlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePlaceholderText: {
    fontSize: typography.fontSize.xs,
    color: colors.textTertiary,
  },
  cardContent: {
    padding: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardBadge: {
    fontSize: typography.fontSize.xs,
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  cardBadgeSold: {
    fontSize: typography.fontSize.xs,
    color: colors.danger,
    fontWeight: typography.fontWeight.semibold,
  },
  cardBadgeFeatured: {
    fontSize: typography.fontSize.xs,
    color: '#FF8C00',
    fontWeight: typography.fontWeight.semibold,
  },
  featuredUntilText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  cardAddress: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  cardPrice: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  cardMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  cardActionButton: {
    marginLeft: 12,
  },
  cardActionText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  cardActionTextDanger: {
    color: '#FF3B30',
  },
  emptyContainer: {
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  createButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
  },
  createButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});


