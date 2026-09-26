import type { User, UserPreferences } from '@ccovert/shared';
import type { UserRecord } from '../repositories/database';

export const defaultPreferences = (): UserPreferences => ({ theme: 'light', language: 'en' });

/** Strips every internal field before a user record crosses the API boundary. */
export const publicUser = (user: UserRecord): User => ({
  id: user._id,
  email: user.email,
  emailVerified: user.emailVerified,
  role: user.role,
  preferences: user.preferences ?? defaultPreferences(),
  createdAt: user.createdAt
});
