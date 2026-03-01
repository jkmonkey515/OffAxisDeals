import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { openUpgradePage } from '../utils/openUpgradePage';

interface UpgradeRequiredProps {
  /**
   * Title text (default: "Upgrade Required")
   */
  title?: string;
  /**
   * Message text (default: standard Plus feature message)
   */
  message?: string;
  /**
   * Button text (default: "Upgrade to unlock access")
   */
  buttonText?: string;
  /**
   * Button press handler (optional)
   */
  onPress?: () => void;
  /**
   * Secondary button text (optional)
   */
  secondaryButtonText?: string;
  /**
   * Secondary button press handler (optional)
   */
  onSecondaryPress?: () => void;
}

/**
 * Reusable upgrade required / paywall component.
 * 
 * Provides consistent styling and messaging across all upgrade screens.
 * Uses theme colors for consistent branding.
 */
export default function UpgradeRequired({
  title = 'Upgrade Required',
  message = 'This feature requires a Plus subscription. Upgrade to access messaging, contact info, watchlists, heatmap, and filters.',
  buttonText = 'Upgrade to unlock access',
  onPress,
  secondaryButtonText,
  onSecondaryPress,
}: UpgradeRequiredProps) {
  // Default to opening upgrade page if no onPress handler provided
  const handlePress = onPress || (() => openUpgradePage());

  return (
    <View style={styles.container}>
      <View style={styles.upgradeContainer}>
        <Text style={styles.upgradeTitle}>{title}</Text>
        <Text style={styles.upgradeMessage}>{message}</Text>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.upgradeButton} onPress={handlePress}>
            <Text style={styles.upgradeButtonText}>{buttonText}</Text>
          </TouchableOpacity>
          {onSecondaryPress && secondaryButtonText && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onSecondaryPress}>
              <Text style={styles.secondaryButtonText}>{secondaryButtonText}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  upgradeContainer: {
    maxWidth: 400,
    alignItems: 'center',
  },
  upgradeTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.md,
    color: colors.text,
    textAlign: 'center',
  },
  upgradeMessage: {
    fontSize: typography.fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  upgradeButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
