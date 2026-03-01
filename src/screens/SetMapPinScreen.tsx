import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import MapView, { Marker, Region, PROVIDER_GOOGLE, LongPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp, NavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  PostDealStackParamList,
  ListingsStackParamList,
  MyListingsStackParamList,
  SettingsStackParamList,
} from '../types/navigation';
import { getPostDealDraft, setPostDealDraft } from '../state/postDealDraft';
import { colors, spacing, typography } from '../theme';

// SetMapPinScreen can be used in multiple stacks, so we use a union type for the route
type SetMapPinRouteProp = RouteProp<
  PostDealStackParamList | ListingsStackParamList | MyListingsStackParamList | SettingsStackParamList,
  'SetMapPin'
>;

// Navigation type needs to support navigating back to PostDealHome (when in PostDealStack)
// or just using goBack (when in other stacks)
type SetMapPinNavigationProp = NativeStackNavigationProp<PostDealStackParamList, 'SetMapPin'>;

// Default region: Tucson, AZ
const DEFAULT_REGION: Region = {
  latitude: 32.2226,
  longitude: -110.9747,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function SetMapPinScreen() {
  const navigation = useNavigation<SetMapPinNavigationProp>();
  const route = useRoute<SetMapPinRouteProp>();
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [pinLocation, setPinLocation] = useState<{ latitude: number; longitude: number } | null>(
    route.params?.initialLatitude && route.params?.initialLongitude
      ? {
          latitude: route.params.initialLatitude,
          longitude: route.params.initialLongitude,
        }
      : null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const requestLocationPermission = async () => {
      try {
        setLoading(true);

        // If we have initial coordinates, use them
        if (pinLocation) {
          setRegion({
            latitude: pinLocation.latitude,
            longitude: pinLocation.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
          setLoading(false);
          return;
        }

        // Request foreground location permission
        const { status } = await Location.requestForegroundPermissionsAsync();

        let initialRegion: Region;

        if (status === 'granted') {
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
            // Fall back to default region
            initialRegion = DEFAULT_REGION;
          }
        } else {
          // Use default region (Tucson, AZ)
          initialRegion = DEFAULT_REGION;
        }

        setRegion(initialRegion);
      } catch (err) {
        // Fall back to default region
        setRegion(DEFAULT_REGION);
      } finally {
        setLoading(false);
      }
    };

    requestLocationPermission();
  }, [pinLocation]);

  const handleMapLongPress = (event: LongPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setPinLocation({ latitude, longitude });
  };

  /**
   * Safely navigate back to PostDealHome if we're in PostDealStack,
   * otherwise just go back. Walks up parent navigators if needed (max 2 levels).
   */
  const navigateToPostDealHome = (
    nav: NavigationProp<PostDealStackParamList>,
    latitude: number,
    longitude: number
  ): boolean => {
    // Check if PostDealHome exists in current navigator's state
    const state = nav.getState();
    const hasPostDealHome = state?.routes?.some(
      (route) => route.name === 'PostDealHome'
    );
    
    if (hasPostDealHome) {
      try {
        (nav as NavigationProp<PostDealStackParamList>).navigate('PostDealHome', {
          latitude,
          longitude,
        });
        return true;
      } catch {
        // Navigation failed, continue to parent check
      }
    }
    
    // Try parent (1 level up)
    const parent = nav.getParent<NavigationProp<PostDealStackParamList>>();
    if (parent) {
      const parentState = parent.getState();
      const parentHasPostDealHome = parentState?.routes?.some(
        (route) => route.name === 'PostDealHome'
      );
      
      if (parentHasPostDealHome) {
        try {
          parent.navigate('PostDealHome', {
            latitude,
            longitude,
          });
          return true;
        } catch {
          // Continue to grandparent check
        }
      }
      
      // Try grandparent (2 levels up)
      const grandparent = parent.getParent<NavigationProp<PostDealStackParamList>>();
      if (grandparent) {
        const grandparentState = grandparent.getState();
        const grandparentHasPostDealHome = grandparentState?.routes?.some(
          (route) => route.name === 'PostDealHome'
        );
        
        if (grandparentHasPostDealHome) {
          try {
            grandparent.navigate('PostDealHome', {
              latitude,
              longitude,
            });
            return true;
          } catch {
            // All attempts failed
          }
        }
      }
    }
    
    return false;
  };

  const handleConfirm = () => {
    if (pinLocation) {
      // CRITICAL: Update draft state immediately to ensure coordinates persist
      // This ensures coordinates are available even if navigation params fail
      const currentDraft = getPostDealDraft();
      if (currentDraft) {
        setPostDealDraft({
          ...currentDraft,
          latitude: pinLocation.latitude,
          longitude: pinLocation.longitude,
        });
      }
      
      // Try to navigate to PostDealHome if we're in PostDealStack
      const navigated = navigateToPostDealHome(
        navigation as NavigationProp<PostDealStackParamList>,
        pinLocation.latitude,
        pinLocation.longitude
      );
      
      // If navigation to PostDealHome failed (we're not in PostDealStack), just go back
      if (!navigated && navigation.canGoBack()) {
        navigation.goBack();
      }
    }
  };

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
      <MapView
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        style={styles.map}
        region={region}
        onRegionChangeComplete={setRegion}
        onLongPress={handleMapLongPress}
        showsUserLocation={true}
        showsMyLocationButton={false}
      >
        {pinLocation && (
          <Marker
            coordinate={{
              latitude: pinLocation.latitude,
              longitude: pinLocation.longitude,
            }}
            draggable
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setPinLocation({ latitude, longitude });
            }}
          />
        )}
      </MapView>

      <View style={styles.instructionsContainer}>
        <Text style={styles.instructionsText}>
          Long-press on the map to set the property location
        </Text>
        {pinLocation && (
          <Text style={styles.coordinatesText}>
            {pinLocation.latitude.toFixed(4)}, {pinLocation.longitude.toFixed(4)}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.confirmButton, !pinLocation && styles.confirmButtonDisabled]}
        onPress={handleConfirm}
        disabled={!pinLocation}
      >
        <Text style={styles.confirmButtonText}>Confirm Location</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    flex: 1,
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
  instructionsContainer: {
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
  instructionsText: {
    fontSize: typography.fontSize.sm,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  coordinatesText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  confirmButton: {
    position: 'absolute',
    bottom: 100,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
