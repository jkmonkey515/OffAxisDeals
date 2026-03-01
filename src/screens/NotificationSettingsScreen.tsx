import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabaseClient } from '../lib/supabase';
import TopHeader from '../components/TopHeader';
import HeaderRightActions from '../components/HeaderRightActions';
import { colors, spacing, typography } from '../theme';
import { useAuth } from '../contexts/AuthContext';

interface NotificationSettingsScreenProps {
  navigation: {
    goBack: () => void;
  };
}

interface NotificationPreferences {
  // Global toggles
  email_enabled: boolean;
  in_app_enabled: boolean;
  push_enabled: boolean;
  // Type-specific: saved search matches
  saved_search_match_email: boolean;
  saved_search_match_in_app: boolean;
  // Type-specific: price drops
  price_drop_email: boolean;
  price_drop_in_app: boolean;
  // Type-specific: status changes
  status_change_email: boolean;
  status_change_in_app: boolean;
  // Wholesaler legacy flags
  buyer_interest: boolean;
  lead_message: boolean;
}

export default function NotificationSettingsScreen({ navigation }: NotificationSettingsScreenProps) {
  const { profile, refreshPushRegistration } = useAuth();
  const role = profile?.role ?? null;
  const isInvestor = role === 'investor';
  const isWholesaler = role === 'wholesaler' || role === 'admin';

  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Mount guard
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load preferences on mount and on focus
  const loadPreferences = useCallback(async () => {
    try {
      if (isMountedRef.current) {
        setError(null);
        setLoading(true);
      }

      // Get current user
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) {
        if (isMountedRef.current) {
          setError('Not signed in');
          setLoading(false);
        }
        return;
      }

      // Fetch all notification preference columns
      const { data, error: queryError } = await supabaseClient
        .from('notification_preferences')
        .select(`
          email_enabled,
          in_app_enabled,
          push_enabled,
          saved_search_match_email,
          saved_search_match_in_app,
          price_drop_email,
          price_drop_in_app,
          status_change_email,
          status_change_in_app,
          buyer_interest,
          lead_message
        `)
        .eq('user_id', user.id)
        .single();

      if (queryError) {
        // If row doesn't exist, create one with defaults
        if (queryError.code === 'PGRST116' || queryError.message.includes('No rows')) {
          const defaults: NotificationPreferences = {
            email_enabled: true,
            in_app_enabled: true,
            push_enabled: false,
            saved_search_match_email: true,
            saved_search_match_in_app: true,
            price_drop_email: true,
            price_drop_in_app: true,
            status_change_email: true,
            status_change_in_app: true,
            buyer_interest: true,
            lead_message: true,
          };

          // Upsert default preferences (idempotent - will create if not exists)
          const { data: inserted, error: upsertError } = await supabaseClient
            .from('notification_preferences')
            .upsert({
              user_id: user.id,
              ...defaults,
            }, {
              onConflict: 'user_id',
            })
            .select(`
              email_enabled,
              in_app_enabled,
              push_enabled,
              saved_search_match_email,
              saved_search_match_in_app,
              price_drop_email,
              price_drop_in_app,
              status_change_email,
              status_change_in_app,
              buyer_interest,
              lead_message
            `)
            .single();

          if (upsertError) {
            throw new Error(`Failed to create preferences: ${upsertError.message}`);
          }

          if (isMountedRef.current) {
            setPreferences(inserted);
            setError(null);
          }
        } else {
          throw new Error(queryError.message);
        }
      } else if (data) {
        // Ensure all fields exist, defaulting missing fields appropriately
        const prefs: NotificationPreferences = {
          email_enabled: data.email_enabled ?? true,
          in_app_enabled: data.in_app_enabled ?? true,
          push_enabled: data.push_enabled ?? false,
          saved_search_match_email: data.saved_search_match_email ?? true,
          saved_search_match_in_app: data.saved_search_match_in_app ?? true,
          price_drop_email: data.price_drop_email ?? true,
          price_drop_in_app: data.price_drop_in_app ?? true,
          status_change_email: data.status_change_email ?? true,
          status_change_in_app: data.status_change_in_app ?? true,
          buyer_interest: data.buyer_interest ?? true,
          lead_message: data.lead_message ?? true,
        };
        
        if (isMountedRef.current) {
          setPreferences(prefs);
          setError(null);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load notification preferences';
      if (isMountedRef.current) {
        setError(errorMessage);
        setPreferences(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  useFocusEffect(
    useCallback(() => {
      loadPreferences();
    }, [loadPreferences])
  );

  // Generic toggle handler that preserves unspecified columns
  const handleToggle = useCallback(
    async (field: keyof NotificationPreferences, newValue: boolean) => {
      if (saving || !preferences) return;

      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) return;

      // Optimistically update UI
      const optimisticPreferences: NotificationPreferences = {
        ...preferences,
        [field]: newValue,
      };
      setPreferences(optimisticPreferences);
      setUpdateError(null);

      try {
        setSaving(true);

        // Fetch current preferences to preserve all columns
        const { data: currentData } = await supabaseClient
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        // Prepare update payload: merge current data with the single field change
        const updatePayload: Partial<NotificationPreferences> = {
          ...(currentData || {}),
          [field]: newValue,
        };

        // Upsert to ensure row exists, preserving all columns
        const { error: updateError } = await supabaseClient
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            ...updatePayload,
          }, {
            onConflict: 'user_id',
          });

        if (updateError) {
          throw new Error(updateError.message);
        }
      } catch (err) {
        // Revert optimistic update
        setPreferences(preferences);
        const errorMessage = err instanceof Error ? err.message : 'Failed to update preferences';
        if (isMountedRef.current) {
          setUpdateError(errorMessage);
        }
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [preferences, saving]
  );

  // Handle email enabled toggle - also disable type-specific email toggles if email is disabled
  const handleEmailEnabledToggle = useCallback(
    async (newValue: boolean) => {
      if (saving || !preferences) return;

      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) return;

      // Optimistically update UI
      const optimisticPreferences: NotificationPreferences = {
        ...preferences,
        email_enabled: newValue,
        // Disable type-specific email toggles if email is disabled
        saved_search_match_email: newValue ? preferences.saved_search_match_email : false,
        price_drop_email: newValue ? preferences.price_drop_email : false,
        status_change_email: newValue ? preferences.status_change_email : false,
      };
      setPreferences(optimisticPreferences);
      setUpdateError(null);

      try {
        setSaving(true);

        // Fetch current preferences to preserve all columns
        const { data: currentData } = await supabaseClient
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        // Prepare update payload
        const updatePayload: Partial<NotificationPreferences> = {
          ...(currentData || {}),
          email_enabled: newValue,
          saved_search_match_email: newValue ? (currentData?.saved_search_match_email ?? true) : false,
          price_drop_email: newValue ? (currentData?.price_drop_email ?? true) : false,
          status_change_email: newValue ? (currentData?.status_change_email ?? true) : false,
        };

        // Upsert to ensure row exists
        const { error: updateError } = await supabaseClient
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            ...updatePayload,
          }, {
            onConflict: 'user_id',
          });

        if (updateError) {
          throw new Error(updateError.message);
        }
      } catch (err) {
        // Revert optimistic update
        setPreferences(preferences);
        const errorMessage = err instanceof Error ? err.message : 'Failed to update preferences';
        if (isMountedRef.current) {
          setUpdateError(errorMessage);
        }
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [preferences, saving]
  );

  // Handle in-app enabled toggle - also disable type-specific in-app toggles if in-app is disabled
  const handleInAppEnabledToggle = useCallback(
    async (newValue: boolean) => {
      if (saving || !preferences) return;

      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) return;

      // Optimistically update UI
      const optimisticPreferences: NotificationPreferences = {
        ...preferences,
        in_app_enabled: newValue,
        // Disable type-specific in-app toggles if in-app is disabled
        saved_search_match_in_app: newValue ? preferences.saved_search_match_in_app : false,
        price_drop_in_app: newValue ? preferences.price_drop_in_app : false,
        status_change_in_app: newValue ? preferences.status_change_in_app : false,
      };
      setPreferences(optimisticPreferences);
      setUpdateError(null);

      try {
        setSaving(true);

        // Fetch current preferences to preserve all columns
        const { data: currentData } = await supabaseClient
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        // Prepare update payload
        const updatePayload: Partial<NotificationPreferences> = {
          ...(currentData || {}),
          in_app_enabled: newValue,
          saved_search_match_in_app: newValue ? (currentData?.saved_search_match_in_app ?? true) : false,
          price_drop_in_app: newValue ? (currentData?.price_drop_in_app ?? true) : false,
          status_change_in_app: newValue ? (currentData?.status_change_in_app ?? true) : false,
        };

        // Upsert to ensure row exists
        const { error: updateError } = await supabaseClient
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            ...updatePayload,
          }, {
            onConflict: 'user_id',
          });

        if (updateError) {
          throw new Error(updateError.message);
        }
      } catch (err) {
        // Revert optimistic update
        setPreferences(preferences);
        const errorMessage = err instanceof Error ? err.message : 'Failed to update preferences';
        if (isMountedRef.current) {
          setUpdateError(errorMessage);
        }
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [preferences, saving]
  );

  // Handle push enabled toggle - immediately refresh push registration
  const handlePushEnabledToggle = useCallback(
    async (newValue: boolean) => {
      if (saving || !preferences) return;

      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user?.id) return;

      // Optimistically update UI
      const optimisticPreferences: NotificationPreferences = {
        ...preferences,
        push_enabled: newValue,
      };
      setPreferences(optimisticPreferences);
      setUpdateError(null);

      try {
        setSaving(true);

        // Fetch current preferences to preserve all columns
        const { data: currentData } = await supabaseClient
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        // Prepare update payload
        const updatePayload: Partial<NotificationPreferences> = {
          ...(currentData || {}),
          push_enabled: newValue,
        };

        // Upsert to ensure row exists
        const { error: updateError } = await supabaseClient
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            ...updatePayload,
          }, {
            onConflict: 'user_id',
          });

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Successfully updated - immediately refresh push registration
        try {
          await refreshPushRegistration();
        } catch (refreshError) {
          // Log error but don't fail the UI update - preference was saved successfully
          // Push registration will be re-evaluated on next app restart or sign in
          if (__DEV__) {
            console.error('[NotificationSettings] Failed to refresh push registration:', refreshError);
          }
          // Silently fail - preference update succeeded, push will sync on next session change
        }
      } catch (err) {
        // Revert optimistic update
        setPreferences(preferences);
        const errorMessage = err instanceof Error ? err.message : 'Failed to update preferences';
        if (isMountedRef.current) {
          setUpdateError(errorMessage);
        }
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [preferences, saving, refreshPushRegistration]
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <TopHeader 
          title="Notification Preferences"
          right={<HeaderRightActions />}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error && !preferences) {
    return (
      <View style={styles.container}>
        <TopHeader 
          title="Notification Preferences"
          right={<HeaderRightActions />}
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopHeader title="Notification Preferences" />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Global Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Global Settings</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={styles.settingLabel}>Email notifications</Text>
            </View>
            <Switch
              value={preferences?.email_enabled ?? false}
              onValueChange={handleEmailEnabledToggle}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textInverse}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={styles.settingLabel}>In-app notifications</Text>
            </View>
            <Switch
              value={preferences?.in_app_enabled ?? false}
              onValueChange={handleInAppEnabledToggle}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textInverse}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={styles.settingLabel}>Push notifications</Text>
            </View>
            <Switch
              value={preferences?.push_enabled ?? false}
              onValueChange={handlePushEnabledToggle}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textInverse}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>

        {/* Investor-specific sections */}
        {isInvestor && (
          <>
            {/* Saved Search Matches */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Saved Search Matches</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.email_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    Email
                  </Text>
                </View>
                <Switch
                  value={preferences?.saved_search_match_email ?? false}
                  onValueChange={(value) => handleToggle('saved_search_match_email', value)}
                  disabled={saving || !preferences?.email_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.in_app_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    In-app
                  </Text>
                </View>
                <Switch
                  value={preferences?.saved_search_match_in_app ?? false}
                  onValueChange={(value) => handleToggle('saved_search_match_in_app', value)}
                  disabled={saving || !preferences?.in_app_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Price Drops */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Price Drops</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.email_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    Email
                  </Text>
                </View>
                <Switch
                  value={preferences?.price_drop_email ?? false}
                  onValueChange={(value) => handleToggle('price_drop_email', value)}
                  disabled={saving || !preferences?.email_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.in_app_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    In-app
                  </Text>
                </View>
                <Switch
                  value={preferences?.price_drop_in_app ?? false}
                  onValueChange={(value) => handleToggle('price_drop_in_app', value)}
                  disabled={saving || !preferences?.in_app_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Status Changes */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Status Changes</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.email_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    Email
                  </Text>
                </View>
                <Switch
                  value={preferences?.status_change_email ?? false}
                  onValueChange={(value) => handleToggle('status_change_email', value)}
                  disabled={saving || !preferences?.email_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.in_app_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    In-app
                  </Text>
                </View>
                <Switch
                  value={preferences?.status_change_in_app ?? false}
                  onValueChange={(value) => handleToggle('status_change_in_app', value)}
                  disabled={saving || !preferences?.in_app_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Messages */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>New Messages</Text>
              <View style={styles.infoContainer}>
                <Text style={styles.infoText}>
                  Messages follow global Email/In-app/Push toggles.
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Wholesaler-specific sections */}
        {isWholesaler && (
          <>
            {/* Listing Saved / Buyer Interest */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Listing Saved / Buyer Interest</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text style={styles.settingLabel}>Buyer interest</Text>
                </View>
                <Switch
                  value={preferences?.buyer_interest ?? false}
                  onValueChange={(value) => handleToggle('buyer_interest', value)}
                  disabled={saving}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Lead Messages */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Lead Messages</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text style={styles.settingLabel}>Lead messages</Text>
                </View>
                <Switch
                  value={preferences?.lead_message ?? false}
                  onValueChange={(value) => handleToggle('lead_message', value)}
                  disabled={saving}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Listing Status Changes */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Listing Status Changes</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.email_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    Email
                  </Text>
                </View>
                <Switch
                  value={preferences?.status_change_email ?? false}
                  onValueChange={(value) => handleToggle('status_change_email', value)}
                  disabled={saving || !preferences?.email_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.in_app_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    In-app
                  </Text>
                </View>
                <Switch
                  value={preferences?.status_change_in_app ?? false}
                  onValueChange={(value) => handleToggle('status_change_in_app', value)}
                  disabled={saving || !preferences?.in_app_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Listing Price Changes */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Listing Price Changes</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.email_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    Email
                  </Text>
                </View>
                <Switch
                  value={preferences?.price_drop_email ?? false}
                  onValueChange={(value) => handleToggle('price_drop_email', value)}
                  disabled={saving || !preferences?.email_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Text
                    style={[
                      styles.settingLabel,
                      !preferences?.in_app_enabled && styles.settingLabelDisabled,
                    ]}
                  >
                    In-app
                  </Text>
                </View>
                <Switch
                  value={preferences?.price_drop_in_app ?? false}
                  onValueChange={(value) => handleToggle('price_drop_in_app', value)}
                  disabled={saving || !preferences?.in_app_enabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.textInverse}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>

            {/* Messages */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>New Messages</Text>
              <View style={styles.infoContainer}>
                <Text style={styles.infoText}>
                  Messages follow global Email/In-app/Push toggles.
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Error message */}
        {updateError && (
          <View style={styles.errorMessageContainer}>
            <Text style={styles.errorMessageText}>{updateError}</Text>
          </View>
        )}

        {/* Helper text */}
        <View style={styles.helperContainer}>
          <Text style={styles.helperText}>
            Notifications list is available from the bell on Listings.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colors.danger,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
    backgroundColor: colors.backgroundElevated,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    marginBottom: spacing.md,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  settingLabelContainer: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingLabel: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    fontWeight: typography.fontWeight.normal,
  },
  settingLabelDisabled: {
    color: colors.textTertiary,
  },
  settingSubtext: {
    fontSize: typography.fontSize.sm,
    color: colors.textTertiary,
    marginTop: spacing.xs,
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },
  helperContainer: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  helperText: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },
  infoContainer: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  infoText: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },
  errorMessageContainer: {
    backgroundColor: colors.dangerLight + '20', // 20% opacity
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.dangerLight,
  },
  errorMessageText: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },
});
