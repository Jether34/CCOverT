import crypto from 'node:crypto';
import {
  INPUT_DATA_UNAVAILABLE,
  MODEL_PARAMETERS_NOT_CONFIGURED,
  STUDY_AREA,
  type DatasetKind,
  type DatasetRecord,
  type DatasetValidationStatus,
  type DerivedValue,
  type EnvironmentalDataset,
  type ModelParameter,
  type SourceRecord,
  type StudyAreaScope
} from '@ccovert/shared';
import { config } from '../config';
import { logger } from '../logger';
import { badRequest, notConfigured, unprocessable } from '../utils/errors';
import { db, type EnvironmentalDatasetRecord } from '../repositories/database';
import { callUpstream } from './modelClient';
import { modelConfigService } from './modelConfigService';
import { recordActivity } from './activity';

const EXPECTED_UNITS: Record<DatasetKind, string[]> = {
  sst: ['degC', 'celsius', '°c', 'c'],
  tourism: ['annualArrivals', 'arrivals/year', 'annual tourist arrivals'],
  'coral-cover': ['percent', '%']
};

export const datasetUnitHint = (kind: DatasetKind): string => {
  if (kind === 'sst') return 'degC';
  if (kind === 'tourism') return 'annualArrivals';
  return 'percent';
};

/* -------------------------------------------------------------------------- */
/* CSV import                                                                  */
/* -------------------------------------------------------------------------- */

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',' || character === ';' || character === '\t') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
};

export interface ParsedCsv {
  records: DatasetRecord[];
  warnings: string[];
}

export function parseCsv(text: string, kind: DatasetKind, unit: string): ParsedCsv {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) throw unprocessable('The file must contain a header row and at least one data row');

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ''));
  const yearIndex = header.findIndex((cell) => cell === 'year' || cell === 't' || cell === 'tyears' || cell === 'date');
  const valueIndex = header.findIndex((cell) => ['value', 'sst', 'sstc', 'seasurfaceTemperature'.toLowerCase(), 'touristarrive'.replace(/[^a-z]/g, ''), 'tourists', 'arrivals', 'annualarrivals', 'coverpercent', 'cover', 'coralcover'].includes(cell));
  if (yearIndex === -1 || valueIndex === -1) {
    throw unprocessable('The file must have "year" and "value" columns', 'VALIDATION_ERROR', `header was: ${lines[0]}`);
  }
  if (yearIndex === valueIndex) throw unprocessable('The year and value columns must be different columns');

  const records: DatasetRecord[] = [];
  const seenYears = new Set<number>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const year = Number(cells[yearIndex]);
    const value = Number(cells[valueIndex]);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw unprocessable(`Row "${line}" has an invalid year`, 'VALIDATION_ERROR');
    }
    if (!Number.isFinite(value)) throw unprocessable(`Row "${line}" has a non-numeric value`, 'VALIDATION_ERROR');
    if (seenYears.has(year)) throw unprocessable(`Year ${year} appears more than once`, 'VALIDATION_ERROR');
    seenYears.add(year);
    records.push({ year, value });
  }
  records.sort((a, b) => a.year - b.year);

  const normalizedUnit = unit.toLowerCase().replace(/\s+/g, '');
  if (!EXPECTED_UNITS[kind].some((expected) => normalizedUnit === expected.toLowerCase().replace(/\s+/g, ''))) {
    throw unprocessable(
      `Unit "${unit}" does not match the ${kind} series (expected ${EXPECTED_UNITS[kind].join(', ')})`,
      'VALIDATION_ERROR'
    );
  }

  const years = records.map((record) => record.year);
  const gaps: number[] = [];
  for (let index = 1; index < years.length; index += 1) {
    if (years[index] !== years[index - 1] + 1) gaps.push(years[index - 1], years[index]);
  }
  if (gaps.length > 0) {
    warnings.push(`The series has calendar gaps between: ${[...new Set(gaps)].join(', ')}`);
  }
  if (kind === 'sst' && records.some((record) => record.value < 15 || record.value > 40)) {
    warnings.push('Some sea-surface temperature values fall outside the usual 15-40 degC range; confirm these are SST and not air temperature');
  }
  if (kind === 'sst' && records.some((record) => record.value < 20 || record.value > 33)) {
    warnings.push('The paper warns that PAGASA air temperature is not a sea-surface temperature substitute; verify the source metadata');
  }
  if (kind === 'tourism' && records.some((record) => record.value < 0)) {
    throw unprocessable('Tourist arrival counts cannot be negative');
  }
  if (kind === 'tourism' && records.some((record) => record.value < 1000)) {
    warnings.push('Very small arrival counts may be reported in thousands; confirm the unit before use');
  }
  if (kind === 'coral-cover' && records.some((record) => record.value > 100)) {
    throw unprocessable('Coral cover values are percentages and cannot exceed 100');
  }
  return { records, warnings };
}

export interface ImportDatasetInput {
  kind: DatasetKind;
  label: string;
  provider: string;
  sourceCitation: string;
  unit: string;
  scope: StudyAreaScope;
  spatialCoverage: string;
  fileName: string;
  text: string;
  ownerId: string;
  status?: DatasetValidationStatus;
}

export class DatasetService {
  public async importCsv(input: ImportDatasetInput): Promise<{ dataset: EnvironmentalDataset; warnings: string[] }> {
    if (!input.sourceCitation.trim()) {
      throw unprocessable('A source citation is required for every imported series', 'VALIDATION_ERROR');
    }
    if (!input.label.trim()) throw unprocessable('A label is required for every imported series');
    const parsed = parseCsv(input.text, input.kind, input.unit);
    const warnings = [...parsed.warnings];
    const scope: StudyAreaScope = input.scope;
    if (input.kind === 'tourism' && scope !== 'citywide-annual-average') {
      warnings.push('The paper model requires citywide annual tourist arrivals; a reef-site scope does not satisfy this');
    }
    if (input.kind === 'sst' && !/citywide|regional|sea surface|sst/i.test(`${input.label} ${input.spatialCoverage}`)) {
      warnings.push('Confirm this series is sea-surface temperature (SST). The paper rejects air temperature as a substitute.');
    }
    const status: DatasetValidationStatus = scope === 'citywide-annual-average' ? 'validated' : 'needs-review';
    if (input.status === 'needs-review') warnings.push('The researcher marked this import as needing review');

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: EnvironmentalDatasetRecord = {
      _id: id,
      id,
      kind: input.kind,
      studyAreaId: STUDY_AREA.id,
      label: input.label,
      provider: input.provider || 'user-import',
      sourceCitation: input.sourceCitation,
      unit: input.unit,
      scope,
      spatialCoverage: input.spatialCoverage || STUDY_AREA.label,
      temporalCoverage: {
        firstYear: parsed.records[0].year,
        lastYear: parsed.records[parsed.records.length - 1].year,
        yearCount: parsed.records.length
      },
      records: parsed.records,
      status,
      ownerId: input.ownerId,
      createdAt: now,
      derivedValue: null
    };
    await db.createDataset(record);
    logger.info('Imported an environmental dataset', {
      datasetId: record.id,
      kind: record.kind,
      years: record.temporalCoverage.yearCount,
      status
    });
    recordActivity({ kind: 'change', action: `Imported ${record.kind} dataset ${record.label}`, actorId: input.ownerId });
    return { dataset: this.toPublic(record), warnings };
  }

  public async list(kind?: DatasetKind, studyAreaId?: string): Promise<EnvironmentalDataset[]> {
    const records = await db.listDatasets({ kind, studyAreaId });
    return records.map((record) => this.toPublic(record));
  }

  public async getOrThrow(id: string, studyAreaId = STUDY_AREA.id): Promise<EnvironmentalDatasetRecord> {
    const record = await db.findDatasetById(id);
    if (!record) throw notConfigured(INPUT_DATA_UNAVAILABLE, `No dataset with id ${id} exists`);
    if (record.studyAreaId !== studyAreaId) {
      throw badRequest(`Dataset ${id} belongs to a different study area`);
    }
    return record;
  }

  /** Sourced provenance entries shown with every prediction. */
  public toSourceRecord(record: EnvironmentalDatasetRecord): SourceRecord {
    return {
      name: record.label,
      source: record.sourceCitation,
      unit: record.unit,
      timeWindow: `${record.temporalCoverage.firstYear}-${record.temporalCoverage.lastYear}`,
      coverage: record.spatialCoverage,
      scope: record.scope,
      datasetId: record.id,
      retrievedAt: record.createdAt
    };
  }

  public toPublic(record: EnvironmentalDatasetRecord): EnvironmentalDataset {
    return {
      id: record.id,
      kind: record.kind,
      studyAreaId: record.studyAreaId,
      label: record.label,
      provider: record.provider,
      sourceCitation: record.sourceCitation,
      unit: record.unit,
      scope: record.scope,
      spatialCoverage: record.spatialCoverage,
      temporalCoverage: record.temporalCoverage,
      records: record.records,
      status: record.status,
      ownerId: record.ownerId,
      createdAt: record.createdAt,
      derivedValue: record.derivedValue ?? null
    };
  }

  /* -- provider feeds --------------------------------------------------- */

  public providerStatus(kind: DatasetKind): { provider: string; configured: boolean } {
    const provider = kind === 'sst' ? config.data.sst : kind === 'tourism' ? config.data.tourism : config.data.reefContext;
    return { provider: provider.provider, configured: provider.provider !== 'disabled' && Boolean(provider.url) };
  }

  /**
   * Fetches a configured provider series. When no feed is configured the API
   * reports the input as unavailable instead of inventing values.
   */
  public async fetchFromProvider(kind: DatasetKind, studyAreaId: string): Promise<{ records: DatasetRecord[]; provider: string; citation: string; coverage: string }> {
    const provider = kind === 'sst' ? config.data.sst : kind === 'tourism' ? config.data.tourism : config.data.reefContext;
    if (provider.provider === 'disabled' || !provider.url) {
      throw notConfigured(INPUT_DATA_UNAVAILABLE, `No ${kind} provider is configured on this environment`);
    }
    const url = new URL(provider.url);
    url.searchParams.set('studyAreaId', studyAreaId);
    url.searchParams.set('kind', kind);
    const result = await callUpstream({
      url: url.toString(),
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      timeoutMs: 10000,
      label: `${kind} provider`
    });
    if (!result.ok) {
      throw notConfigured(INPUT_DATA_UNAVAILABLE, `The ${kind} provider did not return data`);
    }
    const body = result.body as { records?: DatasetRecord[]; citation?: string; coverage?: string };
    if (!Array.isArray(body.records) || body.records.length === 0) {
      throw notConfigured(INPUT_DATA_UNAVAILABLE, `The ${kind} provider returned no records`);
    }
    return {
      records: body.records.slice().sort((a, b) => a.year - b.year),
      provider: provider.provider,
      citation: body.citation ?? `${provider.provider} (${url.origin})`,
      coverage: body.coverage ?? STUDY_AREA.label
    };
  }

  /* -- derived g --------------------------------------------------------- */

  /** Estimate g from the documented annual-arrivals driver V(t). */
  public async estimateGrowthParameter(
    dataset: EnvironmentalDatasetRecord,
    _parameters: ModelParameter[],
    modelConfigVersion: string
  ): Promise<DerivedValue> {
    if (dataset.kind !== 'tourism') {
      throw unprocessable('Only an annual tourist-arrivals series can be used to estimate g');
    }
    if (dataset.records.length < 2) throw unprocessable('Fitting a parameter needs at least two observed years');
    const sorted = dataset.records.slice().sort((a, b) => a.year - b.year);
    if (sorted.some((record) => record.value <= 0 || !Number.isFinite(record.value))) {
      throw unprocessable('Annual tourist arrivals used to estimate g must be positive finite values');
    }
    const meanYear = sorted.reduce((sum, record) => sum + record.year, 0) / sorted.length;
    const meanLogArrivals = sorted.reduce((sum, record) => sum + Math.log(record.value), 0) / sorted.length;
    const denominator = sorted.reduce((sum, record) => sum + (record.year - meanYear) ** 2, 0);
    if (denominator === 0) throw unprocessable('Annual tourist arrivals need at least two distinct years to estimate g');
    const slope = sorted.reduce(
      (sum, record) => sum + (record.year - meanYear) * (Math.log(record.value) - meanLogArrivals),
      0
    ) / denominator;
    if (!Number.isFinite(slope) || slope < -0.5 || slope > 0.5) {
      throw unprocessable('The estimated tourism growth rate g is outside the supported range of -0.5 to 0.5 per year');
    }
    const warnings = [
      'g was estimated from annual tourist arrivals using a log-linear trend; it is not a value reported by the paper.',
      ...(dataset.scope === 'citywide-annual-average' ? [] : ['The arrivals dataset is not citywide; verify its scope before using the estimate.'])
    ];
    return {
      key: 'g',
      value: Number(slope.toFixed(6)),
      method: 'Least-squares slope of ln(annual tourist arrivals) against year',
      note: `Estimated from ${sorted.length} annual ${dataset.scope} arrivals records covering ${sorted[0].year}-${sorted[sorted.length - 1].year}. Use this value only after researcher review.`,
      warnings,
      derivedAt: new Date().toISOString(),
      modelConfigVersion
    };
  }

  public async saveEstimatedGrowthParameter(datasetId: string, ownerId: string): Promise<EnvironmentalDataset> {
    const dataset = await this.getOrThrow(datasetId);
    if (dataset.kind !== 'tourism') {
      throw unprocessable('Only an annual tourist-arrivals series can be used to estimate g');
    }
    if (dataset.ownerId !== ownerId) throw notConfigured(INPUT_DATA_UNAVAILABLE, 'Only the owner of a dataset can derive values from it');
    if (dataset.status === 'rejected') throw unprocessable('This dataset was rejected and cannot be used');
    const active = await modelConfigService.getActive();
    if (!active) {
      throw notConfigured(MODEL_PARAMETERS_NOT_CONFIGURED, 'No model configuration is active, so a fit has no baseline to work from');
    }
    const derivedValue = await this.estimateGrowthParameter(dataset, active.parameters, active.version);
    const updated = await db.updateDataset(dataset._id, { derivedValue, status: 'validated' });
    logger.info('Estimated tourism growth rate g from imported annual arrivals', {
      datasetId,
      g: derivedValue.value,
      modelConfigVersion: active.version
    });
    return this.toPublic(updated);
  }
}

export const datasetService = new DatasetService();
