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
  isNegative?: boolean;
}

export default function FlipProfitCalculatorScreen() {
  const [purchasePrice, setPurchasePrice] = useState('');
  const [repairs, setRepairs] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [buyClosingCosts, setBuyClosingCosts] = useState('');
  const [holdingCosts, setHoldingCosts] = useState('');
  const [sellingPercent, setSellingPercent] = useState('8.0');
  const [sellingFlat, setSellingFlat] = useState('');
  const [assignmentFee, setAssignmentFee] = useState('');
  const [cashInvested, setCashInvested] = useState('');

  const purchaseNum = parseCurrency(purchasePrice);
  const repairsNum = parseCurrency(repairs) ?? 0;
  const saleNum = parseCurrency(salePrice);
  const buyClosingNum = parseCurrency(buyClosingCosts) ?? 0;
  const holdingNum = parseCurrency(holdingCosts) ?? 0;
  const sellingPercentNum = Math.max(0, Math.min(15, parseFloat(sellingPercent) || 0));
  const sellingFlatNum = parseCurrency(sellingFlat) ?? 0;
  const assignmentNum = parseCurrency(assignmentFee) ?? 0;
  const cashInvestedNum = parseCurrency(cashInvested) ?? 0;

  // Calculate flip profit
  let sellingCosts = 0;
  let totalCosts = 0;
  let netProfit: number | null = null;
  let roi: number | null = null;

  const isValid = purchaseNum !== null && purchaseNum >= 1000 && saleNum !== null && saleNum >= 1000;

  if (isValid) {
    sellingCosts = saleNum * (sellingPercentNum / 100) + sellingFlatNum;
    totalCosts = purchaseNum + repairsNum + buyClosingNum + holdingNum + sellingCosts + assignmentNum;
    netProfit = saleNum - totalCosts;

    if (cashInvestedNum > 0) {
      roi = (netProfit / cashInvestedNum) * 100;
    }
  }

  const breakdown: BreakdownRow[] = isValid && netProfit !== null ? [
    { label: 'Purchase Price', value: purchaseNum! },
    { label: 'Repairs', value: repairsNum },
    { label: 'Buying Closing Costs', value: buyClosingNum },
    { label: 'Holding Costs', value: holdingNum },
    { label: 'Selling Costs', value: sellingCosts },
    { label: 'Assignment Fee', value: assignmentNum },
    { label: 'Total Costs', value: totalCosts },
    { label: 'Sale Price', value: saleNum! },
    { label: 'Net Profit', value: netProfit },
  ] : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Deal</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Purchase Price *</Text>
          <TextInput
            style={[styles.input, !isValid && purchasePrice !== '' && purchaseNum !== null && purchaseNum < 1000 && styles.inputError]}
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            placeholder="Enter purchase price (e.g., $200,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {purchasePrice !== '' && purchaseNum !== null && purchaseNum < 1000 && (
            <Text style={styles.helperText}>Purchase price must be at least $1,000</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Repairs</Text>
          <TextInput
            style={styles.input}
            value={repairs}
            onChangeText={setRepairs}
            placeholder="Enter repair costs (e.g., $30,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Sale Price / ARV *</Text>
          <TextInput
            style={[styles.input, !isValid && salePrice !== '' && saleNum !== null && saleNum < 1000 && styles.inputError]}
            value={salePrice}
            onChangeText={setSalePrice}
            placeholder="Enter sale price (e.g., $300,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {salePrice !== '' && saleNum !== null && saleNum < 1000 && (
            <Text style={styles.helperText}>Sale price must be at least $1,000</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Costs</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Buying Closing Costs</Text>
          <TextInput
            style={styles.input}
            value={buyClosingCosts}
            onChangeText={setBuyClosingCosts}
            placeholder="Enter buying closing costs (e.g., $5,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Paste from Closing Costs calculator if needed</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Holding Costs</Text>
          <TextInput
            style={styles.input}
            value={holdingCosts}
            onChangeText={setHoldingCosts}
            placeholder="Enter holding costs (e.g., $6,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Paste from Holding Costs calculator if needed</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Selling Costs (%)</Text>
          <TextInput
            style={styles.input}
            value={sellingPercent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(15, num));
              setSellingPercent(String(clamped));
            }}
            placeholder="8.0"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 8% (0-15%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Selling Costs (Flat)</Text>
          <TextInput
            style={styles.input}
            value={sellingFlat}
            onChangeText={setSellingFlat}
            placeholder="Enter flat selling costs (e.g., $0)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Assignment Fee (optional)</Text>
          <TextInput
            style={styles.input}
            value={assignmentFee}
            onChangeText={setAssignmentFee}
            placeholder="Enter assignment fee (e.g., $0)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Wholesalers: your fee. Investors: set to $0.</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Investment</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Cash Invested (optional)</Text>
          <TextInput
            style={styles.input}
            value={cashInvested}
            onChangeText={setCashInvested}
            placeholder="Enter cash invested (e.g., $50,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Used for ROI%. If unknown, leave 0 to show N/A.</Text>
        </View>
      </View>

      {isValid && netProfit !== null && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Net Profit</Text>
            <Text style={[styles.resultValue, netProfit < 0 && styles.resultValueNegative]}>
              {formatCurrency(netProfit)}
            </Text>
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
                    row.label === 'Net Profit' && styles.breakdownValueHighlight,
                    row.label === 'Net Profit' && netProfit! < 0 && styles.breakdownValueNegative,
                  ]}
                >
                  {formatCurrency(row.value)}
                </Text>
              </View>
            ))}
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>ROI %</Text>
              <Text style={styles.breakdownValue}>
                {roi !== null ? `${roi.toFixed(2)}%` : 'N/A'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter valid purchase price and sale price (at least $1,000 each) to calculate flip profit.
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
