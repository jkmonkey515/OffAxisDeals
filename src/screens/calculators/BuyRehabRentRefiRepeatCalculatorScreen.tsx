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
 * Calculate monthly mortgage payment (P&I).
 */
function calculateMortgagePayment(loanAmount: number, annualRate: number, termYears: number): number {
  if (loanAmount <= 0) return 0;
  if (termYears <= 0) return 0;

  const monthlyRate = annualRate / 100 / 12;
  const numPayments = termYears * 12;

  if (monthlyRate === 0) {
    // Zero interest: simple division
    return loanAmount / numPayments;
  }

  const monthlyPayment =
    (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  return monthlyPayment;
}

export default function BuyRehabRentRefiRepeatCalculatorScreen() {
  // Purchase / Rehab inputs
  const [purchasePrice, setPurchasePrice] = useState('');
  const [rehabCost, setRehabCost] = useState('');
  const [arv, setArv] = useState('');

  // Refi inputs
  const [refiLtv, setRefiLtv] = useState('75');
  const [refiClosingCosts, setRefiClosingCosts] = useState('');

  // Rental inputs
  const [monthlyRent, setMonthlyRent] = useState('');
  const [monthlyOpEx, setMonthlyOpEx] = useState('');
  const [interestRate, setInterestRate] = useState('7');
  const [termYears, setTermYears] = useState('30');
  const [vacancyPct, setVacancyPct] = useState('5');
  const [mgmtPct, setMgmtPct] = useState('10');

  // Parse inputs
  const purchaseNum = parseCurrency(purchasePrice);
  const rehabNum = parseCurrency(rehabCost) ?? 0;
  const arvNum = parseCurrency(arv);
  const refiLtvNum = Math.max(0, Math.min(100, parseFloat(refiLtv) || 0));
  const refiClosingNum = parseCurrency(refiClosingCosts) ?? 0;
  const monthlyRentNum = parseCurrency(monthlyRent) ?? 0;
  const monthlyOpExNum = parseCurrency(monthlyOpEx) ?? 0;
  const interestRateNum = Math.max(0, Math.min(30, parseFloat(interestRate) || 0));
  // Clamp term to valid values (10, 15, 20, 30)
  const termYearsNumRaw = Math.max(10, Math.min(30, parseFloat(termYears) || 30));
  const termYearsClamped = [10, 15, 20, 30].reduce((prev, curr) =>
    Math.abs(curr - termYearsNumRaw) < Math.abs(prev - termYearsNumRaw) ? curr : prev
  );
  const vacancyPctNum = Math.max(0, Math.min(30, parseFloat(vacancyPct) || 0));
  const mgmtPctNum = Math.max(0, Math.min(20, parseFloat(mgmtPct) || 0));

  // Validation
  const isValid = purchaseNum !== null && purchaseNum >= 1000 && arvNum !== null && arvNum >= 1000 && monthlyRentNum >= 0;

  // Calculations
  let totalCost = 0;
  let maxRefiLoan = 0;
  let netCashOut = 0;
  let cashLeftIn = 0;
  let cashOut = 0;
  let monthlyPI = 0;
  let effectiveRent = 0;
  let mgmt = 0;
  let monthlyCashflow = 0;
  let cashInvested = 0;
  let annualCashflow = 0;
  let cocReturn: number | null = null;

  if (isValid && purchaseNum !== null && arvNum !== null) {
    // 1) Total Project Cost
    totalCost = purchaseNum + rehabNum;

    // 2) Refi Loan
    maxRefiLoan = arvNum * (refiLtvNum / 100);
    netCashOut = maxRefiLoan - totalCost - refiClosingNum;
    cashLeftIn = Math.max(0, -netCashOut);
    cashOut = Math.max(0, netCashOut);

    // 3) Post-refi monthly payment (P&I)
    monthlyPI = calculateMortgagePayment(maxRefiLoan, interestRateNum, termYearsClamped);

    // 4) Monthly cashflow
    effectiveRent = monthlyRentNum * (1 - vacancyPctNum / 100);
    mgmt = effectiveRent * (mgmtPctNum / 100);
    monthlyCashflow = effectiveRent - mgmt - monthlyOpExNum - monthlyPI;

    // 5) Cash-on-Cash Return
    cashInvested = Math.max(0, totalCost + refiClosingNum - maxRefiLoan);
    annualCashflow = monthlyCashflow * 12;
    if (cashInvested > 0) {
      cocReturn = (annualCashflow / cashInvested) * 100;
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Purchase & Rehab</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Purchase Price *</Text>
          <TextInput
            style={[styles.input, !isValid && purchasePrice !== '' && purchaseNum !== null && purchaseNum < 1000 && styles.inputError]}
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            placeholder="Enter purchase price (e.g., $150,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {purchasePrice !== '' && purchaseNum !== null && purchaseNum < 1000 && (
            <Text style={styles.helperText}>Purchase price must be at least $1,000</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Rehab Cost</Text>
          <TextInput
            style={styles.input}
            value={rehabCost}
            onChangeText={setRehabCost}
            placeholder="Enter rehab cost (e.g., $30,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>After Repair Value (ARV) *</Text>
          <TextInput
            style={[styles.input, !isValid && arv !== '' && arvNum !== null && arvNum < 1000 && styles.inputError]}
            value={arv}
            onChangeText={setArv}
            placeholder="Enter ARV (e.g., $250,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {arv !== '' && arvNum !== null && arvNum < 1000 && (
            <Text style={styles.helperText}>ARV must be at least $1,000</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Refi</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Refi LTV (%)</Text>
          <TextInput
            style={styles.input}
            value={refiLtv}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(100, num));
              setRefiLtv(String(clamped));
            }}
            placeholder="75"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 75% (0-100%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Refi Closing Costs</Text>
          <TextInput
            style={styles.input}
            value={refiClosingCosts}
            onChangeText={setRefiClosingCosts}
            placeholder="Enter closing costs (e.g., $5,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rental</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Monthly Rent *</Text>
          <TextInput
            style={styles.input}
            value={monthlyRent}
            onChangeText={setMonthlyRent}
            placeholder="Enter monthly rent (e.g., $2,200)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Monthly Operating Expenses</Text>
          <TextInput
            style={styles.input}
            value={monthlyOpEx}
            onChangeText={setMonthlyOpEx}
            placeholder="Enter monthly expenses (taxes/ins/HOA/maintenance, e.g., $500)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Taxes, insurance, HOA, maintenance, etc.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Interest Rate % (APR)</Text>
          <TextInput
            style={styles.input}
            value={interestRate}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(30, num));
              setInterestRate(String(clamped));
            }}
            placeholder="7"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 7% (0-30%)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Term (Years)</Text>
          <TextInput
            style={styles.input}
            value={termYears}
            onChangeText={(text) => {
              const num = parseFloat(text) || 30;
              const clamped = Math.max(10, Math.min(30, num));
              const validTerm = [10, 15, 20, 30].reduce((prev, curr) =>
                Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
              );
              setTermYears(String(validTerm));
            }}
            placeholder="30"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Default: 30 years (10, 15, 20, or 30)</Text>
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
          <Text style={styles.label}>Management (%)</Text>
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
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>

          <View style={styles.resultCard}>
            {cashOut > 0 ? (
              <>
                <Text style={styles.resultLabel}>Cash Out</Text>
                <Text style={styles.resultValue}>{formatCurrency(cashOut)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.resultLabel}>Cash Left In</Text>
                <Text style={styles.resultValue}>{formatCurrency(cashLeftIn)}</Text>
              </>
            )}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Monthly Cashflow</Text>
            <Text style={[styles.resultValue, monthlyCashflow < 0 && styles.resultValueNegative]}>
              {formatCurrency(monthlyCashflow)}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Cash-on-Cash Return</Text>
            <Text style={styles.resultValue}>
              {cocReturn !== null ? `${cocReturn.toFixed(2)}%` : 'N/A'}
            </Text>
            {cashInvested <= 0 && (
              <Text style={styles.helperText}>No cash left in.</Text>
            )}
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Total Project Cost</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(totalCost)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Max Refi Loan</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(maxRefiLoan)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Refi Closing Costs</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(refiClosingNum)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Monthly P&I Payment</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(monthlyPI)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Effective Rent (after vacancy)</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(effectiveRent)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Management Fee</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(mgmt)}</Text>
            </View>
          </View>

          <Text style={styles.disclaimerText}>
            Estimates only. Taxes, reserves, and lender constraints vary.
          </Text>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter valid purchase price (at least $1,000), ARV (at least $1,000), and monthly rent to calculate.
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
