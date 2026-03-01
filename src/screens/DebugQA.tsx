import * as Sentry from '@sentry/react-native';
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useProfileWithPermissions, type PermissionKey } from '../permissions/permissions';
import { supabaseClient } from '../lib/supabase';
import { SUPABASE_URL } from '../config/env';

interface DebugQAProps {
  navigation: {
    navigate: (screen: string, params?: { listingId?: string }) => void;
  };
}

export default function DebugQA({ navigation }: DebugQAProps) {
  const { user, profile, refreshProfile } = useAuth();
  const { permissions } = useProfileWithPermissions();
  const [firstListingId, setFirstListingId] = useState<string | null>(null);
  const [loadingListing, setLoadingListing] = useState(false);
  const [sendingTestPush, setSendingTestPush] = useState(false);
  const [testPushResult, setTestPushResult] = useState<string | null>(null);

  useEffect(() => {
    loadFirstListingId();
  }, []);

  const loadFirstListingId = async () => {
    setLoadingListing(true);
    try {
      // Try to get first listing ID (adjust table name if different)
      const { data, error } = await supabaseClient
        .from('listings')
        .select('id')
        .limit(1)
        .single();

      if (!error && data?.id) {
        setFirstListingId(data.id);
      } else {
        setFirstListingId(null);
      }
    } catch (err) {
      setFirstListingId(null);
    } finally {
      setLoadingListing(false);
    }
  };

  const handleRefreshProfile = async () => {
    await refreshProfile();
  };

  const handleSignOut = async () => {
    await supabaseClient.auth.signOut();
  };

  const handleGoToListings = () => {
    // Navigate to main Tabs navigator (Listings tab is the default)
    navigation.navigate('Tabs');
  };

  const handleGoToListingDetails = () => {
    if (firstListingId) {
      navigation.navigate('ListingDetails', { listingId: firstListingId });
    }
  };

  const handleGoToPostDeal = () => {
    navigation.navigate('PostDeal');
  };

  const handleGoToMessages = () => {
    navigation.navigate('Messaging');
  };

  const handleGoToWatchlists = () => {
    navigation.navigate('Watchlists');
  };

  const handleGoToHeatmap = () => {
    navigation.navigate('Heatmap');
  };

  const handleSendTestPush = async () => {
    if (sendingTestPush) return;

    setSendingTestPush(true);
    setTestPushResult(null);

    try {
      // Get current session token
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      
      if (sessionError || !session?.access_token) {
        setTestPushResult('Error: Not authenticated. Please sign in.');
        return;
      }

      // Call test-push Edge Function
      const response = await fetch(`${SUPABASE_URL}/functions/v1/test-push`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (result.ok) {
        const deviceText = result.devicesCount > 1 ? ` (${result.devicesCount} devices)` : '';
        setTestPushResult(`✓ Success: Sent to ${result.successCount} device(s)${deviceText}`);
      } else {
        setTestPushResult(`✗ Error: ${result.error || 'Failed to send test push'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setTestPushResult(`✗ Exception: ${errorMessage}`);
    } finally {
      setSendingTestPush(false);
    }
  };

  // Convert permissions object to array for display
  const permissionsList: Array<{ key: PermissionKey; value: boolean }> = Object.entries(permissions).map(
    ([key, value]) => ({
      key: key as PermissionKey,
      value: value as boolean,
    })
  );

  // Check if dev-only features should be shown
  const showDevFeatures = __DEV__ && process.env.EXPO_PUBLIC_SHOW_DEBUG_QA === 'true';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Debug & QA</Text>

      {/* Auth User Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Auth User</Text>
        {user ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>ID:</Text>
              <Text style={styles.value}>{user.id}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Email:</Text>
              <Text style={styles.value}>{user.email || 'N/A'}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.value}>signed out</Text>
        )}
      </View>

      {/* Profile Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        {profile ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>ID:</Text>
              <Text style={styles.value}>{profile.id}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Role:</Text>
              <Text style={styles.value}>{profile.role}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>is_paid:</Text>
              <Text style={styles.value}>{profile.is_paid ? 'true' : 'false'}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.value}>No profile loaded</Text>
        )}
      </View>

      {/* Permissions List */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Derived Permissions</Text>
        {permissionsList.map(({ key, value }) => (
          <View key={key} style={styles.row}>
            <Text style={styles.label}>{key}:</Text>
            <Text style={[styles.value, value ? styles.valueTrue : styles.valueFalse]}>
              {value ? 'true' : 'false'}
            </Text>
          </View>
        ))}
      </View>

      {/* Action Buttons */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>

        <TouchableOpacity style={styles.button} onPress={handleRefreshProfile}>
          <Text style={styles.buttonText}>Refresh Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleGoToListings}>
          <Text style={styles.buttonText}>Go to Listings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, !firstListingId && styles.buttonDisabled]}
          onPress={handleGoToListingDetails}
          disabled={!firstListingId}
        >
          <Text style={styles.buttonText}>
            {loadingListing ? 'Loading...' : firstListingId ? 'Go to Listing Details' : 'No listings available'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleGoToPostDeal}>
          <Text style={styles.buttonText}>Go to Post Deal</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleGoToMessages}>
          <Text style={styles.buttonText}>Go to Messages</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleGoToWatchlists}>
          <Text style={styles.buttonText}>Go to Watchlists</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleGoToHeatmap}>
          <Text style={styles.buttonText}>Go to Heatmap</Text>
        </TouchableOpacity>

        {/* Dev-only: Send Test Push */}
        {showDevFeatures && (
          <>
            <TouchableOpacity
              style={[styles.button, sendingTestPush && styles.buttonDisabled]}
              onPress={handleSendTestPush}
              disabled={sendingTestPush}
            >
              <Text style={styles.buttonText}>
                {sendingTestPush ? 'Sending...' : 'Send Test Push'}
              </Text>
            </TouchableOpacity>
            {testPushResult && (
              <Text style={[
                styles.testPushResult,
                testPushResult.startsWith('✓') ? styles.testPushResultSuccess : styles.testPushResultError
              ]}>
                {testPushResult}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.button, styles.buttonDanger]}
              onPress={() => {
                Sentry.captureException(new Error('Sentry test error from Debug QA (intentional)'));
              }}
            >
              <Text style={styles.buttonText}>Trigger Sentry test error</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={handleSignOut}>
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#000',
  },
  section: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#000',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    width: 120,
    color: '#333',
  },
  value: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  valueTrue: {
    color: '#34C759',
    fontWeight: '600',
  },
  valueFalse: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  buttonDanger: {
    backgroundColor: '#FF3B30',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  testPushResult: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 4,
    lineHeight: 18,
  },
  testPushResultSuccess: {
    color: '#34C759',
  },
  testPushResultError: {
    color: '#FF3B30',
  },
});
