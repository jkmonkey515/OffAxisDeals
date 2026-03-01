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

export default function RentVsSellCalculatorScreen() {
  // Sell Now inputs
  const [currentValue, setCurrentValue] = useState('');
  const [mortgageBalanceNow, setMortgageBalanceNow] = useState('');
  const [sellCostsPct, setSellCostsPct] = useState('8.0');

  // Rent Scenario inputs
  const [monthlyRent, setMonthlyRent] = useState('');
  const [vacancyPct, setVacancyPct] = useState('5');
  const [mgmtPct, setMgmtPct] = useState('10');
  const [monthlyOperatingExpenses, setMonthlyOperatingExpenses] = useState('');
  const [holdYears, setHoldYears] = useState('5');
  const [appreciationPct, setAppreciationPct] = useState('3');
  const [rentGrowthPct, setRentGrowthPct] = useState('2');
  const [expectedMortgageAtSale, setExpectedMortgageAtSale] = useState('');

  // Parse inputs
  const currentValueNum = parseCurrency(currentValue);
  const mortgageBalanceNowNum = parseCurrency(mortgageBalanceNow) ?? 0;
  const sellCostsPctNum = Math.max(0, Math.min(15, parseFloat(sellCostsPct) || 0));
  const monthlyRentNum = parseCurrency(monthlyRent) ?? 0;
  const vacancyPctNum = Math.max(0, Math.min(30, parseFloat(vacancyPct) || 0));
  const mgmtPctNum = Math.max(0, Math.min(20, parseFloat(mgmtPct) || 0));
  const monthlyOperatingExpensesNum = parseCurrency(monthlyOperatingExpenses) ?? 0;
  const holdYearsNum = Math.max(1, Math.min(30, Math.round(parseFloat(holdYears) || 5)));
  const appreciationPctNum = Math.max(-10, Math.min(20, parseFloat(appreciationPct) || 0));
  const rentGrowthPctNum = Math.max(-10, Math.min(20, parseFloat(rentGrowthPct) || 0));
  const expectedMortgageAtSaleNum = parseCurrency(expectedMortgageAtSale);

  // Validation
  const isValid = currentValueNum !== null && currentValueNum >= 1000 && mortgageBalanceNowNum >= 0 && monthlyRentNum >= 0;

  // Calculate Sell Now Net Proceeds
  let sellNowSellingCosts = 0;
  let sellNowNet = 0;

  if (isValid && currentValueNum !== null) {
    sellNowSellingCosts = currentValueNum * (sellCostsPctNum / 100);
    sellNowNet = currentValueNum - sellNowSellingCosts - mortgageBalanceNowNum;
  }

  // Calculate Rent Then Sell
  let totalCashflow = 0;
  let futureValue = 0;
  let saleCostsFuture = 0;
  let mortgageAtSale = expectedMortgageAtSaleNum ?? mortgageBalanceNowNum;
  let netSaleProceedsFuture = 0;
  let rentThenSellNet = 0;

  if (isValid && currentValueNum !== null && monthlyRentNum >= 0) {
    // Calculate annual cashflow for each year
    for (let year = 1; year <= holdYearsNum; year++) {
      const yearRent = monthlyRentNum * 12 * Math.pow(1 + rentGrowthPctNum / 100, year - 1);
      const effectiveRent = yearRent * (1 - vacancyPctNum / 100);
      const mgmt = effectiveRent * (mgmtPctNum / 100);
      const annualCashflow = effectiveRent - mgmt - (monthlyOperatingExpensesNum * 12);
      totalCashflow += annualCashflow;
    }

    // Calculate future value
    futureValue = currentValueNum * Math.pow(1 + appreciationPctNum / 100, holdYearsNum);
    saleCostsFuture = futureValue * (sellCostsPctNum / 100);
    netSaleProceedsFuture = futureValue - saleCostsFuture - mortgageAtSale;
    rentThenSellNet = totalCashflow + netSaleProceedsFuture;
  }

  // Calculate difference
  const difference = rentThenSellNet - sellNowNet;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sell Now</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Current Home Value *</Text>
          <TextInput
            style={[styles.input, !isValid && currentValue !== '' && currentValueNum !== null && currentValueNum < 1000 && styles.inputError]}
            value={currentValue}
            onChangeText={setCurrentValue}
            placeholder="Enter current home value (e.g., $300,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {currentValue !== '' && currentValueNum !== null && currentValueNum < 1000 && (
            <Text style={styles.helperText}>Home value must be at least $1,000</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mortgage Balance Now *</Text>
          <TextInput
            style={styles.input}
            value={mortgageBalanceNow}
            onChangeText={setMortgageBalanceNow}
            placeholder="Enter current mortgage balance (e.g., $200,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Selling Costs (%)</Text>
          <TextInput
            style={styles.input}
            value={sellCostsPct}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(15, num));
              setSellCostsPct(String(clamped));
            }}
            placeholder="8.0"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 8% (0-15%)</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rent Scenario</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Monthly Rent *</Text>
          <TextInput
            style={styles.input}
            value={monthlyRent}
            onChangeText={setMonthlyRent}
            placeholder="Enter monthly rent (e.g., $2,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Vacancy (%)</Text>
          <TextInput
            style={styles.input}
            value={vacancyPct}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(30, num));
              setVacancyPct(String(clamped));
            }}
            placeholder="5"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 5% (0-30%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Management (%)</Text>
          <TextInput
            style={styles.input}
            value={mgmtPct}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(20, num));
              setMgmtPct(String(clamped));
            }}
            placeholder="10"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 10% (0-20%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Monthly Operating Expenses</Text>
          <TextInput
            style={styles.input}
            value={monthlyOperatingExpenses}
            onChangeText={setMonthlyOperatingExpenses}
            placeholder="Enter monthly expenses (taxes/ins/HOA/maintenance, e.g., $500)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Taxes, insurance, HOA, maintenance, etc.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Holding Period (Years)</Text>
          <TextInput
            style={styles.input}
            value={holdYears}
            onChangeText={(text) => {
              const num = parseFloat(text) || 5;
              const clamped = Math.max(1, Math.min(30, num));
              setHoldYears(String(Math.round(clamped)));
            }}
            placeholder="5"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 5 years (1-30)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Home Appreciation (%/yr)</Text>
          <TextInput
            style={styles.input}
            value={appreciationPct}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(-10, Math.min(20, num));
              setAppreciationPct(String(clamped));
            }}
            placeholder="3"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 3% (-10% to 20%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Rent Growth (%/yr)</Text>
          <TextInput
            style={styles.input}
            value={rentGrowthPct}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(-10, Math.min(20, num));
              setRentGrowthPct(String(clamped));
            }}
            placeholder="2"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 2% (-10% to 20%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Expected Mortgage Balance at Sale (optional)</Text>
          <TextInput
            style={styles.input}
            value={expectedMortgageAtSale}
            onChangeText={setExpectedMortgageAtSale}
            placeholder="Leave empty to use current balance"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>If empty, uses current mortgage balance</Text>
        </View>
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Sell Now Net Proceeds</Text>
            <Text style={styles.resultValue}>{formatCurrency(sellNowNet)}</Text>
          </View>
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Rent Then Sell Net</Text>
            <Text style={styles.resultValue}>{formatCurrency(rentThenSellNet)}</Text>
          </View>
          <View style={[styles.resultCard, difference >= 0 ? styles.resultCardPositive : styles.resultCardNegative]}>
            <Text style={styles.resultLabel}>
              {difference >= 0 ? 'Rent beats Sell by' : 'Sell beats Rent by'}
            </Text>
            <Text style={[styles.resultValue, difference < 0 && styles.resultValueNegative]}>
              {formatCurrency(Math.abs(difference))}
            </Text>
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Supporting Values</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Total Cashflow During Hold</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(totalCashflow)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Future Home Value</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(futureValue)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Future Sale Proceeds</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(netSaleProceedsFuture)}</Text>
            </View>
          </View>

          <Text style={styles.disclaimerText}>
            Estimates only. Taxes and loan amortization not included.
          </Text>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter valid current home value (at least $1,000), mortgage balance, and monthly rent to calculate.
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
  resultCardPositive: {
    borderColor: '#34C759',
    backgroundColor: '#F0FDF4',
  },
  resultCardNegative: {
    borderColor: '#FF3B30',
    backgroundColor: '#FEF2F2',
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
    marginBottom: 16,
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
  disclaimerText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
});
