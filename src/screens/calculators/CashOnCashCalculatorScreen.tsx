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
  if (isNaN(parsed)) {
    return null;
  }
  // Allow negative values for cashflow
  return parsed;
}

/**
 * Format number as currency string (USD).
 */
function formatCurrency(n: number): string {
  return formatMoney(n, 'USD');
}

export default function CashOnCashCalculatorScreen() {
  const [annualCashflow, setAnnualCashflow] = useState('');
  const [cashInvested, setCashInvested] = useState('');

  const cashflowNum = parseCurrency(annualCashflow) ?? 0;
  const investedNumRaw = parseCurrency(cashInvested);
  const investedNum = investedNumRaw !== null ? investedNumRaw : 0;

  // Calculate Cash-on-Cash Return
  const cashOnCash = investedNum > 0 ? (cashflowNum / investedNum) * 100 : null;
  const monthlyCashflow = cashflowNum / 12;

  const isValid = investedNumRaw !== null && investedNum >= 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cashflow</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Annual Cashflow *</Text>
          <TextInput
            style={styles.input}
            value={annualCashflow}
            onChangeText={setAnnualCashflow}
            placeholder="Enter annual cashflow (e.g., $4,800)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Can be positive or negative</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Investment</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Cash Invested *</Text>
          <TextInput
            style={[styles.input, !isValid && cashInvested !== '' && styles.inputError]}
            value={cashInvested}
            onChangeText={setCashInvested}
            placeholder="Enter cash invested (e.g., $50,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && cashInvested !== '' && (
            <Text style={styles.helperText}>Cash invested cannot be negative</Text>
          )}
        </View>
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Cash-on-Cash Return</Text>
            {cashOnCash !== null ? (
              <Text style={[styles.resultValue, cashOnCash < 0 && styles.resultValueNegative]}>
                {cashOnCash.toFixed(2)}%
              </Text>
            ) : (
              <>
                <Text style={styles.resultValue}>N/A</Text>
                <Text style={styles.helperText}>Enter cash invested to compute return.</Text>
              </>
            )}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Annual Cashflow</Text>
            <Text style={[styles.resultValue, cashflowNum < 0 && styles.resultValueNegative]}>
              {formatCurrency(cashflowNum)}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Monthly Cashflow</Text>
            <Text style={[styles.resultValue, monthlyCashflow < 0 && styles.resultValueNegative]}>
              {formatCurrency(monthlyCashflow)}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Cash Invested</Text>
            <Text style={styles.resultValue}>{formatCurrency(investedNum)}</Text>
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter cash invested (≥ $0) to calculate cash-on-cash return.
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
  resultValueNegative: {
    color: '#FF3B30',
  },
});
