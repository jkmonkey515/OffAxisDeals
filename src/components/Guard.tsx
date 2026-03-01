import React, { ReactNode, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useProfileWithPermissions, has, type PermissionKey } from '../permissions/permissions';
import { qalog } from '../utils/qalog';
import { openExternalUrl } from '../utils/openExternalUrl';
import UpgradeRequired from './UpgradeRequired';

const PRICING_URL = 'https://www.offaxisdeals.com/pricing';

interface GuardProps {
  /**
   * The permission key to check
   */
  permission: PermissionKey;
  /**
   * Content to render if permission is granted
   */
  children: ReactNode;
  /**
   * Optional fallback content to render if permission is denied
   * If not provided, shows default upgrade screen
   */
  fallback?: ReactNode;
}

/**
 * Guard component that conditionally renders children based on permission.
 * 
 * If the user has the required permission, renders children.
 * If not, shows an upgrade screen prompting the user to upgrade.
 * 
 * No analyzer logic or references included.
 */
export default function Guard({ permission, children, fallback }: GuardProps) {
  const { permissions, loading, profile } = useProfileWithPermissions();

  // Show loading state while permissions are being calculated
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  // Check if user has the required permission
  if (has(permissions, permission)) {
    return <>{children}</>;
  }

  // Permission denied - log the reason
  useEffect(() => {
    let denyReason: string;
    
    if (!profile) {
      denyReason = 'missing profile (not signed in)';
    } else {
      // Check if it's a role restriction
      const roleRestrictedPermissions: PermissionKey[] = ['postDeal', 'editOwnDeal', 'deleteOwnDeal'];
      if (roleRestrictedPermissions.includes(permission) && profile.role !== 'wholesaler' && profile.role !== 'admin') {
        denyReason = `role restriction (${profile.role} cannot ${permission})`;
      } else if (!profile.is_paid && !roleRestrictedPermissions.includes(permission)) {
        denyReason = 'unpaid';
      } else {
        denyReason = 'missing permission';
      }
    }
    
    qalog('guard deny', {
      permission,
      reason: denyReason,
      profileId: profile?.id || null,
      role: profile?.role || null,
      isPaid: profile?.is_paid || false,
    });
  }, [permission, profile]);

  // Permission denied - show fallback or default upgrade screen
  if (fallback) {
    return <>{fallback}</>;
  }

  // Determine message based on permission type
  const message =
    permission === 'postDeal' || permission === 'editOwnDeal' || permission === 'deleteOwnDeal'
      ? 'This feature is available to wholesalers. Free wholesalers can post up to 5 active listings. Upgrade to Plus for unlimited listings, plus messaging, contact info, watchlists, heatmap, and filters.'
      : 'This feature requires a Plus subscription. Upgrade to access messaging, contact info, watchlists, heatmap, and filters.';

  // Only show button if user is signed in and not paid
  const showButton = profile && !profile.is_paid;

  return (
    <UpgradeRequired
      message={message}
      onPress={showButton ? () => openExternalUrl(PRICING_URL) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
});
