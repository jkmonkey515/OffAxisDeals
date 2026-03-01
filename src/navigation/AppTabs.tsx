import React, { type ReactElement } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { navigationRef } from './navigationRef';
import { CommonActions, StackActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import ListingsBrowseScreen from '../screens/ListingsBrowseScreen';
import ListingDetailsScreen from '../screens/ListingDetailsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import MessagingScreen from '../screens/MessagingScreen';
import ConversationScreen from '../screens/ConversationScreen';
import WatchlistsScreen from '../screens/WatchlistsScreen';
import SavedSearchesScreen from '../screens/SavedSearchesScreen';
import CreateSavedSearchScreen from '../screens/CreateSavedSearchScreen';
import EditSavedSearchScreen from '../screens/EditSavedSearchScreen';
import PickSavedSearchAreaScreen from '../screens/PickSavedSearchAreaScreen';
import PickSavedSearchRadiusScreen from '../screens/PickSavedSearchRadiusScreen';
import MapScreen from '../screens/MapScreen';
import PostDealScreen from '../screens/PostDealScreen';
import SetMapPinScreen from '../screens/SetMapPinScreen';
import EditDealScreen from '../screens/EditDealScreen';
import MyListingsScreen from '../screens/MyListingsScreen';
import Guard from '../components/Guard';

import { isDebugQAEnabled } from '../utils/debugGating';

// Conditionally import DebugQA only when explicitly enabled
let DebugQAScreen: React.ComponentType<any> | null = null;
if (isDebugQAEnabled()) {
  try {
    DebugQAScreen = require('../screens/DebugQA').default;
  } catch {
    // Screen not available
  }
}
import HeaderRightActions from '../components/HeaderRightActions';
import { getRootNavigator } from './navHelpers';
import { useProfileWithPermissions, has } from '../permissions/permissions';
import { useUnreadMessages } from '../contexts/UnreadMessagesContext';
import { qalog } from '../utils/qalog';
import { colors, typography } from '../theme';
import ProfileLoadingScreen from '../components/ProfileLoadingScreen';
import { useAuth } from '../contexts/AuthContext';
import type {
  AppTabsParamList,
  ListingsStackParamList,
  MyListingsStackParamList,
  SettingsStackParamList,
  MessagesStackParamList,
  WatchlistsStackParamList,
  SavedSearchesStackParamList,
  MapStackParamList,
  PostDealStackParamList,
} from '../types/navigation';

const Tab = createBottomTabNavigator<AppTabsParamList>();
const ListingsStack = createNativeStackNavigator<ListingsStackParamList>();
const MyListingsStack = createNativeStackNavigator<MyListingsStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();
const WatchlistsStack = createNativeStackNavigator<WatchlistsStackParamList>();
const SavedSearchesStack = createNativeStackNavigator<SavedSearchesStackParamList>();
const MapStack = createNativeStackNavigator<MapStackParamList>();
const PostDealStack = createNativeStackNavigator<PostDealStackParamList>();

// Shared header style for Listings and Map screens
const sharedHeaderStyle = {
  headerStyle: {
    backgroundColor: colors.backgroundElevated,
    elevation: 0,
    shadowOpacity: 0,
  },
  headerTitleStyle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  headerTitleAlign: 'center' as const,
};

function ListingsStackNavigator() {
  return (
    <ListingsStack.Navigator
      screenOptions={{
        ...sharedHeaderStyle,
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <ListingsStack.Screen
        name="ListingsBrowse"
        component={ListingsBrowseScreen}
        options={{
          headerTitle: 'Off-Market Deals',
        }}
      />
      <ListingsStack.Screen
        name="ListingDetails"
        component={ListingDetailsScreen}
        options={{ headerShown: false }}
      />
      <ListingsStack.Screen
        name="PostDeal"
        options={{ headerTitle: 'Post Deal' }}
      >
        {() => (
          <Guard permission="postDeal">
            <PostDealScreen />
          </Guard>
        )}
      </ListingsStack.Screen>
      <ListingsStack.Screen
        name="SetMapPin"
        component={SetMapPinScreen}
        options={{ headerTitle: 'Set Map Location' }}
      />
    </ListingsStack.Navigator>
  );
}

function MyListingsStackNavigator() {
  return (
    <MyListingsStack.Navigator
      screenOptions={{
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <MyListingsStack.Screen
        name="MyListingsHome"
        component={MyListingsScreen}
        options={{ headerTitle: 'My Listings' }}
      />
      <MyListingsStack.Screen
        name="EditDeal"
        component={EditDealScreen}
        options={{ headerShown: false }}
      />
      <MyListingsStack.Screen
        name="ListingDetails"
        component={ListingDetailsScreen}
        options={{ headerShown: false }}
      />
      <MyListingsStack.Screen
        name="PostDeal"
        options={{ headerTitle: 'Post Deal' }}
      >
        {() => (
          <Guard permission="postDeal">
            <PostDealScreen />
          </Guard>
        )}
      </MyListingsStack.Screen>
      <MyListingsStack.Screen
        name="SetMapPin"
        component={SetMapPinScreen}
        options={{ headerTitle: 'Set Map Location' }}
      />
    </MyListingsStack.Navigator>
  );
}

function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <SettingsStack.Screen
        name="SettingsHome"
        component={SettingsScreen}
        options={{ headerTitle: 'Account' }}
      />
      <SettingsStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
      <SettingsStack.Screen
        name="Subscription"
        component={SubscriptionScreen}
        options={{ headerShown: false }}
      />
      <SettingsStack.Screen
        name="NotificationSettings"
        component={NotificationSettingsScreen}
        options={{ headerShown: false }}
      />
      <SettingsStack.Screen
        name="Privacy"
        component={PrivacyScreen}
        options={{ headerShown: false }}
      />
      {isDebugQAEnabled() && DebugQAScreen && (
        <SettingsStack.Screen
          name="DebugQA"
          component={DebugQAScreen}
          options={{ headerTitle: 'Debug QA' }}
        />
      )}
      <SettingsStack.Screen
        name="PostDeal"
        options={{ headerTitle: 'Post Deal' }}
      >
        {() => (
          <Guard permission="postDeal">
            <PostDealScreen />
          </Guard>
        )}
      </SettingsStack.Screen>
      <SettingsStack.Screen
        name="SetMapPin"
        component={SetMapPinScreen}
        options={{ headerTitle: 'Set Map Location' }}
      />
    </SettingsStack.Navigator>
  );
}

function MessagesStackNavigator() {
  return (
    <MessagesStack.Navigator
      screenOptions={{
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <MessagesStack.Screen
        name="MessagesHome"
        options={{ headerTitle: 'Messages' }}
      >
        {() => (
          <Guard permission="message">
            <MessagingScreen />
          </Guard>
        )}
      </MessagesStack.Screen>
      <MessagesStack.Screen
        name="Conversation"
        component={ConversationScreen}
        options={{ headerTitle: 'Conversation' }}
      />
    </MessagesStack.Navigator>
  );
}

function WatchlistsStackNavigator() {
  return (
    <WatchlistsStack.Navigator
      screenOptions={{
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <WatchlistsStack.Screen
        name="WatchlistsHome"
        options={{ headerTitle: 'Watchlists' }}
      >
        {() => (
          <Guard permission="watchlists">
            <WatchlistsScreen />
          </Guard>
        )}
      </WatchlistsStack.Screen>
    </WatchlistsStack.Navigator>
  );
}

function SavedSearchesStackNavigator() {
  return (
    <SavedSearchesStack.Navigator>
      <SavedSearchesStack.Screen
        name="SavedSearchesHome"
        options={{ headerShown: false }}
      >
        {() => <SavedSearchesScreen />}
      </SavedSearchesStack.Screen>
      <SavedSearchesStack.Screen
        name="CreateSavedSearch"
        component={CreateSavedSearchScreen}
        options={{ headerShown: false }}
      />
      <SavedSearchesStack.Screen
        name="EditSavedSearch"
        component={EditSavedSearchScreen}
        options={{ headerShown: false }}
      />
      <SavedSearchesStack.Screen
        name="PickSavedSearchArea"
        component={PickSavedSearchAreaScreen}
        options={{ headerShown: false }}
      />
      <SavedSearchesStack.Screen
        name="PickSavedSearchRadius"
        component={PickSavedSearchRadiusScreen}
        options={{ headerShown: false }}
      />
    </SavedSearchesStack.Navigator>
  );
}

function MapStackNavigator() {
  return (
    <MapStack.Navigator
      screenOptions={{
        ...sharedHeaderStyle,
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <MapStack.Screen
        name="MapHome"
        options={{
          headerTitle: 'Map',
        }}
      >
        {() => (
          <Guard permission="browseListings">
            <MapScreen />
          </Guard>
        )}
      </MapStack.Screen>
    </MapStack.Navigator>
  );
}

function PostDealStackNavigator() {
  return (
    <PostDealStack.Navigator
      screenOptions={{
        headerRight: () => <HeaderRightActions />,
      }}
    >
      <PostDealStack.Screen
        name="PostDealHome"
        options={{ headerTitle: 'Post Deal' }}
      >
        {() => (
          <Guard permission="postDeal">
            <PostDealScreen />
          </Guard>
        )}
      </PostDealStack.Screen>
      <PostDealStack.Screen
        name="SetMapPin"
        component={SetMapPinScreen}
        options={{ headerTitle: 'Set Map Location' }}
      />
    </PostDealStack.Navigator>
  );
}

// Icon mapping for tabs
function getTabIcon(routeName: string, focused: boolean): IoniconName {
  const iconMap: Record<string, { focused: IoniconName; unfocused: IoniconName }> = {
    Listings: { focused: 'home', unfocused: 'home-outline' },
    Map: { focused: 'map', unfocused: 'map-outline' },
    PostDeal: { focused: 'add-circle', unfocused: 'add-circle-outline' },
    MyListings: { focused: 'albums', unfocused: 'albums-outline' },
    Messages: { focused: 'chatbubbles', unfocused: 'chatbubbles-outline' },
    Settings: { focused: 'person', unfocused: 'person-outline' },
    Watchlists: { focused: 'star', unfocused: 'star-outline' },
    SavedSearches: { focused: 'search', unfocused: 'search-outline' },
  };

  const icons = iconMap[routeName];
  if (!icons) {
    // Fallback icon if route name not found
    return focused ? 'ellipse' : 'ellipse-outline';
  }

  return focused ? icons.focused : icons.unfocused;
}

export default function AppTabs() {
  const { profile, permissions } = useProfileWithPermissions();
  const { profileLoading, user } = useAuth();
  const { count: unreadCount } = useUnreadMessages();

  // Show "Finishing account setup..." if user is signed in but profile is missing (after signup)
  if (user && profileLoading && !profile) {
    return <ProfileLoadingScreen />;
  }

  const canMessage = has(permissions, 'message');
  const canWatchlists = has(permissions, 'watchlists');
  const canBrowseListings = has(permissions, 'browseListings');
  const canPostDeal = has(permissions, 'postDeal');

  // Explicit check for PostDeal tab: (role === 'wholesaler' OR role === 'admin')
  // Wholesaler Free can post (up to 5 active), Wholesaler Plus unlimited
  // NOT shown for investors (even if paid)
  const canShowPostDealTab =
    profile?.role === 'wholesaler' || profile?.role === 'admin';

  // Determine if user is investor or wholesaler/admin
  const isInvestor = profile?.role === 'investor';
  const isWholesalerOrAdmin = profile?.role === 'wholesaler' || profile?.role === 'admin';

  // QA log before rendering tabs
  // Ensure role is null (not string "null") when profile is missing
  qalog('tabs', {
    role: profile?.role ?? null,
    isPaid: profile?.is_paid ?? false,
    canPostDeal: canShowPostDealTab,
    isInvestor,
    isWholesalerOrAdmin,
  });

  // Build tab screens based on role
  // Wholesaler/Admin tabs: Listings → Map → PostDeal → MyListings → Messages → Account
  // Investor tabs: Listings → Map → Messages → Watchlists (if paid) → Account
  const tabScreens: Array<{ name: keyof AppTabsParamList; component: () => ReactElement }> = [];

  // 1) Always show Listings first
  tabScreens.push({ name: 'Listings', component: ListingsStackNavigator });

  // 2) Map (for all users)
  if (canBrowseListings) {
    tabScreens.push({ name: 'Map', component: MapStackNavigator });
  }

  // 3) For wholesaler/admin: PostDeal (all wholesalers can post, free up to 5 active)
  if (isWholesalerOrAdmin && canShowPostDealTab) {
    tabScreens.push({ name: 'PostDeal', component: PostDealStackNavigator });
  }

  // 4) For wholesaler/admin: MyListings
  if (isWholesalerOrAdmin && canPostDeal) {
    tabScreens.push({ name: 'MyListings', component: MyListingsStackNavigator });
  }

  // 3 for investors, 5 for wholesalers: Messages (visible for all roles, Guard-gated inside)
  // This allows all users to see the tab, but Guard will show upgrade message if they can't message
  tabScreens.push({ name: 'Messages', component: MessagesStackNavigator });

  // 4 for investors: Watchlists (if paid) - only for investors
  // Note: Watchlists tab is only shown for investors (already checked by isInvestor)
  // The canWatchlists permission check ensures they're paid
  if (isInvestor && canWatchlists) {
    tabScreens.push({ name: 'Watchlists', component: WatchlistsStackNavigator });
  }

  // 5 for investors: Saved Searches - only for investors (free and paid)
  if (isInvestor) {
    tabScreens.push({ name: 'SavedSearches', component: SavedSearchesStackNavigator });
  }

  // Last: Always show Settings (Account) last
  tabScreens.push({ name: 'Settings', component: SettingsStackNavigator });

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          const iconName = getTabIcon(route.name, focused);
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      })}
    >
      {tabScreens.map((screen) => {
        const isMessagesTab = screen.name === 'Messages';
        const badgeCount = isMessagesTab && unreadCount > 0 ? (unreadCount > 99 ? '99+' : String(unreadCount)) : undefined;

        return (
          <Tab.Screen
            key={screen.name}
            name={screen.name}
            component={screen.component}
            options={{
              ...(screen.name === 'Settings' ? { tabBarLabel: 'Account' } : {}),
              ...(isMessagesTab ? { tabBarBadge: badgeCount } : {}),
            }}
            listeners={
              isMessagesTab
                ? ({ navigation, route }) => ({
                    tabPress: (e) => {
                      // Routes: Tab name = 'Messages', Inbox screen = 'MessagesHome', Conversation screen = 'Conversation'
                      // When Messages tab is tapped:
                      // - If NOT focused: allow default tab switching (don't preventDefault)
                      // - If ALREADY focused: preventDefault and reset Messages stack to root (MessagesHome)
                      // This ensures users can switch to Messages tab from other tabs, and can reset to inbox when already on Messages tab
                      const isFocused = navigation.isFocused();
                      
                      if (isFocused) {
                        // Already on Messages tab: prevent default and reset stack to root
                        e.preventDefault();
                        
                        if (!navigationRef.isReady()) {
                          return;
                        }

                        // Get the full navigation state from navigationRef to locate the nested Messages stack
                        const state = navigationRef.getState();
                        const tabsRoute = state?.routes?.find((r) => r.name === 'Tabs');
                        const tabsState = tabsRoute?.state;
                        const messagesTabRoute = tabsState?.routes?.find((r) => r.name === 'Messages');
                        const messagesStackState = messagesTabRoute?.state;
                        const messagesStackKey = messagesStackState?.key;
                        
                        if (messagesStackKey) {
                          // Dispatch reset action targeting the nested Messages stack navigator
                          // Use the nested stack key (messagesStackState.key), NOT the tab route key
                          navigationRef.dispatch({
                            ...CommonActions.reset({
                              index: 0,
                              routes: [{ name: 'MessagesHome' }],
                            }),
                            target: messagesStackKey,
                          });
                        } else {
                          // Fallback: navigate to MessagesHome if stack state/key is missing
                          navigationRef.navigate('Tabs', {
                            screen: 'Messages',
                            params: {
                              screen: 'MessagesHome',
                            },
                          });
                        }
                      }
                      // If not focused, allow default tab switching behavior (no preventDefault)
                    },
                  })
                : undefined
            }
          />
        );
      })}
    </Tab.Navigator>
  );
}
