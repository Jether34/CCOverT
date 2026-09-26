import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, badRequest } from '../utils/errors';
import { sameOriginMiddleware } from '../utils/session';
import { idSchema } from '../utils/validation';
import { deleteUpload, listUploads, storeUpload } from '../services/uploads';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: 1 }
});

export function createUploadsRouter(): Router {
  const router = Router();

  router.get('/', requireAuth, asyncHandler(async (request, response) => {
    response.json({ uploads: await listUploads(request.user!.id) });
  }));

  router.post('/', requireAuth, sameOriginMiddleware, upload.single('file'), asyncHandler(async (request, response) => {
    if (!request.file) throw badRequest('Choose a PDF, TXT, CSV, or JSON file to upload');
    const record = await storeUpload(request.file, request.user!.id);
    response.status(201).json({ upload: record });
  }));

  router.delete('/:id', requireAuth, sameOriginMiddleware, asyncHandler(async (request, response) => {
    await deleteUpload(idSchema.parse(request.params.id), request.user!.id);
    response.status(204).send();
  }));

  return router;
}
