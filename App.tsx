import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { colors } from './src/theme';

/**
 * Performance Monitor Overlay
 * 
 * The React Native Performance Monitor (FPS overlay) is controlled via the developer menu
 * and cannot be disabled programmatically. To disable it:
 * 
 * 1. Shake device (or Cmd+D on iOS simulator / Cmd+M on Android emulator)
 * 2. Select "Hide Perf Monitor" from the dev menu
 * 
 * Note: The performance monitor only appears in development builds (__DEV__ === true).
 * It is automatically disabled in production builds.
 * 
 * If the overlay appears, it must be manually disabled via the dev menu as there is
 * no supported API in React Native/Expo to programmatically disable it.
 */

function AppInner() {
  return (
    <View style={styles.appContainer}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" hidden={false} translucent={false} />
      <AppInner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
