import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AppTabs from './AppTabs';
import NotificationsScreen from '../screens/NotificationsScreen';
import CalculatorsHubScreen from '../screens/CalculatorsHubScreen';
import CalculatorDetailScreen from '../screens/CalculatorDetailScreen';
import type { AppStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<AppStackParamList>();

/**
 * Root app stack navigator (after authentication)
 * Contains:
 * - Tabs (bottom tab navigator with all main screens)
 * - Notifications (standalone screen accessible from anywhere)
 * - Calculators (standalone screen accessible from anywhere)
 */
export default function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={AppTabs} />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ 
          headerShown: false, // NotificationsScreen has its own header
          presentation: 'card',
        }}
      />
      <Stack.Screen
        name="Calculators"
        component={CalculatorsHubScreen}
        options={{ 
          headerShown: false, // CalculatorsHubScreen has its own header
          presentation: 'card',
        }}
      />
      <Stack.Screen
        name="CalculatorDetail"
        component={CalculatorDetailScreen}
        options={{ 
          headerShown: false, // CalculatorDetailScreen has its own header
          presentation: 'card',
        }}
      />
    </Stack.Navigator>
  );
}
