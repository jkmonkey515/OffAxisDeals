import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import MapView, { Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp, StackActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import type { SavedSearchesStackParamList } from '../types/navigation';
import type { GeoBounds } from '../utils/savedSearchCriteria';

type PickSavedSearchAreaNavigationProp = NativeStackNavigationProp<
  SavedSearchesStackParamList,
  'PickSavedSearchArea'
>;

type PickSavedSearchAreaRouteProp = RouteProp<SavedSearchesStackParamList, 'PickSavedSearchArea'>;

// Default region: Tucson, AZ (same as MapScreen)
const DEFAULT_REGION: Region = {
  latitude: 32.2226,
  longitude: -110.9747,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

// Helper to compute bounds from region
function computeBoundsFromRegion(region: Region): GeoBounds {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  return {
    ne: {
      lat: latitude + latitudeDelta / 2,
      lng: longitude + longitudeDelta / 2,
    },
    sw: {
      lat: latitude - latitudeDelta / 2,
      lng: longitude - longitudeDelta / 2,
    },
  };
}

export default function PickSavedSearchAreaScreen() {
  const navigation = useNavigation<PickSavedSearchAreaNavigationProp>();
  const route = useRoute<PickSavedSearchAreaRouteProp>();
  const { returnTo, existingId } = route.params;

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [loading, setLoading] = useState(true);
  const mapViewRef = useRef<MapView>(null);

  // Initialize map region
  useEffect(() => {
    const initializeRegion = async () => {
      try {
        // Request location permission (optional - if denied, use default region)
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          try {
            const location = await Location.getCurrentPositionAsync({});
            const initialRegion: Region = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: 0.5,
              longitudeDelta: 0.5,
            };
            setRegion(initialRegion);
            if (mapViewRef.current) {
              mapViewRef.current.animateToRegion(initialRegion, 500);
            }
          } catch (err) {
            // Location fetch failed, use default region
            setRegion(DEFAULT_REGION);
          }
        } else {
          // Permission denied, use default region
          setRegion(DEFAULT_REGION);
        }
      } catch (err) {
        // Error requesting permission, use default region
        setRegion(DEFAULT_REGION);
      } finally {
        setLoading(false);
      }
    };

    initializeRegion();
  }, []);

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
  };

  const handleUseThisArea = () => {
    const mode = route.params?.mode;
    
    // Replace the current screen (PickSavedSearchArea) with the target screen
    // This ensures the picker is removed from the stack
    if (returnTo === 'CreateSavedSearch') {
      // Forward draft if present to preserve form state
      const draft = route.params?.draft;
      
      if (mode === 'radius') {
        // Return center for radius mode
        const center = {
          lat: region.latitude,
          lng: region.longitude,
        };
        navigation.dispatch(
          StackActions.replace('CreateSavedSearch', { pickedCenter: center, draft })
        );
      } else {
        // Return bounds for polygon mode
        const bounds = computeBoundsFromRegion(region);
        // Polygon mode removed - using radius-only
        navigation.dispatch(
          StackActions.replace('CreateSavedSearch', { draft })
        );
      }
    } else if (returnTo === 'EditSavedSearch' && existingId) {
      if (mode === 'radius') {
        const center = {
          lat: region.latitude,
          lng: region.longitude,
        };
        navigation.dispatch(
          StackActions.replace('EditSavedSearch', { id: existingId, pickedCenter: center })
        );
      } else {
        const bounds = computeBoundsFromRegion(region);
        // Polygon mode removed - using radius-only
        navigation.dispatch(
          StackActions.replace('EditSavedSearch', { id: existingId })
        );
      }
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <TopHeader 
          title="Pick Search Area"
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
      <TopHeader title="Pick Search Area" />
      <View style={styles.mapContainer}>
        <MapView
          ref={mapViewRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          region={region}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation={true}
          showsMyLocationButton={true}
        />
      </View>
      <View style={styles.contentContainer}>
        <Text style={styles.instructionText}>
          {route.params?.mode === 'radius'
            ? 'Move the map to set the center point, then tap "Use this center" to save it.'
            : 'Move the map to adjust the search area, then tap "Use this area" to save it.'}
        </Text>
        <TouchableOpacity
          style={styles.useButton}
          onPress={handleUseThisArea}
          activeOpacity={0.7}
        >
          <Text style={styles.useButtonText}>
            {route.params?.mode === 'radius' ? 'Use this center' : 'Use this area'}
          </Text>
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
  },
  map: {
    flex: 1,
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
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 20,
  },
  useButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  useButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
