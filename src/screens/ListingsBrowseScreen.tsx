import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Modal,
  Image,
  Alert,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import { supabaseClient } from '../lib/supabase';
import { MarketplaceOnlyNotice } from '../components/ComplianceText';
import { useMapBounds } from '../contexts/MapBoundsContext';
import type { AppTabsParamList } from '../types/navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ListingsStackParamList } from '../types/navigation';
import { formatMoney } from '../utils/currency';
import { getFavoriteStatusBatch, toggleFavorite } from '../utils/watchlists';
import { useAuth } from '../contexts/AuthContext';
import { PROPERTY_TYPES, type PropertyType } from '../utils/propertyTypes';
import * as Haptics from 'expo-haptics';
import { colors, spacing, typography } from '../theme';
import { isFeaturedActive } from '../utils/featured';
import { toListingImagePublicUrl } from '../utils/listingImages';

const PRICE_QUICK_MAX = [150000, 250000, 350000, 500000] as const;

const MIN_BEDS_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Any' },
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5+' },
];

const MIN_BATHS_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Any' },
  { value: 1, label: '1+' },
  { value: 1.5, label: '1.5+' },
  { value: 2, label: '2+' },
  { value: 2.5, label: '2.5+' },
  { value: 3, label: '3+' },
];

/** Parse dollar input: strip $ and commas, return integer dollars or null. Rejects empty, invalid, or values < 1000. */
function parseDollarInput(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits === '') return null;
  const value = parseInt(digits, 10);
  if (Number.isNaN(value) || value < 1000) return null;
  return value;
}

function titleCaseWords(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((word) => {
      const w = word.toLowerCase();
      if (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(w)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function formatState(state?: string | null): string {
  return (state ?? '').trim().toUpperCase();
}

function normalizeCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function titleLooksDefault(title: string, addr1: string, addrFull: string): boolean {
  const n = normalizeCompare(title);
  if (!n) return true;
  const n1 = normalizeCompare(addr1);
  const nFull = normalizeCompare(addrFull);
  return n === n1 || n === nFull;
}

interface Listing {
  id: string;
  title?: string;
  address?: string;
  price?: number;
  created_at?: string;
  city?: string;
  state?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  lot_sqft?: number;
   cover_image_url?: string | null;
   images?: string[] | null;
  arv?: number | null;
  repairs?: number | null;
  currency?: string | null;
  status?: 'active' | 'sold' | 'draft' | 'archived' | string | null;
  property_type?: string | null;
  address_visibility?: 'exact' | 'approx' | 'hidden' | null;
  featured?: boolean | null;
  featured_until?: string | null;
  [key: string]: unknown;
}

interface ListingsBrowseScreenProps {
  navigation: {
    navigate: (screen: string, params?: { listingId?: string }) => void;
  };
}

export default function ListingsBrowseScreen({ navigation }: ListingsBrowseScreenProps) {
  const { profile } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [favoriteStatus, setFavoriteStatus] = useState<Record<string, boolean>>({});
  const [favoriteLoading, setFavoriteLoading] = useState<Record<string, boolean>>({});
  const { bounds, isBoundsActive } = useMapBounds();
  const previousBoundsRef = useRef<typeof bounds | null>(null);
  const stackNavigation = useNavigation<NativeStackNavigationProp<ListingsStackParamList>>();
  const insets = useSafeAreaInsets();
  const [filtersVisible, setFiltersVisible] = useState(false);
  
  // Filter state - multi-select property types and numeric filters
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<PropertyType[]>([]);
  const [minBeds, setMinBeds] = useState<string>('');
  const [minBaths, setMinBaths] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [quickNew3d, setQuickNew3d] = useState<boolean>(false);
  const [hasPhotos, setHasPhotos] = useState<boolean>(false);
  const [quickBigSpread, setQuickBigSpread] = useState<boolean>(false);
  const [quickBestDiscount, setQuickBestDiscount] = useState<boolean>(false);
  const [quickLowRehab, setQuickLowRehab] = useState<boolean>(false);

  const renderCountRef = useRef(0);
  const scrollLogRef = useRef<number>(0);
  renderCountRef.current += 1;
  if (__DEV__ && renderCountRef.current % 10 === 0) {
    console.log('[ListingsBrowse perf]', {
      renderCount: renderCountRef.current,
      listingsLength: listings.length,
      isFiltersOpen: filtersVisible,
      quickNew3d,
      hasPhotos,
      quickBigSpread,
      quickBestDiscount,
      quickLowRehab,
    });
  }

  const loadListings = useCallback(async () => {
    // Set loading to true if not already
    if (!loading) {
      setLoading(true);
    }
    setError(null);
    // DO NOT clear listings at the start of the fetch

    try {
      let query = supabaseClient
        .from('listings')
        .select(
          [
            'id',
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
            'property_type',
            'address_visibility',
            'featured',
            'featured_until',
          ].join(', ')
        );

      // Only apply bounds filters if bounds are active
      if (isBoundsActive) {
        query = query
          .gte('latitude', bounds.minLat)
          .lte('latitude', bounds.maxLat)
          .gte('longitude', bounds.minLng)
          .lte('longitude', bounds.maxLng)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null);
      }

      // Filter to only show active listings
      query = query.eq('status', 'active');

      // Quick filter: New (≤ 3d)
      if (quickNew3d) {
        const cutoffIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('created_at', cutoffIso);
      }

      // Apply Property Type filter (multi-select)
      if (selectedPropertyTypes.length > 0) {
        query = query.in('property_type', selectedPropertyTypes);
      }

      // Apply Min Beds filter
      if (minBeds.trim() !== '') {
        const bedsNum = parseInt(minBeds.trim(), 10);
        if (!isNaN(bedsNum) && bedsNum > 0) {
          query = query.gte('beds', bedsNum);
        }
      }

      // Apply Min Baths filter
      if (minBaths.trim() !== '') {
        const bathsNum = parseFloat(minBaths.trim());
        if (!isNaN(bathsNum) && bathsNum > 0) {
          query = query.gte('baths', bathsNum);
        }
      }

      // Apply Min Price filter (parsed integer dollars, >= 1000)
      const parsedMin = parseDollarInput(minPrice);
      if (parsedMin !== null) {
        query = query.gte('price', parsedMin);
      }

      // Apply Max Price filter (parsed integer dollars, >= 1000)
      const parsedMax = parseDollarInput(maxPrice);
      if (parsedMax !== null) {
        query = query.lte('price', parsedMax);
      }

      const { data, error: queryError } = await query
        .order('created_at', { ascending: false })
        .limit(50);

      if (queryError) {
        setError(queryError.message);
        setHasLoadedOnce(true);
        // DO NOT setListings([]) - keep prior list visible
        return;
      }

      const typedData = (data ?? []) as unknown as Listing[];

      // Client-side filters (no DB columns for spread; use row fields for hasPhotos)
      let dataToSort = typedData;
      if (quickBigSpread || hasPhotos || quickBestDiscount || quickLowRehab) {
        dataToSort = typedData.filter((row) => {
          if (quickBigSpread) {
            const arv = row.arv;
            const price = typeof row.price === 'number' && !Number.isNaN(row.price) ? row.price : null;
            if (arv == null || price == null) return false;
            const repairs = typeof row.repairs === 'number' && !Number.isNaN(row.repairs) ? row.repairs : 0;
            const computedSpread = arv - price - (repairs ?? 0);
            if (computedSpread < 50000) return false;
          }
          if (hasPhotos) {
            const hasCover = row.cover_image_url != null && String(row.cover_image_url).trim().length > 0;
            const hasImages = Array.isArray(row.images) && row.images.length > 0;
            if (!hasCover && !hasImages) return false;
          }
          if (quickBestDiscount) {
            const arv = row.arv;
            const price = typeof row.price === 'number' && !Number.isNaN(row.price) ? row.price : 0;
            if (arv == null || arv <= 0 || price <= 0) return false;
            const discount = (arv - price) / arv;
            if (discount < 0.2) return false;
          }
          if (quickLowRehab) {
            const repairs = row.repairs;
            if (repairs == null) return false;
            if (typeof repairs !== 'number' || Number.isNaN(repairs) || repairs > 30000) return false;
          }
          return true;
        });
      }

      // Sort: featured listings first, then by created_at (newest first)
      const sortedData = [...dataToSort].sort((a, b) => {
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
      setHasLoadedOnce(true);
      setError(null);

      // Check favorite status for all listings if user is eligible (investor + paid)
      const canUseWatchlists = profile?.role === 'investor' && profile?.is_paid === true;
      if (canUseWatchlists && profile?.id && typedData.length > 0) {
        try {
          const listingIds = typedData.map((listing) => listing.id);
          const statusMap = await getFavoriteStatusBatch(supabaseClient, profile.id, listingIds);
          setFavoriteStatus(statusMap);
        } catch (err) {
          if (__DEV__) {
            console.error('[ListingsBrowse] Error batch checking favorite status:', err);
          }
          // On error, set empty map (all listings show as not favorited)
          setFavoriteStatus({});
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load listings';
      setError(errorMessage);
      setHasLoadedOnce(true);
      // DO NOT setListings([]) - keep prior list visible
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bounds, isBoundsActive, loading, profile?.id, selectedPropertyTypes, minBeds, minBaths, minPrice, maxPrice, quickNew3d, hasPhotos, quickBigSpread, quickBestDiscount, quickLowRehab]);

  useFocusEffect(
    useCallback(() => {
      loadListings();
    }, [loadListings])
  );

  // Refresh listings when bounds change (even if screen is already focused)
  useEffect(() => {
    if (!isBoundsActive || !bounds) {
      return;
    }

    if (previousBoundsRef.current === null) {
      previousBoundsRef.current = bounds;
      return;
    }

    const boundsChanged =
      previousBoundsRef.current.minLat !== bounds.minLat ||
      previousBoundsRef.current.maxLat !== bounds.maxLat ||
      previousBoundsRef.current.minLng !== bounds.minLng ||
      previousBoundsRef.current.maxLng !== bounds.maxLng;

    if (boundsChanged) {
      previousBoundsRef.current = bounds;
      loadListings();
    }
  }, [bounds, loadListings]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadListings();
  }, [loadListings]);


  const handleListingPress = (listingId: string) => {
    navigation.navigate('ListingDetails', { listingId });
  };

  const handleMapBannerPress = () => {
    // Navigate to Map tab using parent navigator
    const parent = stackNavigation.getParent();
    if (parent) {
      (parent as NavigationProp<AppTabsParamList>).navigate('Map' as never);
    }
  };

  // Full address line: "123 Main St, City, ST" or fallback "City, ST" when no street
  const getFullAddressLine = (listing: Listing): string => {
    const address = titleCaseWords(listing.address ?? '');
    const city = titleCaseWords(listing.city ?? '');
    const state = formatState(listing.state);
    const cityState = [city, state].filter(Boolean).join(', ');
    if (address) {
      return cityState ? `${address}, ${cityState}` : address;
    }
    return cityState || '';
  };

  const renderListingItem = ({ item }: { item: Listing }) => {
    const t0 = (global as { performance?: { now?: () => number } }).performance?.now?.() ?? Date.now();
    const rawImageUrl =
      (item.cover_image_url && item.cover_image_url.length > 0
        ? item.cover_image_url
        : Array.isArray(item.images) && item.images.length > 0
        ? item.images[0]
        : null) || null;
    
    const imageUrl = toListingImagePublicUrl(rawImageUrl);

    const rawAddress = (item.address ?? '').trim();
    const rawCity = (item.city ?? '').trim();
    const rawState = (item.state ?? '').trim();
    const rawFullAddress = [rawAddress, rawCity, rawState].filter(Boolean).join(', ');
    const formattedFullAddressLine = getFullAddressLine(item);
    const rawTitle = (item.title ?? '').trim();
    const isDefault =
      rawTitle.length === 0 || titleLooksDefault(rawTitle, rawAddress, rawFullAddress);
    const displayTitle = isDefault ? formattedFullAddressLine : titleCaseWords(rawTitle);

    const isFeatured = isFeaturedActive(item);
    const createdAt = item.created_at ? new Date(item.created_at).getTime() : NaN;
    const tomDays = !Number.isNaN(createdAt) ? Math.floor((Date.now() - createdAt) / 86400000) : null;
    const tomBadgeLabel =
      tomDays !== null
        ? tomDays <= 3
          ? `TOM ${tomDays}d • New`
          : `TOM ${tomDays}d`
        : null;
    const photoCount = Array.isArray(item.images) && item.images.length > 0
      ? item.images.length
      : (item.cover_image_url && String(item.cover_image_url).trim().length > 0)
        ? 1
        : 0;

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
    const metaLine = metaParts.length > 0 ? metaParts.join(' · ') : '';
    const fullMetaLine = [metaLine, lotText].filter((part) => part.length > 0).join(' · ');

    // ARV / Spread / ROI% (same formula as ListingDetailsScreen)
    const formatCompact = (n: number) =>
      n >= 1000000 ? `$${Math.round(n / 1000000)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
    const arvVal = typeof item.arv === 'number' && !Number.isNaN(item.arv) ? item.arv : null;
    const priceVal = typeof item.price === 'number' && !Number.isNaN(item.price) ? item.price : null;
    const repairsVal = typeof item.repairs === 'number' && !Number.isNaN(item.repairs) ? item.repairs : 0;
    const spreadVal = arvVal !== null && priceVal !== null
      ? arvVal - priceVal - repairsVal
      : null;
    const roiPct = spreadVal !== null && priceVal !== null && priceVal > 0
      ? (spreadVal / priceVal) * 100
      : null;
    const hasInvestmentMetrics = arvVal !== null || spreadVal !== null || roiPct !== null;

    const isFavorited = favoriteStatus[item.id] === true;
    const isFavoriteLoading = favoriteLoading[item.id] === true;
    const canUseWatchlists = profile?.role === 'investor' && profile?.is_paid === true;

    const handleToggleFavorite = async () => {
      if (!canUseWatchlists || !profile?.id || isFavoriteLoading) {
        return;
      }

      setFavoriteLoading((prev) => ({ ...prev, [item.id]: true }));

      try {
        const newFavoriteState = !isFavorited;
        await toggleFavorite(supabaseClient, profile.id, item.id, newFavoriteState);
        setFavoriteStatus((prev) => ({ ...prev, [item.id]: newFavoriteState }));
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch (_) {}
      } catch (err) {
        if (__DEV__) {
          console.error('[ListingsBrowse] Error toggling favorite:', err);
        }
        Alert.alert('Error', 'Failed to update favorite status. Please try again.');
      } finally {
        setFavoriteLoading((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    };

    const card = (
      <TouchableOpacity
        style={[styles.listingItem, isFeatured && styles.listingItemFeatured]}
        onPress={() => handleListingPress(item.id)}
        activeOpacity={0.7}
      >
        {imageUrl ? (
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: imageUrl }}
              style={styles.listingImage}
              resizeMode="cover"
              onError={(e) => {
                if (__DEV__) {
                  console.error('[ListingsBrowseScreen] Image load error:', imageUrl, e.nativeEvent.error);
                }
              }}
            />
            {isFeatured && (
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>FEATURED</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.imageContainer}>
            <View style={styles.listingImagePlaceholder}>
              <Text style={styles.listingImagePlaceholderText}>No image</Text>
            </View>
            {isFeatured && (
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>FEATURED</Text>
              </View>
            )}
          </View>
        )}
        <View style={styles.listingContent}>
          <View style={styles.listingHeaderRow}>
            <View style={styles.listingTextContent}>
              <View style={styles.listingTitleRow}>
                <Text style={styles.listingTitle} numberOfLines={2}>
                  {displayTitle || 'Untitled Listing'}
                </Text>
                <View style={styles.trustBadges}>
                  <View style={styles.trustBadge}>
                    <Text style={styles.trustBadgeText}>Off-Market</Text>
                  </View>
                  <View style={styles.trustBadge}>
                    <Text style={styles.trustBadgeText}>Direct from Wholesaler</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
          {((typeof item.price === 'number' && !Number.isNaN(item.price)) || canUseWatchlists) && (
            <View style={styles.listingPriceRow}>
              <View style={styles.listingPriceLeft}>
                {typeof item.price === 'number' && !Number.isNaN(item.price) && (
                  <Text style={styles.listingPrice}>{formatMoney(item.price, item.currency)}</Text>
                )}
              </View>
              {canUseWatchlists && (
                <TouchableOpacity
                  style={[styles.savePillButton, isFavorited && styles.savePillButtonActive]}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  disabled={isFavoriteLoading}
                >
                  <Text style={[styles.savePillIcon, isFavorited && styles.savePillTextActive]}>
                    {isFavorited ? '★' : '☆'}
                  </Text>
                  <Text
                    style={[
                      styles.savePillText,
                      isFavorited && styles.savePillTextActive,
                    ]}
                  >
                    {isFavorited ? 'Saved' : 'Save'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {fullMetaLine ? <Text style={styles.listingMeta}>{fullMetaLine}</Text> : null}
          {hasInvestmentMetrics ? (
            <View style={styles.listingMetricsBlock}>
              {arvVal !== null && (
                <>
                  <View style={styles.listingMetricsColumn}>
                    <Text style={styles.listingMetricsLabel}>ARV</Text>
                    <Text style={styles.listingMetricsValue}>{formatCompact(arvVal)}</Text>
                  </View>
                  {(spreadVal !== null || roiPct !== null) && <View style={styles.listingMetricsDivider} />}
                </>
              )}
              {spreadVal !== null && (
                <>
                  <View style={styles.listingMetricsColumn}>
                    <Text style={styles.listingMetricsLabel}>SPREAD</Text>
                    <Text style={styles.listingMetricsValue}>{formatCompact(spreadVal)}</Text>
                  </View>
                  {roiPct !== null && <View style={styles.listingMetricsDivider} />}
                </>
              )}
              {roiPct !== null && (
                <View style={styles.listingMetricsColumn}>
                  <Text style={styles.listingMetricsLabel}>ROI</Text>
                  <Text style={styles.listingMetricsValue}>{roiPct.toFixed(1)}%</Text>
                </View>
              )}
            </View>
          ) : null}
          {(isFeatured || tomBadgeLabel || photoCount > 0) && (
            <View style={styles.listingBadgesRow}>
              {isFeatured && (
                <View style={styles.listingBadge}>
                  <Text style={styles.listingBadgeText}>Featured</Text>
                </View>
              )}
              {tomBadgeLabel && (
                <View style={styles.listingBadge}>
                  <Text style={styles.listingBadgeText}>{tomBadgeLabel}</Text>
                </View>
              )}
              {photoCount > 0 && (
                <View style={styles.listingBadge}>
                  <Text style={styles.listingBadgeText}>Photos: {photoCount}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
    const t1 = (global as { performance?: { now?: () => number } }).performance?.now?.() ?? Date.now();
    if (__DEV__) {
      const ms = t1 - t0;
      if (ms > 8) {
        console.log('[ListingsBrowse perf] Slow card render', item.id, ms.toFixed(1), 'ms');
      }
    }
    return card;
  };

  const handleClearFilters = useCallback(() => {
    setSelectedPropertyTypes([]);
    setMinBeds('');
    setMinBaths('');
    setMinPrice('');
    setMaxPrice('');
    setQuickNew3d(false);
    setHasPhotos(false);
    setQuickBigSpread(false);
    setQuickBestDiscount(false);
    setQuickLowRehab(false);
    setFilterError(null);
    setFiltersVisible(false);
    loadListings();
  }, [loadListings]);

  const renderEmptyState = () => {
    // Only show empty state when hasLoadedOnce && !loading && listings.length === 0
    if (!hasLoadedOnce || loading || listings.length > 0) {
      return null;
    }
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No deals match your filters</Text>
          <Text style={styles.emptySubtitle}>Try widening your price range or clearing filters.</Text>
          <TouchableOpacity style={styles.emptyPrimaryButton} onPress={handleClearFilters}>
            <Text style={styles.emptyPrimaryButtonText}>Clear filters</Text>
          </TouchableOpacity>
          <Text style={styles.emptySecondaryText}>New off-market deals are added daily.</Text>
        </View>
      </View>
    );
  };

  // Only show full-screen loader on initial load (before hasLoadedOnce)
  if (loading && !hasLoadedOnce) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading listings...</Text>
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
        <>
          {/* Filters and Bounds banner row */}
          <View style={styles.filtersRow}>
            <TouchableOpacity
              style={styles.filtersButton}
              onPress={() => setFiltersVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.filtersButtonText}>Filters</Text>
              {(() => {
                const activeFilterCount = 
                  selectedPropertyTypes.length +
                  (minBeds.trim() ? 1 : 0) +
                  (minBaths.trim() ? 1 : 0) +
                  (minPrice.trim() ? 1 : 0) +
                  (maxPrice.trim() ? 1 : 0);
                return activeFilterCount > 0 ? (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                  </View>
                ) : null;
              })()}
            </TouchableOpacity>
            {isBoundsActive && (
              <TouchableOpacity
                style={styles.mapBanner}
                onPress={handleMapBannerPress}
                activeOpacity={0.7}
              >
                <Text style={styles.mapBannerIcon}>🗺️</Text>
                <View style={styles.mapBannerTextContainer}>
                  <Text style={styles.mapBannerTitle}>Viewing map area</Text>
                  <Text style={styles.mapBannerSubtext}>Tap to adjust on map</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={listings}
            renderItem={renderListingItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={listings.length === 0 ? styles.emptyListContainer : styles.listContainer}
            ListEmptyComponent={renderEmptyState}
            ListHeaderComponent={
              listings.length > 0 ? (
                <View style={styles.resultsHeader}>
                  <Text style={styles.resultsHeaderText}>Latest Off-Market Deals</Text>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            scrollEventThrottle={16}
            onScroll={
              __DEV__
                ? (e) => {
                    const now = Date.now();
                    if (now - scrollLogRef.current > 1000) {
                      const dt = scrollLogRef.current > 0 ? now - scrollLogRef.current : 0;
                      scrollLogRef.current = now;
                      console.log('[ListingsBrowse perf] scroll', {
                        contentOffsetY: e.nativeEvent.contentOffset.y,
                        dt,
                      });
                    }
                  }
                : undefined
            }
          />
        </>
      )}

      {/* Filters Modal */}
      <Modal
        visible={filtersVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setFilterError(null);
          setFiltersVisible(false);
        }}
      >
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalContent}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity
                style={styles.filterModalCloseButton}
                onPress={() => {
                  setFilterError(null);
                  setFiltersVisible(false);
                }}
              >
                <Text style={styles.filterModalCloseButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.filterModalBody} contentContainerStyle={styles.filterModalBodyContent}>
              {/* Quick Filters */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Quick Filters</Text>
                <View style={styles.filterSectionBody}>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[
                      styles.priceQuickButton,
                      quickNew3d && styles.priceQuickButtonSelected,
                    ]}
                    onPress={() => setQuickNew3d(!quickNew3d)}
                  >
                    <Text
                      style={[
                        styles.priceQuickButtonText,
                        quickNew3d && styles.priceQuickButtonTextSelected,
                      ]}
                    >
                      New (≤ 3d)
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.priceQuickButton,
                      hasPhotos && styles.priceQuickButtonSelected,
                    ]}
                    onPress={() => setHasPhotos(!hasPhotos)}
                  >
                    <Text
                      style={[
                        styles.priceQuickButtonText,
                        hasPhotos && styles.priceQuickButtonTextSelected,
                      ]}
                    >
                      Has Photos
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.priceQuickButton,
                      quickBigSpread && styles.priceQuickButtonSelected,
                    ]}
                    onPress={() => setQuickBigSpread(!quickBigSpread)}
                  >
                    <Text
                      style={[
                        styles.priceQuickButtonText,
                        quickBigSpread && styles.priceQuickButtonTextSelected,
                      ]}
                    >
                      Big Spread (≥ $50k)
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.priceQuickButton,
                      quickBestDiscount && styles.priceQuickButtonSelected,
                    ]}
                    onPress={() => setQuickBestDiscount(!quickBestDiscount)}
                  >
                    <Text
                      style={[
                        styles.priceQuickButtonText,
                        quickBestDiscount && styles.priceQuickButtonTextSelected,
                      ]}
                    >
                      Best Discount (≥ 20%)
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.priceQuickButton,
                      quickLowRehab && styles.priceQuickButtonSelected,
                    ]}
                    onPress={() => setQuickLowRehab(!quickLowRehab)}
                  >
                    <Text
                      style={[
                        styles.priceQuickButtonText,
                        quickLowRehab && styles.priceQuickButtonTextSelected,
                      ]}
                    >
                      Low Rehab (≤ $30k)
                    </Text>
                  </Pressable>
                </View>
                </View>
              </View>

              {/* Property Type */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Property Type</Text>
                <View style={styles.filterSectionBody}>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[
                      styles.priceQuickButton,
                      selectedPropertyTypes.length === 0 && styles.priceQuickButtonSelected,
                    ]}
                    onPress={() => setSelectedPropertyTypes([])}
                  >
                    <Text
                      style={[
                        styles.priceQuickButtonText,
                        selectedPropertyTypes.length === 0 && styles.priceQuickButtonTextSelected,
                      ]}
                    >
                      All Types
                    </Text>
                  </Pressable>
                  {PROPERTY_TYPES.map((item) => {
                    const isSelected = selectedPropertyTypes.includes(item);
                    return (
                      <Pressable
                        key={item}
                        style={[
                          styles.priceQuickButton,
                          isSelected && styles.priceQuickButtonSelected,
                        ]}
                        onPress={() => {
                          if (isSelected) {
                            setSelectedPropertyTypes(selectedPropertyTypes.filter((t) => t !== item));
                          } else {
                            setSelectedPropertyTypes([...selectedPropertyTypes, item]);
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.priceQuickButtonText,
                            isSelected && styles.priceQuickButtonTextSelected,
                          ]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                </View>
              </View>

              {/* Beds */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Min Beds</Text>
                <View style={styles.filterSectionBody}>
                <View style={styles.chipRow}>
                  {MIN_BEDS_OPTIONS.map((opt) => {
                    const parsed = minBeds.trim() !== '' ? parseInt(minBeds.trim(), 10) : null;
                    const isSelected = opt.value === null ? parsed === null : parsed === opt.value;
                    return (
                      <Pressable
                        key={opt.value ?? 'any'}
                        style={[
                          styles.priceQuickButton,
                          isSelected && styles.priceQuickButtonSelected,
                        ]}
                        onPress={() => setMinBeds(opt.value === null ? '' : String(opt.value))}
                      >
                        <Text
                          style={[
                            styles.priceQuickButtonText,
                            isSelected && styles.priceQuickButtonTextSelected,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                </View>
              </View>

              {/* Baths */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Min Baths</Text>
                <View style={styles.filterSectionBody}>
                <View style={styles.chipRow}>
                  {MIN_BATHS_OPTIONS.map((opt) => {
                    const parsed = minBaths.trim() !== '' ? parseFloat(minBaths.trim()) : null;
                    const isSelected =
                      opt.value === null ? parsed === null : parsed !== null && parsed === opt.value;
                    return (
                      <Pressable
                        key={opt.value ?? 'any'}
                        style={[
                          styles.priceQuickButton,
                          isSelected && styles.priceQuickButtonSelected,
                        ]}
                        onPress={() => setMinBaths(opt.value === null ? '' : String(opt.value))}
                      >
                        <Text
                          style={[
                            styles.priceQuickButtonText,
                            isSelected && styles.priceQuickButtonTextSelected,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                </View>
              </View>

              {/* Price */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Price</Text>
                <View style={styles.filterSectionBody}>
                <View style={styles.row}>
                  <View style={[styles.field, styles.halfField]}>
                    <Text style={styles.filterLabel}>Min price</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., $150,000"
                      placeholderTextColor={colors.textTertiary}
                      selectionColor={colors.primary}
                      value={minPrice}
                      onChangeText={setMinPrice}
                      keyboardType="numeric"
                    />
                    <Text style={[styles.filterLabel, styles.maxPresetsLabel]}>Min presets</Text>
                    <View style={styles.priceQuickRow}>
                      <Pressable
                        style={[
                          styles.priceQuickButton,
                          parseDollarInput(minPrice) === null && styles.priceQuickButtonSelected,
                        ]}
                        onPress={() => setMinPrice('')}
                      >
                        <Text
                          style={[
                            styles.priceQuickButtonText,
                            parseDollarInput(minPrice) === null && styles.priceQuickButtonTextSelected,
                          ]}
                        >
                          Any
                        </Text>
                      </Pressable>
                      {PRICE_QUICK_MAX.map((val) => {
                        const isSelected = parseDollarInput(minPrice) === val;
                        return (
                          <Pressable
                            key={val}
                            style={[
                              styles.priceQuickButton,
                              isSelected && styles.priceQuickButtonSelected,
                            ]}
                            onPress={() => {
                              if (isSelected) {
                                setMinPrice('');
                              } else {
                                setMinPrice('$' + val.toLocaleString('en-US'));
                              }
                            }}
                          >
                            <Text
                              style={[
                                styles.priceQuickButtonText,
                                isSelected && styles.priceQuickButtonTextSelected,
                              ]}
                            >
                              {`${val / 1000}k`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={[styles.field, styles.halfField]}>
                    <Text style={styles.filterLabel}>Max price</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., $500,000"
                      placeholderTextColor={colors.textTertiary}
                      selectionColor={colors.primary}
                      value={maxPrice}
                      onChangeText={setMaxPrice}
                      keyboardType="numeric"
                    />
                    <Text style={[styles.filterLabel, styles.maxPresetsLabel]}>Max presets</Text>
                    <View style={styles.priceQuickRow}>
                      <Pressable
                        style={[
                          styles.priceQuickButton,
                          parseDollarInput(maxPrice) === null && styles.priceQuickButtonSelected,
                        ]}
                        onPress={() => setMaxPrice('')}
                      >
                        <Text
                          style={[
                            styles.priceQuickButtonText,
                            parseDollarInput(maxPrice) === null && styles.priceQuickButtonTextSelected,
                          ]}
                        >
                          Any
                        </Text>
                      </Pressable>
                      {PRICE_QUICK_MAX.map((val) => {
                        const isSelected = parseDollarInput(maxPrice) === val;
                        return (
                          <Pressable
                            key={val}
                            style={[
                              styles.priceQuickButton,
                              isSelected && styles.priceQuickButtonSelected,
                            ]}
                            onPress={() => {
                              if (isSelected) {
                                setMaxPrice('');
                              } else {
                                setMaxPrice('$' + val.toLocaleString('en-US'));
                              }
                            }}
                          >
                            <Text
                              style={[
                                styles.priceQuickButtonText,
                                isSelected && styles.priceQuickButtonTextSelected,
                              ]}
                            >
                              {`${val / 1000}k`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>
                </View>
              </View>
            </ScrollView>
            {filterError && (
              <View style={styles.filterErrorContainer}>
                <Text style={styles.filterErrorText}>{filterError}</Text>
              </View>
            )}
            <SafeAreaView edges={['bottom']} style={styles.filterModalFooterContainer}>
              <View style={styles.filterModalFooter}>
                <TouchableOpacity
                  style={styles.filterClearButton}
                  onPress={handleClearFilters}
                >
                  <Text style={styles.filterClearButtonText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.filterApplyButton}
                  onPress={() => {
                    setFilterError(null);
                    const parsedMin = parseDollarInput(minPrice);
                    const parsedMax = parseDollarInput(maxPrice);
                    if (minPrice.trim() !== '' && parsedMin === null) {
                      setFilterError('Min price must be at least $1,000 or empty.');
                      return;
                    }
                    if (maxPrice.trim() !== '' && parsedMax === null) {
                      setFilterError('Max price must be at least $1,000 or empty.');
                      return;
                    }
                    if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
                      setFilterError('Min price cannot exceed max price.');
                      return;
                    }
                    setFiltersVisible(false);
                    loadListings();
                  }}
                >
                  <Text style={styles.filterApplyButtonText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </View>
        </View>
      </Modal>

      {/* Info modal with marketplace disclaimer */}
      <Modal
        visible={infoVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setInfoVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>About Off Axis Deals</Text>
              <TouchableOpacity onPress={() => setInfoVisible(false)}>
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <MarketplaceOnlyNotice />
            </View>
          </View>
        </View>
      </Modal>
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
    paddingTop: spacing.xs,
  },
  emptyListContainer: {
    flex: 1,
  },
  listingItem: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  listingItemFeatured: {
    borderColor: '#FF8C00',
    borderWidth: 2,
  },
  imageContainer: {
    position: 'relative',
  },
  featuredBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    backgroundColor: '#FF8C00',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 4,
    zIndex: 1,
  },
  featuredBadgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  listingContent: {
    padding: 14,
  },
  listingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  listingTextContent: {
    flex: 1,
    minWidth: 0,
  },
  listingTitleRow: {
    marginBottom: spacing.xs,
  },
  trustBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  trustBadge: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  trustBadgeText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeight.medium,
  },
  listingImage: {
    width: '100%',
    height: 160,
    borderRadius: 6,
    marginBottom: spacing.sm,
    backgroundColor: colors.border,
  },
  savePillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    gap: spacing.xs,
    minWidth: 70,
  },
  savePillButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  savePillIcon: {
    fontSize: typography.fontSize.sm,
  },
  savePillText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
  },
  savePillTextActive: {
    color: colors.textInverse,
  },
  listingImagePlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 6,
    marginBottom: spacing.sm,
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
  },
  listingMeta: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.textSecondary,
    marginTop: 6,
  },
  listingMetricsBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.borderLight,
    marginTop: 8,
  },
  listingMetricsColumn: {
    flex: 1,
    alignItems: 'center',
  },
  listingMetricsLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  listingMetricsValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  listingMetricsDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  listingPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: spacing.sm,
  },
  listingPriceLeft: {
    flex: 1,
    minWidth: 0,
  },
  listingPrice: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  listingBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  listingBadge: {
    backgroundColor: colors.borderLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  listingBadgeText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    fontWeight: typography.fontWeight.medium,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  emptyCard: {
    backgroundColor: colors.backgroundElevated,
    padding: spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
  },
  emptyTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  emptyPrimaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyPrimaryButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textInverse,
  },
  emptySecondaryText: {
    fontSize: typography.fontSize.sm,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  modalCloseText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  modalBody: {
    marginTop: spacing.xs,
  },
  mapBanner: {
    backgroundColor: colors.backgroundElevated,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapBannerIcon: {
    fontSize: typography.fontSize.lg,
    marginRight: 10,
  },
  mapBannerTextContainer: {
    flex: 1,
  },
  mapBannerTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: 2,
  },
  mapBannerSubtext: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  contextBand: {
    backgroundColor: '#f8f8f8',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  contextBandTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  contextBandTrustHelper: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: 6,
    marginBottom: 10,
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
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  resultsHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    marginBottom: spacing.xs,
  },
  resultsHeaderText: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  filtersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  filtersButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
  },
  filterBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
    paddingHorizontal: 6,
  },
  filterBadgeText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  filterModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  filterModalContent: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  filterModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  filterModalTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  filterModalCloseButton: {
    padding: spacing.sm,
  },
  filterModalCloseButtonText: {
    fontSize: typography.fontSize['2xl'],
    color: colors.textSecondary,
  },
  filterModalBody: {
    maxHeight: 400,
  },
  filterModalBodyContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  filterSection: {
    marginTop: 16,
    marginBottom: 16,
    paddingHorizontal: spacing.md,
  },
  filterSectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: 0,
  },
  filterSectionBody: {
    marginTop: 8,
  },
  filterLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  maxPresetsLabel: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  filterOptionSelected: {
    backgroundColor: '#F0F8FF',
  },
  filterOptionText: {
    fontSize: typography.fontSize.base,
    color: colors.text,
  },
  filterOptionTextSelected: {
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  filterOptionCheck: {
    fontSize: typography.fontSize.lg,
    color: colors.primary,
    fontWeight: typography.fontWeight.bold,
  },
  filterErrorContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  filterErrorText: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
  },
  filterModalFooterContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.backgroundElevated,
    paddingTop: spacing.md,
  },
  filterModalFooter: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  filterInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.text,
    backgroundColor: colors.backgroundElevated,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    marginBottom: spacing.lg,
  },
  halfField: {
    flex: 1,
    marginBottom: spacing.md,
  },
  priceQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
    marginBottom: 0,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priceQuickButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priceQuickButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  priceQuickButtonText: {
    fontSize: typography.fontSize.sm,
    color: colors.text,
  },
  priceQuickButtonTextSelected: {
    color: colors.textInverse,
  },
  label: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: typography.fontSize.base,
    color: colors.text,
    backgroundColor: colors.backgroundElevated,
  },
  priceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  priceInputContainer: {
    flex: 1,
  },
  priceLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  filterClearButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
  },
  filterClearButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
  },
  filterApplyButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  filterApplyButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textInverse,
  },
});
