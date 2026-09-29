import { z } from 'zod';
import {
  AI_NOT_CONFIGURED,
  AI_PROVIDER_UNAVAILABLE,
  MODEL_SERVICE_UNAVAILABLE,
  type ApiErrorCode,
  type ConsentedLocation
} from '@ccovert/shared';
import { config, aiProviderConfigured } from '../config';
import { logger } from '../logger';
import { AppError, notConfigured, unavailable, unprocessable } from '../utils/errors';

/* -------------------------------------------------------------------------- */
/* shared low-level http helper                                                */
/* -------------------------------------------------------------------------- */

export interface UpstreamResult {
  status: number;
  ok: boolean;
  body: unknown;
}

export const upstreamUnavailable = (code: ApiErrorCode, message: string, cause: string): AppError => {
  logger.warn(message, { upstream: cause });
  return unavailable(code, message);
};

export async function callUpstream(input: {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  label: string;
}): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: input.method ?? 'GET',
      headers: { accept: 'application/json', ...(input.body ? { 'content-type': 'application/json' } : {}), ...input.headers },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 500) };
      }
    }
    return { status: response.status, ok: response.ok, body: parsed };
  } catch (error) {
    const reason = error instanceof Error ? error.name === 'AbortError' ? 'timeout' : error.message : 'unknown';
    throw new AppError(504, 'UPSTREAM_TIMEOUT' as ApiErrorCode, `${input.label} did not respond within ${input.timeoutMs}ms`, {
      details: reason,
      expose: true
    });
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* model service (python)                                                      */
/* -------------------------------------------------------------------------- */

const annualPointSchema = z.object({
  year: z.number(),
  tYears: z.number(),
  coverStartPercent: z.number(),
  coverEndPercent: z.number(),
  coverIntervalMeanPercent: z.number(),
  temperatureStartC: z.number(),
  temperatureEndC: z.number(),
  tourismStartArrivals: z.number(),
  tourismEndArrivals: z.number(),
  tourismGrowthRate: z.number().default(0),
  tourismPeriodStartYear: z.number().int().nullable().default(null),
  tourismPeriodEndYear: z.number().int().nullable().default(null),
  growthRateMean: z.number(),
  thermalRateMean: z.number(),
  tourismRateMean: z.number(),
  growthContributionPp: z.number(),
  thermalContributionPp: z.number(),
  tourismContributionPp: z.number(),
  stateClassification: z.string().nullable(),
  meanClassification: z.string().nullable()
});

const conditionBandSchema = z.object({
  label: z.string(),
  minPercent: z.number(),
  maxPercent: z.number(),
  upperInclusive: z.boolean()
});

const conditionConventionSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
  bands: z.array(conditionBandSchema)
});

const solverSchema = z.object({
  method: z.string().min(1),
  substepsPerYear: z.number().int().positive(),
  intervalMeanQuadrature: z.string().min(1),
  stateOutput: z.string().min(1),
  notes: z.string()
});

const sourceRecordSchema = z.object({
  name: z.string(),
  source: z.string(),
  unit: z.string(),
  timeWindow: z.string(),
  coverage: z.string().nullable(),
  scope: z.string().nullable(),
  datasetId: z.string().nullable(),
  retrievedAt: z.string().nullable()
});

/** Parameter manifest entries, as returned by GET /model/metadata. */
const metadataParameterSchema = z.object({
  key: z.string(),
  symbol: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  status: z.string(),
  description: z.string(),
  provenance: z.string(),
  reviewStatus: z.string(),
  effectiveDate: z.string().nullable(),
  notes: z.string()
});

/** Parameter echo entries, as returned with a prediction. */
const predictedParameterSchema = z.object({
  key: z.string(),
  symbol: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  status: z.string(),
  provenance: z.string(),
  reviewStatus: z.string(),
  sourceDatasetId: z.string().nullable(),
  effectiveDate: z.string().nullable()
});

const paperConflictSchema = z.object({
  id: z.string(),
  severity: z.string(),
  title: z.string(),
  detail: z.string()
});

const modelMetadataSchema = z.object({
  equationVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  equationSource: z.string(),
  equations: z.record(z.string()),
  requiredParameters: z.array(z.string()),
  targetMeasure: z.string(),
  parameters: z.array(metadataParameterSchema),
  provisionalParameters: z.array(z.string()),
  conditionConvention: conditionConventionSchema,
  solver: solverSchema,
  studyArea: z.object({
    id: z.string(),
    label: z.string(),
    scope: z.string(),
    description: z.string()
  }),
  paperConflicts: z.array(paperConflictSchema),
  demoProfile: z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    values: z.record(z.number()),
    status: z.string()
  }),
  paperReproductionProfile: z.object({
    version: z.string(),
    label: z.string(),
    alpha: z.number(),
    initialCoverPercent: z.number(),
    initialCoverYear: z.number(),
    tourismConfigVersion: z.string(),
    tourismGrowthPeriods: z.array(z.object({
      startYear: z.number(), endYear: z.number(), growthRate: z.number(), unit: z.string(),
      provenance: z.string(), reviewStatus: z.string(), effectiveDate: z.string().nullable()
    }))
  }).optional()
});

const predictionSchema = z.object({
  equationVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  modelConfigVersion: z.string().min(1),
  requestId: z.string().min(1),
  profile: z.enum(['paper', 'demo', 'scenario', 'paper-reproduction']),
  isDemo: z.boolean(),
  /** True when the caller supplied assumed values for unconfigured parameters. */
  isScenario: z.boolean(),
  isPaperReproduction: z.boolean().optional(),
  alphaResolution: z.string().optional(),
  targetMeasure: z.string(),
  studyAreaId: z.string(),
  studyAreaLabel: z.string(),
  scope: z.string(),
  baselineYear: z.number().int(),
  horizonYears: z.number().int(),
  forecastEndYear: z.number().int().optional(),
  initialCoverPercent: z.number(),
  finalCoverPercent: z.number(),
  finalIntervalMeanPercent: z.number(),
  stateClassification: z.string().nullable(),
  meanClassification: z.string().nullable(),
  classificationConvention: z.string().min(1),
  classificationConventionSource: z.string(),
  annual: z.array(annualPointSchema),
  parameters: z.array(predictedParameterSchema),
  solver: solverSchema,
  sources: z.array(sourceRecordSchema),
  warnings: z.array(z.string()),
  conditions: z.array(conditionBandSchema),
  missingParameters: z.array(z.object({
    key: z.string(),
    reason: z.string(),
    requiredBy: z.string(),
    note: z.string()
  })),
  tourismGrowthPeriods: z.array(z.object({
    startYear: z.number().int(),
    endYear: z.number().int(),
    growthRate: z.number(),
    unit: z.string(),
    provenance: z.string(),
    reviewStatus: z.string(),
    effectiveDate: z.string().nullable()
  })).optional()
});

export type ModelMetadata = z.infer<typeof modelMetadataSchema>;
export type ModelPrediction = z.infer<typeof predictionSchema>;

/**
 * The body of `POST /model/predict`, shaped exactly like the model service's
 * `PredictRequest`. The API keeps its own camelCase domain types; this is the
 * one place where they are translated for the wire, so the Python request
 * schema stays the single description of what the model service accepts.
 */
export interface ModelPredictInput {
  study_area_id: string;
  study_area_label: string;
  scope: string;
  consented_location?: ConsentedLocation | null;
  profile: 'paper' | 'demo' | 'scenario' | 'paper-reproduction';
  baseline_year: number;
  horizon_years: number;
  forecast_end_year: number;
  coral_baseline: {
    cover_percent: number;
    year: number;
    hard_coral_percent: number | null;
    soft_coral_percent: number | null;
    measure: string;
    survey_source: string;
    survey_scope: string;
    same_scope_confirmed: boolean;
  };
  /**
   * Each value travels with its own provenance, so the service echoes an
   * assumed value as `assumed`/`unreviewed` instead of as a paper value.
   */
  parameters: Record<string, {
    value: number | null;
    unit: string;
    status: string;
    provenance: string;
    reviewStatus: string;
    source_dataset_id: string | null;
    effective_date: string | null;
  }>;
  solver: {
    method: string;
    substeps_per_year: number;
    interval_mean_quadrature: string;
    state_output: string;
  };
  model_config_version: string;
  sources: Record<string, unknown>[];
  request_id?: string;
  tourism_growth_periods?: Array<{
    start_year: number;
    end_year: number;
    growth_rate: number;
    unit: string;
    provenance: string;
    review_status: string;
    effective_date: string | null;
  }>;
}

const calibrationSchema = z.object({
  equationVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  requestId: z.string().min(1),
  parameterKey: z.string().min(1),
  value: z.number().finite(),
  searchBracket: z.tuple([z.number(), z.number()]),
  observedCoverPercent: z.number(),
  observedCoverYear: z.number().int(),
  fittedFinalCoverPercent: z.number(),
  absoluteResidualPercent: z.number().nonnegative(),
  method: z.string().min(1),
  note: z.string().min(1),
  warnings: z.array(z.string())
});

export type ModelCalibration = z.infer<typeof calibrationSchema>;

export interface ModelCalibrateInput {
  studyAreaId: string;
  baselineYear: number;
  parameterKey: string;
  initialCoverPercent: number;
  observedCoverPercent: number;
  observedCoverYear: number;
  parameters: Record<string, {
    value: number | null;
    unit: string;
    status: string;
    provenance: string;
    reviewStatus: string;
    sourceDatasetId?: string | null;
    effectiveDate?: string | null;
  }>;
  solver: { substepsPerYear: number };
  conditionBands: { label: string; minPercent: number; maxPercent: number; upperInclusive: boolean }[];
  requestId: string;
}

export class ModelServiceUnavailableError extends AppError {
  constructor(message: string, details?: string) {
    super(503, MODEL_SERVICE_UNAVAILABLE, message, { details, expose: true });
  }
}

export class ModelClient {
  private get baseUrl(): string {
    return config.model.serviceUrl;
  }

  private get tokenHeader(): Record<string, string> {
    if (!config.model.serviceToken) {
      throw notConfigured(MODEL_SERVICE_UNAVAILABLE, 'The model service token is not configured on this environment');
    }
    return { 'x-service-token': config.model.serviceToken };
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const result = await callUpstream({
        url: `${this.baseUrl}/ready`,
        headers: this.tokenHeader,
        timeoutMs: Math.min(config.model.timeoutMs, 3000),
        label: 'Model service readiness check'
      });
      return result.ok;
    } catch (error) {
      logger.debug('Model service readiness probe failed', { error: error instanceof Error ? error.message : 'unknown' });
      return false;
    }
  }

  public async fetchMetadata(): Promise<ModelMetadata> {
    const result = await callUpstream({
      url: `${this.baseUrl}/model/metadata`,
      headers: this.tokenHeader,
      timeoutMs: config.model.timeoutMs,
      label: 'Model service metadata'
    });
    if (!result.ok) {
      throw upstreamUnavailable(MODEL_SERVICE_UNAVAILABLE, 'The model service did not return metadata', `status ${result.status}`);
    }
    const parsed = modelMetadataSchema.safeParse(result.body);
    if (!parsed.success) {
      throw upstreamUnavailable(MODEL_SERVICE_UNAVAILABLE, 'The model service returned an unexpected metadata payload', parsed.error.message);
    }
    return parsed.data;
  }

  public async predict(input: ModelPredictInput, requestId: string): Promise<ModelPrediction> {
    const result = await callUpstream({
      url: `${this.baseUrl}/model/predict`,
      method: 'POST',
      headers: { ...this.tokenHeader, 'x-request-id': requestId },
      body: input,
      timeoutMs: config.model.timeoutMs,
      label: 'Model service prediction'
    });
    if (!result.ok) {
      const detail = typeof result.body === 'object' && result.body !== null && 'detail' in result.body
        ? JSON.stringify((result.body as { detail: unknown }).detail).slice(0, 500)
        : `status ${result.status}`;
      throw upstreamUnavailable(MODEL_SERVICE_UNAVAILABLE, 'The model service could not compute this prediction', detail);
    }
    const parsed = predictionSchema.safeParse(result.body);
    if (!parsed.success) {
      throw upstreamUnavailable(MODEL_SERVICE_UNAVAILABLE, 'The model service returned an unexpected prediction payload', parsed.error.message);
    }
    return parsed.data;
  }

  /**
   * Asks the model service to fit one parameter against an observation. The
   * inversion happens in Python so no second implementation of CCOverT exists.
   */
  public async calibrate(input: ModelCalibrateInput, requestId: string): Promise<ModelCalibration> {
    const result = await callUpstream({
      url: `${this.baseUrl}/model/calibrate`,
      method: 'POST',
      headers: { ...this.tokenHeader, 'x-request-id': requestId },
      body: input,
      timeoutMs: Math.max(config.model.timeoutMs, 15000),
      label: 'Model service calibration'
    });
    if (!result.ok) {
      const detail = typeof result.body === 'object' && result.body !== null && 'error' in result.body
        ? JSON.stringify((result.body as { error: unknown }).error).slice(0, 500)
        : `status ${result.status}`;
      if (result.status === 422) {
        throw unprocessable('The model service could not fit a value for this observation', 'VALIDATION_ERROR', detail);
      }
      throw upstreamUnavailable(MODEL_SERVICE_UNAVAILABLE, 'The model service could not fit a value for this observation', detail);
    }
    const parsed = calibrationSchema.safeParse(result.body);
    if (!parsed.success) {
      throw upstreamUnavailable(MODEL_SERVICE_UNAVAILABLE, 'The model service returned an unexpected calibration payload', parsed.error.message);
    }
    return parsed.data;
  }
}

export const modelClient = new ModelClient();

/* -------------------------------------------------------------------------- */
/* AI provider (optional)                                                      */
/* -------------------------------------------------------------------------- */

const aiReportSchema = z.object({
  body: z.string().min(1),
  citations: z.array(z.object({
    predictionId: z.string().nullable(),
    uploadId: z.string().nullable(),
    filename: z.string().nullable(),
    page: z.number().nullable(),
    excerpt: z.string()
  })),
  warnings: z.array(z.string())
});

export interface AiProviderResult {
  body: string;
  citations: z.infer<typeof aiReportSchema>['citations'];
  warnings: string[];
  provider: string;
  model: string;
}

export class AiClient {
  public get configured(): boolean {
    return aiProviderConfigured;
  }

  public async generate(input: {
    system: string;
    user: string;
    allowedCitationKeys: string[];
    timeoutMs: number;
  }): Promise<AiProviderResult> {
    if (!aiProviderConfigured) {
      throw notConfigured(AI_NOT_CONFIGURED, 'No AI provider is configured on this environment');
    }
    const result = await callUpstream({
      url: config.ai.url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.ai.apiKey ? { authorization: `Bearer ${config.ai.apiKey}` } : {})
      },
      body: {
        model: config.ai.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      },
      timeoutMs: input.timeoutMs,
      label: 'AI provider'
    });
    if (!result.ok) {
      throw upstreamUnavailable(AI_PROVIDER_UNAVAILABLE, 'The AI provider request failed', `status ${result.status}`);
    }
    const raw = result.body as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = raw?.choices?.[0]?.message?.content;
    if (!content) {
      throw upstreamUnavailable(AI_PROVIDER_UNAVAILABLE, 'The AI provider returned an empty response', 'missing choices[0].message.content');
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw upstreamUnavailable(AI_PROVIDER_UNAVAILABLE, 'The AI provider response was not valid JSON', content.slice(0, 200));
    }
    const parsed = aiReportSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw upstreamUnavailable(AI_PROVIDER_UNAVAILABLE, 'The AI provider response did not match the required report contract', parsed.error.message);
    }
    const allowed = new Set(input.allowedCitationKeys);
    const citations = parsed.data.citations.filter((citation) => {
      const key = citation.uploadId ?? citation.predictionId ?? '';
      return allowed.has(key);
    });
    if (citations.length !== parsed.data.citations.length) {
      logger.warn('Dropped AI citations that referenced sources outside the request', {
        kept: citations.length,
        dropped: parsed.data.citations.length - citations.length
      });
    }
    return {
      body: parsed.data.body,
      citations,
      warnings: parsed.data.warnings,
      provider: config.ai.provider,
      model: config.ai.model
    };
  }
}

export const aiClient = new AiClient();
