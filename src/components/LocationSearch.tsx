import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Text,
  ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
import { colors, spacing, typography } from '../theme';

interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface PlaceDetails {
  place_id: string;
  geometry: {
    location: {
      lat: number | (() => number);
      lng: number | (() => number);
    };
  };
  formatted_address: string;
}

interface LocationSearchProps {
  initialText?: string;
  onPlaceSelected: (place: { label: string; lat: number; lng: number }) => void;
  onCleared?: () => void;
  renderMode?: 'list' | 'static';
}

export default function LocationSearch({
  initialText = '',
  onPlaceSelected,
  onCleared,
  renderMode = 'list',
}: LocationSearchProps) {
  const [query, setQuery] = useState(initialText);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Get Google Places API key (prefer Places key, fallback to Maps key)
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY || '';

  // Update query when initialText changes
  useEffect(() => {
    if (initialText !== undefined) {
      setQuery(initialText);
    }
  }, [initialText]);

  // Fetch autocomplete predictions
  const fetchPredictions = useCallback(async (input: string) => {
    if (!input.trim() || input.length < 2) {
      setPredictions([]);
      setShowResults(false);
      return;
    }

    if (!apiKey) {
      console.warn('[LocationSearch] Google Maps API key not found');
      return;
    }

    setLoading(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=geocode&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && Array.isArray(data.predictions)) {
        setPredictions(data.predictions);
        setShowResults(true);
      } else {
        if (__DEV__) {
          console.warn('[LocationSearch] autocomplete non-OK:', {
            endpoint: 'autocomplete',
            status: data.status,
            error_message: data.error_message,
            input: input,
          });
        }
        setPredictions([]);
        setShowResults(false);
      }
    } catch (error) {
      console.error('[LocationSearch] Autocomplete error:', error);
      setPredictions([]);
      setShowResults(false);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  // Debounced search
  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (text.trim().length === 0) {
      setPredictions([]);
      setShowResults(false);
      if (onCleared) {
        onCleared();
      }
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchPredictions(text);
    }, 300);
  }, [fetchPredictions, onCleared]);

  // Fetch place details and call onPlaceSelected
  const handleSelectPlace = useCallback(async (prediction: PlacePrediction) => {
    if (!apiKey) {
      if (__DEV__) {
        console.warn('[LocationSearch] Google Maps API key not found');
      }
      return;
    }

    setLoading(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,formatted_address&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.result) {
        const details = data.result as PlaceDetails;
        
        // Extract lat/lng handling both function and value cases
        if (details?.geometry?.location) {
          const lat = typeof details.geometry.location.lat === "function" 
            ? details.geometry.location.lat() 
            : details.geometry.location.lat;
          const lng = typeof details.geometry.location.lng === "function" 
            ? details.geometry.location.lng() 
            : details.geometry.location.lng;

          // Validate lat/lng are finite numbers
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            if (__DEV__) {
              console.warn('[LocationSearch] Invalid coordinates:', { lat, lng });
            }
            return;
          }

          const description = prediction.description ?? prediction.structured_formatting?.main_text ?? "";
          const label = details.formatted_address || description;

          setQuery(label);
          setPredictions([]);
          setShowResults(false);
          onPlaceSelected({ label, lat, lng });
        } else {
          if (__DEV__) {
            console.warn('[LocationSearch] Missing geometry.location in place details');
          }
        }
      } else {
        if (__DEV__) {
          console.warn('[LocationSearch] details non-OK:', {
            endpoint: 'details',
            status: data.status,
            error_message: data.error_message,
            place_id: prediction.place_id,
          });
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[LocationSearch] Place details error:', error);
      }
    } finally {
      setLoading(false);
    }
  }, [apiKey, onPlaceSelected]);

  // Handle Enter/Submit - trigger selection if predictions exist, else fetch and show
  const handleSubmit = useCallback(async () => {
    if (__DEV__) {
      console.log("[LocationSearch] submit:", { query, predictionsCount: predictions.length });
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      return;
    }

    // If predictions exist, select the first one immediately
    if (predictions.length > 0) {
      handleSelectPlace(predictions[0]);
      return;
    }

    // Else: fetch predictions and show dropdown (no auto-select)
    await fetchPredictions(trimmedQuery);
  }, [query, predictions, handleSelectPlace, fetchPredictions]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Search city or address"
          placeholderTextColor="#888"
          value={query}
          onChangeText={handleQueryChange}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading && (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
      </View>
      {showResults && predictions.length > 0 && (
        <View style={styles.resultsContainer}>
          {renderMode === 'static' ? (
            <View>
              {predictions.map((item) => (
                <TouchableOpacity
                  key={item.place_id}
                  style={styles.resultItem}
                  onPress={() => handleSelectPlace(item)}
                >
                  <Text style={styles.resultMainText}>{item.structured_formatting.main_text}</Text>
                  <Text style={styles.resultSecondaryText}>
                    {item.structured_formatting.secondary_text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelectPlace(item)}
                >
                  <Text style={styles.resultMainText}>{item.structured_formatting.main_text}</Text>
                  <Text style={styles.resultSecondaryText}>
                    {item.structured_formatting.secondary_text}
                  </Text>
                </TouchableOpacity>
              )}
              style={styles.resultsList}
              nestedScrollEnabled={true}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="always"
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 9999,
    elevation: 9999,
  },
  inputContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingRight: 40,
    fontSize: typography.fontSize.base,
    color: '#000',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  loaderContainer: {
    position: 'absolute',
    right: spacing.md,
    top: 12,
  },
  resultsContainer: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    maxHeight: 320,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    zIndex: 9999,
    elevation: 9999,
  },
  resultsList: {
    flexGrow: 0,
  },
  resultItem: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  resultMainText: {
    fontSize: typography.fontSize.base,
    fontWeight: '500',
    color: '#000',
    marginBottom: 2,
  },
  resultSecondaryText: {
    fontSize: typography.fontSize.sm,
    color: '#666',
  },
});
