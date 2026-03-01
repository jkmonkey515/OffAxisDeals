import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import NotificationsBell from './NotificationsBell';
import HeaderCalculatorsButton from './HeaderCalculatorsButton';
import { getRootNavigator } from '../navigation/navHelpers';

/**
 * Header right actions component that renders both Bell and Calculator icons.
 * Uses useNavigation() to access navigation for root-level navigation.
 * Can be used in screenOptions for consistent header actions across screens.
 */
export default function HeaderRightActions() {
  const navigation = useNavigation<NavigationProp<any>>();

  return (
    <View style={styles.container}>
      <NotificationsBell
        onPress={() => {
          // Navigate to root-level Notifications screen (list)
          const rootNav = getRootNavigator(navigation);
          rootNav.navigate('Notifications' as never);
        }}
      />
      <HeaderCalculatorsButton
        onPress={() => {
          // Navigate to root-level Calculators screen
          const rootNav = getRootNavigator(navigation);
          rootNav.navigate('Calculators' as never);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
});
