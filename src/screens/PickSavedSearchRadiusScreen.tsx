import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import MapView, { Region, PROVIDER_GOOGLE, Circle, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp, StackActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import type { SavedSearchesStackParamList } from '../types/navigation';

type PickSavedSearchRadiusNavigationProp = NativeStackNavigationProp<
  SavedSearchesStackParamList,
  'PickSavedSearchRadius'
>;

type PickSavedSearchRadiusRouteProp = RouteProp<SavedSearchesStackParamList, 'PickSavedSearchRadius'>;

// Default region: Tucson, AZ
const DEFAULT_REGION: Region = {
  latitude: 32.2226,
  longitude: -110.9747,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

// Default radius: 10 miles
const DEFAULT_RADIUS_MILES = 10;

// Convert miles to meters for Circle radius
function milesToMeters(miles: number): number {
  return miles * 1609.34;
}

// Calculate appropriate latitudeDelta for radius (to show full circle)
function calculateLatitudeDelta(radiusMiles: number): number {
  // Approximate: 1 degree latitude ≈ 69 miles
  // Add padding (1.5x) to ensure circle is fully visible
  return (radiusMiles * 1.5) / 69;
}

export default function PickSavedSearchRadiusScreen() {
  const navigation = useNavigation<PickSavedSearchRadiusNavigationProp>();
  const route = useRoute<PickSavedSearchRadiusRouteProp>();
  const { returnTo, existingId, initialCenter, initialRadius, locationLabel } = route.params || {};

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    initialCenter || null
  );
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [loading, setLoading] = useState(true);
  const [radiusMode, setRadiusMode] = useState<'suggested' | 'custom'>('suggested');
  const [customRadius, setCustomRadius] = useState<string>(
    initialRadius?.toString() || DEFAULT_RADIUS_MILES.toString()
  );
  const mapViewRef = useRef<MapView>(null);

  // Current radius value
  const currentRadius = radiusMode === 'suggested' ? DEFAULT_RADIUS_MILES : parseInt(customRadius, 10) || DEFAULT_RADIUS_MILES;
  const clampedRadius = Math.max(1, Math.min(250, currentRadius));

  // Initialize map region
  useEffect(() => {
    const initializeRegion = async () => {
      try {
        // If we have an initial center, use it
        if (initialCenter) {
          const delta = calculateLatitudeDelta(initialRadius || DEFAULT_RADIUS_MILES);
          const initialRegion: Region = {
            latitude: initialCenter.lat,
            longitude: initialCenter.lng,
            latitudeDelta: delta,
            longitudeDelta: delta,
          };
          setCenter(initialCenter);
          setRegion(initialRegion);
          if (mapViewRef.current) {
            mapViewRef.current.animateToRegion(initialRegion, 500);
          }
          setLoading(false);
          return;
        }

        // Otherwise, try to get user location
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          try {
            const location = await Location.getCurrentPositionAsync({});
            const userCenter = {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
            };
            const delta = calculateLatitudeDelta(DEFAULT_RADIUS_MILES);
            const initialRegion: Region = {
              latitude: userCenter.lat,
              longitude: userCenter.lng,
              latitudeDelta: delta,
              longitudeDelta: delta,
            };
            setCenter(userCenter);
            setRegion(initialRegion);
            if (mapViewRef.current) {
              mapViewRef.current.animateToRegion(initialRegion, 500);
            }
          } catch (err) {
            // Location fetch failed, use default
            setCenter({ lat: DEFAULT_REGION.latitude, lng: DEFAULT_REGION.longitude });
            setRegion(DEFAULT_REGION);
          }
        } else {
          // Permission denied, use default
          setCenter({ lat: DEFAULT_REGION.latitude, lng: DEFAULT_REGION.longitude });
          setRegion(DEFAULT_REGION);
        }
      } catch (err) {
        // Error, use default
        setCenter({ lat: DEFAULT_REGION.latitude, lng: DEFAULT_REGION.longitude });
        setRegion(DEFAULT_REGION);
      } finally {
        setLoading(false);
      }
    };

    initializeRegion();
  }, [initialCenter, initialRadius]);

  // Update region when radius changes to keep circle visible
  useEffect(() => {
    if (center && mapViewRef.current) {
      const delta = calculateLatitudeDelta(clampedRadius);
      const newRegion: Region = {
        latitude: center.lat,
        longitude: center.lng,
        latitudeDelta: delta,
        longitudeDelta: delta,
      };
      mapViewRef.current.animateToRegion(newRegion, 300);
    }
  }, [clampedRadius, center]);

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
    // Update center to map center (fixed pin approach)
    setCenter({
      lat: newRegion.latitude,
      lng: newRegion.longitude,
    });
  };

  const handleApply = () => {
    if (!center) {
      return;
    }

    const radiusMiles = clampedRadius;

    // Return to the calling screen
    if (returnTo === 'CreateSavedSearch') {
      const draft = route.params?.draft;
      const payload = {
        center_lat: center.lat,
        center_lng: center.lng,
        radius_miles: radiusMiles,
        locationLabel: locationLabel || undefined,
      };
      if (__DEV__) {
        console.log("[PickSavedSearchRadius] apply ->", payload);
      }
      navigation.dispatch(
        StackActions.replace('CreateSavedSearch', {
          pickedRadius: payload,
          draft,
        })
      );
    } else if (returnTo === 'EditSavedSearch' && existingId) {
      const payload = {
        center_lat: center.lat,
        center_lng: center.lng,
        radius_miles: radiusMiles,
        locationLabel: locationLabel || undefined,
      };
      if (__DEV__) {
        console.log("[PickSavedSearchRadius] apply ->", payload);
      }
      navigation.dispatch(
        StackActions.replace('EditSavedSearch', {
          id: existingId,
          pickedRadius: payload,
        })
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <TopHeader 
          title="Set Location"
          right={<HeaderRightActions />}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopHeader title="Set Location" />
      <View style={styles.mapContainer}>
        <MapView
          ref={mapViewRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          region={region}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation={true}
          showsMyLocationButton={true}
        >
          {center && (
            <>
              {/* Center marker (fixed pin) */}
              <Marker
                coordinate={{
                  latitude: center.lat,
                  longitude: center.lng,
                }}
                pinColor="#007AFF"
              />
              {/* Circle overlay showing radius */}
              <Circle
                center={{
                  latitude: center.lat,
                  longitude: center.lng,
                }}
                radius={milesToMeters(clampedRadius)}
                strokeColor="#007AFF"
                strokeWidth={2}
                fillColor="rgba(0, 122, 255, 0.1)"
              />
            </>
          )}
        </MapView>
        {/* Center pin indicator overlay (visual only) */}
        {center && (
          <View style={styles.centerPinOverlay} pointerEvents="none">
            <View style={styles.centerPin} />
          </View>
        )}
      </View>
      <View style={styles.contentContainer}>
        <Text style={styles.instructionText}>
          Drag the map to set the center point. The circle shows your search radius.
        </Text>

        {/* Radius mode selection */}
        <View style={styles.radiusModeContainer}>
          <TouchableOpacity
            style={[styles.radioOption, radiusMode === 'suggested' && styles.radioOptionActive]}
            onPress={() => setRadiusMode('suggested')}
          >
            <View style={styles.radioCircle}>
              {radiusMode === 'suggested' && <View style={styles.radioInner} />}
            </View>
            <Text style={[styles.radioLabel, radiusMode === 'suggested' && styles.radioLabelActive]}>
              Suggested local radius ({DEFAULT_RADIUS_MILES} miles)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.radioOption, radiusMode === 'custom' && styles.radioOptionActive]}
            onPress={() => setRadiusMode('custom')}
          >
            <View style={styles.radioCircle}>
              {radiusMode === 'custom' && <View style={styles.radioInner} />}
            </View>
            <Text style={[styles.radioLabel, radiusMode === 'custom' && styles.radioLabelActive]}>
              Custom local radius
            </Text>
          </TouchableOpacity>
        </View>

        {/* Custom radius input */}
        {radiusMode === 'custom' && (
          <View style={styles.customRadiusContainer}>
            <View style={styles.radiusInputRow}>
              <Text style={styles.radiusLabel}>Radius:</Text>
              <TextInput
                style={styles.radiusInput}
                value={customRadius}
                onChangeText={(text) => {
                  // Only allow numbers 1-250
                  const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
                  if (isNaN(num)) {
                    setCustomRadius('');
                  } else if (num > 250) {
                    setCustomRadius('250');
                  } else if (num < 1 && text.length > 0) {
                    setCustomRadius('1');
                  } else {
                    setCustomRadius(num.toString());
                  }
                }}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor="#888"
              />
              <Text style={styles.radiusUnit}>miles</Text>
            </View>
            <Text style={styles.radiusHelperText}>Enter a radius between 1 and 250 miles</Text>
          </View>
        )}

        {/* Live radius label */}
        <View style={styles.radiusDisplay}>
          <Text style={styles.radiusDisplayText}>
            {clampedRadius} {clampedRadius === 1 ? 'mile' : 'miles'}
          </Text>
        </View>

        {/* Apply button */}
        <TouchableOpacity
          style={[styles.applyButton, !center && styles.applyButtonDisabled]}
          onPress={handleApply}
          disabled={!center}
          activeOpacity={0.7}
        >
          <Text style={styles.applyButtonText}>Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
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
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  centerPinOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -20,
    marginLeft: -10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  centerPin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  contentContainer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  instructionText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  radiusModeContainer: {
    marginBottom: 16,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#f9f9f9',
  },
  radioOptionActive: {
    backgroundColor: '#e8f4fd',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007AFF',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
  },
  radioLabel: {
    fontSize: 16,
    color: '#666',
    flex: 1,
  },
  radioLabelActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  customRadiusContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  radiusInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  radiusLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginRight: 12,
  },
  radiusInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: '#fff',
    marginRight: 8,
    color: '#000',
  },
  radiusUnit: {
    fontSize: 16,
    color: '#666',
  },
  radiusHelperText: {
    fontSize: 12,
    color: '#999',
  },
  radiusDisplay: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  radiusDisplayText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
