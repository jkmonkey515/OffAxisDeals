import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { supabaseClient } from '../lib/supabase';
import {
  TERMS_URL,
  PRIVACY_URL,
  DISCLAIMER_URL,
  REFUND_POLICY_URL,
  ACCOUNT_DELETION_URL,
} from '../config/env';
import { openExternalUrl } from '../utils/openExternalUrl';
import { isDebugQAEnabled } from '../utils/debugGating';
import { colors, spacing, typography } from '../theme';

interface SettingsScreenProps {
  navigation: {
    navigate: (screen: string) => void;
  };
}

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        if (__DEV__) {
          console.error('Sign out error:', error.message);
        }
      }
      // Navigation will automatically switch to AuthStack via root navigator
    } catch (err) {
      if (__DEV__) {
        console.error('Sign out error:', err);
      }
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => navigation.navigate('Profile')}
        >
          <Text style={styles.settingText}>Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => navigation.navigate('Subscription')}
        >
          <Text style={styles.settingText}>Subscription</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => navigation.navigate('NotificationSettings')}
        >
          <Text style={styles.settingText}>Notifications</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => navigation.navigate('Privacy')}
        >
          <Text style={styles.settingText}>Privacy</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Policies</Text>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => openExternalUrl(TERMS_URL)}
        >
          <Text style={styles.settingText}>Terms of Service</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => openExternalUrl(PRIVACY_URL)}
        >
          <Text style={styles.settingText}>Privacy Policy</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => openExternalUrl(DISCLAIMER_URL)}
        >
          <Text style={styles.settingText}>Disclaimer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => openExternalUrl(REFUND_POLICY_URL)}
        >
          <Text style={styles.settingText}>Refund Policy</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => openExternalUrl(ACCOUNT_DELETION_URL)}
        >
          <Text style={styles.settingText}>Account deletion instructions</Text>
        </TouchableOpacity>
      </View>

      {/* Debug QA button - only visible when explicitly enabled */}
      {isDebugQAEnabled() && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Development</Text>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => navigation.navigate('DebugQA')}
          >
            <Text style={styles.settingText}>Debug QA</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sign Out */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.signOutButton, signingOut && styles.signOutButtonDisabled]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    marginBottom: spacing.sm,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  settingText: {
    fontSize: typography.fontSize.base,
    color: colors.text,
  },
  signOutButton: {
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutButtonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});

