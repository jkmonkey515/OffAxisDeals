/**
 * Global typography system
 * Consistent font sizes, weights, and line heights
 */

export const typography = {
  // Font sizes
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
  },

  // Font weights
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

/**
 * Get font size by key
 */
export function getFontSize(key: keyof typeof typography.fontSize): number {
  return typography.fontSize[key];
}

/**
 * Get font weight by key
 */
export function getFontWeight(key: keyof typeof typography.fontWeight): string {
  return typography.fontWeight[key];
}
