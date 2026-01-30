/**
 * Centralized development-mode flags for client-side code.
 * Gate ALL dev-only console logs and schema checks behind these flags.
 *
 * Usage:
 *   import { IS_DEV, DEV_VERBOSE } from '@/lib/devFlags';
 *   if (IS_DEV) { console.log('[DEBUG] ...'); }
 *
 * Vite replaces process.env.NODE_ENV at build time. In production builds,
 * dead-code elimination will remove IS_DEV-guarded blocks.
 */

/** True in development, false in production */
export const IS_DEV = process.env.NODE_ENV === 'development';

/** True in production */
export const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Verbose development logging - set VITE_DEV_VERBOSE=true to enable extra debug output.
 * Defaults to false even in development to keep console manageable.
 */
export const DEV_VERBOSE = IS_DEV && import.meta.env.VITE_DEV_VERBOSE === 'true';
