/**
 * QA logging utility for debugging and testing.
 * All logs are prefixed with [QA] for easy filtering.
 * 
 * In production builds (__DEV__ === false), these functions are no-ops.
 */

/**
 * Log an event with optional data
 * No-op in production builds
 */
export function qalog(event: string, data?: Record<string, unknown>): void {
  if (!__DEV__) {
    return;
  }
  if (data) {
    console.log(`[QA] ${event}`, data);
  } else {
    console.log(`[QA] ${event}`);
  }
}

/**
 * Log a normalized error string
 * No-op in production builds
 */
export function qaError(event: string, err: unknown): void {
  if (!__DEV__) {
    return;
  }
  let errorMessage: string;
  
  if (err instanceof Error) {
    errorMessage = err.message;
  } else if (typeof err === 'string') {
    errorMessage = err;
  } else if (err && typeof err === 'object' && 'message' in err) {
    errorMessage = String(err.message);
  } else {
    errorMessage = 'Unknown error';
  }
  
  console.error(`[QA] ${event}`, { error: errorMessage });
}

