/**
 * Centralized development-mode flags for server-side code.
 * Gate ALL dev-only console logs and schema checks behind these flags.
 *
 * Usage:
 *   import { IS_DEV, DEV_VERBOSE } from '../utils/devFlags';
 *   if (IS_DEV) { console.log('[DEBUG] ...'); }
 *
 * These flags are evaluated at module load time from NODE_ENV.
 * In production builds, dead-code elimination will remove guarded blocks.
 */

export const NODE_ENV = process.env.NODE_ENV ?? 'development';

/** True in development, false in production */
export const IS_DEV = NODE_ENV === 'development';

/** True in production */
export const IS_PROD = NODE_ENV === 'production';

/**
 * Verbose development logging - set DEV_VERBOSE=true to enable extra debug output.
 * Defaults to false even in development to keep logs manageable.
 */
export const DEV_VERBOSE = IS_DEV && process.env.DEV_VERBOSE === 'true';
