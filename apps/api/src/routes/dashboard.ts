import { Router } from 'express';
import { STUDY_AREA, type DashboardResponse } from '@ccovert/shared';
import { createAuthMiddleware } from '../middleware/auth';
import type { Database } from '../repositories/database';
import { asyncHandler } from '../utils/errors';
import { CONDITION_CONVENTION, PAPER_CONFLICTS, SOLVER_DEFAULTS } from '@ccovert/shared';
import { modelConfigService } from '../services/modelConfigService';
import { modelClient } from '../services/modelClient';
import { toPublicRecord } from '../services/report';
import { db } from '../repositories/database';
import { logger } from '../logger';

export function createDashboardRouter(database: Database): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(database);

  router.get('/', requireAuth, asyncHandler(async (request, response) => {
    const userId = request.user!.id;
    const readiness = await modelConfigService.readiness();
    const { parameters, missing } = readiness;
    const active = await modelConfigService.getActive();
    const paperReadiness = await modelConfigService.paperReadiness(active);
    const serviceAvailable = await modelClient.isAvailable();
    // Versions are reported only when the model service actually answered, so
    // the dashboard can never claim a version the service did not confirm.
    let equationVersion: string | null = null;
    let modelVersion: string | null = null;
    if (serviceAvailable) {
      try {
        const metadata = await modelClient.fetchMetadata();
        equationVersion = metadata.equationVersion;
        modelVersion = metadata.modelVersion;
      } catch (error) {
        logger.debug('Model metadata unavailable for the dashboard', { error: error instanceof Error ? error.message : 'unknown' });
      }
    }
    const [predictionCount, aiReportCount, datasetCount] = await Promise.all([
      // This is a saved-run count, not a validated-finding count. Refused,
      // demo, scenario, and paper-reproduction attempts remain visible in the
      // user's history and must be reflected in the dashboard counter.
      db.countPredictions(userId),
      db.countAiReports(userId),
      database.listDatasets({}).then((records) => records.length)
    ]);
    // The snapshot shows the user's most recent runs of any kind, including
    // exploratory ones, so an assumption is never hidden by the validated count.
    const records = await db.listPredictions(userId, 5);

    const body: DashboardResponse = {
      today: new Date().toISOString().slice(0, 10),
      studyArea: STUDY_AREA,
      locationStatus: {
        studyAreaConfirmed: true,
        consentedLocation: records.find((record) => record.request.consentedLocation)?.request.consentedLocation ?? null,
        siteLevelForecastAvailable: false as const,
        message: 'The paper model is citywide. A consented location is stored as context only and never used as a model input.'
      },
      predictionCount,
      aiReportCount,
      datasetCount,
      latestPrediction: records[0] ? toPublicRecord(records[0]) : null,
      historySnapshot: records.map(toPublicRecord),
      modelStatus: {
        service: serviceAvailable ? 'available' : 'unavailable',
        configured: paperReadiness.ready,
        equationVersion,
        modelVersion,
        activeModelConfigVersion: readiness.version,
        missingParameters: missing.map((parameter) => ({
          key: parameter.key,
          reason: parameter.status === 'unspecified-in-paper' ? 'Not specified in the paper' : 'No value has been configured',
          requiredBy: 'The published equation',
          note: parameter.notes
        })),
        provisionalParameters: readiness.provisional,
        unreviewedParameters: parameters.filter((parameter) => parameter.reviewStatus !== 'reviewed').map((parameter) => parameter.key),
        disputedParameters: parameters.filter((parameter) => parameter.reviewStatus === 'disputed').map((parameter) => parameter.key),
        dataGaps: paperReadiness.reasons,
        activeProfile: readiness.profile,
        demoProfileAvailable: await modelConfigService.demoAvailable(),
        scenarioProfileAvailable: true as const,
        conditionConvention: CONDITION_CONVENTION,
        solver: active?.solver ?? SOLVER_DEFAULTS,
        studyArea: STUDY_AREA,
        paperConflicts: PAPER_CONFLICTS,
        message: !paperReadiness.ready
          ? 'Paper profile not configured: missing, provisional, or unreviewed research inputs remain.'
          : 'All parameter values are present and reviewed; confirm source datasets and independent validation separately.'
      },
      emailVerified: request.user!.emailVerified
    };
    response.json(body);
  }));

  return router;
}
