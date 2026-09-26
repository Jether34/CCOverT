import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@ccovert/shared';
import { config } from '../config';
import { db, type Database } from '../repositories/database';
import { AppError, forbidden, unauthorized } from '../utils/errors';
import { readSessionToken } from '../utils/session';

export function createAuthMiddleware(database: Database) {
  const requireAuth = async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = readSessionToken(request.cookies?.[config.sessionCookieName] as string | undefined);
      if (!userId) throw unauthorized('Sign in is required');
      const user = await database.findUserById(userId);
      if (!user || user.disabledAt) throw unauthorized('Your session is no longer valid');
      request.user = {
        id: user._id,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        preferences: user.preferences,
        createdAt: user.createdAt
      };
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireVerified = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    await requireAuth(request, response, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      if (!request.user?.emailVerified) {
        next(new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before using this feature'));
        return;
      }
      next();
    });
  };

  const requireRole = (...roles: UserRole[]) => async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    await requireAuth(request, response, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      const role = request.user?.role;
      if (!role || !roles.includes(role)) {
        next(forbidden(`This action requires one of: ${roles.join(', ')}`));
        return;
      }
      next();
    });
  };

  return { requireAuth, requireVerified, requireRole };
}

/** Exported singleton-style middleware bound to the shared database instance. */
export const requireAuth = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = readSessionToken(request.cookies?.[config.sessionCookieName] as string | undefined);
    if (!userId) throw unauthorized('Sign in is required');
    const user = await db.findUserById(userId);
    if (!user || user.disabledAt) throw unauthorized('Your session is no longer valid');
    request.user = {
      id: user._id,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      preferences: user.preferences,
      createdAt: user.createdAt
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireVerifiedEmail = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  await requireAuth(request, response, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    if (!request.user?.emailVerified) {
      next(new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before using this feature'));
      return;
    }
    next();
  });
};

export const requireRole = (...roles: UserRole[]) => async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  await requireAuth(request, response, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    const role = request.user?.role;
    if (!role || !roles.includes(role)) {
      next(forbidden(`This action requires one of: ${roles.join(', ')}`));
      return;
    }
    next();
  });
};
