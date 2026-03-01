/**
 * Global color theme for Off Axis Deals Mobile
 * Colors extracted from brand logo:
 * - Primary: Deep navy (logo text)
 * - Accent: Muted green (logo arrow)
 * - Background: Very light off-white (logo background tone)
 */

export const colors = {
  // Primary brand colors
  primary: '#1e3a5f', // Deep navy - main brand color
  primaryLight: '#2d4f7a', // Lighter navy for hover states
  primaryDark: '#152a47', // Darker navy for pressed states

  // Accent color
  accent: '#6b8e6b', // Muted green from logo arrow
  accentLight: '#7fa07f',
  accentDark: '#5a7a5a',

  // Background colors
  background: '#fafafa', // Very light off-white
  backgroundElevated: '#ffffff', // White for cards/elevated surfaces

  // Text colors
  text: '#1a1a1a', // Near-black for primary text
  textSecondary: '#666666', // Gray for secondary text
  textTertiary: '#999999', // Light gray for placeholder text
  textInverse: '#ffffff', // White text on dark backgrounds

  // UI element colors
  border: '#e5e5e5', // Light border color
  borderLight: '#f0f0f0', // Very light border
  divider: '#e0e0e0', // Divider lines

  // Semantic colors
  danger: '#FF3B30', // Red for destructive actions
  dangerLight: '#ff6b66',
  dangerDark: '#e62e24',

  success: '#34C759', // Green for success states
  warning: '#FF9500', // Orange for warnings
  info: '#5AC8FA', // Blue for info

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)', // Modal overlay

  // Legacy support (will be phased out)
  legacyBlue: '#007AFF', // Keep for gradual migration
} as const;

export type ColorKey = keyof typeof colors;
