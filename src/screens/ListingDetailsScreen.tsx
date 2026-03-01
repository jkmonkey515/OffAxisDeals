import { memo, useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { supabaseClient } from '../lib/supabase';
import { useProfileWithPermissions, has } from '../permissions/permissions';
import { ListingDetailDisclaimer } from '../components/ComplianceText';
import { getOrCreateConversationForListing } from '../utils/messaging';
import { qalog, qaError } from '../utils/qalog';
import { openExternalUrl } from '../utils/openExternalUrl';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import type { ListingDetailsNavigationProp } from '../types/navigation';
import type { ListingsStackParamList, MyListingsStackParamList, AppStackParamList } from '../types/navigation';
import * as Haptics from 'expo-haptics';
import { formatMoney } from '../utils/currency';
import { isListingFavorited, toggleFavorite } from '../utils/watchlists';
import { colors, spacing, typography } from '../theme';
import { toListingImagePublicUrl } from '../utils/listingImages';

const PRICING_URL = 'https://www.offaxisdeals.com/pricing';

/** Normalize description: trim, fix newlines, collapse excessive whitespace. */
function normalizeDescription(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

/** Format raw property_type enum to human label. */
function formatPropertyType(pt?: string | null): string {
  const s = (pt ?? '').trim().toLowerCase();
  if (!s) return 'N/A';
  const map: Record<string, string> = {
    sfr: 'SFR',
    single_family: 'Single Family',
    multi_family: 'Multifamily',
    multifamily: 'Multifamily',
    townhome: 'Townhome',
    townhouse: 'Townhouse',
    condo: 'Condo',
    land: 'Land',
    other: 'Other',
    manufactured: 'Manufactured',
    commercial: 'Commercial',
    '55+_community': '55+ Community',
  };
  if (map[s]) return map[s];
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ListingDetailsScreenProps {
  route: RouteProp<ListingsStackParamList | MyListingsStackParamList | AppStackParamList, 'ListingDetails'>;
}

interface ListingDetail {
  id: string;
  owner_id: string;
  title?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  lot_sqft?: number;
  cover_image_url?: string | null;
  images?: string[] | null;
  description?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  status?: string | null;
  arv?: number | null;
  repairs?: number | null;
  year_built?: number | null;
  garage_spaces?: number | null;
  property_type?: string | null;
  currency?: string | null;
  address_visibility?: 'exact' | 'approx' | 'hidden' | null;
}

// Database row type for listings query
interface ListingDetailRow {
  id: string;
  owner_id: string;
  title?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lot_sqft?: number | null;
  cover_image_url?: string | null;
  images?: string[] | null;
  description?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  status?: string | null;
  arv?: number | null;
  repairs?: number | null;
  year_built?: number | null;
  garage_spaces?: number | null;
  property_type?: string | null;
  currency?: string | null;
  address_visibility?: 'exact' | 'approx' | 'hidden' | null;
}

type ImageCarouselProps = {
  images: ReadonlyArray<string>;
  activeIndex: number;
  onIndexChange: (index: number) => void;
  onPressImage: (index: number) => void;
  screenWidth: number;
};

const ImageCarousel = memo(function ImageCarousel({
  images,
  activeIndex,
  onIndexChange,
  onPressImage,
  screenWidth,
}: ImageCarouselProps) {
  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        scrollArea: { width: screenWidth },
        slide: { width: screenWidth, justifyContent: 'center' },
        image: { width: screenWidth },
      }),
    [screenWidth]
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / screenWidth);
      onIndexChange(index);
    },
    [onIndexChange, screenWidth]
  );

  const handlePress = useCallback(
    (index: number) => {
      onPressImage(index);
    },
    [onPressImage]
  );

  if (images.length === 0) {
    return null;
  }

  return (
    <View style={styles.carouselContainer}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={dynamicStyles.scrollArea}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {images.map((url, index) => (
          <TouchableOpacity
            key={`${url}-${index}`}
            activeOpacity={0.9}
            style={dynamicStyles.slide}
            onPress={() => handlePress(index)}
          >
            <Image
              source={{ uri: url }}
              style={[styles.heroImage, dynamicStyles.image]}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.carouselOverlay}>
        <View style={styles.carouselDots}>
          {images.map((_, index) => (
            <View
              key={`dot-${index}`}
              style={[
                styles.carouselDot,
                index === activeIndex && styles.carouselDotActive,
              ]}
            />
          ))}
        </View>
        <Text style={styles.carouselCounter}>
          {`${activeIndex + 1}/${images.length}`}
        </Text>
      </View>
    </View>
  );
});

export default function ListingDetailsScreen({ route }: ListingDetailsScreenProps) {
  const { listingId } = route.params;
  const navigation = useNavigation<ListingDetailsNavigationProp>();
  const { profile, permissions } = useProfileWithPermissions();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [fullScreenVisible, setFullScreenVisible] = useState(false);
  const [fullScreenKey, setFullScreenKey] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [checkingFavorite, setCheckingFavorite] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    setDescExpanded(false);
  }, [listingId]);

  const screenWidth = Dimensions.get('window').width;

  const isPaid = profile?.is_paid === true;
  const canMessage = has(permissions, 'message');
  const isSignedIn = !!profile;

  useEffect(() => {
    const loadListing = async () => {
      setLoading(true);
      setError(null);

      try {
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
              'zip',
              'price',
              'beds',
              'baths',
              'sqft',
              'lot_sqft',
              'cover_image_url',
              'images',
              'description',
              'contact_name',
              'contact_email',
              'contact_phone',
              'status',
              'arv',
              'repairs',
            'year_built',
            'garage_spaces',
            'property_type',
            'currency',
            'address_visibility',
          ].join(', ')
        )
          .eq('id', listingId)
          .single() as { data: ListingDetailRow | null; error: { message: string } | null };

        if (queryError) {
          setError(queryError.message);
          setListing(null);
          return;
        }

        if (!data) {
          setError('Listing not found');
          setListing(null);
          return;
        }

        // Map database row to domain type
        const listing: ListingDetail = {
          id: data.id,
          owner_id: data.owner_id,
          title: data.title ?? undefined,
          address: data.address ?? undefined,
          city: data.city ?? undefined,
          state: data.state ?? undefined,
          zip: data.zip ?? undefined,
          price: typeof data.price === 'number' ? data.price : undefined,
          beds: typeof data.beds === 'number' ? data.beds : undefined,
          baths: typeof data.baths === 'number' ? data.baths : undefined,
          sqft: typeof data.sqft === 'number' ? data.sqft : undefined,
          lot_sqft: typeof data.lot_sqft === 'number' ? data.lot_sqft : undefined,
          cover_image_url: data.cover_image_url ?? null,
          images: Array.isArray(data.images) ? data.images : null,
          description: data.description ?? undefined,
          contact_name: data.contact_name ?? undefined,
          contact_email: data.contact_email ?? undefined,
          contact_phone: data.contact_phone ?? undefined,
          status: data.status ?? null,
          arv: typeof data.arv === 'number' ? data.arv : null,
          repairs: typeof data.repairs === 'number' ? data.repairs : null,
          year_built: typeof data.year_built === 'number' ? data.year_built : null,
          garage_spaces: typeof data.garage_spaces === 'number' ? data.garage_spaces : null,
          property_type: data.property_type ?? null,
          currency: data.currency ?? null,
          address_visibility: data.address_visibility ?? null,
        };

        setListing(listing);

        // Check if listing is favorited (only for investor + paid users)
        const canUseWatchlists = profile?.role === 'investor' && profile?.is_paid === true;
        if (canUseWatchlists && profile?.id) {
          setCheckingFavorite(true);
          try {
            const favorited = await isListingFavorited(supabaseClient, profile.id, listingId);
            setIsFavorited(favorited);
          } catch (err) {
            if (__DEV__) {
              console.error('Error checking favorite status:', err);
            }
          } finally {
            setCheckingFavorite(false);
          }
        } else {
          setCheckingFavorite(false);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load listing';
        setError(errorMessage);
        setListing(null);
        setCheckingFavorite(false);
      } finally {
        setLoading(false);
      }
    };

    loadListing();
  }, [listingId, profile?.role, profile?.is_paid, profile?.id]);

  const handleUpgrade = () => {
    openExternalUrl(PRICING_URL);
  };

  const orderedImages = useMemo(() => {
    if (!listing) {
      return [];
    }

    const baseImages = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];
    const cover =
      listing.cover_image_url && listing.cover_image_url.length > 0
        ? listing.cover_image_url
        : null;

    // Resolve all image URLs through the resolver
    const resolvedImages: string[] = [];
    
    if (cover) {
      const resolvedCover = toListingImagePublicUrl(cover);
      if (resolvedCover && !resolvedImages.includes(resolvedCover)) {
        resolvedImages.push(resolvedCover);
      }
    }

    baseImages.forEach((img) => {
      const resolved = toListingImagePublicUrl(img);
      if (resolved && !resolvedImages.includes(resolved)) {
        resolvedImages.push(resolved);
      }
    });

    return resolvedImages;
  }, [listing]);

  // Full address: "W Wolf Street, Phoenix, AZ 85031" (titleCase street/city, uppercase state, zip as-is)
  const getFullAddressLine = (listing: ListingDetail | null): string => {
    if (!listing) return '';
    const address = titleCaseWords(listing.address ?? '');
    const city = titleCaseWords(listing.city ?? '');
    const state = formatState(listing.state);
    const zip = (listing.zip ?? '').trim();
    const cityStateZip = [city, state, zip].filter(Boolean).join(', ');
    if (address) {
      return cityStateZip ? `${address}, ${cityStateZip}` : address;
    }
    return cityStateZip || '';
  };

  const addressLine = getFullAddressLine(listing);

  const bedsText =
    listing && typeof listing.beds === 'number' && !Number.isNaN(listing.beds)
      ? `${listing.beds} Beds`
      : '';
  const bathsText =
    listing && typeof listing.baths === 'number' && !Number.isNaN(listing.baths)
      ? `${listing.baths} Baths`
      : '';
  const sqftText =
    listing && typeof listing.sqft === 'number' && !Number.isNaN(listing.sqft)
      ? `${listing.sqft} Sqft`
      : '';

  const lotText =
    listing && typeof listing.lot_sqft === 'number' && !Number.isNaN(listing.lot_sqft)
      ? `Lot: ${listing.lot_sqft.toLocaleString()} sqft`
      : '';

  const yearBuiltText =
    listing && typeof listing.year_built === 'number' && !Number.isNaN(listing.year_built)
      ? `Year Built: ${listing.year_built}`
      : 'Year Built: N/A';

  const garageSpacesText =
    listing && typeof listing.garage_spaces === 'number' && !Number.isNaN(listing.garage_spaces)
      ? `Garage: ${listing.garage_spaces} ${listing.garage_spaces === 1 ? 'space' : 'spaces'}`
      : 'Garage: N/A';

  const metaParts = [bedsText, bathsText, sqftText, lotText].filter((part) => part.length > 0);
  const metaLine = metaParts.join(' · ');

  const isOwner = !!(listing && profile && listing.owner_id === profile.id);
  
  // Require permissions.message === true (which is only true for paid investors or admin)
  // AND (profile.role === 'investor' OR profile.role === 'admin') to START a conversation from listing
  // Note: canMessage uses permissions.message which is now investor/admin-only (not wholesaler)
  const canStartConversation =
    !!listing &&
    isSignedIn &&
    canMessage &&
    (profile?.role === 'investor' || profile?.role === 'admin') &&
    !isOwner;
  
  const showMessageSellerButton = canStartConversation;
  const showMessageUpgrade =
    !!listing && isSignedIn && !canMessage && !isOwner;

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Fallback: navigate to Listings if can't go back
      const parent = navigation.getParent();
      if (parent) {
        parent.navigate('Listings');
      }
    }
  };

  const handleMessageSeller = async () => {
    if (!listing || !profile) {
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (_) {}

    // Double-check requirements before proceeding
    // Must have message permission (paid investor or admin) and be investor or admin
    if (!canMessage || (profile.role !== 'investor' && profile.role !== 'admin')) {
      Alert.alert(
        'Upgrade Required',
        'You must be a paid investor to start conversations with sellers.'
      );
      return;
    }

    const buyerId = profile.id;
    const sellerId = listing.owner_id;
    const listingId = listing.id;

    // QA log: starting conversation flow
    qalog('messageSeller: start', {
      listingId,
      buyerId,
      sellerId,
    });

    try {
      const { conversationId } = await getOrCreateConversationForListing(listingId);
      
      // QA log: conversation ready, navigating
      qalog('messageSeller: navigating', {
        conversationId,
        listingId,
        buyerId,
        sellerId,
      });

      // Navigate to Messages tab, then to Conversation screen
      // Use getParent to access the tab navigator
      const parent = navigation.getParent();
      if (parent) {
        parent.navigate('Messages', {
          screen: 'Conversation',
          params: {
            conversationId,
            listingId,
          },
        });
      }
    } catch (err) {
      qaError('messageSeller: failed', err);
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to start a conversation. Please try again.';
      Alert.alert('Unable to message seller', message);
    }
  };

  const handleCarouselIndexChange = useCallback((index: number) => {
    setActiveImageIndex(index);
  }, []);

  const handleCarouselImagePress = useCallback((index: number) => {
    setActiveImageIndex(index);
    setFullScreenKey((prev) => prev + 1);
    setFullScreenVisible(true);
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading listing...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Text style={styles.errorText}>Listing not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopHeader 
        title={listing.title || 'Listing Details'} 
        onBackPress={handleBack}
        right={<HeaderRightActions />}
      />

      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Trust Badges */}
        <View style={styles.trustBadges}>
          <View style={styles.trustBadge}>
            <Text style={styles.trustBadgeText}>Off-Market</Text>
          </View>
          <View style={styles.trustBadge}>
            <Text style={styles.trustBadgeText}>Direct from Wholesaler</Text>
          </View>
        </View>

        {orderedImages.length > 0 ? (
          <ImageCarousel
            images={orderedImages}
            activeIndex={activeImageIndex}
            onIndexChange={handleCarouselIndexChange}
            onPressImage={handleCarouselImagePress}
            screenWidth={screenWidth}
          />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text style={styles.heroPlaceholderText}>No image available</Text>
          </View>
        )}

      {addressLine && <Text style={styles.subtitle}>{addressLine}</Text>}

      {/* Price */}
      {typeof listing.price === 'number' && !Number.isNaN(listing.price) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Price</Text>
          <Text style={styles.priceText}>{formatMoney(listing.price, listing.currency)}</Text>
        </View>
      )}

      {/* Investor Summary - same formulas as listing cards. QA: verify values match card; no crash when ARV/repairs missing; layout wraps on small screen */}
      {(() => {
        const formatCompact = (n: number) =>
          n >= 1000000 ? `$${Math.round(n / 1000000)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
        const arvVal = typeof listing.arv === 'number' && !Number.isNaN(listing.arv) ? listing.arv : null;
        const priceVal = typeof listing.price === 'number' && !Number.isNaN(listing.price) ? listing.price : null;
        const repairsVal = typeof listing.repairs === 'number' && !Number.isNaN(listing.repairs) ? listing.repairs : null;
        const spreadVal = arvVal !== null && priceVal !== null ? arvVal - priceVal - (repairsVal ?? 0) : null;
        const roiPct = spreadVal !== null && priceVal !== null && priceVal > 0 ? (spreadVal / priceVal) * 100 : null;
        return (
          <View style={styles.investorSummaryBlock}>
            <View style={styles.investorSummaryRow}>
              <View style={styles.investorSummaryColumn}>
                <Text style={styles.investorSummaryLabel}>ARV</Text>
                <Text style={styles.investorSummaryValue}>{arvVal !== null ? formatCompact(arvVal) : '—'}</Text>
              </View>
              <View style={styles.investorSummaryColumn}>
                <Text style={styles.investorSummaryLabel}>REPAIRS</Text>
                <Text style={styles.investorSummaryValue}>{repairsVal !== null ? formatCompact(repairsVal) : '—'}</Text>
              </View>
            </View>
            <View style={styles.investorSummaryRow}>
              <View style={styles.investorSummaryColumn}>
                <Text style={styles.investorSummaryLabel}>SPREAD</Text>
                <Text style={styles.investorSummaryValue}>{spreadVal !== null ? formatCompact(spreadVal) : '—'}</Text>
              </View>
              <View style={styles.investorSummaryColumn}>
                <Text style={styles.investorSummaryLabel}>ROI</Text>
                <Text style={styles.investorSummaryValue}>{roiPct !== null ? `${roiPct.toFixed(1)}%` : '—'}</Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* Message Seller CTA - prominent placement under Investor Summary */}
      {!isOwner && (
        <View style={styles.messageSellerCtaSection}>
          {showMessageSellerButton && (
            <>
              <TouchableOpacity
                style={styles.messageSellerCtaButton}
                onPress={handleMessageSeller}
              >
                <Text style={styles.messageSellerCtaButtonText}>Message Seller</Text>
              </TouchableOpacity>
              <Text style={styles.messageSellerCtaHelper}>
                Ask about access, comps, or inspection details
              </Text>
            </>
          )}
          {showMessageUpgrade && (
            <View style={styles.upgradeBlock}>
              <Text style={styles.upgradeText}>
                {!profile?.is_paid
                  ? 'Upgrade to unlock messaging and seller contact.'
                  : profile?.role !== 'investor'
                  ? 'Only investors can start conversations with sellers.'
                  : 'Upgrade to unlock messaging and seller contact.'}
              </Text>
              {!profile?.is_paid && (
                <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
                  <Text style={styles.upgradeButtonText}>Upgrade to unlock access</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* Property Info */}
      {(metaLine.length > 0 || listing.description || yearBuiltText || garageSpacesText || listing.property_type) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Property Information</Text>
          {listing.property_type && (
            <Text style={styles.infoText}>Type: {formatPropertyType(listing.property_type)}</Text>
          )}
          {metaLine.length > 0 && (
            <Text style={styles.infoText}>{metaLine}</Text>
          )}
          {yearBuiltText && (
            <Text style={styles.infoText}>{yearBuiltText}</Text>
          )}
          {garageSpacesText && (
            <Text style={styles.infoText}>{garageSpacesText}</Text>
          )}
          {listing.description && (() => {
            const normalized = normalizeDescription(listing.description);
            if (!normalized) return null;
            const isLong = normalized.length > 400 || (normalized.match(/\n/g)?.length ?? 0) > 8;
            return (
              <>
                <Text
                  style={styles.descriptionText}
                  numberOfLines={descExpanded ? undefined : 10}
                  ellipsizeMode={descExpanded ? undefined : 'tail'}
                >
                  {normalized}
                </Text>
                {isLong && (
                  <TouchableOpacity
                    onPress={() => setDescExpanded((e) => !e)}
                    style={styles.readMoreButton}
                  >
                    <Text style={styles.readMoreText}>
                      {descExpanded ? 'Show less' : 'Read more'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            );
          })()}
        </View>
      )}

      {/* Save to Favorites (investor + paid only) */}
      {profile?.role === 'investor' && profile?.is_paid === true && profile?.id && (
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.savePillButton, isFavorited && styles.savePillButtonActive]}
            onPress={async () => {
              if (favoriteLoading || checkingFavorite) return;

              setFavoriteLoading(true);
              try {
                const newFavoriteState = !isFavorited;
                await toggleFavorite(supabaseClient, profile.id, listingId, newFavoriteState);
                setIsFavorited(newFavoriteState);
                try {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                } catch (_) {}
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to update favorite.';
                Alert.alert('Error', message);
              } finally {
                setFavoriteLoading(false);
              }
            }}
            disabled={favoriteLoading || checkingFavorite}
          >
            {favoriteLoading || checkingFavorite ? (
              <ActivityIndicator size="small" color={isFavorited ? colors.textInverse : colors.primary} />
            ) : (
              <>
                <Text style={styles.savePillIcon}>⭐</Text>
                <Text style={[styles.savePillText, isFavorited && styles.savePillTextActive]}>
                  {isFavorited ? 'Saved' : 'Save'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Compliance disclaimer footer */}
      <ListingDetailDisclaimer />

      {/* Full-screen image viewer */}
      <Modal
        visible={fullScreenVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setFullScreenVisible(false)}
      >
        <View style={styles.fullscreenContainer}>
          <TouchableOpacity
            style={styles.fullscreenClose}
            onPress={() => setFullScreenVisible(false)}
          >
            <Text style={styles.fullscreenCloseText}>×</Text>
          </TouchableOpacity>

          <ScrollView
            key={fullScreenKey}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(
                event.nativeEvent.contentOffset.x / screenWidth
              );
              setActiveImageIndex(index);
            }}
            contentOffset={{ x: activeImageIndex * screenWidth, y: 0 }}
          >
            {orderedImages.map((url) => (
              <ScrollView
                key={url}
                style={{ width: screenWidth }}
                contentContainerStyle={styles.fullscreenImageContainer}
                maximumZoomScale={3}
                minimumZoomScale={1}
                centerContent
              >
                <Image
                  source={{ uri: url }}
                  style={styles.fullscreenImage}
                  onError={(e) => {
                    if (__DEV__) {
                      console.error('[ListingDetailsScreen] Fullscreen image load error:', url, e.nativeEvent.error);
                    }
                  }}
                />
              </ScrollView>
            ))}
          </ScrollView>

          <View style={styles.fullscreenCounterContainer}>
            <Text style={styles.fullscreenCounterText}>
              {`${activeImageIndex + 1}/${orderedImages.length}`}
            </Text>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  contentContainer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  trustBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
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
  carouselContainer: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.sm,
  },
  heroImage: {
    height: 240,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  heroPlaceholder: {
    width: '100%',
    height: 240,
    borderRadius: 8,
    marginBottom: spacing.md,
    backgroundColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderText: {
    fontSize: typography.fontSize.xs,
    color: colors.textTertiary,
  },
  carouselOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  carouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  carouselDotActive: {
    backgroundColor: colors.textInverse,
  },
  carouselCounter: {
    fontSize: typography.fontSize.xs,
    color: colors.textInverse,
    fontWeight: typography.fontWeight.semibold,
  },
  title: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  section: {
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.backgroundElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    marginBottom: spacing.sm,
    color: colors.text,
  },
  infoText: {
    fontSize: typography.fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  priceText: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  messageSellerCtaSection: {
    marginBottom: spacing.md,
  },
  messageSellerCtaButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageSellerCtaButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  messageSellerCtaHelper: {
    marginTop: spacing.sm,
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  descriptionText: {
    fontSize: typography.fontSize.sm,
    lineHeight: 21,
    color: colors.text,
    marginTop: spacing.sm,
  },
  readMoreButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  readMoreText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  upgradeBlock: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.backgroundElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  upgradeText: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  upgradeButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
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
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullscreenClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
  },
  fullscreenCloseText: {
    fontSize: 30,
    color: '#fff',
    fontWeight: '600',
  },
  fullscreenImageContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  fullscreenCounterContainer: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  fullscreenCounterText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  investorSummaryBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.borderLight,
    marginBottom: spacing.md,
  },
  investorSummaryRow: {
    flexDirection: 'row',
    flex: 1,
    minWidth: '50%',
  },
  investorSummaryColumn: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  investorSummaryLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  investorSummaryValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
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
    alignSelf: 'flex-start',
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
});

