/**
 * Returns true only if debug features should be enabled.
 * Requires BOTH __DEV__ to be true AND explicit environment variable.
 * This ensures debug features are never visible in production builds.
 */
export function isDebugQAEnabled(): boolean {
  return __DEV__ === true && process.env.EXPO_PUBLIC_SHOW_DEBUG_QA === 'true';
}
