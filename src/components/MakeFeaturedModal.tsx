import { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme';

interface MakeFeaturedModalProps {
  visible: boolean;
  listingId: string;
  onStartCheckout: (listingId: string) => Promise<void>;
  onClose: () => void;
}

export default function MakeFeaturedModal({
  visible,
  listingId,
  onStartCheckout,
  onClose,
}: MakeFeaturedModalProps) {
  const [loading, setLoading] = useState(false);

  const handleContinueToCheckout = async () => {
    setLoading(true);
    try {
      await onStartCheckout(listingId);
      // Don't close modal immediately - let user see if there's an error
      // Modal will close when Stripe redirects or user cancels
    } catch (err) {
      // Error handling is done in the parent component
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Make Featured</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeButton}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>Featured Listing Benefits</Text>
            
            <View style={styles.benefitItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.benefitText}>
                Adds a "Featured" badge to your listing
              </Text>
            </View>

            <View style={styles.benefitItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.benefitText}>
                Priority visibility in browse results (featured listings appear first when applicable)
              </Text>
            </View>

            <View style={styles.benefitItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.benefitText}>
                Expires after 7 days
              </Text>
            </View>

            <View style={styles.priceContainer}>
              <Text style={styles.priceLabel}>Price:</Text>
              <Text style={styles.priceValue}>$10</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.checkoutButton, loading && styles.checkoutButtonDisabled]}
            onPress={handleContinueToCheckout}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.checkoutButtonText}>Continue to Checkout</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.text,
  },
  closeButton: {
    fontSize: typography.fontSize.base,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
  infoContainer: {
    padding: spacing.md,
  },
  infoTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  benefitItem: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  bullet: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  benefitText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.text,
    lineHeight: 22,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
    marginRight: spacing.sm,
  },
  priceValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  footer: {
    flexDirection: 'row',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    marginRight: spacing.sm,
  },
  cancelButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
  },
  checkoutButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    minHeight: 44,
  },
  checkoutButtonDisabled: {
    opacity: 0.6,
  },
  checkoutButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textInverse,
  },
});
