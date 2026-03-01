import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography } from '../theme';

interface ProfileLoadingScreenProps {
  onRetry?: () => void;
}

/**
 * Shows "Finishing account setup..." when profile is missing after signup.
 * Displays a retry button after 30s if profile still not found.
 */
export default function ProfileLoadingScreen({ onRetry }: ProfileLoadingScreenProps) {
  const { profileLoading, error, refreshProfile } = useAuth();
  const showRetry = !profileLoading && error === null; // After 30s timeout, profileLoading becomes false

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      refreshProfile();
    }
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.message}>Finishing account setup…</Text>
      {showRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Tap to retry</Text>
        </TouchableOpacity>
      )}
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
  message: {
    fontSize: typography.fontSize.lg,
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
