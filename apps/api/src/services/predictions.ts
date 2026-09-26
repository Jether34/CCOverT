import crypto from 'node:crypto';
import {
  CONDITION_CONVENTION,
  DEMO_SYNTHETIC_PARAMETERS,
  MODEL_PARAMETERS_NOT_CONFIGURED,
  PAPER_CONFLICTS,
  SCENARIO_DISCLAIMER,
  SOLVER_DEFAULTS,
  STUDY_AREA,
  TARGET_MEASURE,
  thermalTermInactiveForHorizon,
  type ConsentedLocation,
  type CreatePredictionResponse,
  type ModelParameter,
  type PredictionRequest,
  type ScenarioAssumption,
  type SourceRecord
} from '@ccovert/shared';
import { logger } from '../logger';
import { badRequest, conflict, notConfigured, notFound } from '../utils/errors';
import { db, type EnvironmentalDatasetRecord, type PredictionRecordStored } from '../repositories/database';
import { modelClient, type ModelPredictInput } from './modelClient';
import { datasetService } from './datasets';
import { modelConfigService, parameterByKey } from './modelConfigService';
import { toPublicRecord } from './report';

const PAPER_CITATION = 'Pacliban, Kanaya and Fujita (2020), CCOverT, Stochastics and Environmental Research Reports';

/** Least-squares slope/intercept of value against year, anchored at the baseline year. */
const linearFit = (records: { year: number; value: number }[], baselineYear: number): { intercept: number; slope: number; n: number } => {
  const n = records.length;
  if (n === 0) throw badRequest('The imported series has no records');
  if (n === 1) return { intercept: records[0].value, slope: 0, n };
  const meanYear = records.reduce((sum, record) => sum + record.year, 0) / n;
  const meanValue = records.reduce((sum, record) => sum + record.value, 0) / n;
  const numerator = records.reduce((sum, record) => sum + (record.year - meanYear) * (record.value - meanValue), 0);
  const denominator = records.reduce((sum, record) => sum + (record.year - meanYear) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { intercept: meanValue + slope * (baselineYear - meanYear), slope, n };
};

const valueAtYear = (records: { year: number; value: number }[], year: number): number | null => {
  const exact = records.find((record) => record.year === year);
  if (exact) return exact.value;
  const before = [...records].reverse().find((record) => record.year < year);
  const after = records.find((record) => record.year > year);
  if (before && after) {
    const weight = (year - before.year) / (after.year - before.year);
    return before.value + weight * (after.value - before.value);
  }
  return (before ?? after)?.value ?? null;
};

/** Key-sorted JSON so two equal requests always hash identically. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
};

const fingerprint = (request: PredictionRequest): string =>
  crypto.createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');

export interface CreatePredictionInput {
  userId: string;
  request: PredictionRequest;
  idempotencyKey: string | null;
}

export class PredictionService {
  private async resolveDatasets(request: PredictionRequest): Promise<{
    sst: EnvironmentalDatasetRecord | null;
    tourism: EnvironmentalDatasetRecord | null;
    sources: SourceRecord[];
    warnings: string[];
  }> {
    const sources: SourceRecord[] = [];
    const warnings: string[] = [];
    const sst = request.sstDatasetId ? await datasetService.getOrThrow(request.sstDatasetId) : null;
    const tourism = request.tourismDatasetId ? await datasetService.getOrThrow(request.tourismDatasetId) : null;

    if (sst) {
      if (sst.kind !== 'sst') throw badRequest(`Dataset ${sst.id} is a ${sst.kind} series, not sea-surface temperature`);
      if (sst.status === 'rejected') throw notConfigured('INPUT_DATA_UNAVAILABLE', 'The selected temperature series was rejected and cannot be used');
      if (sst.scope !== 'citywide-annual-average') {
        warnings.push('The temperature series is not citywide; the paper model is defined for the citywide annual average.');
      }
      sources.push(datasetService.toSourceRecord(sst));
    } else {
      warnings.push('No sea-surface temperature series was attached; the configured T0 and gamma values were used without an imported source.');
    }

    if (tourism) {
      if (tourism.kind !== 'tourism') throw badRequest(`Dataset ${tourism.id} is a ${tourism.kind} series, not tourist arrivals`);
      if (tourism.status === 'rejected') throw notConfigured('INPUT_DATA_UNAVAILABLE', 'The selected tourism series was rejected and cannot be used');
      if (tourism.scope !== 'citywide-annual-average') {
        warnings.push('The tourism series is not citywide annual arrivals; the paper model requires that scope.');
      }
      sources.push(datasetService.toSourceRecord(tourism));
    } else {
      // Deliberately does not say the values were "configured": at this point a
      // scenario assumption may still be what supplies g.
      warnings.push('No tourist arrivals series was attached; V0 and g were used with no imported series to support them.');
    }

    sources.push({
      name: 'Initial coral-cover baseline',
      source: request.coralBaseline.surveySource,
      unit: request.coralBaseline.measure,
      timeWindow: String(request.coralBaseline.year),
      coverage: STUDY_AREA.label,
      scope: request.coralBaseline.surveyScope,
      datasetId: null,
      retrievedAt: null
    });

    sources.push({
      name: 'CCOverT model parameters',
      source: PAPER_CITATION,
      unit: 'model',
      timeWindow: `baseline ${request.baselineYear}`,
      coverage: STUDY_AREA.label,
      scope: 'model-parameters',
      datasetId: null,
      retrievedAt: null
    });
    return { sst, tourism, sources, warnings };
  }

  /**
   * Applies sourced datasets on top of the stored model configuration. Values
   * are never invented: an unsourced run keeps the configured value and says so.
   *
   * Every replacement is reported as a warning, so a run never silently
   * contradicts the configuration version it cites.
   */
  private applyDatasets(
    parameters: ModelParameter[],
    sst: EnvironmentalDatasetRecord | null,
    tourism: EnvironmentalDatasetRecord | null,
    baselineYear: number
  ): { parameters: ModelParameter[]; warnings: string[] } {
    const warnings: string[] = [];
    const replace = (
      copy: ModelParameter,
      value: number,
      dataset: EnvironmentalDatasetRecord,
      provenance: string
    ): void => {
      if (copy.value !== null && Number.isFinite(copy.value) && Math.abs(copy.value - value) > 1e-9) {
        warnings.push(
          `${copy.key} was changed from the configured ${copy.value} to ${value} using ${dataset.label} (${dataset.sourceCitation}).`
        );
      }
      copy.value = value;
      copy.sourceDatasetId = dataset.id;
      copy.provenance = provenance;
    };
    const applied = parameters.map((parameter) => {
      const copy = { ...parameter };
      if (sst && copy.key === 'T0') {
        const value = valueAtYear(sst.records, baselineYear);
        if (value !== null) {
          replace(copy, Number(value.toFixed(4)), sst, `Mean sea-surface temperature for ${baselineYear} from ${sst.sourceCitation}`);
        }
      }
      if (sst && copy.key === 'gamma') {
        const fit = linearFit(sst.records, baselineYear);
        replace(copy, Number(fit.slope.toFixed(6)), sst, `Least-squares trend of ${sst.sourceCitation} over ${fit.n} years`);
      }
      if (tourism && copy.key === 'V0') {
        const value = valueAtYear(tourism.records, baselineYear);
        if (value !== null) {
          replace(copy, Math.round(value), tourism, `Annual tourist arrivals for ${baselineYear} from ${tourism.sourceCitation}`);
        }
      }
      if (tourism && copy.key === 'beta') {
        const arrivals = valueAtYear(tourism.records, baselineYear);
        if (arrivals !== null && copy.value !== null && copy.value > 0) {
          const implied = -Math.log(0.99) / (copy.value * arrivals);
          warnings.push(
            `With beta = ${copy.value} and ${Math.round(arrivals)} annual arrivals, the tourism term alone removes about ${(implied * 100).toFixed(2)}% of cover each year. Confirm beta is the coefficient the paper intended, because its units are not stated.`
          );
        }
      }
      return copy;
    });
    return { parameters: applied, warnings };
  }

  /**
   * Applies analyst-assumed values for parameters the paper leaves unspecified.
   *
   * Each assumption is stamped `assumed`/`unreviewed` with the rationale as its
   * provenance, so a stored run can never be mistaken for a configured value.
   * Assumptions never overwrite a value that is already configured from the
   * paper or an imported dataset: the run says so instead of quietly changing a
   * sourced input.
   */
  private applyAssumptions(
    parameters: ModelParameter[],
    assumptions: ScenarioAssumption[]
  ): { parameters: ModelParameter[]; warnings: string[] } {
    const warnings: string[] = [];
    const byKey = new Map(assumptions.map((assumption) => [assumption.key, assumption]));
    const applied = parameters.map((parameter) => {
      const assumption = byKey.get(parameter.key);
      if (!assumption) return { ...parameter };
      if (parameter.value !== null && Number.isFinite(parameter.value)) {
        warnings.push(
          `${parameter.key} is already configured as ${parameter.value}; the scenario assumption of ${assumption.value} was not applied.`
        );
        return { ...parameter };
      }
      warnings.push(
        `${parameter.key} has no value in the paper or the active configuration, so this run assumed ${assumption.value} ${assumption.unit}. Rationale: ${assumption.rationale}`
      );
      if (assumption.range) {
        warnings.push(
          `${parameter.key} was drawn from the assumed range ${assumption.range.min} to ${assumption.range.max} ${assumption.unit}.`
        );
      }
      return {
        ...parameter,
        value: assumption.value,
        unit: assumption.unit,
        status: 'assumed' as const,
        reviewStatus: 'unreviewed' as const,
        sourceDatasetId: null,
        provenance: `Scenario assumption supplied by the analyst: ${assumption.rationale}`,
        notes: 'Exploratory value, not a paper finding and not reviewed.'
      };
    });
    return { parameters: applied, warnings };
  }

  /**
   * DEMO is an explicit synthetic profile. Its two synthetic values must stay
   * synthetic even if a reviewed paper configuration happens to exist.
   */
  private applyDemoProfile(parameters: ModelParameter[]): ModelParameter[] {
    return parameters.map((parameter) => {
      const synthetic = DEMO_SYNTHETIC_PARAMETERS[parameter.key];
      if (synthetic === undefined) return { ...parameter };
      return {
        ...parameter,
        value: synthetic,
        status: 'synthetic-demo-only' as const,
        reviewStatus: 'synthetic' as const,
        sourceDatasetId: null,
        provenance: 'Synthetic development value from the DEMO profile; not a research value.',
        notes: 'DEMO value only; never use for research output.'
      };
    });
  }

  /**
   * Alpha is not a default. It can be represented as zero only when the
   * linear SST driver stays at or below Tcrit for the complete requested
   * horizon, in which case the paper's max(...) term is exactly zero.
   */
  private resolveInactiveAlpha(parameters: ModelParameter[], horizonYears: number): {
    parameters: ModelParameter[];
    warnings: string[];
  } {
    const alpha = parameterByKey(parameters, 'alpha');
    if (!alpha || alpha.value !== null && Number.isFinite(alpha.value)) {
      return { parameters: parameters.map((parameter) => ({ ...parameter })), warnings: [] };
    }
    // If another required value is missing, keep alpha visibly missing too;
    // the request is refused for the complete set of missing inputs.
    if (parameters.some((parameter) => parameter.key !== 'alpha' && (parameter.value === null || !Number.isFinite(parameter.value)))) {
      return { parameters: parameters.map((parameter) => ({ ...parameter })), warnings: [] };
    }
    if (!thermalTermInactiveForHorizon(parameters, horizonYears)) {
      return { parameters: parameters.map((parameter) => ({ ...parameter })), warnings: [] };
    }
    const resolved = parameters.map((parameter) => parameter.key === 'alpha'
      ? {
        ...parameter,
        value: 0,
        status: 'not-required-for-horizon' as const,
        reviewStatus: 'unreviewed' as const,
        sourceDatasetId: null,
        provenance: 'Alpha was not numerically required for this horizon because SST never exceeds Tcrit; the thermal term is exactly zero for this run.',
        notes: 'Explicit horizon exception; this is not a configured alpha value.'
      }
      : { ...parameter });
    return {
      parameters: resolved,
      warnings: ['Alpha was not numerically required for this horizon: sea-surface temperature never exceeds Tcrit, so the thermal term is exactly zero for this run.']
    };
  }

  public async create(input: CreatePredictionInput): Promise<CreatePredictionResponse> {
    let request = input.request;

    if (request.scope !== 'citywide-annual-average') {
      throw badRequest('The CCOverT paper model is citywide; reef-site scoped runs are not supported.');
    }
    if (request.profile === 'demo') await modelConfigService.assertDemoAllowed();

    const stored = await modelConfigService.getRunBase(request.profile);
    if (!stored) {
      throw notConfigured(MODEL_PARAMETERS_NOT_CONFIGURED, 'No model configuration is active on this environment');
    }
    if (stored.studyAreaId !== request.studyAreaId) {
      throw badRequest(`The active model configuration targets ${stored.studyAreaId}, not ${request.studyAreaId}`);
    }
    request = {
      ...request,
      sstDatasetId: stored.sstDatasetId ?? request.sstDatasetId,
      tourismDatasetId: stored.tourismDatasetId ?? request.tourismDatasetId
    };

    if (input.idempotencyKey) {
      const existing = await db.findPredictionByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing) {
        if (existing.requestId === fingerprint(request) || JSON.stringify(canonical(existing.request)) === JSON.stringify(canonical(request))) {
          return { prediction: toPublicRecord(existing), replayed: true };
        }
        throw conflict('This idempotency key was already used for a different request', 'IDEMPOTENCY_CONFLICT');
      }
    }

    const { sst, tourism, sources, warnings } = await this.resolveDatasets(request);
    const applied = this.applyDatasets(stored.parameters, sst, tourism, request.baselineYear);
    const profiled = request.profile === 'demo'
      ? { parameters: this.applyDemoProfile(applied.parameters), warnings: [] as string[] }
      : { parameters: applied.parameters, warnings: [] as string[] };
    const assumed = request.profile === 'scenario'
      ? this.applyAssumptions(profiled.parameters, request.assumedValues)
      : profiled;
    const parametersForModel = assumed.parameters;
    const alphaResolution = request.profile === 'demo'
      ? { parameters: parametersForModel.map((parameter) => ({ ...parameter })), warnings: [] as string[] }
      : this.resolveInactiveAlpha(parametersForModel, request.horizonYears);
    const parameters = alphaResolution.parameters;
    const allWarnings = [...warnings, ...applied.warnings, ...assumed.warnings, ...alphaResolution.warnings];
    if (request.profile === 'scenario') {
      allWarnings.unshift(SCENARIO_DISCLAIMER);
    }
    const missing = parameters.filter((parameter) => parameter.value === null || !Number.isFinite(parameter.value));
    if (missing.length > 0) {
      const detail = missing.map((parameter) => `${parameter.key} (${parameter.status})`).join(', ');
      if (request.profile === 'scenario') {
        throw badRequest(
          `This scenario still cannot run: no value is available or was assumed for ${detail}. Add an assumed value for every missing parameter.`,
          'SCENARIO_ASSUMPTIONS_INCOMPLETE',
          detail
        );
      }
      throw notConfigured(MODEL_PARAMETERS_NOT_CONFIGURED, `The model cannot run: no value is configured for ${detail}`, detail);
    }
    const gParameter = parameterByKey(parameters, 'g');
    if (request.profile === 'paper' && gParameter && !gParameter.sourceDatasetId) {
      allWarnings.push('The tourism growth rate g has no imported dataset behind it; record the source in a new model configuration version.');
    }

    // Consent is recorded before the upstream call, not after: the model
    // service receives the location context and echoes it back on the result.
    const now = new Date().toISOString();
    const consentedLocation: ConsentedLocation | null = request.consentedLocation
      ? {
        ...request.consentedLocation,
        consentedAt: request.consentedLocation.consentedAt ?? now,
        contextOnly: true
      }
      : null;

    const modelInput: ModelPredictInput = {
      study_area_id: request.studyAreaId,
      study_area_label: STUDY_AREA.label,
      scope: request.scope,
      consented_location: consentedLocation,
      profile: request.profile,
      baseline_year: request.baselineYear,
      horizon_years: request.horizonYears,
      coral_baseline: {
        cover_percent: request.coralBaseline.coverPercent,
        year: request.coralBaseline.year,
        hard_coral_percent: request.coralBaseline.hardCoralPercent,
        soft_coral_percent: request.coralBaseline.softCoralPercent,
        measure: request.coralBaseline.measure,
        survey_source: request.coralBaseline.surveySource,
        survey_scope: request.coralBaseline.surveyScope,
        same_scope_confirmed: request.coralBaseline.sameScopeConfirmed
      },
      // Each value carries its own provenance, so the model service echoes an
      // assumption as `assumed`/`unreviewed` rather than as a paper value.
      // Send the fully resolved run snapshot. In particular, this includes
      // alpha=status `not-required-for-horizon` when the SST driver never
      // crosses Tcrit; sending the pre-resolution list would incorrectly make
      // FastAPI reject an otherwise valid scenario.
      parameters: Object.fromEntries(parameters.map((parameter) => [
        parameter.key,
        {
          value: parameter.value,
          unit: parameter.unit,
          status: parameter.status,
          provenance: parameter.provenance,
          reviewStatus: parameter.reviewStatus,
          source_dataset_id: parameter.sourceDatasetId ?? null,
          effective_date: stored.effectiveDate
        }
      ])),
      solver: {
        // Only the substep count is caller-controlled. The method, the
        // quadrature, and the state output stay on the published defaults, so
        // a run cannot quietly change how the integral is computed.
        method: SOLVER_DEFAULTS.method,
        substeps_per_year: request.solver.substepsPerYear,
        interval_mean_quadrature: SOLVER_DEFAULTS.intervalMeanQuadrature,
        state_output: SOLVER_DEFAULTS.stateOutput
      },
      model_config_version: stored.version,
      sources: sources.map((source) => ({
        name: source.name,
        source: source.source,
        unit: source.unit,
        time_window: source.timeWindow,
        coverage: source.coverage,
        scope: source.scope,
        dataset_id: source.datasetId,
        retrieved_at: source.retrievedAt
      })),
      request_id: crypto.randomUUID()
    };
    const requestId = modelInput.request_id as string;
    let result;
    try {
      result = await modelClient.predict(modelInput, requestId);
    } catch (error) {
      // Nothing is written when the model service fails: no partial results.
      logger.warn('Prediction failed before persistence', {
        requestId,
        userId: input.userId,
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }

    const predictionId = crypto.randomUUID();
    const record: PredictionRecordStored = {
      _id: predictionId,
      id: predictionId,
      userId: input.userId,
      status: result.isDemo ? 'demo' : result.isScenario ? 'scenario' : 'computed',
      isDemo: result.isDemo,
      isScenario: result.isScenario,
      // Stored with the run so the assumptions survive independently of the
      // echoed parameter list.
      assumptions: request.profile === 'scenario' ? request.assumedValues : [],
      requestId,
      equationVersion: result.equationVersion,
      modelVersion: result.modelVersion,
      modelConfigVersion: stored.version,
      targetMeasure: result.targetMeasure || TARGET_MEASURE,
      studyArea: {
        id: result.studyAreaId,
        label: result.studyAreaLabel,
        scope: result.scope,
        description: `${result.studyAreaLabel} (${result.scope})`
      },
      scope: result.scope,
      baselineYear: result.baselineYear,
      horizonYears: result.horizonYears,
      initialCoverPercent: result.initialCoverPercent,
      finalCoverPercent: result.finalCoverPercent,
      finalIntervalMeanPercent: result.finalIntervalMeanPercent,
      stateClassification: result.stateClassification,
      meanClassification: result.meanClassification,
      classificationConvention: CONDITION_CONVENTION,
      annual: result.annual,
      parameters,
      solver: { ...result.solver, method: 'rk4' as const, intervalMeanQuadrature: 'trapezoid' as const, stateOutput: 'end-of-year' as const },
      sources,
      warnings: [...allWarnings, ...result.warnings, ...PAPER_CONFLICTS.map((conflict) => conflict.title)],
      request: { ...request, consentedLocation },
      idempotencyKey: input.idempotencyKey,
      createdAt: now
    };
    const saved = await db.createPrediction(record);
    logger.info('Stored a prediction', {
      predictionId: saved.id,
      userId: input.userId,
      isDemo: saved.isDemo,
      modelConfigVersion: saved.modelConfigVersion,
      finalCoverPercent: saved.finalCoverPercent
    });
    return { prediction: toPublicRecord(saved), replayed: false };
  }

  public async owned(id: string, userId: string): Promise<PredictionRecordStored> {
    const record = await db.findPredictionForUser(id, userId);
    if (!record) throw notFound('The prediction was not found');
    return record;
  }

  public conditionConvention() {
    return CONDITION_CONVENTION;
  }
}

export const predictionService = new PredictionService();
