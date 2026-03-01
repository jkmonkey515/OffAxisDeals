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

/**
 * Calculate monthly mortgage payment (P&I) using standard formula.
 * If rate is 0, returns simple loan amount / number of payments.
 */
function calculateMortgagePayment(
  loanAmount: number,
  annualRate: number,
  termYears: number
): number {
  if (loanAmount <= 0 || termYears <= 0) {
    return 0;
  }

  const monthlyRate = annualRate / 100 / 12;
  const numPayments = termYears * 12;

  // Handle zero interest rate
  if (monthlyRate === 0) {
    return loanAmount / numPayments;
  }

  // Standard mortgage formula: P = L * [r(1+r)^n] / [(1+r)^n - 1]
  const onePlusR = 1 + monthlyRate;
  const onePlusRToN = Math.pow(onePlusR, numPayments);
  const numerator = monthlyRate * onePlusRToN;
  const denominator = onePlusRToN - 1;

  return loanAmount * (numerator / denominator);
}

interface BreakdownRow {
  label: string;
  value: number;
}

export default function MortgageCalculatorScreen() {
  const [homePrice, setHomePrice] = useState('');
  const [downPaymentPercent, setDownPaymentPercent] = useState('20');
  const [interestRate, setInterestRate] = useState('');
  const [termYears, setTermYears] = useState('30');
  const [propertyTaxes, setPropertyTaxes] = useState('');
  const [insurance, setInsurance] = useState('');
  const [hoa, setHoa] = useState('');

  const priceNum = parseCurrency(homePrice) ?? 0;
  const downPercentNum = Math.max(0, Math.min(100, parseFloat(downPaymentPercent) || 0));
  const rateNum = Math.max(0, Math.min(30, parseFloat(interestRate) || 0));
  const termNum = parseFloat(termYears) || 30;
  const taxesNum = parseCurrency(propertyTaxes) ?? 0;
  const insuranceNum = parseCurrency(insurance) ?? 0;
  const hoaNum = parseCurrency(hoa) ?? 0;

  // Calculate loan amount and payments
  const loanAmount = priceNum > 0 ? priceNum * (1 - downPercentNum / 100) : 0;
  const principalAndInterest = calculateMortgagePayment(loanAmount, rateNum, termNum);
  const totalMonthlyPayment = principalAndInterest + taxesNum + insuranceNum + hoaNum;

  const isValid = priceNum >= 1000 && rateNum > 0 && termNum > 0;

  const breakdown: BreakdownRow[] = [
    { label: 'Home Price', value: priceNum },
    { label: `Down Payment (${downPercentNum}%)`, value: priceNum * (downPercentNum / 100) },
    { label: 'Loan Amount', value: loanAmount },
    { label: 'Principal & Interest', value: principalAndInterest },
    { label: 'Property Taxes', value: taxesNum },
    { label: 'Insurance', value: insuranceNum },
    { label: 'HOA', value: hoaNum },
    { label: 'Total Monthly Payment', value: totalMonthlyPayment },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Loan Details</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Home Price *</Text>
          <TextInput
            style={[styles.input, !isValid && homePrice !== '' && styles.inputError]}
            value={homePrice}
            onChangeText={setHomePrice}
            placeholder="Enter home price (e.g., $400,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && homePrice !== '' && (
            <Text style={styles.helperText}>Home price must be at least $1,000</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Down Payment (%)</Text>
          <TextInput
            style={styles.input}
            value={downPaymentPercent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(100, num));
              setDownPaymentPercent(String(clamped));
            }}
            placeholder="20"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 20% (0-100)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Interest Rate (APR %) *</Text>
          <TextInput
            style={[styles.input, !isValid && interestRate !== '' && styles.inputError]}
            value={interestRate}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(30, num));
              setInterestRate(String(clamped));
            }}
            placeholder="Enter interest rate (e.g., 7)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && interestRate !== '' && (
            <Text style={styles.helperText}>Interest rate must be between 0-30%</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Term (Years)</Text>
          <TextInput
            style={styles.input}
            value={termYears}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(1, Math.min(50, num));
              setTermYears(String(Math.round(clamped)));
            }}
            placeholder="30"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 30 years (common: 10, 15, 20, 30)</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Additional Monthly Costs</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Taxes (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={propertyTaxes}
            onChangeText={setPropertyTaxes}
            placeholder="Enter monthly property taxes (e.g., $500)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Insurance (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={insurance}
            onChangeText={setInsurance}
            placeholder="Enter monthly insurance (e.g., $150)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>HOA (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={hoa}
            onChangeText={setHoa}
            placeholder="Enter monthly HOA (e.g., $200)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Total Monthly Payment</Text>
            <Text style={styles.resultValue}>{formatCurrency(totalMonthlyPayment)}</Text>
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            {breakdown.map((row, index) => (
              <View key={index} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{row.label}</Text>
                <Text
                  style={[
                    styles.breakdownValue,
                    row.label === 'Total Monthly Payment' && styles.breakdownValueHighlight,
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
            Enter home price and interest rate to calculate mortgage payment.
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
