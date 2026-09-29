import { Router } from 'express';
import type { CreatePredictionResponse, PredictionListResponse } from '@ccovert/shared';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError, asyncHandler, badRequest, errorMessage } from '../utils/errors';
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
    const isClientUser = request.user!.role === 'client' || request.user!.role === 'user';
    const profile = body.profile;
    const forecastEndYear = body.forecastEndYear ?? body.baselineYear + body.horizonYears;
    const horizonYears = forecastEndYear - body.baselineYear;
    const predictionRequest = {
      userId: request.user!.id,
      request: {
        studyAreaId: body.studyAreaId,
        scope: body.scope,
        profile,
        baselineYear: body.baselineYear,
        predictionStartYear: body.baselineYear,
        horizonYears,
        forecastEndYear,
        coralBaseline: {
          coverPercent: body.coralBaseline.coverPercent,
          year: body.coralBaseline.year,
          hardCoralPercent: body.coralBaseline.hardCoralPercent,
          softCoralPercent: body.coralBaseline.softCoralPercent,
          measure: body.coralBaseline.measure,
          surveySource: body.coralBaseline.surveySource,
          surveyMethod: body.coralBaseline.surveyMethod,
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
    };
    try {
      if (isClientUser && (body.sstDatasetId || body.tourismDatasetId)) {
        throw badRequest('Dataset selection is managed by the researcher in the active model configuration');
      }
      if (isClientUser && body.profile !== 'paper-reproduction') {
        const configured = await db.findActiveModelConfig();
        const configuredEndYear = configured ? configured.baselineYear + configured.horizonYears : null;
        const withinWindow = configured && configuredEndYear !== null
          && body.baselineYear >= configured.baselineYear
          && body.baselineYear < configuredEndYear
          && forecastEndYear <= configuredEndYear;
        if (!configured || !withinWindow || body.coralBaseline.coverPercent !== configured.initialCoverPercent || body.coralBaseline.year !== configured.initialCoverYear) {
          throw badRequest('This profile requires a coral-cover baseline and forecast window supplied by the active researcher configuration. Select a configured start year and a forecast end year within that profile.', 'PROFILE_FORECAST_WINDOW_INVALID');
        }
      }
      const result: CreatePredictionResponse = await predictionService.create(predictionRequest);
      response.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const failed = await predictionService.recordFailure({
        userId: predictionRequest.userId,
        request: predictionRequest.request,
        idempotencyKey: predictionRequest.idempotencyKey,
        reason: error instanceof AppError ? error.message : 'The prediction service could not complete this run.'
      });
      const appError = error instanceof AppError ? error : null;
      response.status(appError?.status ?? 502).json({
        error: {
          code: appError?.code ?? 'MODEL_SERVICE_ERROR',
          message: appError ? errorMessage(appError) : 'The prediction service could not complete this run.',
          requestId: request.requestId
        },
        prediction: toPublicRecord(failed)
      });
    }
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
