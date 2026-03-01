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

export default function HoldingCostsCalculatorScreen() {
  const [holdingMonths, setHoldingMonths] = useState('3');
  const [mortgagePI, setMortgagePI] = useState('');
  const [propertyTaxes, setPropertyTaxes] = useState('');
  const [insurance, setInsurance] = useState('');
  const [utilities, setUtilities] = useState('');
  const [hoa, setHoa] = useState('');
  const [maintenance, setMaintenance] = useState('');
  const [other, setOther] = useState('');

  const monthsNum = Math.max(0, Math.min(60, Math.round(parseFloat(holdingMonths) || 0)));
  const mortgageNum = parseCurrency(mortgagePI) ?? 0;
  const taxesNum = parseCurrency(propertyTaxes) ?? 0;
  const insuranceNum = parseCurrency(insurance) ?? 0;
  const utilitiesNum = parseCurrency(utilities) ?? 0;
  const hoaNum = parseCurrency(hoa) ?? 0;
  const maintenanceNum = parseCurrency(maintenance) ?? 0;
  const otherNum = parseCurrency(other) ?? 0;

  // Calculate holding costs
  const totalMonthlyCarry = mortgageNum + taxesNum + insuranceNum + utilitiesNum + hoaNum + maintenanceNum + otherNum;
  const totalHoldingCosts = totalMonthlyCarry * monthsNum;

  const isValid = monthsNum > 0;

  const breakdown: BreakdownRow[] = [
    { label: 'Holding Period', value: monthsNum },
    { label: 'Mortgage P&I', value: mortgageNum },
    { label: 'Property Taxes', value: taxesNum },
    { label: 'Insurance', value: insuranceNum },
    { label: 'Utilities', value: utilitiesNum },
    { label: 'HOA', value: hoaNum },
    { label: 'Maintenance', value: maintenanceNum },
    { label: 'Other', value: otherNum },
    { label: 'Total Monthly Carry', value: totalMonthlyCarry },
    { label: 'Total Holding Costs', value: totalHoldingCosts },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Holding Period</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Holding Period (Months) *</Text>
          <TextInput
            style={[styles.input, !isValid && holdingMonths !== '' && styles.inputError]}
            value={holdingMonths}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(60, num));
              setHoldingMonths(String(Math.round(clamped)));
            }}
            placeholder="3"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && holdingMonths !== '' && (
            <Text style={styles.helperText}>Holding period must be at least 1 month</Text>
          )}
          <Text style={styles.helperText}>Default: 3 months (0-60)</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Monthly Costs</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mortgage P&I (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={mortgagePI}
            onChangeText={setMortgagePI}
            placeholder="Enter monthly mortgage payment (e.g., $800)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

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
          <Text style={styles.label}>Insurance (Monthly)</Text>
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
          <Text style={styles.label}>Utilities (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={utilities}
            onChangeText={setUtilities}
            placeholder="Enter monthly utilities (e.g., $150)"
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
            placeholder="Enter monthly HOA (e.g., $150)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Maintenance (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={maintenance}
            onChangeText={setMaintenance}
            placeholder="Enter monthly maintenance (e.g., $100)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Other (Monthly)</Text>
          <TextInput
            style={styles.input}
            value={other}
            onChangeText={setOther}
            placeholder="Enter other monthly costs (e.g., $0)"
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
            <Text style={styles.resultLabel}>Total Holding Costs</Text>
            <Text style={styles.resultValue}>{formatCurrency(totalHoldingCosts)}</Text>
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            {breakdown.map((row, index) => (
              <View key={index} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>
                  {row.label === 'Holding Period' ? `${row.label} (${row.value} ${row.value === 1 ? 'month' : 'months'})` : row.label}
                </Text>
                <Text
                  style={[
                    styles.breakdownValue,
                    row.label === 'Total Holding Costs' && styles.breakdownValueHighlight,
                  ]}
                >
                  {row.label === 'Holding Period' ? `${row.value}` : formatCurrency(row.value)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter holding period (at least 1 month) to calculate holding costs.
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
