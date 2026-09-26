import { Router } from 'express';
import type { CreatePredictionResponse, PredictionListResponse } from '@ccovert/shared';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { asyncHandler, badRequest } from '../utils/errors';
import { sameOriginMiddleware } from '../utils/session';
import { createPredictionSchema, downloadQuerySchema, predictionListQuerySchema } from '../utils/validation';
import { predictionService } from '../services/predictions';
import { downloadFileName, renderDownload, toPublicRecord } from '../services/report';
import { db } from '../repositories/database';
import { aiReportService } from '../services/ai';

const idempotencyKeyOf = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const key = value.trim();
  if (key.length === 0) return null;
  if (key.length > 200) return null;
  return key;
};

export function createPredictionsRouter(): Router {
  const router = Router();

  router.post('/', requireVerifiedEmail, sameOriginMiddleware, asyncHandler(async (request, response) => {
    const body = createPredictionSchema.parse(request.body);
    if (request.user!.role === 'user' && (body.sstDatasetId || body.tourismDatasetId)) {
      throw badRequest('Dataset selection is managed by the researcher in the active model configuration');
    }
    const result: CreatePredictionResponse = await predictionService.create({
      userId: request.user!.id,
      request: {
        studyAreaId: body.studyAreaId,
        scope: body.scope,
        profile: body.profile,
        baselineYear: body.baselineYear,
        horizonYears: body.horizonYears,
        coralBaseline: {
          coverPercent: body.coralBaseline.coverPercent,
          year: body.coralBaseline.year,
          hardCoralPercent: body.coralBaseline.hardCoralPercent,
          softCoralPercent: body.coralBaseline.softCoralPercent,
          measure: body.coralBaseline.measure,
          surveySource: body.coralBaseline.surveySource,
          surveyScope: body.coralBaseline.surveyScope,
          sameScopeConfirmed: body.coralBaseline.sameScopeConfirmed
        },
        sstDatasetId: body.sstDatasetId,
        tourismDatasetId: body.tourismDatasetId,
        consentedLocation: body.consentedLocation
          ? {
            latitude: body.consentedLocation.latitude,
            longitude: body.consentedLocation.longitude,
            accuracyMeters: body.consentedLocation.accuracyMeters,
            consentedAt: body.consentedLocation.consentedAt ?? new Date().toISOString(),
            contextOnly: true as const
          }
          : null,
        solver: { substepsPerYear: body.solver.substepsPerYear },
        assumedValues: body.assumedValues
      },
      idempotencyKey: idempotencyKeyOf(request.get('idempotency-key') ?? undefined)
    });
    response.status(result.replayed ? 200 : 201).json(result);
  }));

  router.get('/', requireAuth, asyncHandler(async (request, response) => {
    const { limit } = predictionListQuerySchema.parse(request.query);
    const records = await db.listPredictions(request.user!.id, limit);
    const body: PredictionListResponse = { predictions: records.map(toPublicRecord), total: await db.countPredictions(request.user!.id) };
    response.json(body);
  }));

  router.get('/:id', requireAuth, asyncHandler(async (request, response) => {
    const record = await predictionService.owned(String(request.params.id), request.user!.id);
    response.json({ prediction: toPublicRecord(record) });
  }));

  router.get('/:id/download', requireAuth, asyncHandler(async (request, response) => {
    const { format } = downloadQuerySchema.parse(request.query);
    const record = await predictionService.owned(String(request.params.id), request.user!.id);
    const { body, contentType } = renderDownload(record, format);
    response.type(contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${downloadFileName(record, format)}"`);
    response.send(body);
  }));

  router.get('/:id/reports', requireAuth, asyncHandler(async (request, response) => {
    const reports = await aiReportService.listForPrediction(String(request.params.id), request.user!.id);
    response.json({ reports });
  }));

  return router;
}
