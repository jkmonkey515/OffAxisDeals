import type { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabScreenProps, BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Central navigation type definitions
 * Single source of truth for all route names and params
 */

// Auth Stack
export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

// Listings Stack (nested in Listings tab)
export type ListingsStackParamList = {
  ListingsBrowse: undefined;
  ListingDetails: { listingId: string };
  PostDeal: { latitude?: number; longitude?: number };
  SetMapPin: { initialLatitude?: number; initialLongitude?: number };
};

// My Listings Stack (nested in MyListings tab)
export type MyListingsStackParamList = {
  MyListingsHome: undefined;
  EditDeal: { listingId: string };
  ListingDetails: { listingId: string };
  PostDeal: { latitude?: number; longitude?: number };
  SetMapPin: { initialLatitude?: number; initialLongitude?: number };
};

// Settings Stack (nested in Settings tab)
export type SettingsStackParamList = {
  SettingsHome: undefined;
  Profile: undefined;
  Subscription: undefined;
  NotificationSettings: undefined;
  Privacy: undefined;
  PostDeal: { latitude?: number; longitude?: number };
  SetMapPin: { initialLatitude?: number; initialLongitude?: number };
  DebugQA: undefined;
};

// Messages Stack (nested in Messages tab)
export type MessagesStackParamList = {
  MessagesHome: undefined;
  Conversation: { conversationId: string; listingId: string };
};

// Watchlists Stack (nested in Watchlists tab)
export type WatchlistsStackParamList = {
  WatchlistsHome: undefined;
};

// Saved Searches Stack (nested in SavedSearches tab)
export type SavedSearchesStackParamList = {
  SavedSearchesHome: undefined;
  CreateSavedSearch: {
    pickedRadius?: { center_lat: number; center_lng: number; radius_miles: number } | null;
    draft?: {
      name: string;
      locationKeyword: string;
      buyBox: {
        minBeds?: string;
        minBaths?: string;
        minPrice?: string;
        maxPrice?: string;
      };
      criteria?: Record<string, unknown>;
      propertyTypes?: string[];
    };
  };
  PickSavedSearchArea: {
    returnTo: 'CreateSavedSearch' | 'EditSavedSearch';
    existingId?: string;
    mode?: string;
    draft?: SavedSearchesStackParamList['CreateSavedSearch']['draft'];
  };
  EditSavedSearch: { 
    id: string; 
    pickedRadius?: { center_lat: number; center_lng: number; radius_miles: number; locationLabel?: string } | null;
  };
  PickSavedSearchRadius: { 
    returnTo: 'CreateSavedSearch' | 'EditSavedSearch'; 
    existingId?: string; 
    draft?: SavedSearchesStackParamList['CreateSavedSearch']['draft'];
    initialCenter?: { lat: number; lng: number };
    initialRadius?: number;
    locationLabel?: string;
  };
};

// Map Stack (nested in Map tab)
export type MapStackParamList = {
  MapHome: undefined;
};

// Post Deal Stack (nested in PostDeal tab)
export type PostDealStackParamList = {
  PostDealHome: { latitude?: number; longitude?: number };
  SetMapPin: { initialLatitude?: number; initialLongitude?: number };
};

// Bottom Tab Navigator - tabs are nested stacks
export type AppTabsParamList = {
  Listings: NavigatorScreenParams<ListingsStackParamList>;
  Settings: NavigatorScreenParams<SettingsStackParamList>;
  MyListings: NavigatorScreenParams<MyListingsStackParamList>;
  Messages: NavigatorScreenParams<MessagesStackParamList>;
  Watchlists: NavigatorScreenParams<WatchlistsStackParamList>;
  SavedSearches: NavigatorScreenParams<SavedSearchesStackParamList>;
  Map: NavigatorScreenParams<MapStackParamList>;
  PostDeal: NavigatorScreenParams<PostDealStackParamList>;
};

// App Stack (root stack after authentication) - contains Tabs as nested navigator
export type AppStackParamList = {
  Tabs: NavigatorScreenParams<AppTabsParamList>;
  ListingDetails: { listingId: string };
  Profile: undefined;
  Subscription: undefined;
  Notifications: undefined;
  Privacy: undefined;
  EditDeal: { listingId: string };
  PostDeal: { latitude?: number; longitude?: number };
  Messaging: undefined;
  Watchlists: undefined;
  Heatmap: undefined;
  Admin: undefined;
  DebugQA: undefined;
  Calculators: undefined;
  CalculatorDetail: { key: string };
};

// Helper types for screen props
export type StackScreenProps<
  T extends keyof ParamList,
  ParamList extends Record<string, object | undefined>
> = NativeStackScreenProps<ParamList, T>;

export type TabScreenProps<
  T extends keyof ParamList,
  ParamList extends Record<string, object | undefined>
> = BottomTabScreenProps<ParamList, T>;

// Navigation prop for ListingDetailsScreen
// ListingDetailsScreen can be in ListingsStack, MyListingsStack, or AppStack
// When in a nested stack, React Navigation allows navigating to parent AppStack routes directly
// Since we need to navigate to EditDeal (in AppStack), we use AppStack navigation type
// Tab navigation (Listings, Messages) uses getParent() as already implemented
export type ListingDetailsNavigationProp = NativeStackNavigationProp<AppStackParamList>;

// Helper to extract route prop type
export type RouteProp<
  T extends keyof ParamList,
  ParamList extends Record<string, object | undefined>
> = NativeStackScreenProps<ParamList, T>['route'];
