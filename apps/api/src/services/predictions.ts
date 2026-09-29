import crypto from 'node:crypto';
import {
  CONDITION_CONVENTION,
  DEMO_SYNTHETIC_PARAMETERS,
  PAPER_REPRODUCTION_LABEL,
  PAPER_REPRODUCTION_TOURISM_PERIODS,
  MODEL_PARAMETERS_NOT_CONFIGURED,
  PAPER_CONFLICTS,
  PAPER_PARAMETERS,
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
import { config } from '../config';
import { badRequest, conflict, notConfigured, notFound } from '../utils/errors';
import { db, type EnvironmentalDatasetRecord, type PredictionRecordStored } from '../repositories/database';
import { modelClient, type ModelPredictInput } from './modelClient';
import { datasetService } from './datasets';
import { modelConfigService, parameterByKey, validateParameterValue } from './modelConfigService';
import { toPublicRecord } from './report';

const PAPER_CITATION = 'Pacliban, Kanaya and Fujita (2020), CCOverT, Stochastics and Environmental Research Reports';
export const FUTURE_TOURISM_PROJECTION_WARNING = 'Tourism values after 2026 are model projections using g = 0.128708; no observed tourism data was used for those years.';

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
  // No interpolation or extrapolation is silently applied to a baseline.
  return exact?.value ?? null;
};

export const estimateTourismGrowth = (records: { year: number; value: number }[], baselineYear: number): number => {
  const usable = records.filter((record) => record.value > 0);
  if (usable.length < 2) throw badRequest('Paper-reproduction requires at least two positive annual tourism observations to estimate g');
  const meanT = usable.reduce((sum, record) => sum + (record.year - baselineYear), 0) / usable.length;
  const meanLog = usable.reduce((sum, record) => sum + Math.log(record.value), 0) / usable.length;
  const denominator = usable.reduce((sum, record) => sum + ((record.year - baselineYear) - meanT) ** 2, 0);
  if (denominator === 0) throw badRequest('Paper-reproduction tourism data must contain more than one year');
  return usable.reduce((sum, record) => sum + ((record.year - baselineYear) - meanT) * (Math.log(record.value) - meanLog), 0) / denominator;
};

const paperReproductionParameters = (baselineYear = 2006): ModelParameter[] => PAPER_PARAMETERS.map((parameter) => ({
  ...parameter,
  value: parameter.key === 'alpha' ? 0.05
    : parameter.value === null ? null
      : parameter.key === 'T0' ? parameter.value + 0.013 * (baselineYear - 2006)
      : parameter.key === 'V0' ? PAPER_REPRODUCTION_TOURISM_PERIODS.reduce((value, period) => {
        const start = Math.max(2006, period.startYear);
        const end = Math.min(baselineYear, period.endYear + 1);
        return end > start ? value * Math.exp(period.growthRate * (end - start)) : value;
      }, parameter.value)
        : parameter.value,
  status: parameter.key === 'alpha' ? 'paper-inferred' as const : parameter.key === 'beta' || parameter.key === 'K' ? 'provisional' as const : 'paper-stated' as const,
  reviewStatus: 'unreviewed' as const,
  provenance: parameter.key === 'alpha' ? 'Confirmed paper-reproduction configuration: alpha = 0.05 per degree Celsius per year.' : parameter.provenance,
  notes: parameter.key === 'alpha' ? 'Paper-reproduction value; not independently validated.' : parameter.notes
}));

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

export interface RecordPredictionFailureInput {
  userId: string;
  request: PredictionRequest;
  idempotencyKey: string | null;
  reason: string;
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
      if (request.profile === 'paper' && sst.status !== 'validated') throw notConfigured('INPUT_DATA_UNAVAILABLE', 'The SST dataset still needs independent review');
      if (sst.scope !== 'citywide-annual-average') throw badRequest('The SST series must be a citywide annual average');
      if (!/\bSST\b|sea[ -]?surface[ -]?temperature/i.test(`${sst.label} ${sst.sourceCitation}`) || /\bair[ -]?temperature\b/i.test(`${sst.label} ${sst.sourceCitation}`)) throw badRequest('The temperature series is not documented as SST');
      if (valueAtYear(sst.records, request.baselineYear) === null) throw badRequest('The baseline year has no observed SST value in the selected dataset; interpolation or extrapolation needs a documented method');
      sources.push(datasetService.toSourceRecord(sst));
    } else {
      warnings.push('No sea-surface temperature series was attached; the configured T0 and gamma values were used without an imported source.');
    }

    if (tourism) {
      if (tourism.kind !== 'tourism') throw badRequest(`Dataset ${tourism.id} is a ${tourism.kind} series, not tourist arrivals`);
      if (tourism.status === 'rejected') throw notConfigured('INPUT_DATA_UNAVAILABLE', 'The selected tourism series was rejected and cannot be used');
      if (request.profile === 'paper' && tourism.status !== 'validated') throw notConfigured('INPUT_DATA_UNAVAILABLE', 'The tourism dataset still needs independent review');
      if (tourism.scope !== 'citywide-annual-average') throw badRequest('The tourism series must be citywide annual arrivals');
      if (valueAtYear(tourism.records, request.baselineYear) === null) throw badRequest('The baseline year has no observed tourism value in the selected dataset; interpolation or extrapolation needs a documented method');
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
          const instantaneousRate = copy.value * arrivals;
          // Reported as the raw driver rate only. Converting it to "percent of
          // current cover per year" is misleading: the model's actual loss also
          // depends on the cover present each year, so the integrated
          // percentage-point loss is added after the run instead.
          warnings.push(
            `The tourism driver rate is beta*V = ${instantaneousRate.toPrecision(4)} per year at ${Math.round(arrivals)} arrivals, before growth and thermal effects. This is a rate, not a cover loss; the run's cumulative tourism loss in percentage points is reported after the model runs. Beta's units still need confirmation.`
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

    // The forecast end is a boundary, not a second baseline. Normalize the
    // duration once at the API boundary so every downstream consumer uses
    // t=0 at the profile baseline.
    const forecastEndYear = request.forecastEndYear ?? request.baselineYear + request.horizonYears;
    const horizonYears = forecastEndYear - request.baselineYear;
    if (forecastEndYear <= request.baselineYear || forecastEndYear > config.model.maxForecastYear || horizonYears < 1 || horizonYears > config.model.maxForecastHorizonYears) {
      throw badRequest(
        `The forecast ending year (${forecastEndYear}) must be after baseline year (${request.baselineYear}), no later than ${config.model.maxForecastYear}, and within a ${config.model.maxForecastHorizonYears}-year duration.`,
        'INVALID_FORECAST_WINDOW'
      );
    }
    request = { ...request, predictionStartYear: request.baselineYear, forecastEndYear, horizonYears };

    if (request.scope !== 'citywide-annual-average') {
      throw badRequest('The CCOverT paper model is citywide; reef-site scoped runs are not supported.');
    }
    if (request.coralBaseline.surveyScope !== 'citywide-annual-average') {
      throw badRequest('The coral-cover baseline must represent the citywide annual-average scope');
    }
    if (request.profile === 'paper' && !request.coralBaseline.surveyMethod?.trim()) {
      throw badRequest('A paper-profile baseline requires a documented coral-cover survey method');
    }
    if (request.profile === 'demo') await modelConfigService.assertDemoAllowed();
    if (request.profile === 'paper-reproduction' && (request.coralBaseline.year !== request.baselineYear || request.coralBaseline.coverPercent !== 57)) {
      throw badRequest(`Paper-reproduction requires C0 = 57% and coralBaseline.year = baselineYear (${request.baselineYear}).`, 'BASELINE_YEAR_MISMATCH');
    }

    const reproductionBase = request.profile === 'paper-reproduction'
      ? await modelConfigService.getActive()
      : null;
    const stored = request.profile === 'paper-reproduction'
      ? reproductionBase
        ? {
          ...reproductionBase,
          version: 'paper-reproduction-1.0.0',
          baselineYear: request.baselineYear,
          initialCoverYear: request.baselineYear,
          initialCoverPercent: 57,
          parameters: reproductionBase.parameters.map((parameter) => ({ ...parameter }))
        }
        : null
      : await modelConfigService.getRunBase(request.profile);
    if (!stored) {
      throw notConfigured(MODEL_PARAMETERS_NOT_CONFIGURED, 'No model configuration is active on this environment');
    }
    if (stored.studyAreaId !== request.studyAreaId) {
      throw badRequest(`The active model configuration targets ${stored.studyAreaId}, not ${request.studyAreaId}`);
    }
    const configuredGrowth = stored.parameters.find((parameter) => parameter.key === 'g')?.value;
    const reproductionPeriods = request.profile === 'paper-reproduction'
      ? PAPER_REPRODUCTION_TOURISM_PERIODS.map((period, index) => index === PAPER_REPRODUCTION_TOURISM_PERIODS.length - 1 && configuredGrowth !== null && configuredGrowth !== undefined
        ? { ...period, growthRate: configuredGrowth }
        : { ...period })
      : request.tourismGrowthPeriods;
    request = {
      ...request,
      sstDatasetId: stored.sstDatasetId ?? request.sstDatasetId,
      tourismDatasetId: stored.tourismDatasetId ?? request.tourismDatasetId,
      tourismGrowthPeriods: reproductionPeriods
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
    const expectedBaselineYear = request.profile === 'paper-reproduction' ? request.baselineYear : stored.baselineYear;
    if (request.baselineYear !== expectedBaselineYear || request.coralBaseline.year !== expectedBaselineYear) {
      throw badRequest(
        `${request.profile} profile baseline mismatch: request baselineYear=${request.baselineYear}, coralBaseline.year=${request.coralBaseline.year}, configured profile baselineYear=${expectedBaselineYear}`,
        'BASELINE_YEAR_MISMATCH'
      );
    }
    let applied = request.profile === 'paper-reproduction'
      ? { parameters: stored.parameters.map((parameter) => ({ ...parameter })), warnings: [] as string[] }
      : this.applyDatasets(stored.parameters, sst, tourism, request.baselineYear);
    let reproductionWarnings: string[] = [];
    if (request.profile === 'paper-reproduction') {
      const periods = request.tourismGrowthPeriods ?? PAPER_REPRODUCTION_TOURISM_PERIODS;
      const gParameter = applied.parameters.find((parameter) => parameter.key === 'g');
      if (gParameter) {
        gParameter.value = periods[periods.length - 1].growthRate;
        gParameter.status = 'paper-inferred';
        gParameter.provenance = 'Confirmed piecewise tourism configuration; g is represented by the stored period schedule.';
        gParameter.notes = 'The model uses continuous piecewise growth; this scalar is retained for compatibility only.';
      }
      reproductionWarnings = [PAPER_REPRODUCTION_LABEL, 'Alpha = 0.05 per degree Celsius per year is a confirmed paper-reproduction value.', 'Tourism growth uses the versioned continuous piecewise configuration; no period resets V to V0.', `K and beta remain provisional/inferred. C0 = 57% at the selected ${request.baselineYear} start year is used; the paper reports conflicting 2006 values of 57.25% and 45.83%.`];
    }
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
    for (const parameter of parameters) {
      if (parameter.value !== null) validateParameterValue(parameter.key, parameter.value);
    }
    const allWarnings = [...reproductionWarnings, ...warnings, ...applied.warnings, ...assumed.warnings, ...alphaResolution.warnings];
    if (request.profile === 'paper-reproduction' && request.baselineYear + request.horizonYears > 2026) {
      allWarnings.push(FUTURE_TOURISM_PROJECTION_WARNING);
    }
    if (request.profile === 'scenario') {
      allWarnings.unshift(SCENARIO_DISCLAIMER);
    }
    const missing = parameters.filter((parameter) => parameter.value === null || !Number.isFinite(parameter.value));
    if (missing.length > 0) {
      const detail = missing.map((parameter) => `${parameter.key} (${parameter.status})`).join(', ');
      if (request.profile === 'paper-reproduction' && missing.some((parameter) => parameter.key === 'alpha')) {
        throw badRequest('Paper-reproduction refused: SST exceeds Tcrit and alpha was not explicitly supplied', 'ALPHA_REQUIRED_FOR_THERMAL_CROSSING', detail);
      }
      if (request.profile === 'scenario') {
        throw badRequest(
          `This scenario still cannot run: no value is available or was assumed for ${detail}. Add an assumed value for every missing parameter.`,
          'SCENARIO_ASSUMPTIONS_INCOMPLETE',
          detail
        );
      }
      throw notConfigured(MODEL_PARAMETERS_NOT_CONFIGURED, `The model cannot run: no value is configured for ${detail}`, detail);
    }
    if (request.profile === 'paper') {
      const inactiveAlpha = parameters.some((parameter) => parameter.key === 'alpha' && parameter.status === 'not-required-for-horizon');
      const readiness = await modelConfigService.paperReadiness(stored, inactiveAlpha);
      if (!readiness.ready) throw notConfigured(MODEL_PARAMETERS_NOT_CONFIGURED, `The paper profile is not research-ready: ${readiness.reasons.join('; ')}`);
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
      forecast_end_year: request.forecastEndYear ?? request.baselineYear + request.horizonYears,
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
      model_config_version: request.profile === 'paper-reproduction' ? 'paper-reproduction-1.0.0' : stored.version,
      tourism_growth_periods: request.profile === 'paper-reproduction' ? (request.tourismGrowthPeriods ?? PAPER_REPRODUCTION_TOURISM_PERIODS).map((period) => ({
        start_year: period.startYear, end_year: period.endYear, growth_rate: period.growthRate, unit: period.unit,
        provenance: period.provenance, review_status: period.reviewStatus, effective_date: period.effectiveDate
      })) : undefined,
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

    // The actual continuous-model tourism loss, integrated over the horizon.
    // This replaces the instantaneous driver rate that used to be presented as
    // a percentage of cover, which was not the model's cover loss.
    const tourismLossPp = result.annual.reduce((sum, point) => sum + point.tourismContributionPp, 0);
    const thermalLossPp = result.annual.reduce((sum, point) => sum + point.thermalContributionPp, 0);
    if (parameterByKey(parameters, 'beta')?.value) {
      result.warnings = [
        ...result.warnings,
        `Over the full horizon the continuous model attributes a cumulative tourism loss of ${tourismLossPp.toFixed(2)} percentage points of coral cover (summed interval-mean tourism contribution), against a net change of ${(result.finalCoverPercent - result.initialCoverPercent).toFixed(2)} percentage points and a thermal loss of ${thermalLossPp.toFixed(2)} percentage points. Components are additive rate contributions and are not a causal decomposition.`
      ];
    }

    const record: PredictionRecordStored = {
      _id: predictionId,
      id: predictionId,
      userId: input.userId,
      status: result.isDemo ? 'demo' : result.isScenario ? 'scenario' : request.profile === 'paper-reproduction' ? 'paper-reproduction' : 'computed',
      validationStatus: 'not-validated',
      isDemo: result.isDemo,
      isScenario: result.isScenario,
      isPaperReproduction: request.profile === 'paper-reproduction',
      alphaResolution: parameters.some((parameter) => parameter.key === 'alpha' && parameter.status === 'not-required-for-horizon') ? 'inactive-for-horizon' : 'explicit',
      tourismGrowthPeriods: request.tourismGrowthPeriods,
      // Stored with the run so the assumptions survive independently of the
      // echoed parameter list.
      assumptions: request.profile === 'scenario' ? request.assumedValues : [],
      requestId,
      equationVersion: result.equationVersion,
      modelVersion: result.modelVersion,
      modelConfigVersion: request.profile === 'paper-reproduction' ? 'paper-reproduction-1.0.0' : stored.version,
      modelConfigBaselineYear: stored.baselineYear,
      targetMeasure: result.targetMeasure || TARGET_MEASURE,
      studyArea: {
        id: result.studyAreaId,
        label: result.studyAreaLabel,
        scope: result.scope,
        description: `${result.studyAreaLabel} (${result.scope})`
      },
      scope: result.scope,
      baselineYear: result.baselineYear,
      predictionStartYear: result.baselineYear,
      horizonYears: result.horizonYears,
      forecastEndYear: result.baselineYear + result.horizonYears,
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

  /** Persist refused/upstream-failed attempts without presenting them as model output. */
  public async recordFailure(input: RecordPredictionFailureInput): Promise<PredictionRecordStored> {
    if (input.idempotencyKey) {
      const existing = await db.findPredictionByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: PredictionRecordStored = {
      _id: id,
      id,
      userId: input.userId,
      status: 'unavailable',
      validationStatus: 'not-validated',
      isDemo: false,
      isScenario: input.request.profile === 'scenario',
      isPaperReproduction: input.request.profile === 'paper-reproduction',
      alphaResolution: 'explicit',
      tourismGrowthPeriods: input.request.tourismGrowthPeriods,
      assumptions: input.request.assumedValues,
      requestId: crypto.randomUUID(),
      equationVersion: 'not-run',
      modelVersion: 'not-run',
      modelConfigVersion: input.request.profile === 'paper-reproduction' ? 'paper-reproduction-1.0.0' : 'not-resolved',
      modelConfigBaselineYear: input.request.profile === 'paper-reproduction' ? 2006 : undefined,
      targetMeasure: TARGET_MEASURE,
      studyArea: {
        id: input.request.studyAreaId,
        label: STUDY_AREA.label,
        scope: input.request.scope,
        description: `${STUDY_AREA.label} (${input.request.scope})`
      },
      scope: input.request.scope,
      baselineYear: input.request.baselineYear,
      predictionStartYear: input.request.predictionStartYear ?? input.request.baselineYear,
      horizonYears: input.request.horizonYears,
      forecastEndYear: input.request.forecastEndYear ?? input.request.baselineYear + input.request.horizonYears,
      initialCoverPercent: input.request.coralBaseline.coverPercent,
      finalCoverPercent: input.request.coralBaseline.coverPercent,
      finalIntervalMeanPercent: input.request.coralBaseline.coverPercent,
      stateClassification: null,
      meanClassification: null,
      classificationConvention: CONDITION_CONVENTION,
      annual: [],
      parameters: [],
      solver: {
        method: SOLVER_DEFAULTS.method,
        substepsPerYear: input.request.solver.substepsPerYear,
        intervalMeanQuadrature: SOLVER_DEFAULTS.intervalMeanQuadrature,
        stateOutput: SOLVER_DEFAULTS.stateOutput,
        notes: SOLVER_DEFAULTS.notes
      },
      sources: [],
      warnings: [input.reason],
      failureReason: input.reason,
      request: input.request,
      idempotencyKey: input.idempotencyKey,
      createdAt: now
    };
    return db.createPrediction(record);
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
