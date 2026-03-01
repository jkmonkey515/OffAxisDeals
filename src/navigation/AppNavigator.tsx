import { NavigationContainer } from '@react-navigation/native';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import AuthStack from './AuthStack';
import AppStack from './AppStack';
import { UnreadMessagesProvider } from '../contexts/UnreadMessagesContext';
import { MapBoundsProvider } from '../contexts/MapBoundsContext';
import { navigationRef } from './navigationRef';
import { flushPendingNotificationTap } from '../lib/notifications';
import { useAuth } from '../contexts/AuthContext';

/**
 * Root navigator that switches between AuthStack and AppStack
 * based on auth state from AuthContext.
 */
export default function AppNavigator() {
  const { user, loading } = useAuth();

  // Show loading screen while auth is initializing
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        flushPendingNotificationTap();
      }}
    >
      {user ? (
        <MapBoundsProvider>
          <UnreadMessagesProvider>
            <AppStack />
          </UnreadMessagesProvider>
        </MapBoundsProvider>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
