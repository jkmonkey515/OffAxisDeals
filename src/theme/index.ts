/**
 * Global theme system
 * Central export for all theme values
 */

export * from './colors';
export * from './spacing';
export * from './typography';

import { colors } from './colors';
import { spacing } from './spacing';
import { typography } from './typography';

/**
 * Complete theme object
 */
export const theme = {
  colors,
  spacing,
  typography,
} as const;

export default theme;
