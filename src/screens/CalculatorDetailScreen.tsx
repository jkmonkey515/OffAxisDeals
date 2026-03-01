import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { AppStackParamList } from '../types/navigation';
import TopHeader from '../components/TopHeader';
import { useAuth } from '../contexts/AuthContext';
import UpgradeRequired from '../components/UpgradeRequired';
import { CALCULATOR_REGISTRY, type CalculatorKey } from './calculators/calculatorRegistry';
import { colors, spacing, typography } from '../theme';

type CalculatorDetailRouteProp = RouteProp<AppStackParamList, 'CalculatorDetail'>;

export default function CalculatorDetailScreen() {
  const route = useRoute<CalculatorDetailRouteProp>();
  const { key } = route.params;
  const { profile } = useAuth();

  const calculatorEntry = CALCULATOR_REGISTRY[key as CalculatorKey];
  const calculatorName = calculatorEntry?.title || 'Calculator';

  // Gate: Only Plus users can use calculators
  if (profile?.is_paid !== true) {
    return (
      <SafeAreaView style={styles.container}>
        <TopHeader title={calculatorName} />
        <UpgradeRequired
          message="This calculator requires a Plus subscription. Upgrade to access all calculators and premium features."
        />
      </SafeAreaView>
    );
  }

  // Plus users: render calculator if implemented, else empty state
  if (!calculatorEntry) {
    return (
      <SafeAreaView style={styles.container}>
        <TopHeader title={calculatorName} />
        <View style={styles.content}>
          <Text style={styles.emptyStateTitle}>{calculatorName}</Text>
          <Text style={styles.emptyStateText}>
            This section will be available soon.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const CalculatorComponent = calculatorEntry.component;

  if (CalculatorComponent) {
    return (
      <SafeAreaView style={styles.container}>
        <TopHeader title={calculatorName} />
        <CalculatorComponent />
      </SafeAreaView>
    );
  }

  // Plus users see neutral empty state for unimplemented calculators
  return (
    <SafeAreaView style={styles.container}>
      <TopHeader title={calculatorName} />
      <View style={styles.content}>
        <Text style={styles.emptyStateTitle}>{calculatorName}</Text>
        <Text style={styles.emptyStateText}>
          This section will be available soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  emptyStateTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
});
