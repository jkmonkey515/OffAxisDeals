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

export default function CapRateCalculatorScreen() {
  const [annualRent, setAnnualRent] = useState('');
  const [annualExpenses, setAnnualExpenses] = useState('');
  const [propertyValue, setPropertyValue] = useState('');

  const rentNum = parseCurrency(annualRent) ?? 0;
  const expensesNum = parseCurrency(annualExpenses) ?? 0;
  const valueNum = parseCurrency(propertyValue) ?? 0;

  // Calculate NOI and Cap Rate
  const noi = rentNum - expensesNum;
  const capRate = valueNum > 0 ? (noi / valueNum) * 100 : null;

  const isValid = valueNum >= 1000;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Income</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Annual Rent *</Text>
          <TextInput
            style={styles.input}
            value={annualRent}
            onChangeText={setAnnualRent}
            placeholder="Enter annual rent (e.g., $24,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Expenses</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Annual Operating Expenses</Text>
          <TextInput
            style={styles.input}
            value={annualExpenses}
            onChangeText={setAnnualExpenses}
            placeholder="Enter annual expenses (e.g., $8,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Property</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Value *</Text>
          <TextInput
            style={[styles.input, !isValid && propertyValue !== '' && styles.inputError]}
            value={propertyValue}
            onChangeText={setPropertyValue}
            placeholder="Enter property value (e.g., $200,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && propertyValue !== '' && (
            <Text style={styles.helperText}>Property value must be at least $1,000</Text>
          )}
        </View>
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Cap Rate</Text>
            {capRate !== null ? (
              <Text style={styles.resultValue}>{capRate.toFixed(2)}%</Text>
            ) : (
              <>
                <Text style={styles.resultValue}>N/A</Text>
                <Text style={styles.helperText}>Property value must be greater than $0</Text>
              </>
            )}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Net Operating Income (NOI)</Text>
            <Text style={styles.resultValue}>{formatCurrency(noi)}</Text>
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter property value (at least $1,000) to calculate cap rate.
          </Text>
        </View>
      )}
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
  inputError: {
    borderColor: '#FF3B30',
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  resultCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
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
