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

export default function WholesaleSplitCalculatorScreen() {
  const [assignmentFee, setAssignmentFee] = useState('');
  const [split1Name, setSplit1Name] = useState('You');
  const [split1Percent, setSplit1Percent] = useState('100');
  const [split2Name, setSplit2Name] = useState('Partner');
  const [split2Percent, setSplit2Percent] = useState('0');

  const feeNum = parseCurrency(assignmentFee) ?? 0;
  const split1PercentNum = Math.max(0, Math.min(100, parseFloat(split1Percent) || 0));
  const split2PercentNum = Math.max(0, Math.min(100, parseFloat(split2Percent) || 0));

  // Calculate splits
  const split1Amount = feeNum * (split1PercentNum / 100);
  const split2Amount = feeNum * (split2PercentNum / 100);
  const totalAllocated = split1Amount + split2Amount;
  const remaining = feeNum - totalAllocated;

  const isValid = feeNum >= 0;
  const splitsTotal = split1PercentNum + split2PercentNum;
  const splitsValid = Math.abs(splitsTotal - 100) < 0.01; // Allow small floating point differences

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fee</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Assignment Fee *</Text>
          <TextInput
            style={styles.input}
            value={assignmentFee}
            onChangeText={setAssignmentFee}
            placeholder="Enter assignment fee (e.g., $10,000)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Splits</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Split 1 Name</Text>
          <TextInput
            style={styles.input}
            value={split1Name}
            onChangeText={setSplit1Name}
            placeholder="You"
            placeholderTextColor="#888"
            autoCapitalize="words"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Split 1 (%)</Text>
          <TextInput
            style={styles.input}
            value={split1Percent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(100, num));
              setSplit1Percent(String(clamped));
            }}
            placeholder="100"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Split 2 Name</Text>
          <TextInput
            style={styles.input}
            value={split2Name}
            onChangeText={setSplit2Name}
            placeholder="Partner"
            placeholderTextColor="#888"
            autoCapitalize="words"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Split 2 (%)</Text>
          <TextInput
            style={styles.input}
            value={split2Percent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(100, num));
              setSplit2Percent(String(clamped));
            }}
            placeholder="0"
            placeholderTextColor="#888"
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        {!splitsValid && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>Splits should total 100%</Text>
          </View>
        )}
      </View>

      {isValid && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.resultCard}>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>{split1Name || 'Split 1'}</Text>
              <Text style={styles.resultValue}>{formatCurrency(split1Amount)}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>{split2Name || 'Split 2'}</Text>
              <Text style={styles.resultValue}>{formatCurrency(split2Amount)}</Text>
            </View>
            <View style={[styles.resultRow, styles.resultRowLast]}>
              <Text style={styles.resultLabel}>
                {remaining >= 0 ? 'Unallocated' : 'Over-allocated'}
              </Text>
              <Text style={[styles.resultValue, remaining < 0 && styles.resultValueNegative]}>
                {formatCurrency(Math.abs(remaining))}
              </Text>
            </View>
          </View>

          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Assignment Fee</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(feeNum)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{split1Name || 'Split 1'} ({split1PercentNum}%)</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(split1Amount)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{split2Name || 'Split 2'} ({split2PercentNum}%)</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(split2Amount)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Total Allocated</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(totalAllocated)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>
                {remaining >= 0 ? 'Unallocated' : 'Over-allocated'}
              </Text>
              <Text style={[styles.breakdownValue, remaining < 0 && styles.breakdownValueNegative]}>
                {formatCurrency(Math.abs(remaining))}
              </Text>
            </View>
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter an assignment fee to calculate splits.
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
  warningBox: {
    backgroundColor: '#FFF3CD',
    borderWidth: 1,
    borderColor: '#FFC107',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  warningText: {
    fontSize: 14,
    color: '#856404',
    fontWeight: '500',
  },
  resultCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  resultRowLast: {
    marginBottom: 0,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  resultLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  resultValue: {
    fontSize: 24,
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
});
