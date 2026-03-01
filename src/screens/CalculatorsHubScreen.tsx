import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../types/navigation';
import TopHeader from '../components/TopHeader';
import { CALCULATOR_REGISTRY, type CalculatorKey } from './calculators/calculatorRegistry';
import { colors, spacing, typography } from '../theme';

type CalculatorsHubNavigationProp = NativeStackNavigationProp<AppStackParamList, 'Calculators'>;

interface CalculatorItem {
  key: CalculatorKey;
  title: string;
  description: string;
}

// Convert registry to array maintaining order
const CALCULATORS: CalculatorItem[] = Object.entries(CALCULATOR_REGISTRY).map(([key, entry]) => ({
  key: key as CalculatorKey,
  title: entry.title,
  description: entry.description,
}));

export default function CalculatorsHubScreen() {
  const navigation = useNavigation<CalculatorsHubNavigationProp>();

  const handleCalculatorPress = (key: string) => {
    navigation.navigate('CalculatorDetail', { key });
  };

  const renderCalculatorItem = ({ item }: { item: CalculatorItem }) => (
    <TouchableOpacity
      style={styles.calculatorCard}
      onPress={() => handleCalculatorPress(item.key)}
      activeOpacity={0.7}
    >
      <View style={styles.calculatorContent}>
        <Text style={styles.calculatorTitle}>{item.title}</Text>
        <Text style={styles.calculatorDescription}>{item.description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <TopHeader title="Calculators" />
      <FlatList
        data={CALCULATORS}
        renderItem={renderCalculatorItem}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.md,
  },
  calculatorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calculatorContent: {
    flex: 1,
  },
  calculatorTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  calculatorDescription: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  chevron: {
    fontSize: typography.fontSize['2xl'],
    color: colors.textTertiary,
    marginLeft: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
});
