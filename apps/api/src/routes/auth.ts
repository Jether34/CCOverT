import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { AuthResponse, UserRole } from '@ccovert/shared';
import { config } from '../config';
import { createAuthMiddleware } from '../middleware/auth';
import type { Database, UserRecord } from '../repositories/database';
import { isDuplicateKeyError } from '../repositories/database';
import { AppError, asyncHandler } from '../utils/errors';
import { tokenHash, verificationToken } from '../utils/crypto';
import { clearSessionCookie, requireSameOrigin, setSessionCookie } from '../utils/session';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/mailer';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema, verifySchema } from '../utils/validation';
import { publicUser } from '../utils/user';
import { logger } from '../logger';

const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;
const RESET_TTL_MS = 1000 * 60 * 60;

const roleForEmail = (email: string): UserRole => {
  if (config.bootstrapAdminEmails.includes(email)) return 'admin';
  if (config.bootstrapResearcherEmails.includes(email)) return 'researcher';
  return 'user';
};

export function createAuthRouter(database: Database): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(database);

  router.post('/signup', asyncHandler(async (request, response) => {
    requireSameOrigin(request);
    const input = signupSchema.parse(request.body);
    if (await database.findUserByEmail(input.email)) {
      throw new AppError(409, 'EMAIL_IN_USE', 'An account with that email already exists');
    }
    const token = verificationToken();
    let user: UserRecord;
    try {
      user = await database.createUser({
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        emailVerified: false,
        role: roleForEmail(input.email)
      });
      await database.createToken({
        userId: user._id,
        purpose: 'email-verification',
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS)
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new AppError(409, 'EMAIL_IN_USE', 'An account with that email already exists');
      throw error;
    }
    const verificationUrl = `${config.appUrl.replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}`;
    try {
      const delivery = await sendVerificationEmail(user.email, verificationUrl);
      setSessionCookie(response, user._id);
      const result: AuthResponse = { user: publicUser(user), verificationRequired: true };
      if (delivery === 'development-only' && !config.isProduction) result.developmentVerificationUrl = verificationUrl;
      response.status(201).json(result);
    } catch (error) {
      await database.deleteUser(user._id);
      throw error;
    }
  }));

  router.post('/verify', asyncHandler(async (request, response) => {
    requireSameOrigin(request);
    const { token } = verifySchema.parse(request.body);
    const record = await database.findTokenByHash(tokenHash(token), 'email-verification');
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
      throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'The verification link is invalid or has expired');
    }
    await database.consumeToken(record._id);
    const updated = await database.updateUser(record.userId, { emailVerified: true });
    if (!updated) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'The verification link is invalid or has expired');
    setSessionCookie(response, updated._id);
    response.json({ user: publicUser(updated), verified: true });
  }));

  router.post('/login', asyncHandler(async (request, response) => {
    requireSameOrigin(request);
    const input = loginSchema.parse(request.body);
    const user = await database.findUserByEmail(input.email);
    if (!user || user.disabledAt || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    setSessionCookie(response, user._id);
    response.json({ user: publicUser(user) });
  }));

  router.post('/logout', asyncHandler(async (request, response) => {
    requireSameOrigin(request);
    clearSessionCookie(response);
    response.status(204).send();
  }));

  /**
   * Always answers the same way so the endpoint cannot be used to discover
   * which email addresses have accounts.
   */
  router.post('/forgot-password', asyncHandler(async (request, response) => {
    requireSameOrigin(request);
    const { email } = forgotPasswordSchema.parse(request.body);
    const user = await database.findUserByEmail(email);
    if (user) {
      const token = verificationToken();
      await database.invalidateTokensForUser(user._id, 'password-reset');
      await database.createToken({
        userId: user._id,
        purpose: 'password-reset',
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS)
      });
      const url = `${config.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
      const delivery = await sendPasswordResetEmail(user.email, url);
      logger.info('Issued a password reset link', { userId: user._id, delivery });
    }
    response.status(202).json({ accepted: true });
  }));

  router.post('/reset-password', asyncHandler(async (request, response) => {
    requireSameOrigin(request);
    const input = resetPasswordSchema.parse(request.body);
    const record = await database.findTokenByHash(tokenHash(input.token), 'password-reset');
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
      throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'The password reset link is invalid or has expired');
    }
    await database.consumeToken(record._id);
    await database.updateUser(record.userId, { passwordHash: await bcrypt.hash(input.password, 12) });
    await database.invalidateTokensForUser(record.userId, 'email-verification');
    logger.info('Reset a password', { userId: record.userId });
    response.json({ reset: true });
  }));

  router.get('/me', requireAuth, asyncHandler(async (request, response) => {
    const user = await database.findUserById(request.user!.id);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your session is no longer valid');
    response.json({ user: publicUser(user) });
  }));

  return router;
}
