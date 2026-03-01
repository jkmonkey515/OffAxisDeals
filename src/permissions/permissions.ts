import { useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, Role } from './types';
import { qalog, qaError } from '../utils/qalog';

/**
 * Permission keys for launch-only features.
 * 
 * TODO: analyzer (post-launch)
 */
export type PermissionKey =
  | 'browseListings'
  | 'viewListingDetails'
  | 'postDeal'
  | 'editOwnDeal'
  | 'deleteOwnDeal'
  | 'message'
  | 'saveFavorite'
  | 'watchlists'
  | 'multiImageUpload'
  | 'viewContactInfo'
  | 'useHeatmap'
  | 'advancedFilters'
  | 'adminAccess';

/**
 * Permissions object with all permission keys as boolean values
 */
export type Permissions = {
  [K in PermissionKey]: boolean;
};

/**
 * Calculate permissions based on profile.
 * 
 * Rules:
 * - Signed-in users: browseListings, viewListingDetails = true
 * - Wholesalers (free and paid): can post/edit/delete own deals + multiImageUpload
 *   - Wholesaler Free: max 5 active listings (enforced at submit time)
 *   - Wholesaler Plus: unlimited active listings
 * - If is_paid=false: all Plus permissions false (including message)
 * - If is_paid=true:
 *   - message: true for ALL paid users (investors, wholesalers, admin)
 *   - wholesaler: all Plus features (including message)
 *   - investor: cannot post/edit/delete deals; all Plus features true (including message)
 *   - admin: everything true
 */
export function getPermissions(profile: Profile | null): Permissions {
  // If no profile (not signed in), all permissions are false
  if (!profile) {
    return {
      browseListings: false,
      viewListingDetails: false,
      postDeal: false,
      editOwnDeal: false,
      deleteOwnDeal: false,
      message: false,
      saveFavorite: false,
      watchlists: false,
      multiImageUpload: false,
      viewContactInfo: false,
      useHeatmap: false,
      advancedFilters: false,
      adminAccess: false,
    };
  }

  const { role, is_paid } = profile;

  // isPaid is computed ONLY from profile.is_paid === true
  const isPaid = is_paid === true;

  // Admin users have all permissions
  if (role === 'admin') {
    return {
      browseListings: true,
      viewListingDetails: true,
      postDeal: true,
      editOwnDeal: true,
      deleteOwnDeal: true,
      message: true,
      saveFavorite: true,
      watchlists: true,
      multiImageUpload: true,
      viewContactInfo: true,
      useHeatmap: true,
      advancedFilters: true,
      adminAccess: true,
    };
  }

  // Base permissions for all signed-in users
  const basePermissions: Partial<Permissions> = {
    browseListings: true,
    viewListingDetails: true,
  };

  // If not paid, check role-specific permissions
  if (!isPaid) {
    // Wholesalers (free) can post/edit/delete deals (up to 5 active, enforced at submit)
    if (role === 'wholesaler') {
      return {
        ...basePermissions,
        postDeal: true,
        editOwnDeal: true,
        deleteOwnDeal: true,
        multiImageUpload: true,
        message: false,
        saveFavorite: false,
        watchlists: false,
        viewContactInfo: false,
        useHeatmap: false,
        advancedFilters: false,
        adminAccess: false,
      } as Permissions;
    }
    
    // Free investors and other roles: only base permissions
    return {
      ...basePermissions,
      postDeal: false,
      editOwnDeal: false,
      deleteOwnDeal: false,
      message: false,
      saveFavorite: false,
      watchlists: false,
      multiImageUpload: false,
      viewContactInfo: false,
      useHeatmap: false,
      advancedFilters: false,
      adminAccess: false,
    } as Permissions;
  }

  // Paid users get Plus features
  // message permission is true for ALL paid users (investors, wholesalers, admin)
  const plusPermissions: Partial<Permissions> = {
    saveFavorite: true,
    watchlists: true,
    multiImageUpload: true,
    viewContactInfo: true,
    useHeatmap: true,
    advancedFilters: true,
    message: true, // All paid users can message
  };

  // Role-specific permissions for paid users
  if (role === 'wholesaler') {
    // Paid wholesalers can post/edit/delete their own deals and message
    return {
      ...basePermissions,
      ...plusPermissions,
      postDeal: true,
      editOwnDeal: true,
      deleteOwnDeal: true,
      adminAccess: false,
    } as Permissions;
  }

  // Investors (paid) get Plus features including message, but cannot post/edit/delete deals
  return {
    ...basePermissions,
    ...plusPermissions,
    postDeal: false,
    editOwnDeal: false,
    deleteOwnDeal: false,
    adminAccess: false,
  } as Permissions;
}

/**
 * Check if a specific permission is granted
 */
export function has(permissions: Permissions, key: PermissionKey): boolean {
  return permissions[key];
}

/**
 * Check if profile has a specific role
 */
export function isRole(profile: Profile | null, role: Role): boolean {
  return profile?.role === role;
}

/**
 * Hook that combines profile data with calculated permissions.
 * 
 * Returns:
 * - profile: The user's profile (or null if not signed in)
 * - permissions: Calculated permissions based on profile
 * - loading: Whether profile is still loading
 * - error: Any error that occurred loading the profile
 * 
 * No analyzer logic or fields included - launch keys only.
 */
export function useProfileWithPermissions() {
  const { profile: authProfile, loading, profileLoading, error } = useAuth();
  const previousProfileRef = useRef<Profile | null>(null);

  // Convert AuthContext profile to permissions Profile type
  const profile: Profile | null = useMemo(() => {
    if (!authProfile) {
      return null;
    }

    return {
      id: authProfile.id,
      role: authProfile.role,
      is_paid: authProfile.is_paid ?? false,
    };
  }, [authProfile]);

  // Include profileLoading in loading state so Guard shows loading during retries
  const isLoading = loading || profileLoading;

  // Log auth state changes
  useEffect(() => {
    const previousProfile = previousProfileRef.current;
    const currentProfile = profile;

    // Detect auth state change
    if (previousProfile === null && currentProfile !== null) {
      qalog('auth state changed', {
        event: 'signed in',
        profileId: currentProfile.id,
        role: currentProfile.role,
        isPaid: currentProfile.is_paid,
      });
    } else if (previousProfile !== null && currentProfile === null) {
      qalog('auth state changed', {
        event: 'signed out',
        previousProfileId: previousProfile.id,
      });
    } else if (previousProfile !== null && currentProfile !== null) {
      // Profile updated (e.g., role or is_paid changed)
      if (
        previousProfile.id !== currentProfile.id ||
        previousProfile.role !== currentProfile.role ||
        previousProfile.is_paid !== currentProfile.is_paid
      ) {
        qalog('auth state changed', {
          event: 'profile updated',
          profileId: currentProfile.id,
          role: currentProfile.role,
          isPaid: currentProfile.is_paid,
          previousRole: previousProfile.role,
          previousIsPaid: previousProfile.is_paid,
        });
      }
    }

    previousProfileRef.current = currentProfile;
  }, [profile]);

  // Log profile loaded
  useEffect(() => {
    if (!loading && profile) {
      qalog('profile loaded', {
        profileId: profile.id,
        role: profile.role,
        isPaid: profile.is_paid,
      });
    }
  }, [loading, profile]);

  // Log errors
  useEffect(() => {
    if (error) {
      qaError('profile load error', error);
    }
  }, [error]);

  // Calculate permissions based on profile
  const permissions = useMemo(() => {
    return getPermissions(profile);
  }, [profile]);

  return {
    profile,
    permissions,
    loading: isLoading,
    error,
  };
}

