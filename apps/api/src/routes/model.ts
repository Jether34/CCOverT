import { Router } from 'express';
import {
  CONDITION_CONVENTION,
  PAPER_CONFLICTS,
  PAPER_PARAMETERS,
  SOLVER_DEFAULTS,
  STUDY_AREA,
  type ModelStatus
} from '@ccovert/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, notConfigured } from '../utils/errors';
import { sameOriginMiddleware } from '../utils/session';
import { createModelConfigSchema } from '../utils/validation';
import { modelConfigService } from '../services/modelConfigService';
import { modelClient } from '../services/modelClient';
import { config } from '../config';
import { logger } from '../logger';

const requiredBy: Record<string, string> = {
  alpha: 'Thermal mortality term (unspecified in the paper)',
  g: 'Tourism pressure term (unspecified in the paper)',
  r: 'Intrinsic growth term',
  beta: 'Tourism mortality coefficient',
  gamma: 'Sea-surface temperature trend',
  T0: 'Baseline sea-surface temperature',
  Tcrit: 'Thermal stress threshold',
  V0: 'Baseline annual tourist arrivals',
  K: 'Carrying capacity'
};

export function createModelRouter(): Router {
  const router = Router();

  const buildStatus = async (): Promise<ModelStatus> => {
    const readiness = await modelConfigService.readiness();
    const { parameters, missing } = readiness;
    const serviceAvailable = await modelClient.isAvailable();
    let equationVersion: string | null = null;
    let modelVersion: string | null = null;
    if (serviceAvailable) {
      try {
        const metadata = await modelClient.fetchMetadata();
        equationVersion = metadata.equationVersion;
        modelVersion = metadata.modelVersion;
      } catch (error) {
        logger.debug('Model metadata unavailable', { error: error instanceof Error ? error.message : 'unknown' });
      }
    }
    return {
      service: serviceAvailable ? 'available' : 'unavailable',
      configured: missing.length === 0,
      equationVersion,
      modelVersion,
      activeModelConfigVersion: readiness.version,
      missingParameters: missing.map((parameter) => ({
        key: parameter.key,
        reason: parameter.status === 'unspecified-in-paper'
          ? 'Not specified in the paper'
          : 'No value has been configured',
        requiredBy: requiredBy[parameter.key] ?? 'The published equation',
        note: parameter.notes
      })),
      provisionalParameters: readiness.provisional,
      activeProfile: readiness.profile,
      demoProfileAvailable: await modelConfigService.demoAvailable(),
      // Scenario runs are available to any signed-in user; no env switch gates
      // them because the result is permanently labelled as an assumption.
      scenarioProfileAvailable: true as const,
      conditionConvention: CONDITION_CONVENTION,
      solver: SOLVER_DEFAULTS,
      studyArea: STUDY_AREA,
      paperConflicts: PAPER_CONFLICTS,
      message: missing.length > 0
        ? `The model is not configured: ${missing.map((parameter) => parameter.key).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no value. Import a cited dataset and create a model configuration version to enable it.`
        : serviceAvailable
          ? 'The model is configured and the internal model service is reachable.'
          : 'The model is configured but the internal model service is not reachable right now.'
    };
  };

  router.get('/status', asyncHandler(async (_request, response) => {
    response.json({ status: await buildStatus() });
  }));

  router.get('/conditions', (_request, response) => {
    response.json({ convention: CONDITION_CONVENTION, paper: PAPER_CONFLICTS });
  });

  router.get('/parameters', asyncHandler(async (_request, response) => {
    const active = await modelConfigService.getActive();
    response.json({
      activeVersion: active?.version ?? null,
      parameters: active?.parameters ?? PAPER_PARAMETERS,
      solver: active?.solver ?? SOLVER_DEFAULTS
    });
  }));

  router.get('/versions', requireAuth, asyncHandler(async (_request, response) => {
    response.json({ versions: await modelConfigService.list(50) });
  }));

  router.post('/versions', requireRole('researcher'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const input = createModelConfigSchema.parse(request.body);
    const record = await modelConfigService.createVersion({
      baseVersion: input.baseVersion,
      changes: input.changes as Record<string, number>,
      notes: input.notes,
      effectiveDate: input.effectiveDate ?? null,
      reviewStatus: input.reviewStatus,
      createdById: request.user!.id,
      createdByLabel: request.user!.email,
      sourceDatasetIds: input.sourceDatasetIds as Record<string, string> | undefined,
      sstDatasetId: input.sstDatasetId,
      tourismDatasetId: input.tourismDatasetId
    });
    response.status(201).json({ version: record });
  }));

  router.post('/versions/:id/activate', requireRole('researcher'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const record = await modelConfigService.activate(String(request.params.id), request.user!.email);
    response.json({ version: record });
  }));

  router.delete('/versions/:id', requireRole('researcher'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    await modelConfigService.archive(String(request.params.id));
    response.status(204).send();
  }));

  router.get('/demo-availability', asyncHandler(async (_request, response) => {
    if (!config.model.allowDemoProfile) {
      throw notConfigured('MODEL_PARAMETERS_NOT_CONFIGURED', 'The synthetic demo profile is disabled on this environment');
    }
    response.json({ available: true, warning: 'DEMO values are synthetic and must never be cited as findings.' });
  }));

  return router;
}
