import { useState, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, useFocusEffect, NavigationProp, RouteProp } from '@react-navigation/native';
import { useCallback } from 'react';
import { supabaseClient } from '../lib/supabase';
import { uploadListingImage } from '../utils/uploadListingImage';
import { qalog } from '../utils/qalog';
import { getPostDealDraft, setPostDealDraft, clearPostDealDraft, PostDealDraft } from '../state/postDealDraft';
import { useAuth } from '../contexts/AuthContext';
import { openExternalUrl } from '../utils/openExternalUrl';
import { SUPPORTED_CURRENCIES, normalizeCurrency, type SupportedCurrency } from '../utils/currency';
import { PROPERTY_TYPES, type PropertyType } from '../utils/propertyTypes';
import { DEAL_CONSTRAINT_OPTIONS } from '../utils/dealConstraints';
import { colors, spacing, typography } from '../theme';

const PRICING_URL = 'https://www.offaxisdeals.com/pricing';

/** Trim whitespace and collapse repeated spaces. */
function sanitizeAddressField(s: string): string {
  return s.trim().replace(/\s{2,}/g, ' ');
}

type RootRoutes = {
  Tabs: undefined;
  Listings: undefined;
  MyListings: undefined;
  MyListingsHome: undefined;
  ListingDetails: { listingId: string };
  PostDeal: { latitude?: number; longitude?: number };
  PostDealHome: { latitude?: number; longitude?: number };
  SetMapPin: { initialLatitude?: number; initialLongitude?: number };
};

interface SelectedImage {
  uri: string;
}

export default function PostDealScreen(): ReactElement {
  const navigation = useNavigation<NavigationProp<RootRoutes>>();
  const route = useRoute();
  const { profile } = useAuth();
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
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [coverIndex, setCoverIndex] = useState<number | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [sellerAcknowledged, setSellerAcknowledged] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [mapLocationError, setMapLocationError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<SupportedCurrency>('USD');
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [propertyTypePickerVisible, setPropertyTypePickerVisible] = useState(false);
  const [dealConstraints, setDealConstraints] = useState<string[]>([]);
  const [dealConstraintsNotes, setDealConstraintsNotes] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasHydratedRef = useRef(false);

  // Helper to restore form from draft (used on mount and focus)
  // This ensures form state persists when returning from SetMapPin
  const restoreFromDraft = useCallback(() => {
    const draft = getPostDealDraft();
    if (draft) {
      // Only restore if form appears to be empty (component may have remounted)
      // Check multiple fields to be sure form was reset
        const isFormEmpty = !title && !address && !price && !city && !stateValue && !zip && 
                            !description && !arv && !repairs && !yearBuilt && !garageSpaces && selectedImages.length === 0;
      
      if (isFormEmpty) {
        // Restore all fields from draft
        setTitle(draft.title);
        setAddress(draft.address);
        setCity(draft.city);
        setStateValue(draft.state);
        setZip(draft.zip);
        setPrice(draft.price);
        setBeds(draft.beds);
        setBaths(draft.baths);
        setSqft(draft.sqft);
        setLotSqft(draft.lotSqft);
        setDescription(draft.description);
        setArv(draft.arv ?? '');
        setRepairs(draft.repairs ?? '');
        setYearBuilt(draft.yearBuilt ?? '');
        setGarageSpaces(draft.garageSpaces ?? '');
        setSelectedImages(draft.selectedImages);
        setCoverIndex(draft.coverIndex);
        setCurrency(draft.currency ?? 'USD');
        setPropertyType(draft.propertyType ?? null);
        setDealConstraints(draft.dealConstraints ?? []);
        setDealConstraintsNotes(draft.dealConstraintsNotes ?? '');
        // Location will be updated from route params if provided, otherwise use draft
        // Don't overwrite location if route params will provide it
        const params = route.params as { latitude?: number; longitude?: number } | undefined;
        if (!params?.latitude && !params?.longitude && draft.latitude !== null && draft.longitude !== null) {
          setLatitude(draft.latitude);
          setLongitude(draft.longitude);
        }
      }
    }
  }, [title, address, price, city, stateValue, zip, description, arv, repairs, selectedImages.length, route.params]);

  // Hydrate from draft on mount (only once)
  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }
    restoreFromDraft();
    hasHydratedRef.current = true;
  }, [restoreFromDraft]);

  // Restore form from draft when screen comes into focus
  // This handles the case where component remounts when navigating back from SetMapPin
  useFocusEffect(
    useCallback(() => {
      // Always check draft on focus - restore if form is empty
      // Use a small delay to ensure component has fully mounted
      const timeoutId = setTimeout(() => {
        restoreFromDraft();
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }, [restoreFromDraft])
  );
  
  // Additional safety: listen for navigation state changes to detect return from SetMapPin
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // When screen comes into focus, check if we need to restore from draft
      // This catches cases where useFocusEffect might not fire correctly
      const draft = getPostDealDraft();
      if (draft) {
        const isFormEmpty = !title && !address && !price && !city && !stateValue && !zip && 
                            !description && !arv && !repairs && !yearBuilt && !garageSpaces && selectedImages.length === 0;
        if (isFormEmpty) {
          // Small delay to ensure state has settled
          setTimeout(() => {
            restoreFromDraft();
          }, 100);
        }
      }
    });
    
    return unsubscribe;
  }, [navigation, title, address, price, city, stateValue, zip, description, arv, repairs, selectedImages.length, restoreFromDraft]);

  // Handle route params from SetMapPinScreen
  // This updates location when returning from map picker
  // Form state is preserved via draft system (saved continuously in useEffect below)
  // Only update location - do NOT reset other fields
  useEffect(() => {
    const params = route.params as { latitude?: number; longitude?: number } | undefined;
    if (params?.latitude !== undefined && params?.longitude !== undefined) {
      // Validate coordinates are valid numbers
      const lat = Number(params.latitude);
      const lng = Number(params.longitude);
      
      if (!Number.isNaN(lat) && !Number.isNaN(lng) &&
          typeof lat === 'number' && typeof lng === 'number') {
        // Only update location fields - preserve all other form state
        setLatitude(lat);
        setLongitude(lng);
        setMapLocationError(null);
        
        // Update draft with new location immediately (CRITICAL for persistence)
        const currentDraft = getPostDealDraft();
        if (currentDraft) {
          setPostDealDraft({
            ...currentDraft,
            latitude: lat,
            longitude: lng,
          });
        } else {
          // If no draft exists yet, create one with just the coordinates
          // This ensures coordinates persist even if form hasn't been filled yet
          setPostDealDraft({
            title: '',
            address: '',
            city: '',
            state: '',
            zip: '',
            price: '',
            beds: '',
            baths: '',
            sqft: '',
            lotSqft: '',
            description: '',
            arv: '',
            repairs: '',
            yearBuilt: '',
            garageSpaces: '',
            selectedImages: [],
            coverIndex: null,
            latitude: lat,
            longitude: lng,
          });
        }
      } else {
        // Invalid coordinates - log error but don't crash
        if (__DEV__) {
          console.error('[PostDeal] Invalid coordinates received from SetMapPin:', params);
        }
        setMapLocationError('Invalid coordinates received. Please set the location again.');
      }
    }
  }, [route.params]);

  // Save draft whenever any field changes
  useEffect(() => {
    // Skip saving if we haven't hydrated yet
    if (!hasHydratedRef.current) {
      return;
    }

    const draft: PostDealDraft = {
      title,
      address,
      city,
      state: stateValue,
      zip,
      price,
      beds,
      baths,
      sqft,
      lotSqft,
      description,
      arv,
      repairs,
      yearBuilt,
      garageSpaces,
      selectedImages,
      coverIndex,
      latitude,
      longitude,
      currency,
      propertyType,
      dealConstraints,
      dealConstraintsNotes,
    };

    setPostDealDraft(draft);
  }, [
    title,
    address,
    city,
    stateValue,
    zip,
    price,
    beds,
    baths,
    sqft,
    lotSqft,
    description,
    arv,
    repairs,
    yearBuilt,
    garageSpaces,
    selectedImages,
    coverIndex,
    latitude,
    longitude,
    currency,
    propertyType,
    dealConstraints,
    dealConstraintsNotes,
  ]);

  const navigateAfterPublish = () => {
    // Always navigate to MyListings tab after successful publish
    // Get the root navigator (tab navigator) to navigate to the tab
    const parent = navigation.getParent();
    if (parent) {
      // Navigate to MyListings tab - this will show MyListingsHome screen
      parent.navigate('MyListings');
    } else {
      // Fallback: try direct navigation if parent is not available
      // This should not happen in normal flow, but provides safety
      try {
        (navigation as any).navigate('MyListings');
      } catch (err) {
        if (__DEV__) {
          console.error('Failed to navigate to MyListings:', err);
        }
        // Last resort: go back if possible
        if (navigation.canGoBack()) {
          navigation.goBack();
        }
      }
    }
  };

  const pickImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant camera roll permissions to select images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets) {
        const newImages = result.assets
          .filter((asset) => !!asset.uri)
          .map((asset) => ({ uri: asset.uri as string }));

        if (newImages.length === 0) {
          return;
        }

        setSelectedImages((prev) => {
          const combined = [...prev, ...newImages];
          // Default cover to first image if none set yet
          if (combined.length > 0 && coverIndex === null) {
            setCoverIndex(0);
          }
          return combined;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pick images.';
      setError(message);
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages(selectedImages.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setTitle('');
    setAddress('');
    setCity('');
    setStateValue('');
    setZip('');
    setPrice('');
    setBeds('');
    setBaths('');
    setSqft('');
    setLotSqft('');
    setDescription('');
    setArv('');
    setRepairs('');
    setSelectedImages([]);
    setCoverIndex(null);
    setLatitude(null);
    setLongitude(null);
    setSellerAcknowledged(false);
    setMapLocationError(null);
    setError(null);
    setPropertyType(null);
    setDealConstraints([]);
    setDealConstraintsNotes('');
    setAddressError(null);
    setCityError(null);
    setStateError(null);
    setZipError(null);
    hasHydratedRef.current = false;
  };

  const handleSubmit = async () => {
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

    if (!sellerAcknowledged) {
      setError('Please acknowledge the seller confirmation statement.');
      return;
    }

    // QA checklist: cannot submit without pin - lat/lng must be set before submit
    const finalLatitude = latitude ?? getPostDealDraft()?.latitude ?? null;
    const finalLongitude = longitude ?? getPostDealDraft()?.longitude ?? null;

    if (finalLatitude === null || finalLongitude === null) {
      setMapLocationError('Please set a map location to continue');
      setError('Please set a map location to continue');
      return;
    }
    
    // Additional validation: ensure coordinates are valid numbers
    if (typeof finalLatitude !== 'number' || typeof finalLongitude !== 'number' ||
        Number.isNaN(finalLatitude) || Number.isNaN(finalLongitude)) {
      setMapLocationError('Invalid map location. Please set the location again.');
      setError('Invalid map location. Please set the location again.');
      return;
    }
    
    // Update state if we used draft values (defensive)
    if (latitude !== finalLatitude || longitude !== finalLongitude) {
      setLatitude(finalLatitude);
      setLongitude(finalLongitude);
    }

    // Get user first (needed for both listing cap check and submission)
    const { data: userResult, error: userError } = await supabaseClient.auth.getUser();
    if (userError) {
      setError(userError.message);
      return;
    }

    const user = userResult.user;
    if (!user) {
      setError('Not authenticated.');
      return;
    }

    // Check 5 active listings cap for Wholesaler Free users
    // Only applies to: role === 'wholesaler' AND is_paid !== true
    if (profile?.role === 'wholesaler' && profile.is_paid !== true) {
      try {
        // Count active listings for this user
        // Owner field: owner_id (confirmed from PostDealScreen insert and MyListingsScreen filter)
        // Active definition: status = 'active' (only 'active' listings count toward the cap)
        // Query: count listings where owner_id = user.id AND status = 'active'
        const { count, error: countError } = await supabaseClient
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', user.id)
          .eq('status', 'active');

        // CRITICAL: Block submission if query fails OR count is null/undefined
        if (countError) {
          if (__DEV__) {
            console.error('Error checking active listings count:', countError);
          }
          qalog('listing cap check error', {
            error: countError.message,
            userId: user.id,
            ownerField: 'owner_id',
            statusFilter: 'status.eq.active',
          });
          Alert.alert(
            'Unable to verify listing limit',
            'We couldn\'t verify your active listing count. Please try again.',
            [{ text: 'OK' }]
          );
          return;
        }

        // If count is null or undefined, block submission (cannot verify limit)
        if (count === null || count === undefined) {
          if (__DEV__) {
            console.error('Count query returned null/undefined');
          }
          qalog('listing cap check null count', {
            userId: user.id,
            ownerField: 'owner_id',
            statusFilter: 'status.eq.active',
          });
          Alert.alert(
            'Unable to verify listing limit',
            'We couldn\'t verify your active listing count. Please try again.',
            [{ text: 'OK' }]
          );
          return;
        }

        // count is a number (0 or positive integer)
        const activeCount = count;
        
        // QA log: single line with activeCount + fields used
        if (__DEV__) {
          console.log(`listing cap check: activeCount=${activeCount}, ownerField=owner_id, statusFilter=status.eq.active`);
        }
        qalog('listing cap check', {
          activeCount,
          ownerField: 'owner_id',
          statusFilter: 'status.eq.active',
          userId: user.id,
        });

        // Block if already at or above limit (>= 5)
        if (activeCount >= 5) {
          Alert.alert(
            'Listing limit reached',
            'Free wholesalers can have up to 5 active listings. Upgrade to Plus for unlimited listings.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Upgrade to Plus',
                onPress: () => {
                  openExternalUrl(PRICING_URL);
                },
              },
            ],
            { cancelable: true }
          );
          return;
        }
      } catch (err) {
        // On unexpected error, block submission to avoid violating cap
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        if (__DEV__) {
          console.error('Unexpected error checking listing cap:', errorMessage);
        }
        qalog('listing cap check unexpected error', {
          error: errorMessage,
          userId: user.id,
          ownerField: 'owner_id',
          statusFilter: 'status.eq.active',
        });
        Alert.alert(
          'Unable to verify listing limit',
          'We couldn\'t verify your active listing count. Please try again.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    setSubmitting(true);
    setUploadingImages(true);

    try {

      // Final coordinate validation before building payload
      // Use state values, fallback to draft if needed
      const payloadLatitude = latitude ?? getPostDealDraft()?.latitude ?? null;
      const payloadLongitude = longitude ?? getPostDealDraft()?.longitude ?? null;
      
      if (payloadLatitude === null || payloadLongitude === null ||
          typeof payloadLatitude !== 'number' || typeof payloadLongitude !== 'number' ||
          Number.isNaN(payloadLatitude) || Number.isNaN(payloadLongitude)) {
        setError('Map location is required and must be valid coordinates.');
        setSubmitting(false);
        setUploadingImages(false);
        return;
      }
      
      // Dev-only debug log
      if (__DEV__) {
        console.log('[PostDeal] Submitting listing payload:', {
          status: 'active',
          latitude: payloadLatitude,
          longitude: payloadLongitude,
          source: latitude !== null ? 'state' : 'draft',
        });
      }
      
      // Prepare insert payload (without images first)
      // QA checklist: verify DB row contains exact coordinates and address_visibility='exact'
      // QA checklist: constraints selections persist after create/edit
      const insertPayload: {
        owner_id: string;
        title: string;
        address: string;
        city: string;
        state: string;
        zip: string;
        price: number;
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
        latitude: number;
        longitude: number;
        status: string;
        currency?: string;
        address_visibility: 'exact';
        deal_constraints?: string[];
        deal_constraints_notes?: string | null;
      } = {
        owner_id: user.id,
        title: title.trim(),
        address: sanitizeAddressField(address),
        city: sanitizeAddressField(city),
        state: sanitizeAddressField(stateValue),
        zip: sanitizeAddressField(zip),
        price: priceNumber,
        latitude: payloadLatitude,
        longitude: payloadLongitude,
        status: 'active',
        currency: currency,
        address_visibility: 'exact',
        deal_constraints: dealConstraints.length > 0 ? dealConstraints : undefined,
        deal_constraints_notes: dealConstraintsNotes.trim() || null,
      };

      if (bedsNumber !== undefined) insertPayload.beds = bedsNumber;
      if (bathsNumber !== undefined) insertPayload.baths = bathsNumber;
      if (sqftNumber !== undefined) insertPayload.sqft = sqftNumber;
      if (lotSqftNumber !== undefined) insertPayload.lot_sqft = lotSqftNumber;
      if (description.trim()) insertPayload.description = description.trim();
      if (arvNumber !== null) insertPayload.arv = arvNumber;
      if (repairsNumber !== null) insertPayload.repairs = repairsNumber;
      if (yearBuiltNumber !== null) insertPayload.year_built = yearBuiltNumber;
      if (garageSpacesNumber !== null) insertPayload.garage_spaces = garageSpacesNumber;
      if (propertyType) insertPayload.property_type = propertyType;

      // Insert listing first to get real listing ID
      const { data: insertData, error: insertError } = await supabaseClient
        .from('listings')
        .insert([insertPayload])
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
        setSubmitting(false);
        setUploadingImages(false);
        return;
      }

      const listingId = insertData.id;

      // Upload all images with real listing ID
      const imageUrls: string[] = [];
      if (selectedImages.length > 0) {
        try {
          for (let i = 0; i < selectedImages.length; i++) {
            const image = selectedImages[i];
            const url = await uploadListingImage(listingId, user.id, image.uri);
            imageUrls.push(url);
          }
        } catch (uploadError) {
          // If upload fails, delete the listing to avoid partial state
          await supabaseClient.from('listings').delete().eq('id', listingId);
          const message =
            uploadError instanceof Error ? uploadError.message : 'Failed to upload images.';
          setError(`Image upload failed: ${message}`);
          setSubmitting(false);
          setUploadingImages(false);
          return;
        }

        const effectiveCoverIndex =
          coverIndex !== null && coverIndex >= 0 && coverIndex < imageUrls.length
            ? coverIndex
            : 0;
        const coverUrl = imageUrls.length > 0 ? imageUrls[effectiveCoverIndex] : null;

        qalog('listing images update payload', {
          listingId,
          cover_image_url: coverUrl,
          images_length: imageUrls.length,
        });

        // Update listing with image URLs
        const { error: updateError } = await supabaseClient
          .from('listings')
          .update({
            images: imageUrls,
            cover_image_url: coverUrl,
          })
          .eq('id', listingId);

        if (updateError) {
          // If update fails, try to clean up uploaded images (optional for v1)
          setError(`Failed to save image URLs: ${updateError.message}`);
          setSubmitting(false);
          setUploadingImages(false);
          return;
        }
      }

      // Clear draft and reset form on successful submit
      clearPostDealDraft();
      resetForm();

      // Navigate to MyListings immediately after successful submission
      // This ensures user sees their newly created listing
      navigateAfterPublish();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to post deal.';
      setError(message);
    } finally {
      setSubmitting(false);
      setUploadingImages(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
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
          placeholderTextColor="#777"
          editable={!submitting}
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
          placeholderTextColor="#777"
          editable={!submitting}
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
            placeholderTextColor="#777"
            editable={!submitting}
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
            placeholderTextColor="#777"
            autoCapitalize="characters"
            maxLength={2}
            editable={!submitting}
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
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
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
          placeholderTextColor="#777"
          keyboardType="numeric"
          editable={!submitting}
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
              disabled={submitting}
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
          disabled={submitting}
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
              placeholderTextColor="#777"
              keyboardType="numeric"
              editable={!submitting}
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Repairs</Text>
            <TextInput
              style={styles.input}
              value={repairs}
              onChangeText={setRepairs}
              placeholder="$0"
              placeholderTextColor="#777"
              keyboardType="numeric"
              editable={!submitting}
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
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Baths</Text>
          <TextInput
            style={styles.input}
            value={baths}
            onChangeText={setBaths}
            placeholder="Baths"
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Sqft</Text>
          <TextInput
            style={styles.input}
            value={sqft}
            onChangeText={setSqft}
            placeholder="Sqft"
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Lot Size (sqft)</Text>
          <TextInput
            style={styles.input}
            value={lotSqft}
            onChangeText={setLotSqft}
            placeholder="Lot size"
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Year Built</Text>
          <TextInput
            style={styles.input}
            value={yearBuilt}
            onChangeText={setYearBuilt}
            placeholder="1990"
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Garage Spaces</Text>
          <TextInput
            style={styles.input}
            value={garageSpaces}
            onChangeText={setGarageSpaces}
            placeholder="2"
            placeholderTextColor="#777"
            keyboardType="numeric"
            editable={!submitting}
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
          placeholderTextColor="#777"
          multiline
          numberOfLines={4}
          editable={!submitting}
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
                if (submitting) return;
                setDealConstraints((prev) =>
                  isSelected ? prev.filter((v) => v !== opt.value) : [...prev, opt.value]
                );
              }}
              disabled={submitting}
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
          placeholderTextColor="#777"
          multiline
          numberOfLines={2}
          editable={!submitting}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Map Location *</Text>
        <TouchableOpacity
          style={[styles.mapLocationButton, mapLocationError && styles.mapLocationButtonError]}
          onPress={() => {
            // Save draft immediately before navigating to ensure it's persisted
            const currentDraft: PostDealDraft = {
              title,
              address,
              city,
              state: stateValue,
              zip,
              price,
              beds,
              baths,
              sqft,
              lotSqft,
              description,
              arv,
              repairs,
              yearBuilt,
              garageSpaces,
              selectedImages,
              coverIndex,
              latitude,
              longitude,
              currency,
              propertyType,
              dealConstraints,
              dealConstraintsNotes,
            };
            setPostDealDraft(currentDraft);
            
            setMapLocationError(null);
            navigation.navigate('SetMapPin', {
              initialLatitude: latitude ?? undefined,
              initialLongitude: longitude ?? undefined,
            });
          }}
          disabled={submitting || uploadingImages}
        >
          <Text style={styles.mapLocationButtonText}>
            {(() => {
              // Defensive check: verify coordinates are actually valid
              const displayLat = latitude ?? getPostDealDraft()?.latitude ?? null;
              const displayLng = longitude ?? getPostDealDraft()?.longitude ?? null;
              const hasValidCoords = displayLat !== null && displayLng !== null &&
                                     typeof displayLat === 'number' && typeof displayLng === 'number' &&
                                     !Number.isNaN(displayLat) && !Number.isNaN(displayLng);
              
              if (hasValidCoords) {
                return `Location set: ${displayLat.toFixed(4)}, ${displayLng.toFixed(4)}`;
              }
              return 'Tap to set the property location on the map (required)';
            })()}
          </Text>
        </TouchableOpacity>
        {mapLocationError && (
          <Text style={styles.mapLocationErrorText}>{mapLocationError}</Text>
        )}
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Images</Text>
        <TouchableOpacity
          style={styles.imagePickerButton}
          onPress={pickImages}
          disabled={submitting || uploadingImages}
        >
          <Text style={styles.imagePickerButtonText}>
            {uploadingImages ? 'Uploading...' : 'Select Images'}
          </Text>
        </TouchableOpacity>

        {selectedImages.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.imageStrip}
          >
            {selectedImages.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={styles.imageItem}>
                <View style={styles.imageContainer}>
                  <Image source={{ uri: image.uri }} style={styles.thumbnail} />
                  {coverIndex === index && (
                    <View style={styles.coverBadge}>
                      <Text style={styles.coverBadgeText}>Cover</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.removeImageButton}
                    onPress={() => removeImage(index)}
                    disabled={submitting || uploadingImages}
                  >
                    <Text style={styles.removeImageButtonText}>×</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.setCoverButton}
                  onPress={() => setCoverIndex(index)}
                  disabled={submitting || uploadingImages || coverIndex === index}
                >
                  <Text style={styles.setCoverButtonText}>
                    {coverIndex === index ? 'Current cover' : 'Set as cover'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.formGroup}>
        <TouchableOpacity
          style={styles.checkboxContainer}
          onPress={() => setSellerAcknowledged(!sellerAcknowledged)}
          disabled={submitting || uploadingImages}
        >
          <View style={[styles.checkbox, sellerAcknowledged && styles.checkboxChecked]}>
            {sellerAcknowledged && <Text style={styles.checkboxCheckmark}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>
            I confirm the information entered is accurate to the best of my knowledge and understand Off Axis Deals does not verify listings.
          </Text>
        </TouchableOpacity>
      </View>

      {(() => {
        // Defensive check: verify coordinates and address for button state
        const checkLat = latitude ?? getPostDealDraft()?.latitude ?? null;
        const checkLng = longitude ?? getPostDealDraft()?.longitude ?? null;
        const hasValidCoords = checkLat !== null && checkLng !== null &&
                               typeof checkLat === 'number' && typeof checkLng === 'number' &&
                               !Number.isNaN(checkLat) && !Number.isNaN(checkLng);
        const hasValidAddress = !!sanitizeAddressField(address) && !!sanitizeAddressField(city) &&
          !!sanitizeAddressField(stateValue) && !!sanitizeAddressField(zip);
        const isDisabled = submitting || uploadingImages || !sellerAcknowledged || !hasValidCoords || !hasValidAddress;
        
        return (
          <TouchableOpacity
            style={[styles.submitButton, isDisabled && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isDisabled}
      >
            {submitting || uploadingImages ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Publish</Text>
            )}
          </TouchableOpacity>
        );
      })()}
    </ScrollView>
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
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 4,
    marginRight: spacing.sm,
    marginTop: 2,
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
  checkboxLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text,
    lineHeight: 20,
  },
  mapLocationButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundElevated,
    minHeight: 44,
    justifyContent: 'center',
  },
  mapLocationButtonError: {
    borderColor: colors.danger,
  },
  mapLocationButtonText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    textAlign: 'center',
  },
  mapLocationErrorText: {
    fontSize: typography.fontSize.xs,
    color: colors.danger,
    marginTop: spacing.xs,
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
  helpText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
