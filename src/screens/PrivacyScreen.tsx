import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import { PRIVACY_URL } from '../config/env';
import { openExternalUrl } from '../utils/openExternalUrl';
import { colors, spacing, typography } from '../theme';

interface PrivacyScreenProps {
  navigation: {
    goBack: () => void;
  };
}

export default function PrivacyScreen({ navigation }: PrivacyScreenProps) {
  return (
    <View style={styles.container}>
      <TopHeader 
        title="Privacy"
        right={<HeaderRightActions />}
      />
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <Text style={styles.description}>
          Our privacy policy explains how we collect, use, and protect your personal information.
        </Text>
        <Text style={styles.description}>
          The full privacy policy is available on our website.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => openExternalUrl(PRIVACY_URL)}
        >
          <Text style={styles.buttonText}>View Privacy Policy</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    flexGrow: 1,
    padding: 20,
  },
  description: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
    marginBottom: 16,
    textAlign: 'left',
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
