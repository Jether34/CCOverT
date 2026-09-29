import { Router } from 'express';
import { createAuthMiddleware } from '../middleware/auth';
import type { Database } from '../repositories/database';
import { asyncHandler, AppError } from '../utils/errors';
import { sameOriginMiddleware } from '../utils/session';
import { settingsSchema } from '../utils/validation';

export function createSettingsRouter(database: Database): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(database);

  router.patch('/', requireAuth, sameOriginMiddleware, asyncHandler(async (request, response) => {
    const preferences = settingsSchema.parse(request.body);
    const current = await database.findUserById(request.user!.id);
    const updated = await database.updateUser(request.user!.id, { preferences: { ...current?.preferences, ...preferences } });
    if (!updated) throw new AppError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.');
    response.json({ preferences: updated.preferences });
  }));

  return router;
}
