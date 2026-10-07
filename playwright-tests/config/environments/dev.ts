/**
 * Optional environment profile.
 *
 * Values that vary between environments should normally be supplied through .env
 * or CI variables. This file exists as a stable extension point for teams that
 * later introduce profile-specific configuration.
 */
export const devEnvironment = {
  name: 'dev',
} as const;
