import React, { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useNavigation, NavigationProp, CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabaseClient } from '../lib/supabase';
import { qalog, qaError } from '../utils/qalog';
import { useAuth } from '../contexts/AuthContext';
import { useProfileWithPermissions, has } from '../permissions/permissions';
import { openExternalUrl } from '../utils/openExternalUrl';
import { MapApproxLocationDisclaimer } from '../components/ComplianceText';
import { useMapBounds } from '../contexts/MapBoundsContext';
import { PROPERTY_TYPES, type PropertyType } from '../utils/propertyTypes';
import { colors, spacing, typography } from '../theme';
import LocationSearch from '../components/LocationSearch';

// Apple Maps on iOS does not support Heatmap (Google-only). Gate so we never load Heatmap on iOS Apple Maps.
const mapProvider = Platform.OS === 'android' ? 'google' : undefined;
const isAppleMaps = Platform.OS === 'ios' && mapProvider !== 'google';
const MapHeatmapLayer = isAppleMaps ? null : require('../components/MapHeatmapLayer').default as React.ComponentType<{
  points: Array<{ latitude: number; longitude: number; weight: number }>;
  radius?: number;
  opacity?: number;
  maxIntensity?: number;
}>;

/** Catches heatmap render errors; on error calls onError once and prevents further heatmap use for the session. */
class HeatmapErrorBoundary extends Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError = (): { hasError: true } => ({ hasError: true });

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type RootTabParamList = {
  Listings: {
    screen: 'ListingDetails';
    params: { listingId: string };
  };
  Settings: undefined;
  MyListings: undefined;
  Messages: undefined;
  Watchlists: undefined;
  Map: undefined;
  PostDeal: undefined;
};

type MapNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<{ MapHome: undefined }>,
  BottomTabNavigationProp<RootTabParamList>
>;

interface MappableListing {
  id: string;
  title: string;
  lat: number;
  lng: number;
  owner_id: string;
  address_visibility: 'exact' | 'approx' | 'hidden';
}

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface ClusterBucket {
  listings: MappableListing[];
  centerLat: number;
  centerLng: number;
  bucketKey: string;
}

// Clustering thresholds with hysteresis (statewide zoom thresholds)
const CLUSTER_ENTER_THRESHOLD = 1.2; // Enter clustering when delta >= this
const CLUSTER_EXIT_THRESHOLD = 0.9;  // Exit clustering when delta <= this

// Screen distance thresholds (in pixels)
const CLUSTER_MERGE_PX_THRESHOLD = 70; // Merge clusters closer than this
const PIN_SPIDERFY_PX_THRESHOLD = 20; // Apply spiderfy offset if pins closer than this
const PIN_SPIDERFY_RADIUS_PX = 15; // Radius for spiderfy circle layout

// Helper to get display coordinates (always true lat/lng; no offset)
// Callers must filter with isValidCoordinate before use to skip invalid listings.
function getDisplayCoordinates(listing: MappableListing): { latitude: number; longitude: number } {
  return {
    latitude: listing.lat,
    longitude: listing.lng,
  };
}

// Helper to round coordinates to 5 decimals for duplicate detection
function roundCoordinate(coord: number): number {
  return Math.round(coord * 100000) / 100000;
}

// Helper to generate deterministic index from listing ID for ring positioning
function getDeterministicIndex(listingId: string, groupSize: number): number {
  // Simple hash function for deterministic index
  let hash = 0;
  for (let i = 0; i < listingId.length; i++) {
    const char = listingId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % groupSize;
}

// Helper to apply duplicate marker spread (display-only)
// Groups listings by rounded coordinates (5 decimals) and spreads duplicates in a ring (15-35m)
function applyDuplicateMarkerSpread(
  listings: Array<{ listing: MappableListing; displayCoord: { latitude: number; longitude: number } }>
): Array<{ listing: MappableListing; displayCoord: { latitude: number; longitude: number } }> {
  if (listings.length === 0) {
    return listings;
  }

  // Group listings by rounded coordinates (5 decimals)
  const groups = new Map<string, Array<{ listing: MappableListing; displayCoord: { latitude: number; longitude: number }; originalIndex: number }>>();
  
  listings.forEach((item, index) => {
    const roundedLat = roundCoordinate(item.displayCoord.latitude);
    const roundedLng = roundCoordinate(item.displayCoord.longitude);
    const groupKey = `${roundedLat.toFixed(5)}-${roundedLng.toFixed(5)}`;
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push({ ...item, originalIndex: index });
  });

  // Apply spread to groups with > 1 listing
  const result: Array<{ listing: MappableListing; displayCoord: { latitude: number; longitude: number } }> = new Array(listings.length);
  
  groups.forEach((groupListings, groupKey) => {
    if (groupListings.length === 1) {
      // Single listing: no spread needed
      const item = groupListings[0];
      result[item.originalIndex] = {
        listing: item.listing,
        displayCoord: item.displayCoord,
      };
    } else {
      // Multiple listings: apply ring spread (15-35m)
      // Sort by listing ID for deterministic order
      const sorted = [...groupListings].sort((a, b) => a.listing.id.localeCompare(b.listing.id));
      
      sorted.forEach((item, indexInGroup) => {
        // Get deterministic index for stable positioning
        const deterministicIndex = getDeterministicIndex(item.listing.id, sorted.length);
        
        // Calculate ring offset: 15-35m range
        // Use index to determine distance (15m + (index * step) up to 35m)
        const minDistanceMeters = 15;
        const maxDistanceMeters = 35;
        const step = (maxDistanceMeters - minDistanceMeters) / Math.max(1, sorted.length - 1);
        const distanceMeters = minDistanceMeters + (deterministicIndex * step);
        
        // Calculate angle: evenly distribute around circle
        const angle = (deterministicIndex * 2 * Math.PI) / sorted.length;
        
        // Convert meters to degrees
        // At equator: 1 degree latitude ≈ 111,320 meters
        // Longitude conversion depends on latitude
        const baseLat = item.displayCoord.latitude;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((baseLat * Math.PI) / 180);
        
        const latOffset = (distanceMeters * Math.cos(angle)) / metersPerDegreeLat;
        const lngOffset = (distanceMeters * Math.sin(angle)) / metersPerDegreeLng;
        
        result[item.originalIndex] = {
          listing: item.listing,
          displayCoord: {
            latitude: item.displayCoord.latitude + latOffset,
            longitude: item.displayCoord.longitude + lngOffset,
          },
        };
      });
    }
  });
  
  return result;
}

// Helper to get exact coordinates from a listing (used in both grid cluster and normal pin modes)
// NOTE: This is kept for backward compatibility but should use getDisplayCoordinates for marker rendering
function toLatLng(listing: MappableListing): { latitude: number; longitude: number } {
  return {
    latitude: listing.lat,
    longitude: listing.lng,
  };
}

// Helper to compute bounds from region
function computeBoundsFromRegion(region: Region): MapBounds {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  return {
    minLat: latitude - latitudeDelta / 2,
    maxLat: latitude + latitudeDelta / 2,
    minLng: longitude - longitudeDelta / 2,
    maxLng: longitude + longitudeDelta / 2,
  };
}

// Helper to validate coordinates
function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const numLat = Number(lat);
  const numLng = Number(lng);

  // Check if both are finite numbers
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return false;
  }

  // Check if within valid ranges
  if (Math.abs(numLat) > 90 || Math.abs(numLng) > 180) {
    return false;
  }

  // Reject 0,0 as invalid (null island)
  if (numLat === 0 && numLng === 0) {
    return false;
  }

  return true;
}

// Default region: Tucson, AZ
const DEFAULT_REGION: Region = {
  latitude: 32.2226,
  longitude: -110.9747,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

const PRICING_URL = 'https://www.offaxisdeals.com/pricing';

export default function MapScreen() {
  const navigation = useNavigation<MapNavigationProp>();
  const { profile } = useAuth();
  const { permissions } = useProfileWithPermissions();
  const { setRegion: setSharedRegion, activateBounds } = useMapBounds();
  const mapViewRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [viewMode, setViewMode] = useState<'map' | 'heatmap'>('map');
  const [heatmapDisabledByError, setHeatmapDisabledByError] = useState(false);
  const heatmapErrorLoggedRef = useRef(false);
  const [rawRegion, setRawRegion] = useState<Region | null>(null);
  const [clusterRegion, setClusterRegion] = useState<Region | null>(null);
  const [isGridClusteringActive, setIsGridClusteringActive] = useState(false);
  const [clusterTapHint, setClusterTapHint] = useState<{ count: number; visible: boolean } | null>(null);
  const insets = useSafeAreaInsets();
  const [filtersVisible, setFiltersVisible] = useState(false);
  
  // Filter state - multi-select property types and numeric filters
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>([]);
  const [minBeds, setMinBeds] = useState<string>('');
  const [minBaths, setMinBaths] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [rawListings, setRawListings] = useState<Array<{
    id: string;
    title: string | null;
    address: string | null;
    latitude: unknown;
    longitude: unknown;
    owner_id: string;
    address_visibility: 'exact' | 'approx' | 'hidden' | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [isRegionDirty, setIsRegionDirty] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  const initialLoadDoneRef = useRef(false);
  const isLoadingRef = useRef(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heatmapDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rawRegionRef = useRef<Region | null>(null);
  const forceRegionUntilRef = useRef<number>(0);
  const hasAutoSearchedRef = useRef(false);

  // Grid clustering enabled (default ON, no UI toggle)
  const [gridClusteringEnabled] = useState(true);

  // Minimal state for user-facing banner (when listings exist but none have valid coords)
  const [bannerInfo, setBannerInfo] = useState<{
    totalFetched: number;
    withCoords: number;
    lastError: string | null;
  }>({
    totalFetched: 0,
    withCoords: 0,
    lastError: null,
  });

  // Production-safe diagnostics (visible in dev + production)
  const [containerLayout, setContainerLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [mapReady, setMapReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapStatus, setMapStatus] = useState<string>('init');
  const [mapError, setMapError] = useState<string>('');
  const [gotRegionCallback, setGotRegionCallback] = useState(false);

  const apiKeyPresent = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;
  const providerLabel = Platform.OS === 'android' ? 'google' : 'undefined';

  const onContainerLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = e?.nativeEvent?.layout ?? {};
    if (typeof width === 'number' && typeof height === 'number') {
      setContainerLayout({ width, height });
    }
  }, []);

  const handleMapReadyProbe = useCallback(() => {
    setMapReady(true);
    setMapStatus((prev) => (prev === 'init' ? 'mapReady' : prev));
  }, []);

  const handleMapLoadedProbe = useCallback(() => {
    setMapLoaded(true);
    setMapStatus((prev) => (prev === 'init' ? 'mapLoaded' : prev));
  }, []);

  const handleRegionChangeCompleteOnce = useCallback(() => {
    setGotRegionCallback((prev) => {
      if (!prev) setMapStatus((s) => (s === 'init' ? 'regionCallback' : s));
      return true;
    });
  }, []);

  const handleMapError = useCallback((e: unknown) => {
    function getNativeErrorMessage(err: unknown): string {
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
        return (err as any).message;
      }
      return '';
    }
    const ev = e as { nativeEvent?: { error?: unknown }; message?: string };
    const msg =
      getNativeErrorMessage(ev?.nativeEvent?.error) ||
      ev?.nativeEvent?.error ||
      ev?.message ||
      (typeof e === 'string' ? e : 'unknown map error');
    setMapError(String(msg));
    setMapStatus('mapError');
  }, []);

  /**
   * RELEASE SIGNING / API KEY RESTRICTIONS CHECKLIST (Android)
   * - Production EAS builds use RELEASE signing, so Google Cloud key restrictions must include:
   *   1) Android app package name (applicationId)
   *   2) Release signing certificate SHA-1 (NOT debug SHA-1)
   * - If apiKeyPresent=true but the map is blank in release, restrictions mismatch is the most likely cause.
   */

  useEffect(() => {
    setMapReady(false);
    setMapLoaded(false);
  }, [viewMode]);

  // Debounce cluster region updates
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (!rawRegion) {
      setClusterRegion(null);
      setIsGridClusteringActive(false);
      return;
    }

    debounceTimeoutRef.current = setTimeout(() => {
      setClusterRegion(rawRegion);

      // Update grid clustering active state with hysteresis (statewide zoom thresholds)
      setIsGridClusteringActive((currentActive) => {
        const delta = rawRegion.latitudeDelta;
        
        if (currentActive) {
          // Currently active: remain active unless delta <= EXIT threshold
          return delta > CLUSTER_EXIT_THRESHOLD;
        } else {
          // Currently inactive: remain inactive unless delta >= ENTER threshold
          return delta >= CLUSTER_ENTER_THRESHOLD;
        }
      });
    }, 250);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [rawRegion]);

  // Cleanup heatmap debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (heatmapDebounceTimeoutRef.current) {
        clearTimeout(heatmapDebounceTimeoutRef.current);
      }
    };
  }, []);

  // On Apple Maps, never stay in heatmap mode (no heatmap support)
  useEffect(() => {
    if (isAppleMaps && viewMode === 'heatmap') {
      setViewMode('map');
    }
  }, [isAppleMaps, viewMode]);

  // Build mappable listings from raw data with bulletproof validation
  const mappableListings = useMemo(() => {
    return rawListings
      .map((row) => {
        const lat = Number(row.latitude);
        const lng = Number(row.longitude);

        // Validate coordinates
        if (!isValidCoordinate(lat, lng)) {
          return null;
        }

        return {
          id: String(row.id),
          title: row.title || row.address || 'Untitled Listing',
          lat,
          lng,
          owner_id: String(row.owner_id),
          address_visibility: row.address_visibility ?? 'approx',
        };
      })
      .filter((listing): listing is MappableListing => listing !== null);
  }, [rawListings]);

  // Helper: Generate stable cluster ID from listing IDs
  const getClusterId = useCallback((listingIds: string[]): string => {
    const sorted = [...listingIds].sort();
    // Simple hash-like string (for stability, not security)
    return sorted.join('-');
  }, []);

  // Helper: Calculate approximate screen distance using coordinate distance and current zoom
  const getApproximateScreenDistance = useCallback((lat1: number, lng1: number, lat2: number, lng2: number, region: Region | null): number => {
    if (!region) return Infinity;
    
    // Approximate meters per pixel based on latitude and zoom level
    // At equator: 111320 meters per degree latitude
    // Screen width typically ~400px, so pixels per degree = 400 / latitudeDelta
    const metersPerDegreeLat = 111320;
    const pixelsPerDegreeLat = 400 / region.latitudeDelta; // Approximate based on typical screen width
    
    // Calculate coordinate distance
    const dLat = Math.abs(lat1 - lat2);
    const dLng = Math.abs(lng1 - lng2);
    const avgLat = (lat1 + lat2) / 2;
    const metersPerDegreeLng = 111320 * Math.cos((avgLat * Math.PI) / 180);
    
    // Convert to approximate pixels
    const pxLat = dLat * pixelsPerDegreeLat;
    const pxLng = (dLng * metersPerDegreeLng / metersPerDegreeLat) * pixelsPerDegreeLat;
    
    return Math.sqrt(pxLat * pxLat + pxLng * pxLng);
  }, []);

  // Helper: Merge clusters that are too close in screen space (approximate)
  const mergeCloseClusters = useCallback((clusters: ClusterBucket[], currentRegion: Region | null): ClusterBucket[] => {
    if (clusters.length === 0) {
      return clusters;
    }

    const merged: ClusterBucket[] = [];
    const mergedIndices = new Set<number>();

    for (let i = 0; i < clusters.length; i++) {
      if (mergedIndices.has(i)) continue;

      const cluster1 = clusters[i];
      let mergedCluster: ClusterBucket = { ...cluster1 };

      // Try to find clusters to merge
      for (let j = i + 1; j < clusters.length; j++) {
        if (mergedIndices.has(j)) continue;

        const cluster2 = clusters[j];

        // Calculate approximate screen distance
        const screenDistance = getApproximateScreenDistance(
          cluster1.centerLat,
          cluster1.centerLng,
          cluster2.centerLat,
          cluster2.centerLng,
          currentRegion
        );

        if (screenDistance < CLUSTER_MERGE_PX_THRESHOLD) {
          // Merge clusters: weighted average center
          const totalCount = mergedCluster.listings.length + cluster2.listings.length;
          mergedCluster = {
            listings: [...mergedCluster.listings, ...cluster2.listings],
            centerLat:
              (mergedCluster.centerLat * mergedCluster.listings.length +
                cluster2.centerLat * cluster2.listings.length) /
              totalCount,
            centerLng:
              (mergedCluster.centerLng * mergedCluster.listings.length +
                cluster2.centerLng * cluster2.listings.length) /
              totalCount,
            bucketKey: getClusterId([
              ...mergedCluster.listings.map((l) => l.id),
              ...cluster2.listings.map((l) => l.id),
            ]),
          };
          mergedIndices.add(j);
        }
      }

      merged.push(mergedCluster);
      mergedIndices.add(i);
    }

    return merged;
  }, [getClusterId, getApproximateScreenDistance]);

  // Helper: Apply spiderfy offset to markers that are too close (coordinate-based approximation)
  // Only applies offsets at very close zoom (small latitudeDelta), otherwise uses exact coordinates
  const spiderfyCloseMarkers = useCallback((markers: MappableListing[], currentRegion: Region | null): Array<MappableListing & { displayLat: number; displayLng: number }> => {
    if (markers.length === 0) {
      return markers.map((m) => ({ ...m, displayLat: m.lat, displayLng: m.lng }));
    }

    // Only apply offsets at very close zoom (latitudeDelta < 0.01 = very zoomed in)
    // For mid/far zoom, use exact coordinates to prevent pin position jumping
    const VERY_CLOSE_ZOOM_THRESHOLD = 0.01;
    const shouldApplyOffsets = currentRegion && currentRegion.latitudeDelta < VERY_CLOSE_ZOOM_THRESHOLD;

    // If not at very close zoom, return exact coordinates
    if (!shouldApplyOffsets) {
      return markers.map((m) => ({ ...m, displayLat: m.lat, displayLng: m.lng }));
    }

    // At very close zoom, apply spiderfy offsets to prevent overlap
    // Sort by id for deterministic order
    const sorted = [...markers].sort((a, b) => a.id.localeCompare(b.id));
    const result: Array<MappableListing & { displayLat: number; displayLng: number }> = [];

    // Calculate approximate coordinate offset for spiderfy (convert pixels to degrees)
    let coordOffsetDegrees = 0.0001; // Default small offset
    if (currentRegion) {
      // Approximate: 111320 meters per degree, ~0.01 meters per pixel at typical zoom
      const metersPerPixel = (currentRegion.latitudeDelta * 111320) / 400; // Assuming ~400px screen width
      coordOffsetDegrees = (PIN_SPIDERFY_RADIUS_PX * metersPerPixel) / 111320;
    }

    for (let i = 0; i < sorted.length; i++) {
      const marker = sorted[i];
      let displayLat = marker.lat;
      let displayLng = marker.lng;

      // Check distance to already-placed markers
      for (let j = 0; j < result.length; j++) {
        const placed = result[j];
        const screenDistance = getApproximateScreenDistance(
          displayLat,
          displayLng,
          placed.displayLat,
          placed.displayLng,
          currentRegion
        );

        if (screenDistance < PIN_SPIDERFY_PX_THRESHOLD) {
          // Apply offset: place in a circle around the original position
          // Use index in the close group to determine angle
          const angle = (j * 2 * Math.PI) / Math.min(8, sorted.length); // Max 8 positions
          const latOffset = Math.cos(angle) * coordOffsetDegrees;
          const lngOffset = Math.sin(angle) * coordOffsetDegrees;
          
          displayLat = marker.lat + latOffset;
          displayLng = marker.lng + lngOffset;
          break; // Apply offset once per marker
        }
      }

      result.push({ ...marker, displayLat, displayLng });
    }

    return result;
  }, [getApproximateScreenDistance]);

  // Grid clustering logic with bounds-relative bucketing
  const clusteredMarkers = useMemo(() => {
    // Check if we should force immediate region usage
    const useImmediateRegion = Date.now() < forceRegionUntilRef.current;
    const clusteringRegionSource = useImmediateRegion ? 'RAW' as const : 'DEBOUNCED' as const;
    
    // Choose which region to use for clustering: immediate if in force window, else debounced
    const useRegionForClustering = useImmediateRegion
      ? (rawRegionRef.current ?? rawRegion ?? clusterRegion)
      : clusterRegion;

    // If clustering is disabled or no region available, show individual pins
    if (!gridClusteringEnabled || !useRegionForClustering) {
      return {
        clusters: [] as ClusterBucket[],
        individualPins: mappableListings,
        gridInfo: null,
        extremeFallback: false,
        superZoomActive: false,
        gridBucketingActive: false,
        clusteringRegionSource: 'NONE' as const,
      };
    }

    // Compute isGridClusteringActive dynamically based on useRegionForClustering with hysteresis
    const delta = useRegionForClustering.latitudeDelta;
    const computedIsGridClusteringActive = isGridClusteringActive
      ? delta > CLUSTER_EXIT_THRESHOLD  // Currently active: remain active unless delta <= EXIT
      : delta >= CLUSTER_ENTER_THRESHOLD;  // Currently inactive: remain inactive unless delta >= ENTER

    // When grid clustering is inactive, show only individual pins
    if (!computedIsGridClusteringActive) {
      return {
        clusters: [] as ClusterBucket[],
        individualPins: mappableListings,
        gridInfo: null,
        extremeFallback: false,
        superZoomActive: false,
        gridBucketingActive: false,
        clusteringRegionSource,
      };
    }

    // When grid clustering is active, we'll compute clusters and return NO individual pins

    // Super-zoom threshold: force single cluster when delta >= 1.0
    if (useRegionForClustering.latitudeDelta >= 1.0) {
      if (mappableListings.length === 0) {
        return {
          clusters: [] as ClusterBucket[],
          individualPins: [],
          gridInfo: null,
          extremeFallback: false,
          superZoomActive: true,
          gridBucketingActive: false,
          clusteringRegionSource,
        };
      }

      // Calculate centroid of all listings
      const centroidLat = mappableListings.reduce((sum, l) => sum + l.lat, 0) / mappableListings.length;
      const centroidLng = mappableListings.reduce((sum, l) => sum + l.lng, 0) / mappableListings.length;

      if (isValidCoordinate(centroidLat, centroidLng)) {
        return {
          clusters: [{
            listings: mappableListings,
            centerLat: centroidLat,
            centerLng: centroidLng,
            bucketKey: 'super-zoom',
          }],
          individualPins: [],
          gridInfo: null,
          extremeFallback: false,
          superZoomActive: true,
          gridBucketingActive: false,
          clusteringRegionSource,
        };
      } else {
        // Fallback to individual pins if centroid is invalid
        return {
          clusters: [] as ClusterBucket[],
          individualPins: mappableListings,
          gridInfo: null,
          extremeFallback: false,
          superZoomActive: true,
          gridBucketingActive: false,
          clusteringRegionSource,
        };
      }
    }

    // Extreme zoom-out fallback: single cluster at centroid (for very extreme zoom)
    if (useRegionForClustering.latitudeDelta > 25 || useRegionForClustering.longitudeDelta > 25) {
      if (mappableListings.length === 0) {
        return {
          clusters: [] as ClusterBucket[],
          individualPins: [],
          gridInfo: null,
          extremeFallback: true,
          superZoomActive: false,
          gridBucketingActive: false,
          clusteringRegionSource,
        };
      }

      // Calculate centroid of all listings
      const centroidLat = mappableListings.reduce((sum, l) => sum + l.lat, 0) / mappableListings.length;
      const centroidLng = mappableListings.reduce((sum, l) => sum + l.lng, 0) / mappableListings.length;

      if (isValidCoordinate(centroidLat, centroidLng)) {
        return {
          clusters: [{
            listings: mappableListings,
            centerLat: centroidLat,
            centerLng: centroidLng,
            bucketKey: 'extreme-fallback',
          }],
          individualPins: [],
          gridInfo: null,
          extremeFallback: true,
          superZoomActive: false,
          gridBucketingActive: false,
          clusteringRegionSource,
        };
      } else {
        // Fallback to individual pins if centroid is invalid
        return {
          clusters: [] as ClusterBucket[],
          individualPins: mappableListings,
          gridInfo: null,
          extremeFallback: true,
          superZoomActive: false,
          gridBucketingActive: false,
          clusteringRegionSource,
        };
      }
    }

    // Normal clustering: bounds-relative grid (when delta < 1.0, otherwise use super-zoom)
    // Compute bounds from useRegionForClustering
    const minLat = useRegionForClustering.latitude - useRegionForClustering.latitudeDelta / 2;
    const maxLat = useRegionForClustering.latitude + useRegionForClustering.latitudeDelta / 2;
    const minLng = useRegionForClustering.longitude - useRegionForClustering.longitudeDelta / 2;
    const maxLng = useRegionForClustering.longitude + useRegionForClustering.longitudeDelta / 2;

    // Fixed grid resolution
    const gridSize = 8;
    const cellLat = (maxLat - minLat) / gridSize;
    const cellLng = (maxLng - minLng) / gridSize;

    // Guard against zero or invalid cell sizes
    if (cellLat <= 0 || cellLng <= 0 || !Number.isFinite(cellLat) || !Number.isFinite(cellLng)) {
      return {
        clusters: [] as ClusterBucket[],
        individualPins: mappableListings,
        gridInfo: { gridSize, cellLat: 0, cellLng: 0 },
        extremeFallback: false,
        superZoomActive: false,
        gridBucketingActive: false,
        clusteringRegionSource,
      };
    }

    // Bucket listings into grid cells
    const buckets = new Map<string, MappableListing[]>();

    for (const listing of mappableListings) {
      // Calculate grid position relative to bounds
      const x = Math.floor((listing.lng - minLng) / cellLng);
      const y = Math.floor((listing.lat - minLat) / cellLat);
      
      // Clamp to grid bounds
      const clampedX = Math.max(0, Math.min(gridSize - 1, x));
      const clampedY = Math.max(0, Math.min(gridSize - 1, y));
      
      const bucketKey = `${clampedX}-${clampedY}`;
      
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(listing);
    }

    // Process buckets into clusters only (when grid clustering is active, we don't show individual pins)
    const clusters: ClusterBucket[] = [];

    for (const [bucketKey, listings] of buckets.entries()) {
      if (listings.length === 1) {
        // Single listing in bucket: still create a cluster marker (count=1) so we show it
        clusters.push({
          listings,
          centerLat: listings[0].lat,
          centerLng: listings[0].lng,
          bucketKey,
        });
      } else {
        // Multiple listings: calculate average center and create cluster
        const avgLat = listings.reduce((sum, l) => sum + l.lat, 0) / listings.length;
        const avgLng = listings.reduce((sum, l) => sum + l.lng, 0) / listings.length;

        // Strict validation: Number.isFinite, bounds check, not 0,0
        const numLat = Number(avgLat);
        const numLng = Number(avgLng);
        
        if (
          Number.isFinite(numLat) &&
          Number.isFinite(numLng) &&
          Math.abs(numLat) <= 90 &&
          Math.abs(numLng) <= 180 &&
          !(numLat === 0 && numLng === 0)
        ) {
          clusters.push({
            listings,
            centerLat: numLat,
            centerLng: numLng,
            bucketKey,
          });
        }
        // If cluster center is invalid, skip this bucket (don't show anything)
      }
    }

    // Apply screen-distance merge pass to keep close clusters together
    const preMergeCount = clusters.length;
    const mergedClusters = mergeCloseClusters(clusters, useRegionForClustering);
    const postMergeCount = mergedClusters.length;

    // No debug info updates needed (debug UI removed)

    return {
      clusters: mergedClusters,
      individualPins: [], // When grid clustering is active, no individual pins
      gridInfo: { gridSize, cellLat, cellLng },
      extremeFallback: false,
      superZoomActive: false,
      gridBucketingActive: true,
      clusteringRegionSource,
    };
  }, [mappableListings, clusterRegion, rawRegion, gridClusteringEnabled, isGridClusteringActive, mergeCloseClusters]);

  // Handle cluster press: zoom in (always deterministic, never increases deltas)
  const zoomToCluster = useCallback((cluster: ClusterBucket) => {
    if (!mapViewRef.current) {
      return;
    }

    // Show hint with cluster count
    setClusterTapHint({ count: cluster.listings.length, visible: true });
    setTimeout(() => {
      setClusterTapHint((prev) => prev ? { ...prev, visible: false } : null);
    }, 1500);

    // Get current region from ref (most immediate) or fallback to state
    const current = rawRegionRef.current ?? rawRegion ?? clusterRegion;
    if (!current) {
      return;
    }

    // Compute next deltas that are guaranteed smaller
    let nextLatDelta: number;
    let nextLngDelta: number;

    if (current.latitudeDelta <= 0.06) {
      // Already zoomed in: zoom a bit more (75% of current, minimum 0.02)
      nextLatDelta = Math.max(current.latitudeDelta * 0.75, 0.02);
      nextLngDelta = Math.max(current.longitudeDelta * 0.75, 0.02);
    } else {
      // Normal zoom: reduce by half or at least 0.001, minimum 0.05
      nextLatDelta = Math.max(
        Math.min(current.latitudeDelta * 0.5, current.latitudeDelta - 0.001),
        0.05
      );
      nextLngDelta = Math.max(
        Math.min(current.longitudeDelta * 0.5, current.longitudeDelta - 0.001),
        0.05
      );
    }

    // Guard: never let next > current (ensures we always zoom in)
    nextLatDelta = Math.min(nextLatDelta, current.latitudeDelta);
    nextLngDelta = Math.min(nextLngDelta, current.longitudeDelta);

    const newRegion: Region = {
      latitude: cluster.centerLat,
      longitude: cluster.centerLng,
      latitudeDelta: nextLatDelta,
      longitudeDelta: nextLngDelta,
    };

    // Use faster animation duration for responsive feel
    mapViewRef.current.animateToRegion(newRegion, 300);
    
    // Force immediate region usage for 700ms after animation starts (covers 300ms animation + buffer)
    forceRegionUntilRef.current = Date.now() + 700;
  }, [rawRegion, clusterRegion]);

  // Load listings for a given region
  const loadListingsForRegion = useCallback(async (targetRegion: Region) => {
    // Prevent concurrent fetches
    if (isLoadingRef.current) {
      return;
    }

    try {
      isLoadingRef.current = true;
      setSearching(true);
      
      const bounds = computeBoundsFromRegion(targetRegion);

      // Query Supabase for listings within bounds
      // Only filter by bounds in the query; filter null coords in JS
      // Only return active listings (exclude sold/draft/archived) and exclude soft-deleted rows
      let query = supabaseClient
        .from('listings')
        .select('id, title, address, latitude, longitude, property_type, beds, baths, price, owner_id, address_visibility')
        .eq('status', 'active')
        .is('deleted_at', null)
        .gte('latitude', bounds.minLat)
        .lte('latitude', bounds.maxLat)
        .gte('longitude', bounds.minLng)
        .lte('longitude', bounds.maxLng);

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
        const bathsNum = parseInt(minBaths.trim(), 10);
        if (!isNaN(bathsNum) && bathsNum > 0) {
          query = query.gte('baths', bathsNum);
        }
      }

      // Apply Min Price filter
      if (minPrice.trim() !== '') {
        const priceNum = parseFloat(minPrice.trim().replace(/[^0-9.]/g, ''));
        if (!isNaN(priceNum) && priceNum > 0) {
          query = query.gte('price', priceNum);
        }
      }

      // Apply Max Price filter
      if (maxPrice.trim() !== '') {
        const priceNum = parseFloat(maxPrice.trim().replace(/[^0-9.]/g, ''));
        if (!isNaN(priceNum) && priceNum > 0) {
          query = query.lte('price', priceNum);
        }
      }

      const { data, error } = await query;

      const totalFetched = data?.length ?? 0;

      if (error) {
        const errorMsg = error.message || String(error);
        setBannerInfo({
          totalFetched: 0,
          withCoords: 0,
          lastError: errorMsg,
        });
        qaError('map: listings query failed', error);
        Alert.alert('Error', 'Failed to load listings. Please try again.');
        return;
      }

      // Store raw listings data
      setRawListings(data || []);

      // Count valid coordinates for banner calculation
      const validCount = (data || []).filter((item) => {
        return (
          typeof item.latitude !== 'undefined' &&
          typeof item.longitude !== 'undefined' &&
          item.latitude !== null &&
          item.longitude !== null &&
          isValidCoordinate(item.latitude, item.longitude)
        );
      }).length;

      setBannerInfo({
        totalFetched,
        withCoords: validCount,
        lastError: null,
      });

      if (__DEV__) {
        console.log(`[Map] Loaded ${validCount} mappable listings from ${totalFetched} rows`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setBannerInfo({
        totalFetched: 0,
        withCoords: 0,
        lastError: errorMsg,
      });
      qaError('map: loadListingsForRegion exception', err);
      Alert.alert('Error', 'Failed to load listings. Please try again.');
    } finally {
      isLoadingRef.current = false;
      setSearching(false);
    }
  }, [selectedPropertyTypes, minBeds, minBaths, minPrice, maxPrice]);

  // Activate bounds filtering when Map screen mounts
  useEffect(() => {
    activateBounds();
  }, [activateBounds]);

  // DEV-only warning about Google Maps API key configuration
  useEffect(() => {
    if (__DEV__) {
      const googleMapsApiKey =
        (Constants.expoConfig?.extra?.googleMapsApiKey as string | undefined) ??
        (Constants.expoConfig?.android?.config?.googleMaps?.apiKey as string | undefined);
      if (!googleMapsApiKey || googleMapsApiKey.trim() === '') {
        console.warn(
          'MapScreen: ensure android.config.googleMaps.apiKey (and iOS Google Maps key if applicable) is configured. Placeholder gate removed.'
        );
      }
    }
  }, []);

  // Request location permission and fetch current position
  useEffect(() => {
    const requestLocationPermission = async () => {
      try {
        setLoading(true);
        
        // Request foreground location permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        let initialRegion: Region;
        
        if (status === 'granted') {
          setLocationPermissionGranted(true);
          
          try {
            // Get current position
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            
            const { latitude, longitude } = location.coords;
            
            // Center map on user location
            initialRegion = {
              latitude,
              longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            };
          } catch (locationError) {
            qaError('map: getCurrentPosition failed', locationError);
            // Fall back to default region
            initialRegion = DEFAULT_REGION;
          }
        } else {
          setLocationPermissionGranted(false);
          // Use default region (Tucson, AZ)
          initialRegion = DEFAULT_REGION;
        }

        // Set the initial region
        setRegion(initialRegion);
        setRawRegion(initialRegion);
        rawRegionRef.current = initialRegion;
        
        // Load listings for initial region (only once)
        if (!initialLoadDoneRef.current) {
          initialLoadDoneRef.current = true;
          await loadListingsForRegion(initialRegion);
        }
      } catch (err) {
        qaError('map: permission request failed', err);
        // Fall back to default region
        const fallbackRegion = DEFAULT_REGION;
        setRegion(fallbackRegion);
        setRawRegion(fallbackRegion);
        rawRegionRef.current = fallbackRegion;
        
        // Load listings for fallback region (only once)
        if (!initialLoadDoneRef.current) {
          initialLoadDoneRef.current = true;
          await loadListingsForRegion(fallbackRegion);
        }
      } finally {
        setLoading(false);
      }
    };

    requestLocationPermission();
  }, [loadListingsForRegion]);

  const handleSearchThisArea = () => {
    if (rawRegion && !isLoadingRef.current) {
      if (__DEV__) {
        console.log('[Map] Search this area pressed');
      }
      setIsRegionDirty(false);
      loadListingsForRegion(rawRegion);
    }
  };

  // Auto-load listings on first Map open when rawRegion becomes available
  useEffect(() => {
    if (
      !hasAutoSearchedRef.current &&
      rawRegion !== null &&
      !searching &&
      !isLoadingRef.current
    ) {
      hasAutoSearchedRef.current = true;
      handleSearchThisArea();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRegion, searching]);

  const handleMarkerPress = (listingId: string) => {
    // Navigate to ListingDetails screen
    // Use getParent to access the tab navigator, then navigate to Listings stack
    const parent = navigation.getParent();
    if (parent) {
      (parent as NavigationProp<RootTabParamList>).navigate('Listings', {
        screen: 'ListingDetails',
        params: { listingId },
      });
    } else {
      // Fallback: try direct navigation
      navigation.navigate('Listings', {
        screen: 'ListingDetails',
        params: { listingId },
      });
    }
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    // Update rawRegion immediately (for immediate UI feedback)
    setRawRegion(newRegion);
    // Also store in ref for zoomToCluster to always have latest value
    rawRegionRef.current = newRegion;
    // clusterRegion and isClusteringActive will update via debounced effect
    // Update shared region/bounds for Listings feed
    setSharedRegion(newRegion);
    // Mark region as dirty if we have results loaded
    if (rawListings.length > 0) {
      setIsRegionDirty(true);
    }
    
    // Auto-load listings for heatmap mode (debounced) — only when heatmap is actually available
    if (viewMode === 'heatmap' && canUseHeatmap && !isAppleMaps && !heatmapDisabledByError) {
      // Clear existing timeout
      if (heatmapDebounceTimeoutRef.current) {
        clearTimeout(heatmapDebounceTimeoutRef.current);
      }
      // Debounce auto-load (350ms)
      heatmapDebounceTimeoutRef.current = setTimeout(() => {
        loadListingsForRegion(newRegion);
        setIsRegionDirty(false); // Heatmap auto-refreshes, no "Search this area" button
      }, 350);
    }
  };

  // Build grid cluster markers (count >= 2) and grid singles (count === 1) from clusteredMarkers.clusters
  // Must be computed before any early returns to maintain hook order
  const { gridClusters, gridSingles } = useMemo(() => {
    const clusters: React.ReactElement[] = [];
    const singlesListings: Array<{ listing: MappableListing; displayCoord: { latitude: number; longitude: number } }> = [];
    
    clusteredMarkers.clusters.forEach((cluster) => {
      const count = cluster.listings.length;
      // Build stable unique key
      const clusterId = cluster.bucketKey || `${cluster.centerLat.toFixed(4)}-${cluster.centerLng.toFixed(4)}-${count}`;
      
      // Use numeric coordinates
      const lat = Number(cluster.centerLat);
      const lng = Number(cluster.centerLng);
      
      if (count >= 2) {
        // Multi-point cluster: blue cluster marker
        const key = `cluster:${clusterId}`;
        
        // Validate coordinates are finite
        const isLatFinite = Number.isFinite(lat);
        const isLngFinite = Number.isFinite(lng);
        
        // Log cluster details (dev only)
        if (__DEV__) {
          console.log('[MapScreen] Grid Cluster:', {
            clusterId,
            key,
            count,
            lat,
            lng,
            isLatFinite,
            isLngFinite,
          });
        }
        
        // Filter out non-finite coordinates
        if (!isLatFinite || !isLngFinite) {
          if (__DEV__) {
            console.warn('[MapScreen] Filtering out grid cluster with non-finite coordinates:', {
              clusterId,
              key,
              count,
              lat,
              lng,
              isLatFinite,
              isLngFinite,
            });
          }
          return; // Skip this cluster
        }
        
        clusters.push(
          <Marker
            key={key}
            identifier={key}
            coordinate={{
              latitude: lat,
              longitude: lng,
            }}
            pinColor="blue"
            title={`${count} listings`}
            description="Tap to zoom"
            zIndex={999}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            onPress={() => zoomToCluster(cluster)}
          />
        );
      } else if (count === 1) {
        // Single-point cluster: collect for duplicate spread
        const listing = cluster.listings[0];
        const coord = getDisplayCoordinates(listing);
        singlesListings.push({
          listing,
          displayCoord: coord,
        });
      }
    });
    
    // Apply duplicate marker spread to singles
    const spreadSingles = applyDuplicateMarkerSpread(singlesListings);
    const singles = spreadSingles.map((item) => (
      <Marker
        key={`listing:${item.listing.id}`}
        identifier={`listing-${String(item.listing.id)}`}
        coordinate={item.displayCoord}
        title={item.listing.title}
        onPress={() => handleMarkerPress(item.listing.id)}
        tracksViewChanges={false}
      />
    ));
    
    return { gridClusters: clusters, gridSingles: singles };
  }, [clusteredMarkers.clusters, handleMarkerPress, zoomToCluster]);

  // Build single markers from clusteredMarkers.individualPins (when clustering is active)
  // Must be computed before any early returns to maintain hook order
  const singleMarkers = useMemo(() => {
    if (!gridClusteringEnabled) return [];
    
    // Collect listings with display coordinates
    const listingsWithCoords = clusteredMarkers.individualPins
      .filter((listing) => isValidCoordinate(listing.lat, listing.lng))
      .map((listing) => ({
        listing,
        displayCoord: getDisplayCoordinates(listing),
      }));
    
    // Apply duplicate marker spread
    const spreadListings = applyDuplicateMarkerSpread(listingsWithCoords);
    
    return spreadListings.map((item) => (
      <Marker
        key={`listing:${item.listing.id}`}
        identifier={`listing-${String(item.listing.id)}`}
        coordinate={item.displayCoord}
        title={item.listing.title}
        onPress={() => handleMarkerPress(item.listing.id)}
        tracksViewChanges={false}
      />
    ));
  }, [gridClusteringEnabled, clusteredMarkers.individualPins, handleMarkerPress]);

  // Fallback markers: all mappable listings as normal pins (used when clustering produces zero markers)
  // Must be computed before any early returns to maintain hook order
  const fallbackMarkers = useMemo(() => {
    // Collect listings with display coordinates
    const listingsWithCoords = mappableListings.map((listing) => ({
      listing,
      displayCoord: getDisplayCoordinates(listing),
    }));
    
    // Apply duplicate marker spread
    const spreadListings = applyDuplicateMarkerSpread(listingsWithCoords);
    
    return spreadListings.map((item) => (
      <Marker
        key={`listing:${item.listing.id}`}
        identifier={`listing-${String(item.listing.id)}`}
        coordinate={item.displayCoord}
        title={item.listing.title}
        onPress={() => handleMarkerPress(item.listing.id)}
        tracksViewChanges={false}
      />
    ));
  }, [mappableListings, handleMarkerPress]);

  // Determine which markers to render when clustering is ON
  // Must be computed before any early returns to maintain hook order
  const renderedClusteredMarkers = useMemo(() => {
    if (!gridClusteringEnabled) return [];
    
    // Determine render mode based on clustering state
    let renderMode: 'GRID_CLUSTERS' | 'GRID_FALLBACK_PINS' | 'NORMAL_PINS';
    let markersToRender: React.ReactElement[];
    
    // If grid clustering is not active, render normal pins
    if (!isGridClusteringActive) {
      renderMode = 'NORMAL_PINS';
      markersToRender = fallbackMarkers;
    }
    // If we have clusters or singles, render them
    else if (gridClusters.length > 0 || gridSingles.length > 0) {
      renderMode = 'GRID_CLUSTERS';
      markersToRender = [...gridClusters, ...gridSingles];
    }
    // Fallback: no clusters/singles but we have mappable listings, render normal pins
    else {
      renderMode = 'GRID_FALLBACK_PINS';
      markersToRender = fallbackMarkers;
    }
    
    // Debug logging when Grid Clustering is ON
    if (__DEV__) {
      console.log('[MapScreen] Grid Clustering ON - Render Mode:', renderMode);
      console.log('  mappableListings.length:', mappableListings.length);
      console.log('  gridClusters.length:', gridClusters.length);
      console.log('  gridSingles.length:', gridSingles.length);
      console.log('  isGridClusteringActive:', isGridClusteringActive);
      console.log('  rendered markers count:', markersToRender.length);
    }
    
    return markersToRender;
  }, [gridClusteringEnabled, gridClusters, gridSingles, isGridClusteringActive, mappableListings.length, fallbackMarkers]);

  // Build spiderfy'd markers for non-clustered view (only when clustering is OFF)
  // Uses exact coordinates via toLatLng helper (spiderfy offsets only applied at very close zoom)
  const spiderfyMarkers = useMemo(() => {
    if (gridClusteringEnabled) return [];
    const rawMarkers = clusteredMarkers.individualPins.filter((listing) => isValidCoordinate(listing.lat, listing.lng));
    if (rawMarkers.length === 0) return [];
    
    // Get base coordinates and apply duplicate spread
    const listingsWithCoords = rawMarkers.map((listing) => ({
      listing,
      displayCoord: getDisplayCoordinates(listing),
    }));
    const spreadListings = applyDuplicateMarkerSpread(listingsWithCoords);
    
    // Create a map of listing ID to spread coordinates for spiderfy to use
    const spreadCoordMap = new Map<string, { latitude: number; longitude: number }>();
    spreadListings.forEach((item) => {
      spreadCoordMap.set(item.listing.id, item.displayCoord);
    });
    
    // Apply spiderfy to raw markers (spiderfy works on true coordinates for distance calculation)
    const useRegionForSpiderfy = rawRegion ?? clusterRegion;
    const spiderfyListings = spiderfyCloseMarkers(rawMarkers, useRegionForSpiderfy);
    
    return spiderfyListings.map((listing) => {
      // Get spread coordinates (with duplicate spread applied)
      const spreadCoord = spreadCoordMap.get(listing.id) || getDisplayCoordinates(listing);
      
      // If spiderfy was applied (very close zoom), apply spiderfy offset on top of spread coordinates
      if (listing.displayLat !== undefined && listing.displayLng !== undefined) {
        // Calculate spiderfy offset relative to true coordinates
        const latOffset = listing.displayLat - listing.lat;
        const lngOffset = listing.displayLng - listing.lng;
        
        // Apply spiderfy offset to spread coordinates
        return (
          <Marker
            key={`listing:${listing.id}`}
            identifier={`listing-${String(listing.id)}`}
            coordinate={{
              latitude: spreadCoord.latitude + latOffset,
              longitude: spreadCoord.longitude + lngOffset,
            }}
            title={listing.title}
            onPress={() => handleMarkerPress(listing.id)}
            tracksViewChanges={false}
          />
        );
      }
      
      // No spiderfy: use spread display coordinates
      return (
        <Marker
          key={`listing:${listing.id}`}
          identifier={`listing-${String(listing.id)}`}
          coordinate={spreadCoord}
          title={listing.title}
          onPress={() => handleMarkerPress(listing.id)}
          tracksViewChanges={false}
        />
      );
    });
  }, [gridClusteringEnabled, clusteredMarkers.individualPins, spiderfyCloseMarkers, rawRegion, clusterRegion, handleMarkerPress]);

  // Build heatmap points from mappable listings (using true coordinates)
  const heatmapPoints = useMemo(() => {
    return mappableListings
      .filter((listing) => isValidCoordinate(listing.lat, listing.lng))
      .map((listing) => {
        const coord = getDisplayCoordinates(listing);
        return {
          latitude: coord.latitude,
          longitude: coord.longitude,
          weight: 1,
        };
      });
  }, [mappableListings]);

  // Stable renderCluster callback for ClusteredMapView
  const renderCluster = useCallback((cluster: {
    id: string | number;
    geometry: { coordinates: [number, number] };
    properties: { point_count: number; point_count_abbreviated: string };
  }) => {
    // Extract coordinate from cluster geometry (GeoJSON format: [lng, lat])
    const [lng, lat] = cluster.geometry.coordinates;
    const count = cluster.properties.point_count;

    // Validate coordinate
    if (!isValidCoordinate(lat, lng)) {
      return null;
    }

    return (
      <Marker
        key={`cluster-${cluster.id}-${lat.toFixed(6)}-${lng.toFixed(6)}`}
        identifier={`cluster-${cluster.id}`}
        coordinate={{ latitude: lat, longitude: lng }}
        pinColor="#2563EB"
        zIndex={999}
        anchor={{ x: 0.5, y: 1 }}
        tracksViewChanges={false}
      >
        <View style={styles.clusterMarkerContainer}>
          <Text style={styles.clusterMarkerText}>{count}</Text>
        </View>
      </Marker>
    );
  }, []);


  // Computed values for render (not hooks, safe to compute conditionally)
  const showNoMappableBanner = bannerInfo.totalFetched > 0 && bannerInfo.withCoords === 0 && !bannerInfo.lastError;
  const canUseHeatmap = has(permissions, 'useHeatmap');

  // Handle view mode toggle
  const handleViewModeChange = (mode: 'map' | 'heatmap') => {
    if (mode === 'heatmap') {
      if (isAppleMaps) return; // Heatmap not supported on Apple Maps; tap does nothing
      if (heatmapDisabledByError) return; // Disabled for this session after an error
      if (!canUseHeatmap) {
        // Free user trying to access heatmap - show upgrade alert
        Alert.alert(
          'Plus required',
          'Heatmap is a Plus feature. Upgrade to Plus to unlock market activity heatmaps.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Upgrade to Plus', onPress: () => openExternalUrl(PRICING_URL) },
          ],
          { cancelable: true }
        );
        return;
      }
    }
    setViewMode(mode);
  };

  // Handle place selection from LocationSearch
  const handlePlaceSelected = useCallback((payload: unknown) => {
    console.log("[MapScreen] onPlaceSelected payload:", payload);

    // Safely extract lat/lng with support for multiple payload shapes
    let lat: number | undefined;
    let lng: number | undefined;

    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      
      // Try payload.lat / payload.lng
      if (typeof p.lat === 'number' && typeof p.lng === 'number') {
        lat = p.lat;
        lng = p.lng;
      }
      // Try payload.location?.lat / payload.location?.lng
      else if (p.location && typeof p.location === 'object') {
        const loc = p.location as Record<string, unknown>;
        if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
          lat = loc.lat;
          lng = loc.lng;
        }
      }
      // Try payload.coords?.latitude / payload.coords?.longitude
      else if (p.coords && typeof p.coords === 'object') {
        const coords = p.coords as Record<string, unknown>;
        if (typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
          lat = coords.latitude;
          lng = coords.longitude;
        }
      }
    }

    // Validate lat/lng are finite numbers
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (__DEV__) {
        console.warn("[MapScreen] Invalid coordinates in payload:", { lat, lng, payload });
      }
      return;
    }

    // Build newRegion using extracted lat/lng and existing deltas
    const next: Region = {
      latitude: lat!,
      longitude: lng!,
      latitudeDelta: region.latitudeDelta ?? 0.25,
      longitudeDelta: region.longitudeDelta ?? 0.25,
    };

    // Update ALL region state exactly once
    setRegion(next);
    setRawRegion(next);
    rawRegionRef.current = next;
    setSharedRegion(next);

    // Animate reliably on Android (both requestAnimationFrame and setTimeout)
    requestAnimationFrame(() => {
      mapViewRef.current?.animateToRegion(next, 450);
    });
    setTimeout(() => {
      mapViewRef.current?.animateToRegion(next, 450);
    }, 50);

    setIsRegionDirty(true);
    loadListingsForRegion(next);
  }, [region, loadListingsForRegion, setSharedRegion]);

  // Determine which markers to render based on grid clustering mode
  const markersToRender = gridClusteringEnabled ? renderedClusteredMarkers : spiderfyMarkers;
  
  // Debug log before return
  if (__DEV__) {
    const mapComponentType = 'PLAIN_MAPVIEW'; // Always using plain MapView now (not ClusteredMapView)
    console.log('[MapScreen] Map Component Render:');
    console.log('  mapComponentType:', mapComponentType);
    console.log('  isGridClusteringOn:', gridClusteringEnabled);
    console.log('  mappableListings.length:', mappableListings.length);
    console.log('  rendered markers count:', markersToRender.length);
  }

  // Early return AFTER all hooks have been called
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Location Search */}
      <View style={styles.locationSearchContainer}>
        <LocationSearch onPlaceSelected={handlePlaceSelected} />
      </View>
      
      {/* View mode toggle and Filters row */}
      <View style={styles.topControlsRow}>
        <View style={styles.viewModeToggle}>
          <TouchableOpacity
            style={[styles.viewModeButton, viewMode === 'map' && styles.viewModeButtonActive]}
            onPress={() => handleViewModeChange('map')}
          >
            <Text style={[styles.viewModeButtonText, viewMode === 'map' && styles.viewModeButtonTextActive]}>
              Map
            </Text>
          </TouchableOpacity>
          {isAppleMaps ? (
            <View style={[styles.viewModeButton, styles.viewModeButtonDisabled]}>
              <Text style={styles.viewModeButtonTextDisabled} numberOfLines={2}>
                Heatmap (Apple Maps) — Coming soon
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.viewModeButton, viewMode === 'heatmap' && styles.viewModeButtonActive]}
              onPress={() => handleViewModeChange('heatmap')}
            >
              <Text style={[styles.viewModeButtonText, viewMode === 'heatmap' && styles.viewModeButtonTextActive]}>
                Heatmap
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {viewMode === 'map' && (
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
        )}
      </View>

      {/* Map view (pins + clusters) - wrapped in layout probe container */}
      <View style={styles.mapContainer} onLayout={onContainerLayout}>
        {viewMode === 'map' && (
          <MapView
            ref={mapViewRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            region={region}
            onRegionChangeComplete={(r) => {
              handleRegionChangeComplete(r);
              handleRegionChangeCompleteOnce();
            }}
            onMapReady={handleMapReadyProbe}
            onMapLoaded={handleMapLoadedProbe}
            // @ts-expect-error - onMapError exists at runtime on some react-native-maps builds but may be missing from typings
            onMapError={handleMapError}
            showsUserLocation={locationPermissionGranted}
            showsMyLocationButton={false}
          >
            {markersToRender}
          </MapView>
        )}

        {/* Heatmap view (Plus-only; skipped on iOS Apple Maps) */}
        {viewMode === 'heatmap' && canUseHeatmap && !isAppleMaps && !heatmapDisabledByError && MapHeatmapLayer && (
          <HeatmapErrorBoundary
            onError={() => {
              if (!heatmapErrorLoggedRef.current) {
                heatmapErrorLoggedRef.current = true;
                qaError('map: heatmap render error', new Error('Heatmap layer failed'));
              }
              setHeatmapDisabledByError(true);
              setViewMode('map');
            }}
          >
            <MapView
              ref={mapViewRef}
              style={styles.map}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              region={region}
              onRegionChangeComplete={(r) => {
                handleRegionChangeComplete(r);
                handleRegionChangeCompleteOnce();
              }}
              onMapReady={handleMapReadyProbe}
              onMapLoaded={handleMapLoadedProbe}
              // @ts-expect-error - onMapError exists at runtime on some react-native-maps builds but may be missing from typings
              onMapError={handleMapError}
              showsUserLocation={locationPermissionGranted}
              showsMyLocationButton={false}
            >
              <MapHeatmapLayer
                points={heatmapPoints}
                radius={40}
                opacity={0.7}
                maxIntensity={10}
              />
            </MapView>
          </HeatmapErrorBoundary>
        )}

        {__DEV__ ? (
          <View pointerEvents="none" style={styles.diagWrap}>
            <View style={styles.diagCard}>
              <Text style={styles.diagText}>
                w:{Math.round(containerLayout.width)} h:{Math.round(containerLayout.height)} | apiKeyPresent:
                {String(apiKeyPresent)}
              </Text>
              <Text style={styles.diagText}>
                provider:{providerLabel} | mapReady:{String(mapReady)} mapLoaded:{String(mapLoaded)}
              </Text>
              <Text style={styles.diagText}>
                gotRegionCallback:{String(gotRegionCallback)} | status:{mapStatus}
              </Text>
              {!!mapError && <Text style={styles.diagText}>mapError:{mapError}</Text>}
            </View>
          </View>
        ) : null}
      </View>

      {/* Cluster tap hint (only show in Map mode) */}
      {viewMode === 'map' && clusterTapHint?.visible && (
        <View style={styles.clusterTapHint}>
          <Text style={styles.clusterTapHintText}>
            {clusterTapHint.count} listing{clusterTapHint.count !== 1 ? 's' : ''} — tap again to zoom more
          </Text>
        </View>
      )}

      {/* User-facing banner when listings exist but none have valid coords (only show in Map mode) */}
      {viewMode === 'map' && showNoMappableBanner && (
        <View style={styles.noMappableBanner}>
          <Text style={styles.noMappableBannerText}>
            No mappable listings yet. Listings need a map pin (address/geolocation) before they appear here.
          </Text>
        </View>
      )}

      {/* Heatmap disclaimer (only show in Heatmap mode when heatmap is actually shown) */}
      {viewMode === 'heatmap' && canUseHeatmap && !isAppleMaps && !heatmapDisabledByError && (
        <View style={styles.heatmapDisclaimer}>
          <MapApproxLocationDisclaimer />
        </View>
      )}

      {/* Search this area button (only show in Map mode) */}
      {viewMode === 'map' && (
        <TouchableOpacity
          style={[styles.searchButton, (searching || !rawRegion) && styles.searchButtonDisabled]}
          onPress={handleSearchThisArea}
          disabled={searching || !rawRegion}
        >
          {searching ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.searchButtonText}>
              {isRegionDirty ? 'Update results' : 'Search this area'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Filters Modal */}
      <Modal
        visible={filtersVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFiltersVisible(false)}
      >
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalContent}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity
                style={styles.filterModalCloseButton}
                onPress={() => setFiltersVisible(false)}
              >
                <Text style={styles.filterModalCloseButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.filterModalBody}>
              {/* Property Type - Multi-select */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Property Type</Text>
                <TouchableOpacity
                  style={[
                    styles.filterOption,
                    selectedPropertyTypes.length === 0 && styles.filterOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedPropertyTypes([]);
                  }}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      selectedPropertyTypes.length === 0 && styles.filterOptionTextSelected,
                    ]}
                  >
                    All Types
                  </Text>
                  {selectedPropertyTypes.length === 0 && (
                    <Text style={styles.filterOptionCheck}>✓</Text>
                  )}
                </TouchableOpacity>
                <FlatList
                  data={PROPERTY_TYPES}
                  keyExtractor={(item) => item}
                  scrollEnabled={false}
                  renderItem={({ item }) => {
                    const isSelected = selectedPropertyTypes.includes(item);
                    return (
                      <TouchableOpacity
                        style={[
                          styles.filterOption,
                          isSelected && styles.filterOptionSelected,
                        ]}
                        onPress={() => {
                          if (isSelected) {
                            setSelectedPropertyTypes(selectedPropertyTypes.filter(t => t !== item));
                          } else {
                            setSelectedPropertyTypes([...selectedPropertyTypes, item]);
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.filterOptionText,
                            isSelected && styles.filterOptionTextSelected,
                          ]}
                        >
                          {item}
                        </Text>
                        {isSelected && (
                          <Text style={styles.filterOptionCheck}>✓</Text>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>

              {/* Beds Filter */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Min Beds</Text>
                <TextInput
                  style={styles.filterInput}
                  placeholder="Any"
                  placeholderTextColor={colors.textTertiary}
                  value={minBeds}
                  onChangeText={setMinBeds}
                  keyboardType="number-pad"
                />
              </View>

              {/* Baths Filter */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Min Baths</Text>
                <TextInput
                  style={styles.filterInput}
                  placeholder="Any"
                  placeholderTextColor={colors.textTertiary}
                  value={minBaths}
                  onChangeText={setMinBaths}
                  keyboardType="number-pad"
                />
              </View>

              {/* Price Range */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Price Range</Text>
                <View style={styles.priceRow}>
                  <View style={styles.priceInputContainer}>
                    <Text style={styles.priceLabel}>Min</Text>
                    <TextInput
                      style={styles.filterInput}
                      placeholder="Any"
                      placeholderTextColor={colors.textTertiary}
                      value={minPrice}
                      onChangeText={setMinPrice}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={styles.priceInputContainer}>
                    <Text style={styles.priceLabel}>Max</Text>
                    <TextInput
                      style={styles.filterInput}
                      placeholder="Any"
                      placeholderTextColor={colors.textTertiary}
                      value={maxPrice}
                      onChangeText={setMaxPrice}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              </View>
            </ScrollView>
            <SafeAreaView edges={['bottom']} style={styles.filterModalFooterContainer}>
              <View style={styles.filterModalFooter}>
                <TouchableOpacity
                  style={styles.filterClearButton}
                  onPress={() => {
                    setSelectedPropertyTypes([]);
                    setMinBeds('');
                    setMinBaths('');
                    setMinPrice('');
                    setMaxPrice('');
                    setFiltersVisible(false);
                    if (rawRegion) {
                      loadListingsForRegion(rawRegion);
                    }
                  }}
                >
                  <Text style={styles.filterClearButtonText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.filterApplyButton}
                  onPress={() => {
                    setFiltersVisible(false);
                    if (rawRegion) {
                      loadListingsForRegion(rawRegion);
                    }
                  }}
                >
                  <Text style={styles.filterApplyButtonText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  diagWrap: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    alignItems: 'flex-start',
  },
  diagCard: {
    maxWidth: '100%',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.70)',
  },
  diagText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
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
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  placeholderTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  placeholderSubtext: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  searchButton: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  searchButtonDisabled: {
    opacity: 0.6,
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
    maxHeight: 500,
    paddingBottom: spacing.md,
  },
  filterSection: {
    padding: spacing.md,
  },
  filterSectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
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
  filterModalFooterContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.backgroundElevated,
  },
  filterModalFooter: {
    flexDirection: 'row',
    padding: spacing.md,
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
  noMappableBanner: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  noMappableBannerText: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  clusterTapHint: {
    position: 'absolute',
    bottom: 160,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  clusterTapHintText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  clusterMarkerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2563EB',
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  clusterMarkerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  locationSearchContainer: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  topControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  viewModeToggle: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: colors.backgroundElevated,
    borderRadius: 8,
    padding: spacing.xs,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 1000,
  },
  viewModeButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  viewModeButtonActive: {
    backgroundColor: colors.primary,
  },
  viewModeButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textSecondary,
  },
  viewModeButtonTextActive: {
    color: colors.textInverse,
  },
  viewModeButtonDisabled: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  viewModeButtonTextDisabled: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  heatmapContainer: {
    flex: 1,
    position: 'relative',
  },
  heatmapOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  heatmapPlaceholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  heatmapPlaceholderSubtext: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
  heatmapDisclaimer: {
    position: 'absolute',
    bottom: 100,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
});
