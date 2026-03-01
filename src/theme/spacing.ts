/**
 * Global spacing scale for consistent layout
 * Based on 4px base unit
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export type SpacingKey = keyof typeof spacing;

/**
 * Get spacing value by key
 */
export function getSpacing(key: SpacingKey): number {
  return spacing[key];
}
