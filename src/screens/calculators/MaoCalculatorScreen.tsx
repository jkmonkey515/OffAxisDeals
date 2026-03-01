import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { formatMoney } from '../../utils/currency';
import { colors, spacing, typography } from '../../theme';

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

export default function MaoCalculatorScreen() {
  const [arv, setArv] = useState('');
  const [repairs, setRepairs] = useState('');
  const [closingCosts, setClosingCosts] = useState('');
  const [holdingCosts, setHoldingCosts] = useState('');
  const [wholesaleFee, setWholesaleFee] = useState('');
  const [discountPercent, setDiscountPercent] = useState('70');

  const arvNum = parseCurrency(arv);
  const repairsNum = parseCurrency(repairs) ?? 0;
  const closingCostsNum = parseCurrency(closingCosts) ?? 0;
  const holdingCostsNum = parseCurrency(holdingCosts) ?? 0;
  const wholesaleFeeNum = parseCurrency(wholesaleFee) ?? 0;
  const discountPercentNum = Math.max(0, Math.min(100, parseFloat(discountPercent) || 0));

  // Calculate MAO
  let mao: number | null = null;
  let breakdown: BreakdownRow[] = [];

  if (arvNum !== null && arvNum >= 1000) {
    const arvAfterDiscount = arvNum * (discountPercentNum / 100);
    const totalCosts = repairsNum + closingCostsNum + holdingCostsNum + wholesaleFeeNum;
    mao = arvAfterDiscount - totalCosts;

    breakdown = [
      { label: 'ARV', value: arvNum },
      { label: `ARV at ${discountPercentNum}%`, value: arvAfterDiscount },
      { label: 'Repair Costs', value: -repairsNum, isNegative: true },
      { label: 'Closing Costs', value: -closingCostsNum, isNegative: true },
      { label: 'Holding Costs', value: -holdingCostsNum, isNegative: true },
      { label: 'Assignment Fee', value: -wholesaleFeeNum, isNegative: true },
      { label: 'MAO', value: mao },
    ];
  }

  const isValid = arvNum !== null && arvNum >= 1000;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inputs</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>ARV (After Repair Value) *</Text>
          <TextInput
            style={[styles.input, !isValid && arv !== '' && styles.inputError]}
            value={arv}
            onChangeText={setArv}
            placeholder="Enter ARV (e.g., $150,000)"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="numeric"
            autoCapitalize="none"
          />
          {!isValid && arv !== '' && (
            <Text style={styles.helperText}>ARV must be at least $1,000</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Repair Costs</Text>
          <TextInput
            style={styles.input}
            value={repairs}
            onChangeText={setRepairs}
            placeholder="Enter repair costs (e.g., $20,000)"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Closing Costs</Text>
          <TextInput
            style={styles.input}
            value={closingCosts}
            onChangeText={setClosingCosts}
            placeholder="Enter closing costs (e.g., $3,000)"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Holding Costs</Text>
          <TextInput
            style={styles.input}
            value={holdingCosts}
            onChangeText={setHoldingCosts}
            placeholder="Enter holding costs (e.g., $1,500)"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="numeric"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Assignment Fee (optional)</Text>
          <TextInput
            style={styles.input}
            value={wholesaleFee}
            onChangeText={setWholesaleFee}
            placeholder="Enter assignment fee (e.g., $5,000)"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Wholesalers: your fee. Investors: set to $0.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>ARV Multiplier (%)</Text>
          <TextInput
            style={styles.input}
            value={discountPercent}
            onChangeText={(text) => {
              const num = parseFloat(text) || 0;
              const clamped = Math.max(0, Math.min(100, num));
              setDiscountPercent(String(clamped));
            }}
            placeholder="70"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Text style={styles.helperText}>Common flip rule: 70%. This sets ARV × % before subtracting costs.</Text>
        </View>
      </View>

      {isValid && mao !== null && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Result</Text>
          <View style={styles.maoCard}>
            <Text style={styles.maoLabel}>Maximum Allowable Offer</Text>
            <Text style={styles.maoValue}>{formatCurrency(mao)}</Text>
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
                    row.label === 'MAO' && styles.breakdownValueMao,
                  ]}
                >
                  {row.isNegative ? '-' : ''}
                  {formatCurrency(Math.abs(row.value))}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!isValid && (
        <View style={styles.section}>
          <Text style={styles.helperText}>
            Enter a valid ARV (at least $1,000) to calculate MAO.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    padding: spacing.md,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    fontSize: typography.fontSize.base,
    backgroundColor: colors.backgroundElevated,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  helperText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  maoCard: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  maoLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  maoValue: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  breakdownCard: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  breakdownTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  breakdownLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  breakdownValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
  },
  breakdownValueNegative: {
    color: colors.danger,
  },
  breakdownValueMao: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.primary,
  },
});
