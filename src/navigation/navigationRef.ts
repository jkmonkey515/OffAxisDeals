import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Global navigation ref for out-of-tree event routing (e.g., push notification taps).
 *
 * We intentionally keep this untyped (`any`) because the root navigator can be either
 * AuthStack or AppStack depending on session state.
 */
export const navigationRef = createNavigationContainerRef<any>();

