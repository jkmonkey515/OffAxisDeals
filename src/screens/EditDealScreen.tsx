import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { supabaseClient } from '../lib/supabase';
import { uploadListingImage } from '../utils/uploadListingImage';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import type { MyListingsStackParamList, AppStackParamList } from '../types/navigation';
import { SUPPORTED_CURRENCIES, normalizeCurrency, type SupportedCurrency } from '../utils/currency';
import { PROPERTY_TYPES, type PropertyType } from '../utils/propertyTypes';
import { DEAL_CONSTRAINT_OPTIONS } from '../utils/dealConstraints';
import { colors, spacing, typography } from '../theme';
import { toListingImagePublicUrl, toListingImagePath } from '../utils/listingImages';

/** Trim whitespace and collapse repeated spaces. */
function sanitizeAddressField(s: string): string {
  return s.trim().replace(/\s{2,}/g, ' ');
}

interface EditDealScreenProps {
  route: RouteProp<MyListingsStackParamList | AppStackParamList, 'EditDeal'>;
}

interface EditableListing {
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
  description?: string;
  arv?: number | null;
  repairs?: number | null;
  year_built?: number | null;
  garage_spaces?: number | null;
  property_type?: string | null;
  cover_image_url?: string | null;
  images?: string[] | null;
  currency?: string | null;
  address_visibility?: 'exact' | 'approx' | 'hidden' | null;
  deal_constraints?: string[] | null;
  deal_constraints_notes?: string | null;
}

// Database row type for listings query
interface ListingRow {
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
  description?: string | null;
  arv?: number | null;
  repairs?: number | null;
  year_built?: number | null;
  garage_spaces?: number | null;
  property_type?: string | null;
  cover_image_url?: string | null;
  images?: string[] | null;
  currency?: string | null;
  address_visibility?: 'exact' | 'approx' | 'hidden' | null;
  deal_constraints?: string[] | null;
  deal_constraints_notes?: string | null;
}

export default function EditDealScreen({ route }: EditDealScreenProps) {
  const { listingId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<MyListingsStackParamList>>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [listing, setListing] = useState<EditableListing | null>(null);

  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [zip, setZip] = useState('');
  const [price, setPrice] = useState('');
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [sqft, setSqft] = useState('');
  const [lotSqft, setLotSqft] = useState('');
  const [description, setDescription] = useState('');
  const [arv, setArv] = useState('');
  const [repairs, setRepairs] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [garageSpaces, setGarageSpaces] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [currency, setCurrency] = useState<SupportedCurrency>('USD');
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [propertyTypePickerVisible, setPropertyTypePickerVisible] = useState(false);
  const [dealConstraints, setDealConstraints] = useState<string[]>([]);
  const [dealConstraintsNotes, setDealConstraintsNotes] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Fallback: navigate to MyListings if can't go back
      navigation.navigate('MyListingsHome');
    }
  };

  const loadListing = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser();

      if (userError) {
        setError(userError.message);
        return;
      }

      if (!user) {
        setError('Not authenticated.');
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
            'zip',
            'price',
            'beds',
            'baths',
            'sqft',
            'lot_sqft',
            'description',
            'arv',
            'repairs',
            'year_built',
            'garage_spaces',
            'property_type',
            'cover_image_url',
            'images',
            'currency',
            'address_visibility',
            'deal_constraints',
            'deal_constraints_notes',
          ].join(', ')
        )
        .eq('id', listingId)
        .single() as { data: ListingRow | null; error: { message: string } | null };

      if (queryError) {
        setError(queryError.message);
        return;
      }

      if (!data) {
        setError('Listing not found');
        return;
      }

      // Map database row to domain type
      const editable: EditableListing = {
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
        description: data.description ?? undefined,
        arv: typeof data.arv === 'number' ? data.arv : null,
        repairs: typeof data.repairs === 'number' ? data.repairs : null,
        year_built: typeof data.year_built === 'number' ? data.year_built : null,
        garage_spaces: typeof data.garage_spaces === 'number' ? data.garage_spaces : null,
        property_type: data.property_type ?? null,
        cover_image_url: data.cover_image_url ?? null,
        images: Array.isArray(data.images) ? data.images : null,
        currency: data.currency ?? null,
        address_visibility: data.address_visibility ?? 'approx',
        deal_constraints: Array.isArray(data.deal_constraints) ? data.deal_constraints : null,
        deal_constraints_notes: data.deal_constraints_notes ?? null,
      };

      if (editable.owner_id !== user.id) {
        setError('You can only edit your own listings.');
        return;
      }

      setListing(editable);
      setTitle(editable.title ?? '');
      setAddress(editable.address ?? '');
      setCity(editable.city ?? '');
      setStateValue(editable.state ?? '');
      setZip(editable.zip ?? '');
      setPrice(
        typeof editable.price === 'number' && !Number.isNaN(editable.price)
          ? String(editable.price)
          : ''
      );
      setBeds(
        typeof editable.beds === 'number' && !Number.isNaN(editable.beds)
          ? String(editable.beds)
          : ''
      );
      setBaths(
        typeof editable.baths === 'number' && !Number.isNaN(editable.baths)
          ? String(editable.baths)
          : ''
      );
      setSqft(
        typeof editable.sqft === 'number' && !Number.isNaN(editable.sqft)
          ? String(editable.sqft)
          : ''
      );
      setLotSqft(
        typeof editable.lot_sqft === 'number' && !Number.isNaN(editable.lot_sqft)
          ? String(editable.lot_sqft)
          : ''
      );
      setDescription(editable.description ?? '');
      setArv(
        typeof editable.arv === 'number' && !Number.isNaN(editable.arv)
          ? String(editable.arv)
          : ''
      );
      setRepairs(
        typeof editable.repairs === 'number' && !Number.isNaN(editable.repairs)
          ? String(editable.repairs)
          : ''
      );
      setYearBuilt(
        typeof editable.year_built === 'number' && !Number.isNaN(editable.year_built)
          ? String(editable.year_built)
          : ''
      );
      setGarageSpaces(
        typeof editable.garage_spaces === 'number' && !Number.isNaN(editable.garage_spaces)
          ? String(editable.garage_spaces)
          : ''
      );
      // Store raw paths/URLs from DB, but resolve for display
      const rawImages = Array.isArray(editable.images) ? editable.images : [];
      setImages(rawImages);
      setCoverImageUrl(editable.cover_image_url ?? null);
      setCurrency(normalizeCurrency(editable.currency));
      setPropertyType(editable.property_type ?? null);
      setDealConstraints(Array.isArray(editable.deal_constraints) ? editable.deal_constraints : []);
      setDealConstraintsNotes(editable.deal_constraints_notes ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load listing.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    loadListing();
  }, [loadListing]);

  const handleSave = async () => {
    if (!listing || !currentUserId || listing.owner_id !== currentUserId) {
      Alert.alert('Not allowed', 'You can only edit your own listings.');
      return;
    }

    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    // Full address required (street + city + state + zip)
    setAddressError(null);
    setCityError(null);
    setStateError(null);
    setZipError(null);
    const sanitizedAddress = sanitizeAddressField(address);
    const sanitizedCity = sanitizeAddressField(city);
    const sanitizedState = sanitizeAddressField(stateValue);
    const sanitizedZip = sanitizeAddressField(zip);
    let hasAddressError = false;
    if (!sanitizedAddress) {
      setAddressError('Street address is required.');
      hasAddressError = true;
    }
    if (!sanitizedCity) {
      setCityError('City is required.');
      hasAddressError = true;
    }
    if (!sanitizedState) {
      setStateError('State is required.');
      hasAddressError = true;
    }
    if (!sanitizedZip) {
      setZipError('Zip is required.');
      hasAddressError = true;
    }
    if (hasAddressError) {
      setError('Please complete all address fields.');
      return;
    }

    if (!price.trim()) {
      setError('Price is required.');
      return;
    }

    const priceNumber = Number(price.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      setError('Price must be a positive number.');
      return;
    }

    const bedsNumber = beds.trim() ? Number(beds) : undefined;
    const bathsNumber = baths.trim() ? Number(baths) : undefined;
    const sqftNumber = sqft.trim() ? Number(sqft) : undefined;
    const lotSqftNumber = lotSqft.trim() ? Number(lotSqft) : undefined;

    // Parse ARV: strip $ and commas, parseFloat, null if empty, block negative
    const arvSanitized = arv.trim().replace(/[^0-9.]/g, '');
    const arvNumber = arvSanitized ? parseFloat(arvSanitized) : null;
    if (arvNumber !== null && (Number.isNaN(arvNumber) || arvNumber < 0)) {
      setError('ARV must be a positive number or empty.');
      return;
    }

    // Parse Repairs: strip $ and commas, parseFloat, null if empty, block negative
    const repairsSanitized = repairs.trim().replace(/[^0-9.]/g, '');
    const repairsNumber = repairsSanitized ? parseFloat(repairsSanitized) : null;
    if (repairsNumber !== null && (Number.isNaN(repairsNumber) || repairsNumber < 0)) {
      setError('Repairs must be a positive number or empty.');
      return;
    }

    if (bedsNumber !== undefined && Number.isNaN(bedsNumber)) {
      setError('Beds must be a number.');
      return;
    }

    if (bathsNumber !== undefined && Number.isNaN(bathsNumber)) {
      setError('Baths must be a number.');
      return;
    }

    if (sqftNumber !== undefined && Number.isNaN(sqftNumber)) {
      setError('Sqft must be a number.');
      return;
    }

    if (lotSqftNumber !== undefined && Number.isNaN(lotSqftNumber)) {
      setError('Lot size must be a number.');
      return;
    }

    // Parse Year Built: allow empty => null, parseInt, validate range
    const yearBuiltTrimmed = yearBuilt.trim();
    const yearBuiltNumber = yearBuiltTrimmed ? parseInt(yearBuiltTrimmed, 10) : null;
    if (yearBuiltNumber !== null) {
      const currentYear = new Date().getFullYear();
      if (Number.isNaN(yearBuiltNumber) || yearBuiltNumber < 1800 || yearBuiltNumber > currentYear + 1) {
        setError('Year Built must be between 1800 and ' + (currentYear + 1) + ' or empty.');
        return;
      }
    }

    // Parse Garage Spaces: allow empty => null, parseInt, validate range
    const garageSpacesTrimmed = garageSpaces.trim();
    const garageSpacesNumber = garageSpacesTrimmed ? parseInt(garageSpacesTrimmed, 10) : null;
    if (garageSpacesNumber !== null) {
      if (Number.isNaN(garageSpacesNumber) || garageSpacesNumber < 0 || garageSpacesNumber > 20) {
        setError('Garage Spaces must be between 0 and 20 or empty.');
        return;
      }
    }

    setSaving(true);

    try {
      // Normalize images and cover_image_url to paths before saving
      const normalizedImages = images.map(img => toListingImagePath(img)).filter(Boolean);
      const normalizedCover = coverImageUrl ? toListingImagePath(coverImageUrl) : null;

      // address_visibility forced to 'exact'; full address required; only write address if changed
      const initialAddress = sanitizeAddressField(listing.address ?? '');
      const initialCity = sanitizeAddressField(listing.city ?? '');
      const initialState = sanitizeAddressField(listing.state ?? '');
      const initialZip = sanitizeAddressField(listing.zip ?? '');
      const payloadAddress = sanitizedAddress !== initialAddress ? sanitizedAddress : undefined;
      const payloadCity = sanitizedCity !== initialCity ? sanitizedCity : undefined;
      const payloadState = sanitizedState !== initialState ? sanitizedState : undefined;
      const payloadZip = sanitizedZip !== initialZip ? sanitizedZip : undefined;

      const updatePayload: Partial<EditableListing> = {
        title: title.trim(),
        ...(payloadAddress !== undefined && { address: payloadAddress }),
        ...(payloadCity !== undefined && { city: payloadCity }),
        ...(payloadState !== undefined && { state: payloadState }),
        ...(payloadZip !== undefined && { zip: payloadZip }),
        address_visibility: 'exact',
        price: priceNumber,
        beds: bedsNumber,
        baths: bathsNumber,
        sqft: sqftNumber,
        lot_sqft: lotSqftNumber,
        description: description.trim() || undefined,
        arv: arvNumber,
        repairs: repairsNumber,
        year_built: yearBuiltNumber,
        garage_spaces: garageSpacesNumber,
        property_type: propertyType || null,
        currency: currency,
        images: normalizedImages.length > 0 ? normalizedImages : null,
        cover_image_url: normalizedCover,
        deal_constraints: dealConstraints.length > 0 ? dealConstraints : null,
        deal_constraints_notes: dealConstraintsNotes.trim() || null,
      };

      const { error: updateError } = await supabaseClient
        .from('listings')
        .update(updatePayload)
        .eq('id', listing.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      Alert.alert('Saved', 'Listing updated successfully.');
      // Navigate back to My Listings and rely on focus-based refetch
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('MyListingsHome');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save listing.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddPhoto = async () => {
    if (!listing || !currentUserId || listing.owner_id !== currentUserId) {
      Alert.alert('Not allowed', 'You can only edit your own listings.');
      return;
    }

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant camera roll permissions to select images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.uri) {
        return;
      }

      setPhotoLoading(true);
      const uploadedUrl = await uploadListingImage(listing.id, listing.owner_id, asset.uri);
      
      // Normalize uploaded URL to path for storage
      const uploadedPath = toListingImagePath(uploadedUrl);
      if (!uploadedPath) {
        Alert.alert('Error', 'Could not determine storage path for uploaded image.');
        setPhotoLoading(false);
        return;
      }

      // Normalize existing images to paths
      const normalizedImages = images.map(img => toListingImagePath(img)).filter(Boolean);
      const normalizedCover = coverImageUrl ? toListingImagePath(coverImageUrl) : null;

      const nextImages = [...normalizedImages, uploadedPath];
      const nextCover = normalizedCover || uploadedPath;

      const { error: updateError } = await supabaseClient
        .from('listings')
        .update({
          images: nextImages,
          cover_image_url: nextCover,
        })
        .eq('id', listing.id);

      if (updateError) {
        Alert.alert('Error', updateError.message);
        setPhotoLoading(false);
        return;
      }

      await loadListing();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add photo.';
      Alert.alert('Error', message);
    } finally {
      setPhotoLoading(false);
    }
  };

  const handleDeletePhoto = async (url: string) => {
    if (!listing || !currentUserId || listing.owner_id !== currentUserId) {
      Alert.alert('Not allowed', 'You can only edit your own listings.');
      return;
    }

    Alert.alert(
      'Remove photo',
      'Are you sure you want to remove this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setPhotoLoading(true);

              // Convert URL to storage path using the resolver
              const path = toListingImagePath(url);

              if (!path) {
                Alert.alert('Error', 'Could not determine storage path for this image.');
                setPhotoLoading(false);
                return;
              }

              const { error: removeError } = await supabaseClient.storage
                .from('listing-images')
                .remove([path]);

              if (removeError) {
                Alert.alert('Error', removeError.message);
                setPhotoLoading(false);
                return;
              }

              // Normalize all images to paths for comparison and storage
              const normalizedImages = images.map(img => toListingImagePath(img)).filter(Boolean);
              const normalizedUrl = toListingImagePath(url);
              const normalizedCover = coverImageUrl ? toListingImagePath(coverImageUrl) : null;

              const nextImages = normalizedImages.filter((img) => img !== normalizedUrl);
              const nextCover =
                normalizedCover === normalizedUrl ? (nextImages.length > 0 ? nextImages[0] : null) : normalizedCover;

              const { error: updateError } = await supabaseClient
                .from('listings')
                .update({
                  images: nextImages,
                  cover_image_url: nextCover,
                })
                .eq('id', listing.id);

              if (updateError) {
                Alert.alert('Error', updateError.message);
                setPhotoLoading(false);
                return;
              }

              await loadListing();
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Failed to remove photo.';
              Alert.alert('Error', message);
            } finally {
              setPhotoLoading(false);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading listing...</Text>
      </View>
    );
  }

  if (error && !listing) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Listing not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopHeader 
        title="Edit Listing" 
        onBackPress={handleBack}
        right={<HeaderRightActions />}
      />

      <ScrollView contentContainerStyle={styles.contentContainer}>
        <Text style={styles.title}>Edit Listing</Text>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.formGroup}>
        <Text style={styles.label}>Title *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Enter title"
          placeholderTextColor="#9AA0A6"
          editable={!saving && !photoLoading}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Address *</Text>
        <TextInput
          style={[styles.input, addressError && styles.inputError]}
          value={address}
          onChangeText={(t) => {
            setAddress(t);
            if (addressError) setAddressError(null);
          }}
          placeholder="Street address"
          placeholderTextColor="#9AA0A6"
          editable={!saving && !photoLoading}
        />
        {addressError && <Text style={styles.inlineErrorText}>{addressError}</Text>}
      </View>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>City *</Text>
          <TextInput
            style={[styles.input, cityError && styles.inputError]}
            value={city}
            onChangeText={(t) => {
              setCity(t);
              if (cityError) setCityError(null);
            }}
            placeholder="City"
            placeholderTextColor="#9AA0A6"
            editable={!saving && !photoLoading}
          />
          {cityError && <Text style={styles.inlineErrorText}>{cityError}</Text>}
        </View>
        <View style={[styles.rowItem, styles.rowItemSmall]}>
          <Text style={styles.label}>State *</Text>
          <TextInput
            style={[styles.input, stateError && styles.inputError]}
            value={stateValue}
            onChangeText={(t) => {
              setStateValue(t);
              if (stateError) setStateError(null);
            }}
            placeholder="ST"
            placeholderTextColor="#9AA0A6"
            autoCapitalize="characters"
            maxLength={2}
            editable={!saving && !photoLoading}
          />
          {stateError && <Text style={styles.inlineErrorText}>{stateError}</Text>}
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Zip *</Text>
          <TextInput
            style={[styles.input, zipError && styles.inputError]}
            value={zip}
            onChangeText={(t) => {
              setZip(t);
              if (zipError) setZipError(null);
            }}
            placeholder="Zip"
            placeholderTextColor="#9AA0A6"
            keyboardType="numeric"
            editable={!saving && !photoLoading}
          />
          {zipError && <Text style={styles.inlineErrorText}>{zipError}</Text>}
        </View>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Price *</Text>
        <TextInput
          style={styles.input}
          value={price}
          onChangeText={setPrice}
          placeholder="Price"
          placeholderTextColor="#9AA0A6"
          keyboardType="numeric"
          editable={!saving && !photoLoading}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Currency</Text>
        <View style={styles.currencyPicker}>
          {SUPPORTED_CURRENCIES.map((curr) => (
            <TouchableOpacity
              key={curr}
              style={[
                styles.currencyOption,
                currency === curr && styles.currencyOptionSelected,
              ]}
              onPress={() => setCurrency(curr)}
              disabled={saving || photoLoading}
            >
              <Text
                style={[
                  styles.currencyOptionText,
                  currency === curr && styles.currencyOptionTextSelected,
                ]}
              >
                {curr}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Property Type</Text>
        <TouchableOpacity
          style={styles.propertyTypeButton}
          onPress={() => setPropertyTypePickerVisible(true)}
          disabled={saving || photoLoading}
        >
          <Text style={[styles.propertyTypeButtonText, !propertyType && styles.propertyTypeButtonTextPlaceholder]}>
            {propertyType || 'Select property type'}
          </Text>
          <Text style={styles.propertyTypeButtonArrow}>▼</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={propertyTypePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPropertyTypePickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Property Type</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setPropertyTypePickerVisible(false)}
              >
                <Text style={styles.modalCloseButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <SafeAreaView edges={['bottom']} style={styles.modalListContainer}>
              <FlatList
                data={['', ...PROPERTY_TYPES]}
                keyExtractor={(item, index) => item || 'none'}
                contentContainerStyle={styles.modalListContent}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.propertyTypeOption,
                      propertyType === item && styles.propertyTypeOptionSelected,
                    ]}
                    onPress={() => {
                      setPropertyType(item || null);
                      setPropertyTypePickerVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.propertyTypeOptionText,
                        propertyType === item && styles.propertyTypeOptionTextSelected,
                      ]}
                    >
                      {item || 'None'}
                    </Text>
                    {propertyType === item && (
                      <Text style={styles.propertyTypeOptionCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            </SafeAreaView>
          </View>
        </View>
      </Modal>

      <View style={styles.formGroup}>
        <Text style={styles.sectionLabel}>Investment Opportunity</Text>
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.label}>ARV</Text>
            <TextInput
              style={styles.input}
              value={arv}
              onChangeText={setArv}
              placeholder="$0"
              placeholderTextColor="#9AA0A6"
              keyboardType="numeric"
              editable={!saving && !photoLoading}
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Repairs</Text>
            <TextInput
              style={styles.input}
              value={repairs}
              onChangeText={setRepairs}
              placeholder="$0"
              placeholderTextColor="#9AA0A6"
              keyboardType="numeric"
              editable={!saving && !photoLoading}
            />
          </View>
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Beds</Text>
          <TextInput
            style={styles.input}
            value={beds}
            onChangeText={setBeds}
            placeholder="Beds"
            placeholderTextColor="#9AA0A6"
            keyboardType="numeric"
            editable={!saving && !photoLoading}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Baths</Text>
          <TextInput
            style={styles.input}
            value={baths}
            onChangeText={setBaths}
            placeholder="Baths"
            placeholderTextColor="#9AA0A6"
            keyboardType="numeric"
            editable={!saving && !photoLoading}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Sqft</Text>
          <TextInput
            style={styles.input}
            value={sqft}
            onChangeText={setSqft}
            placeholder="Sqft"
            placeholderTextColor="#9AA0A6"
            keyboardType="numeric"
            editable={!saving && !photoLoading}
          />
        </View>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Lot Size (sqft)</Text>
        <TextInput
          style={styles.input}
          value={lotSqft}
          onChangeText={setLotSqft}
          placeholder="Lot size"
          placeholderTextColor="#9AA0A6"
          keyboardType="numeric"
          editable={!saving && !photoLoading}
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Year Built</Text>
          <TextInput
            style={styles.input}
            value={yearBuilt}
            onChangeText={setYearBuilt}
            placeholder="1990"
            placeholderTextColor="#9AA0A6"
            keyboardType="numeric"
            editable={!saving && !photoLoading}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Garage Spaces</Text>
          <TextInput
            style={styles.input}
            value={garageSpaces}
            onChangeText={setGarageSpaces}
            placeholder="2"
            placeholderTextColor="#9AA0A6"
            keyboardType="numeric"
            editable={!saving && !photoLoading}
          />
        </View>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the property"
          placeholderTextColor="#9AA0A6"
          multiline
          numberOfLines={4}
          editable={!saving && !photoLoading}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.sectionLabel}>Known Deal Constraints</Text>
        <Text style={styles.helpText}>
          Select any constraints that apply to this deal.
        </Text>
        {DEAL_CONSTRAINT_OPTIONS.map((opt) => {
          const isSelected = dealConstraints.includes(opt.value);
          return (
            <TouchableOpacity
              key={opt.value}
              style={styles.constraintCheckbox}
              onPress={() => {
                if (saving || photoLoading) return;
                setDealConstraints((prev) =>
                  isSelected ? prev.filter((v) => v !== opt.value) : [...prev, opt.value]
                );
              }}
              disabled={saving || photoLoading}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                {isSelected && <Text style={styles.checkboxCheckmark}>✓</Text>}
              </View>
              <Text style={styles.constraintLabel}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
        <Text style={styles.label}>Additional notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={dealConstraintsNotes}
          onChangeText={setDealConstraintsNotes}
          placeholder="Any other deal constraints or details"
          placeholderTextColor="#9AA0A6"
          multiline
          numberOfLines={2}
          editable={!saving && !photoLoading}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Photos</Text>
        <TouchableOpacity
          style={styles.imagePickerButton}
          onPress={handleAddPhoto}
          disabled={saving || photoLoading}
        >
          {photoLoading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={styles.imagePickerButtonText}>Add Photo</Text>
          )}
        </TouchableOpacity>

        {images.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.imageStrip}
          >
            {images.map((url) => {
              // Resolve image URL for display
              const displayUrl = toListingImagePublicUrl(url);
              // Normalize for comparison (both might be URLs or paths)
              const normalizedUrl = toListingImagePath(url);
              const normalizedCover = coverImageUrl ? toListingImagePath(coverImageUrl) : null;
              const isCover = normalizedCover === normalizedUrl;

              return (
                <View key={url} style={styles.imageItem}>
                  <View style={styles.imageContainer}>
                    <Image
                      source={{ uri: displayUrl || url }}
                      style={styles.thumbnail}
                      onError={(e) => {
                        if (__DEV__) {
                          console.error('[EditDealScreen] Image load error:', displayUrl || url, e.nativeEvent.error);
                        }
                      }}
                    />
                    {isCover && (
                      <View style={styles.coverBadge}>
                        <Text style={styles.coverBadgeText}>Cover</Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => handleDeletePhoto(url)}
                      disabled={saving || photoLoading}
                    >
                      <Text style={styles.removeImageButtonText}>×</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.setCoverButton}
                    onPress={async () => {
                      if (!listing || !currentUserId || listing.owner_id !== currentUserId) {
                        Alert.alert('Not allowed', 'You can only edit your own listings.');
                        return;
                      }
                      try {
                        setPhotoLoading(true);
                        // Normalize URL to path before saving
                        const normalizedPath = toListingImagePath(url);
                        if (!normalizedPath) {
                          Alert.alert('Error', 'Could not determine storage path for this image.');
                          setPhotoLoading(false);
                          return;
                        }
                        const { error: updateError } = await supabaseClient
                          .from('listings')
                          .update({ cover_image_url: normalizedPath })
                          .eq('id', listing.id);

                      if (updateError) {
                        Alert.alert('Error', updateError.message);
                        setPhotoLoading(false);
                        return;
                      }

                      await loadListing();
                    } catch (err) {
                      const message =
                        err instanceof Error ? err.message : 'Failed to set cover image.';
                      Alert.alert('Error', message);
                    } finally {
                      setPhotoLoading(false);
                    }
                  }}
                  disabled={saving || photoLoading || isCover}
                >
                  <Text style={styles.setCoverButtonText}>
                    {isCover ? 'Current cover' : 'Set as cover'}
                  </Text>
                </TouchableOpacity>
              </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <TouchableOpacity
        style={[styles.submitButton, (saving || photoLoading) && styles.submitButtonDisabled]}
        onPress={handleSave}
        disabled={saving || photoLoading}
      >
          {saving ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
          <Text style={styles.submitButtonText}>Save Changes</Text>
        )}
      </TouchableOpacity>
      </ScrollView>
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
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
    color: colors.text,
  },
  formGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSize.sm,
    color: colors.text,
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: typography.fontSize.sm,
    color: colors.text,
    backgroundColor: colors.backgroundElevated,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inlineErrorText: {
    fontSize: typography.fontSize.xs,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rowItem: {
    flex: 1,
  },
  rowItemSmall: {
    flex: 0.6,
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  errorBox: {
    backgroundColor: '#FFECEC',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.fontSize.sm,
    textAlign: 'center',
  },
  imagePickerButton: {
    backgroundColor: colors.borderLight,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  imagePickerButtonText: {
    color: colors.primary,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  imageStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  imageItem: {
    marginRight: 12,
    alignItems: 'center',
  },
  imageContainer: {
    position: 'relative',
    width: 100,
    height: 100,
  },
  thumbnail: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: colors.danger,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeImageButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    lineHeight: 20,
  },
  coverBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coverBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  setCoverButton: {
    marginTop: 6,
  },
  setCoverButtonText: {
    fontSize: typography.fontSize.xs,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  helpText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 4,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundElevated,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxCheckmark: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  constraintCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  constraintLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  currencyPicker: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  currencyOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
  },
  currencyOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E3F2FD',
  },
  currencyOptionText: {
    fontSize: typography.fontSize.sm,
    color: colors.text,
  },
  currencyOptionTextSelected: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  propertyTypeButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
    minHeight: 44,
  },
  propertyTypeButtonText: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    flex: 1,
  },
  propertyTypeButtonTextPlaceholder: {
    color: colors.textTertiary,
  },
  propertyTypeButtonArrow: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    flex: 1,
  },
  modalListContainer: {
    flex: 1,
  },
  modalListContent: {
    paddingBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  modalCloseButton: {
    padding: spacing.sm,
  },
  modalCloseButtonText: {
    fontSize: typography.fontSize['2xl'],
    color: colors.textSecondary,
  },
  propertyTypeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
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
  propertyTypeOptionCheck: {
    fontSize: typography.fontSize.lg,
    color: colors.primary,
    fontWeight: typography.fontWeight.bold,
  },
});

