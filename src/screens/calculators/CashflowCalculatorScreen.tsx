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
  value: number | string;
  isNegative?: boolean;
  isPercentage?: boolean;
}

export default function CashflowCalculatorScreen() {
  const [monthlyRent, setMonthlyRent] = useState('');
  const [propertyTaxes, setPropertyTaxes] = useState('');
  const [insurance, setInsurance] = useState('');
  const [hoa, setHoa] = useState('');
  const [propertyManagement, setPropertyManagement] = useState('');
  const [maintenance, setMaintenance] = useState('');
  const [utilities, setUtilities] = useState('');
  const [vacancyPercent, setVacancyPercent] = useState('5');
  const [mortgagePayment, setMortgagePayment] = useState('');
  const [cashInvested, setCashInvested] = useState('');

  const rentNum = parseCurrency(monthlyRent) ?? 0;
  const taxesNum = parseCurrency(propertyTaxes) ?? 0;
  const insuranceNum = parseCurrency(insurance) ?? 0;
  const hoaNum = parseCurrency(hoa) ?? 0;
  const managementNum = parseCurrency(propertyManagement) ?? 0;
  const maintenanceNum = parseCurrency(maintenance) ?? 0;
  const utilitiesNum = parseCurrency(utilities) ?? 0;
  const vacancyPercentNum = Math.max(0, Math.min(100, parseFloat(vacancyPercent) || 0));
  const mortgageNum = parseCurrency(mortgagePayment) ?? 0;
  const cashInvestedNum = parseCurrency(cashInvested) ?? 0;

  // Calculate cashflow
  const effectiveRent = rentNum * (1 - vacancyPercentNum / 100);
  const totalExpenses = taxesNum + insuranceNum + hoaNum + managementNum + maintenanceNum + utilitiesNum + mortgageNum;
  const monthlyCashflow = effectiveRent - totalExpenses;
  const annualCashflow = monthlyCashflow * 12;
  const cashOnCash = cashInvestedNum > 0 ? (annualCashflow / cashInvestedNum) * 100 : null;

  const isValid = rentNum >= 0 && cashInvestedNum >= 0;

  const breakdown: BreakdownRow[] = [
    { label: 'Monthly Rent', value: rentNum },
    { label: `Vacancy (${vacancyPercentNum}%)`, value: -rentNum * (vacancyPercentNum / 100), isNegative: true },
    { label: 'Effective Rent', value: effectiveRent },
    { label: 'Property Taxes', value: -taxesNum, isNegative: true },
    { label: 'Insurance', value: -insuranceNum, isNegative: true },
    { label: 'HOA', value: -hoaNum, isNegative: true },
    { label: 'Property Management', value: -managementNum, isNegative: true },
    { label: 'Maintenance/Repairs', value: -maintenanceNum, isNegative: true },
    { label: 'Utilities', value: -utilitiesNum, isNegative: true },
    { label: 'Mortgage Payment', value: -mortgageNum, isNegative: true },
    { label: 'Total Expenses', value: -totalExpenses, isNegative: true },
    { label: 'Monthly Cashflow', value: monthlyCashflow },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Income</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Monthly Rent *</Text>
          <TextInput
            style={styles.input}
            value={monthlyRent}
            onChangeText={setMonthlyRent}
            placeholder="Enter monthly rent (e.g., $1,500)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Operating Expenses (Monthly)</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Taxes (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={propertyTaxes}
            onChangeText={setPropertyTaxes}
            placeholder="Enter monthly property taxes (e.g., $200)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Insurance</Text>
          <TextInput
            style={styles.input}
            value={insurance}
            onChangeText={setInsurance}
            placeholder="Enter monthly insurance (e.g., $100)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>HOA</Text>
          <TextInput
            style={styles.input}
            value={hoa}
            onChangeText={setHoa}
            placeholder="Enter monthly HOA (e.g., $150)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Management</Text>
          <TextInput
            style={styles.input}
            value={propertyManagement}
            onChangeText={setPropertyManagement}
            placeholder="Enter monthly management fee (e.g., $150)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Maintenance/Repairs (Reserve)</Text>
          <TextInput
            style={styles.input}
            value={maintenance}
            onChangeText={setMaintenance}
            placeholder="Enter monthly maintenance reserve (e.g., $100)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Utilities (if landlord-paid)</Text>
          <TextInput
            style={styles.input}
            value={utilities}
            onChangeText={setUtilities}
            placeholder="Enter monthly utilities (e.g., $0)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Vacancy (%)</Text>
          <TextInput
            style={styles.input}
            value={vacancyPercent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(100, num));
              setVacancyPercent(String(clamped));
            }}
            placeholder="5"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 5% (0-100)</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Financing</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mortgage Payment (P&I)</Text>
          <TextInput
            style={styles.input}
            value={mortgagePayment}
            onChangeText={setMortgagePayment}
            placeholder="Enter monthly mortgage payment (e.g., $800)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Investment</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Cash Invested *</Text>
          <TextInput
            style={styles.input}
            value={cashInvested}
            onChangeText={setCashInvested}
            placeholder="Enter total cash invested (e.g., $50,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Down payment + closing costs + rehab</Text>
        </View>
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Monthly Cashflow</Text>
            <Text style={[styles.resultValue, monthlyCashflow < 0 && styles.resultValueNegative]}>
              {formatCurrency(monthlyCashflow)}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Annual Cashflow</Text>
            <Text style={[styles.resultValue, annualCashflow < 0 && styles.resultValueNegative]}>
              {formatCurrency(annualCashflow)}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Cash-on-Cash Return</Text>
            {cashOnCash !== null ? (
              <Text style={styles.resultValue}>{cashOnCash.toFixed(2)}%</Text>
            ) : (
              <>
                <Text style={styles.resultValue}>N/A</Text>
                <Text style={styles.helperText}>Enter cash invested to calculate cash-on-cash return</Text>
              </>
            )}
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            {breakdown.map((row, index) => (
              <View key={index} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{row.label}</Text>
                <Text
                  style={[
                    styles.breakdownValue,
                    row.isNegative && styles.breakdownValueNegative,
                    row.label === 'Monthly Cashflow' && styles.breakdownValueHighlight,
                  ]}
                >
                  {row.isNegative ? '-' : ''}
                  {typeof row.value === 'number' ? formatCurrency(Math.abs(row.value)) : row.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter monthly rent and cash invested to calculate cashflow.
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
  breakdownValueNegative: {
    color: '#FF3B30',
  },
  breakdownValueHighlight: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
});
