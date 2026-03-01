import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabaseClient } from '../lib/supabase';
import { useProfileWithPermissions } from '../permissions/permissions';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import type { SavedSearchesStackParamList } from '../types/navigation';
import { 
  setLocationKeywordPayload, 
  setBuyBox, 
  setRadiusMode,
  setPropertyTypes,
  getPropertyTypes,
  setLocationData,
  getLocationData,
  type RadiusCenter,
} from '../utils/savedSearchCriteria';
import LocationSearch from '../components/LocationSearch';
import { parsePriceToIntDollars, validateMinMax } from '../utils/price';
import { resetToSavedSearchesHome } from '../navigation/navHelpers';
import { PROPERTY_TYPES, type PropertyType } from '../utils/propertyTypes';
import { colors, spacing, typography } from '../theme';

type CreateSavedSearchNavigationProp = NativeStackNavigationProp<
  SavedSearchesStackParamList,
  'CreateSavedSearch'
>;

type CreateSavedSearchRouteProp = RouteProp<SavedSearchesStackParamList, 'CreateSavedSearch'>;

export default function CreateSavedSearchScreen() {
  const navigation = useNavigation<CreateSavedSearchNavigationProp>();
  const route = useRoute<CreateSavedSearchRouteProp>();
  const { profile } = useProfileWithPermissions();
  const [name, setName] = useState('');
  const [locationKeyword, setLocationKeyword] = useState('');
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [centerLat, setCenterLat] = useState<number | null>(null);
  const [centerLng, setCenterLng] = useState<number | null>(null);
  const [minBeds, setMinBeds] = useState('');
  const [minBaths, setMinBaths] = useState('');
  const [maxBeds, setMaxBeds] = useState('');
  const [maxBaths, setMaxBaths] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minPriceError, setMinPriceError] = useState<string | null>(null);
  const [maxPriceError, setMaxPriceError] = useState<string | null>(null);
  const [radiusCenter, setRadiusCenter] = useState<RadiusCenter | null>(null);
  const [radiusMiles, setRadiusMiles] = useState<number | null>(null);
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didHydrateDraftRef = useRef(false);

  // Handle pickedRadius from route params (when returning from PickSavedSearchRadius)
  useEffect(() => {
    if (route.params?.pickedRadius !== undefined) {
      const radius = route.params.pickedRadius;
      if (__DEV__) {
        console.log("[CreateSavedSearch] from PickSavedSearchRadius ->", radius);
      }
      if (radius && radius.center_lat && radius.center_lng && radius.radius_miles) {
        setRadiusCenter({ lat: radius.center_lat, lng: radius.center_lng });
        setRadiusMiles(radius.radius_miles);
        setCenterLat(radius.center_lat);
        setCenterLng(radius.center_lng);
        const locationLabel =
          typeof (radius as unknown as { locationLabel?: unknown }).locationLabel === 'string'
            ? (radius as unknown as { locationLabel?: string }).locationLabel
            : '';
        if (locationLabel) {
          setLocationLabel(locationLabel);
        }
      } else {
        // Only clear radius-related fields, preserve locationLabel/centerLat/centerLng if they exist
        setRadiusCenter(null);
        setRadiusMiles(null);
        // Do NOT clear locationLabel, centerLat, centerLng here
      }
      navigation.setParams({ pickedRadius: undefined });
    }
  }, [route.params?.pickedRadius, navigation]);

  // Handle draft from route params (when returning from PickSavedSearchArea)
  // Hydrate form state exactly once per return
  useEffect(() => {
    if (route.params?.draft && !didHydrateDraftRef.current) {
      const draft = route.params.draft;
      // Hydrate form state
      setName(draft.name || '');
      setLocationKeyword(draft.locationKeyword || '');
      setMinBeds(draft.buyBox?.minBeds || '');
      setMinBaths(draft.buyBox?.minBaths || '');
      const maxBedsValue =
        typeof (draft.buyBox as unknown as { maxBeds?: unknown })?.maxBeds === 'string'
          ? (draft.buyBox as unknown as { maxBeds?: string }).maxBeds
          : '';
      const maxBathsValue =
        typeof (draft.buyBox as unknown as { maxBaths?: unknown })?.maxBaths === 'string'
          ? (draft.buyBox as unknown as { maxBaths?: string }).maxBaths
          : '';
      setMaxBeds(maxBedsValue || '');
      setMaxBaths(maxBathsValue || '');
      setMinPrice(draft.buyBox?.minPrice || '');
      setMaxPrice(draft.buyBox?.maxPrice || '');
      // Load property types from draft (backwards compatible)
      if (draft.criteria) {
        const types = getPropertyTypes(draft.criteria);
        setSelectedPropertyTypes(types);
        // Load location data from criteria
        const locationData = getLocationData(draft.criteria);
        if (locationData.locationLabel && locationData.centerLat !== null && locationData.centerLng !== null && locationData.radiusMiles !== null) {
          setLocationLabel(locationData.locationLabel);
          setCenterLat(locationData.centerLat);
          setCenterLng(locationData.centerLng);
          setRadiusMiles(locationData.radiusMiles);
        }
      } else if (Array.isArray(draft.propertyTypes)) {
        setSelectedPropertyTypes(draft.propertyTypes);
      } else {
        setSelectedPropertyTypes([]);
      }
      // Mark as hydrated and clear the param
      didHydrateDraftRef.current = true;
      navigation.setParams({ draft: undefined });
    }
  }, [route.params?.draft, navigation]);

  // Reset hydration flag when component unmounts or when starting fresh (no draft)
  useEffect(() => {
    if (!route.params?.draft) {
      didHydrateDraftRef.current = false;
    }
  }, [route.params?.draft]);

  // Validation: name is required, location data (label + center + radius) is required
  const hasLocationData = locationLabel && centerLat !== null && centerLng !== null && radiusMiles && radiusMiles >= 1 && radiusMiles <= 250;
  const isValid = name.trim().length > 0 && hasLocationData;

  // Parse prices using new helper
  const minPriceResult = parsePriceToIntDollars(minPrice);
  const maxPriceResult = parsePriceToIntDollars(maxPrice);
  
  // Validate min/max relationship
  const { minError: minValidationError, maxError: maxValidationError } = validateMinMax(
    minPriceResult.value,
    maxPriceResult.value
  );
  
  // Combine parsing errors with validation errors
  const finalMinError = minPriceResult.error || minValidationError;
  const finalMaxError = maxPriceResult.error || maxValidationError;
  
  // Update error state when values change
  useEffect(() => {
    setMinPriceError(finalMinError);
  }, [finalMinError]);
  
  useEffect(() => {
    setMaxPriceError(finalMaxError);
  }, [finalMaxError]);
  
  // Check if there are any price errors
  const hasPriceErrors = !!finalMinError || !!finalMaxError;

  // Helper to navigate back to Saved Searches list
  // Uses hard reset to ensure we always land on the list, regardless of navigation history
  const goToSavedSearchesHome = useCallback(() => {
    // Clear route params before navigating to avoid re-entry issues
    navigation.setParams({ draft: undefined });
    // Use hard reset to guarantee we land on the list
    resetToSavedSearchesHome(navigation);
  }, [navigation]);

  const handleSave = useCallback(async () => {
    if (!isValid || saving || hasPriceErrors) {
      return;
    }

    if (!profile?.id) {
      setError('Not signed in');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Get current user
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) {
        setError('Not signed in');
        setSaving(false);
        return;
      }

      // Build criteria with location keyword, buy box, and geo bounds
      let criteria: Record<string, unknown> = {};
      
      // Set location keyword only if user typed it (don't auto-set)
      if (locationKeyword.trim().length > 0) {
        criteria = setLocationKeywordPayload(criteria, locationKeyword.trim());
      }

      // Set buy box filters
      const buyBox = {
        minBeds: minBeds.trim() ? parseFloat(minBeds.trim()) : undefined,
        minBaths: minBaths.trim() ? parseFloat(minBaths.trim()) : undefined,
        maxBeds: maxBeds.trim() ? parseFloat(maxBeds.trim()) : undefined,
        maxBaths: maxBaths.trim() ? parseFloat(maxBaths.trim()) : undefined,
        minPrice: minPriceResult.value ?? undefined, // Use parsed integer dollars
        maxPrice: maxPriceResult.value ?? undefined, // Use parsed integer dollars
      };

      // Remove undefined/invalid values
      if (buyBox.minBeds === undefined || isNaN(buyBox.minBeds) || buyBox.minBeds <= 0) {
        delete buyBox.minBeds;
      }
      if (buyBox.minBaths === undefined || isNaN(buyBox.minBaths) || buyBox.minBaths <= 0) {
        delete buyBox.minBaths;
      }
      if (buyBox.maxBeds === undefined || isNaN(buyBox.maxBeds) || buyBox.maxBeds <= 0) {
        delete buyBox.maxBeds;
      }
      if (buyBox.maxBaths === undefined || isNaN(buyBox.maxBaths) || buyBox.maxBaths <= 0) {
        delete buyBox.maxBaths;
      }
      // Prices are already validated by parsePriceToIntDollars and validateMinMax
      // setBuyBox will only persist if >= 1000

      criteria = setBuyBox(criteria, buyBox);

      // Set property types
      criteria = setPropertyTypes(criteria, selectedPropertyTypes);

      // Set location data (locationLabel, centerLat, centerLng, radiusMiles)
      if (locationLabel && centerLat !== null && centerLng !== null && radiusMiles && radiusMiles >= 1 && radiusMiles <= 250) {
        criteria = setLocationData(criteria, locationLabel, centerLat, centerLng, radiusMiles);
      } else {
        criteria = setLocationData(criteria, null, null, null, null);
      }

      // Prepare insert payload with top-level columns for consistency
      // Note: match_saved_searches() reads from criteria.buy_box.min_price/max_price, not top-level columns
      const insertPayload = {
        user_id: user.id,
        name: name.trim(),
        criteria,
        // Write to top-level columns for consistency (matching doesn't use these, but good for data integrity)
        min_price: minPriceResult.value ?? null,
        max_price: maxPriceResult.value ?? null,
        // Set center and radius if radius is set
        center_lat: centerLat !== null ? centerLat : 0,
        center_lng: centerLng !== null ? centerLng : 0,
        radius_miles: radiusMiles !== null ? radiusMiles : null,
        max_beds: buyBox.maxBeds ?? null,
        max_baths: buyBox.maxBaths ?? null,
        is_active: true,
        is_enabled: true,
      };

      // DEV: Log exact payload being written (temporary for debugging)
      if (__DEV__) {
        console.log('[DEV] Saved Search INSERT payload:', JSON.stringify({
          min_price: insertPayload.min_price,
          max_price: insertPayload.max_price,
          'criteria.buy_box.min_price': (criteria as Record<string, unknown>).buy_box 
            ? ((criteria as Record<string, unknown>).buy_box as Record<string, unknown>).min_price 
            : undefined,
          'criteria.buy_box.max_price': (criteria as Record<string, unknown>).buy_box 
            ? ((criteria as Record<string, unknown>).buy_box as Record<string, unknown>).max_price 
            : undefined,
        }, null, 2));
      }

      const { data, error: insertError } = await supabaseClient
        .from('saved_searches')
        .insert([insertPayload])
        .select()
        .single();

      if (insertError) {
        setError(insertError.message || 'Failed to save search');
        setSaving(false);
        return;
      }

      // Success - navigate back to list using hard reset
      // Note: We keep saving=true to prevent re-submission during navigation
      goToSavedSearchesHome();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save search';
      setError(message);
      setSaving(false);
    }
  }, [
    name,
    locationLabel,
    centerLat,
    centerLng,
    radiusMiles,
    minBeds,
    minBaths,
    maxBeds,
    maxBaths,
    minPrice,
    maxPrice,
    selectedPropertyTypes,
    isValid,
    saving,
    hasPriceErrors,
    minPriceResult.value,
    maxPriceResult.value,
    profile?.id,
    navigation,
    goToSavedSearchesHome,
  ]);

  return (
    <View style={styles.container}>
      <TopHeader 
        title="Create Saved Search"
        right={<HeaderRightActions />}
      />
      <ScrollView 
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
              <TextInput
              style={styles.input}
              placeholder="e.g., Vail Properties"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              value={name}
              onChangeText={(text) => {
                setName(text);
                setError(null);
              }}
              editable={!saving}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Location</Text>
            <LocationSearch
              initialText={locationLabel || ''}
              onPlaceSelected={(place) => {
                setLocationLabel(place.label);
                setCenterLat(place.lat);
                setCenterLng(place.lng);
                setRadiusCenter({ lat: place.lat, lng: place.lng });
                setError(null);
              }}
              onCleared={() => {
                setLocationLabel(null);
                setCenterLat(null);
                setCenterLng(null);
                setRadiusMiles(null);
                setRadiusCenter(null);
              }}
              renderMode="static"
            />
            {locationLabel && centerLat !== null && centerLng !== null && (
              <View style={styles.radiusPickerContainer}>
                <Text style={styles.label}>Radius (miles)</Text>
                <View style={styles.radiusOptions}>
                  {[5, 10, 25, 50, 100].map((miles) => (
                    <TouchableOpacity
                      key={miles}
                      style={[
                        styles.radiusOption,
                        radiusMiles === miles && styles.radiusOptionSelected,
                      ]}
                      onPress={() => setRadiusMiles(miles)}
                      disabled={saving}
                    >
                      <Text
                        style={[
                          styles.radiusOptionText,
                          radiusMiles === miles && styles.radiusOptionTextSelected,
                        ]}
                      >
                        {miles}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Buy Box Filters</Text>
            <Text style={styles.sectionSubtitle}>Optional filters to narrow your search</Text>

            <View style={styles.row}>
              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Min beds</Text>
                  <TextInput
                  style={styles.input}
                  placeholder="e.g., 3"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={minBeds}
                  onChangeText={(text) => {
                    setMinBeds(text.replace(/[^0-9]/g, ''));
                    setError(null);
                  }}
                  editable={!saving}
                  keyboardType="numeric"
                />
              </View>

              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Max beds</Text>
                  <TextInput
                  style={styles.input}
                  placeholder="e.g., 5"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={maxBeds}
                  onChangeText={(text) => {
                    setMaxBeds(text.replace(/[^0-9]/g, ''));
                    setError(null);
                  }}
                  editable={!saving}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Min baths</Text>
                  <TextInput
                  style={styles.input}
                  placeholder="e.g., 2"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={minBaths}
                  onChangeText={(text) => {
                    setMinBaths(text.replace(/[^0-9.]/g, '').replace(/\./g, (match, offset) => {
                      return text.indexOf('.') === offset ? match : '';
                    }));
                    setError(null);
                  }}
                  editable={!saving}
                  keyboardType="numeric"
                />
              </View>

              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Max baths</Text>
                  <TextInput
                  style={styles.input}
                  placeholder="e.g., 4"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={maxBaths}
                  onChangeText={(text) => {
                    setMaxBaths(text.replace(/[^0-9.]/g, '').replace(/\./g, (match, offset) => {
                      return text.indexOf('.') === offset ? match : '';
                    }));
                    setError(null);
                  }}
                  editable={!saving}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Min price</Text>
                  <TextInput
                  style={[styles.input, minPriceError && styles.inputError]}
                  placeholder="e.g., $150,000"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={minPrice}
                  onChangeText={(text) => {
                    setMinPrice(text);
                    setError(null);
                  }}
                  editable={!saving}
                  keyboardType="numeric"
                />
                {minPriceError ? (
                  <Text style={styles.errorTextInline}>{minPriceError}</Text>
                ) : (
                  <Text style={styles.helperText}>Enter whole dollars (e.g., $250,000)</Text>
                )}
              </View>

              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Max price</Text>
                  <TextInput
                  style={[styles.input, maxPriceError && styles.inputError]}
                  placeholder="e.g., $350,000"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={maxPrice}
                  onChangeText={(text) => {
                    setMaxPrice(text);
                    setError(null);
                  }}
                  editable={!saving}
                  keyboardType="numeric"
                />
                {maxPriceError ? (
                  <Text style={styles.errorTextInline}>{maxPriceError}</Text>
                ) : (
                  <Text style={styles.helperText}>Enter whole dollars (e.g., $350,000)</Text>
                )}
              </View>
            </View>

            {/* Property Types */}
            <View style={styles.propertyTypesSection}>
              <Text style={styles.label}>Property Types</Text>
              <TouchableOpacity
                style={[
                  styles.propertyTypeOption,
                  selectedPropertyTypes.length === 0 && styles.propertyTypeOptionSelected,
                ]}
                onPress={() => setSelectedPropertyTypes([])}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.propertyTypeOptionText,
                    selectedPropertyTypes.length === 0 && styles.propertyTypeOptionTextSelected,
                  ]}
                >
                  All Types
                </Text>
                {selectedPropertyTypes.length === 0 && (
                  <Text style={styles.propertyTypeCheck}>✓</Text>
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
                        styles.propertyTypeOption,
                        isSelected && styles.propertyTypeOptionSelected,
                      ]}
                      onPress={() => {
                        if (isSelected) {
                          setSelectedPropertyTypes(selectedPropertyTypes.filter(t => t !== item));
                        } else {
                          setSelectedPropertyTypes([...selectedPropertyTypes, item]);
                        }
                      }}
                      disabled={saving}
                    >
                      <Text
                        style={[
                          styles.propertyTypeOptionText,
                          isSelected && styles.propertyTypeOptionTextSelected,
                        ]}
                      >
                        {item}
                      </Text>
                      {isSelected && (
                        <Text style={styles.propertyTypeCheck}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location (optional)</Text>
            <View style={styles.areaRow}>
              <View style={styles.areaInfo}>
                <Text style={styles.areaLabel}>Search area</Text>
                <Text style={styles.areaStatus}>
                  {radiusCenter && radiusMiles
                    ? `Within ${radiusMiles} ${radiusMiles === 1 ? 'mile' : 'miles'}`
                    : 'Anywhere'}
                </Text>
              </View>
              <View style={styles.areaActions}>
                <TouchableOpacity
                  style={styles.areaButton}
                  onPress={() => {
                    // Capture current form state as draft before navigating
                    const draft = {
                      name,
                      locationKeyword,
                      buyBox: {
                        minBeds: minBeds.trim() ? minBeds : undefined,
                        minBaths: minBaths.trim() ? minBaths : undefined,
                        maxBeds: maxBeds.trim() ? maxBeds : undefined,
                        maxBaths: maxBaths.trim() ? maxBaths : undefined,
                        minPrice: minPrice.trim() ? minPrice : undefined,
                        maxPrice: maxPrice.trim() ? maxPrice : undefined,
                      },
                      propertyTypes: selectedPropertyTypes.length > 0 ? selectedPropertyTypes : undefined,
                    };
                    navigation.navigate('PickSavedSearchRadius', {
                      returnTo: 'CreateSavedSearch',
                      draft,
                      initialCenter: radiusCenter || (centerLat !== null && centerLng !== null ? { lat: centerLat, lng: centerLng } : undefined),
                      initialRadius: radiusMiles || undefined,
                      locationLabel: locationLabel || undefined,
                    });
                  }}
                  disabled={saving}
                >
                  <Text style={styles.areaButtonText}>
                    {radiusCenter && radiusMiles ? 'Change' : 'Set Location'}
                  </Text>
                </TouchableOpacity>
                {radiusCenter && radiusMiles && (
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={() => {
                      setRadiusCenter(null);
                      setRadiusMiles(null);
                    }}
                    disabled={saving}
                  >
                    <Text style={styles.clearButtonText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={styles.helperText}>
              Optionally set a location radius to search within. This will override the location keyword.
            </Text>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footerContainer}>
        <TouchableOpacity
          style={[styles.saveButton, (!isValid || saving || hasPriceErrors) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!isValid || saving || hasPriceErrors}
        >
          {saving ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl, // Space for fixed footer
  },
  form: {
    flex: 1,
  },
  field: {
    marginBottom: spacing.lg,
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
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.text,
    backgroundColor: colors.backgroundElevated,
  },
  helperText: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  section: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.backgroundElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  halfField: {
    flex: 1,
    marginBottom: spacing.md,
  },
  areaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  areaInfo: {
    flex: 1,
  },
  areaLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  areaStatus: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  areaActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  propertyTypesSection: {
    marginTop: spacing.md,
  },
  propertyTypeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.background,
    borderRadius: 8,
    marginBottom: spacing.xs,
  },
  propertyTypeOptionSelected: {
    backgroundColor: '#F0F8FF',
  },
  propertyTypeOptionText: {
    fontSize: typography.fontSize.base,
    color: colors.text,
  },
  propertyTypeOptionTextSelected: {
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  propertyTypeCheck: {
    fontSize: typography.fontSize.lg,
    color: colors.primary,
    fontWeight: typography.fontWeight.bold,
  },
  areaButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
  },
  areaButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  clearButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  clearButtonText: {
    color: colors.danger,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  errorTextInline: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  inputError: {
    borderColor: colors.danger,
  },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.backgroundElevated,
    padding: spacing.md,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  saveButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  saveButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  radiusPickerContainer: {
    marginTop: spacing.md,
  },
  radiusOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  radiusOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minWidth: 60,
    alignItems: 'center',
  },
  radiusOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  radiusOptionText: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    fontWeight: typography.fontWeight.medium,
  },
  radiusOptionTextSelected: {
    color: colors.textInverse,
  },
});
