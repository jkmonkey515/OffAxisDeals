import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { openExternalUrl } from '../utils/openExternalUrl';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import { colors, spacing, typography } from '../theme';

const ACCOUNT_URL = 'https://www.offaxisdeals.com/account';

interface ProfileScreenProps {
  navigation: {
    goBack: () => void;
  };
}

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { user, profile } = useAuth();

  // Format role for display (capitalize first letter)
  const displayRole = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : 'Unknown';

  // Determine plan based on is_paid
  const plan = profile?.is_paid === true ? 'Plus' : 'Free';

  // Get email from user
  const email = user?.email || 'Not available';

  return (
    <View style={styles.container}>
      <TopHeader 
        title="Profile"
        right={<HeaderRightActions />}
      />
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Profile Info Card */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{email}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.infoValue}>{displayRole}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Plan</Text>
            <Text style={styles.infoValue}>{plan}</Text>
          </View>
        </View>

        {/* Manage on Website Button */}
        <TouchableOpacity
          style={styles.manageButton}
          onPress={() => openExternalUrl(ACCOUNT_URL)}
        >
          <Text style={styles.manageButtonText}>Manage on Website</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    fontWeight: typography.fontWeight.medium,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.xs,
  },
  manageButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  manageButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
