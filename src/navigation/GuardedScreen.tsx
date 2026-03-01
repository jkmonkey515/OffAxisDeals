import React, { ComponentType } from 'react';
import Guard from '../components/Guard';
import type { PermissionKey } from '../permissions/permissions';

interface GuardedScreenProps {
  component: ComponentType<any>;
  permission?: PermissionKey;
}

/**
 * Higher-order component that wraps a screen with Guard if a permission is required.
 * If no permission is provided, the screen is always accessible (after login).
 */
export function GuardedScreen({ component: Component, permission }: GuardedScreenProps) {
  if (permission) {
    return (
      <Guard permission={permission}>
        <Component />
      </Guard>
    );
  }

  // No permission required - render directly
  return <Component />;
}

