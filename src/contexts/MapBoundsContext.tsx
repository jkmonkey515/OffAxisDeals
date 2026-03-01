import React, { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';
import type { Region } from 'react-native-maps';

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type MapRegion = Region;

// Default region: Tucson, AZ (same as MapScreen)
const DEFAULT_REGION: Region = {
  latitude: 32.2226,
  longitude: -110.9747,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

interface MapBoundsContextValue {
  region: Region;
  bounds: MapBounds;
  isBoundsActive: boolean;
  setRegion: (region: Region) => void;
  setBounds: (bounds: MapBounds) => void;
  activateBounds: () => void;
}

const MapBoundsContext = createContext<MapBoundsContextValue | undefined>(undefined);

interface MapBoundsProviderProps {
  children: ReactNode;
}

/**
 * Helper to compute bounds from region
 * Same logic as MapScreen's computeBoundsFromRegion
 */
export function computeBoundsFromRegion(region: Region): MapBounds {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  return {
    minLat: latitude - latitudeDelta / 2,
    maxLat: latitude + latitudeDelta / 2,
    minLng: longitude - longitudeDelta / 2,
    maxLng: longitude + longitudeDelta / 2,
  };
}

export function MapBoundsProvider({ children }: MapBoundsProviderProps) {
  const [region, setRegionState] = useState<Region>(DEFAULT_REGION);
  const [isBoundsActive, setIsBoundsActive] = useState(false);

  // Compute bounds from region (memoized)
  const bounds = useMemo(() => computeBoundsFromRegion(region), [region]);

  // Set region (updates both region and bounds)
  const setRegion = useCallback((newRegion: Region) => {
    setRegionState(newRegion);
  }, []);

  // Set bounds directly (optional helper - computes region from bounds center)
  const setBounds = useCallback((newBounds: MapBounds) => {
    const centerLat = (newBounds.minLat + newBounds.maxLat) / 2;
    const centerLng = (newBounds.minLng + newBounds.maxLng) / 2;
    const latitudeDelta = newBounds.maxLat - newBounds.minLat;
    const longitudeDelta = newBounds.maxLng - newBounds.minLng;
    
    setRegionState({
      latitude: centerLat,
      longitude: centerLng,
      latitudeDelta,
      longitudeDelta,
    });
  }, []);

  // Activate bounds filtering (called when Map tab is visited)
  const activateBounds = useCallback(() => {
    setIsBoundsActive(true);
  }, []);

  const value: MapBoundsContextValue = useMemo(
    () => ({
      region,
      bounds,
      isBoundsActive,
      setRegion,
      setBounds,
      activateBounds,
    }),
    [region, bounds, isBoundsActive, setRegion, setBounds, activateBounds]
  );

  return <MapBoundsContext.Provider value={value}>{children}</MapBoundsContext.Provider>;
}

export function useMapBounds(): MapBoundsContextValue {
  const context = useContext(MapBoundsContext);
  if (context === undefined) {
    throw new Error('useMapBounds must be used within a MapBoundsProvider');
  }
  return context;
}
