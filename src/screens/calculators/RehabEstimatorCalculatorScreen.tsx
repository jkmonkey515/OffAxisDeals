import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { formatMoney } from '../../utils/currency';

/**
 * Parse currency input string to number.
 * Handles $, commas, and whitespace.
 * Returns null if invalid or empty.
 */
function parseCurrency(input: string): number | null {
  if (!input || input.trim() === '') {
    return null;
  }
  // Remove $, commas, and whitespace
  const cleaned = input.replace(/[$,\s]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * Format number as currency string (USD).
 */
function formatCurrency(n: number): string {
  return formatMoney(n, 'USD');
}

const REHAB_CATEGORIES = [
  'Demolition',
  'Roofing',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Flooring',
  'Kitchen',
  'Bathroom',
  'Paint',
  'Exterior',
  'Misc / Contingency',
] as const;

export default function RehabEstimatorCalculatorScreen() {
  const [values, setValues] = useState<Record<string, string>>({});

  const updateValue = (category: string, text: string) => {
    setValues((prev) => ({ ...prev, [category]: text }));
  };

  // Calculate total
  const categoryAmounts = REHAB_CATEGORIES.map((category) => {
    const value = values[category] || '';
    return parseCurrency(value) ?? 0;
  });

  const totalRehabCost = categoryAmounts.reduce((sum, amount) => sum + amount, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rehab Line Items</Text>

        {REHAB_CATEGORIES.map((category) => (
          <View key={category} style={styles.inputGroup}>
            <Text style={styles.label}>{category}</Text>
            <TextInput
              style={styles.input}
              value={values[category] || ''}
              onChangeText={(text) => updateValue(category, text)}
              placeholder="Enter amount (e.g., $5,000)"
              placeholderTextColor="#888"
              keyboardType="numeric"
              autoCapitalize="none"
            />
          </View>
        ))}

        <Text style={styles.helperText}>
          Estimates only. Always verify with licensed contractors.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Results</Text>
        <View style={styles.resultCard}>
          <Text style={styles.resultLabel}>Total Rehab Cost</Text>
          <Text style={styles.resultValue}>{formatCurrency(totalRehabCost)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#000',
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
  },
  resultCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  resultLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  resultValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
  },
});
