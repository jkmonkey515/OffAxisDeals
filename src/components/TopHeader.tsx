import { ReactNode } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import BackButton from './BackButton';
import { colors, spacing, typography } from '../theme';

interface TopHeaderProps {
  title: string;
  right?: ReactNode;
  showBack?: boolean;
  onBackPress?: () => void;
}

export default function TopHeader({
  title,
  right,
  showBack = true,
  onBackPress,
}: TopHeaderProps) {
  return (
    <View style={styles.header}>
      {showBack && (
        <BackButton
          onPress={onBackPress}
          style={styles.backButton}
        />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right ? (
        <View style={styles.rightContainer}>{right}</View>
      ) : (
        <View style={styles.rightSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.backgroundElevated,
    minHeight: 56,
  },
  backButton: {
    marginRight: spacing.sm,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text,
    flex: 1,
  },
  rightContainer: {
    marginLeft: spacing.sm,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  rightSpacer: {
    width: 44, // Match back button width for centering
  },
});
