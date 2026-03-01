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

interface BreakdownRow {
  label: string;
  value: number;
}

export default function ClosingCostsCalculatorScreen() {
  const [purchasePrice, setPurchasePrice] = useState('');
  const [closingPercent, setClosingPercent] = useState('3.0');
  const [flatFees, setFlatFees] = useState('');

  const priceNum = parseCurrency(purchasePrice) ?? 0;
  const percentNum = Math.max(0, Math.min(10, parseFloat(closingPercent) || 0));
  const flatFeesNum = parseCurrency(flatFees) ?? 0;

  // Calculate closing costs
  const percentCosts = priceNum * (percentNum / 100);
  const totalClosingCosts = percentCosts + flatFeesNum;

  const isValid = priceNum >= 1000;

  const breakdown: BreakdownRow[] = [
    { label: 'Purchase Price', value: priceNum },
    { label: `Closing Costs (${percentNum}%)`, value: percentCosts },
    { label: 'Flat Fees', value: flatFeesNum },
    { label: 'Total Closing Costs', value: totalClosingCosts },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Deal</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Purchase Price *</Text>
          <TextInput
            style={[styles.input, !isValid && purchasePrice !== '' && styles.inputError]}
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            placeholder="Enter purchase price (e.g., $200,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && purchasePrice !== '' && (
            <Text style={styles.helperText}>Purchase price must be at least $1,000</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Costs</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Closing Costs (%)</Text>
          <TextInput
            style={styles.input}
            value={closingPercent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(10, num));
              setClosingPercent(String(clamped));
            }}
            placeholder="3.0"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 3.0% (0-10)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Flat Fees</Text>
          <TextInput
            style={styles.input}
            value={flatFees}
            onChangeText={setFlatFees}
            placeholder="Enter flat fees (e.g., $500)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Escrow, title, admin fees, etc.</Text>
        </View>
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Total Closing Costs</Text>
            <Text style={styles.resultValue}>{formatCurrency(totalClosingCosts)}</Text>
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            {breakdown.map((row, index) => (
              <View key={index} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{row.label}</Text>
                <Text
                  style={[
                    styles.breakdownValue,
                    row.label === 'Total Closing Costs' && styles.breakdownValueHighlight,
                  ]}
                >
                  {formatCurrency(row.value)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter purchase price (at least $1,000) to calculate closing costs.
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
  breakdownCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  breakdownTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  breakdownLabel: {
    fontSize: 14,
    color: '#666',
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  breakdownValueHighlight: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
});
