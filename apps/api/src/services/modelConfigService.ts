import crypto from 'node:crypto';
import {
  CONDITION_CONVENTION,
  DEMO_SYNTHETIC_PARAMETERS,
  PAPER_CONFLICTS,
  PAPER_PARAMETERS,
  SOLVER_DEFAULTS,
  STUDY_AREA,
  type ModelConfig,
  type ModelParameter,
  type ModelStatus,
  type ResearchNote,
  type ReviewStatus
} from '@ccovert/shared';
import { config } from '../config';
import { logger } from '../logger';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { db, type ModelConfigRecord } from '../repositories/database';
import { recordActivity } from './activity';

export const PAPER_CONFIG_VERSION = '1.0.0';
export const DEMO_CONFIG_VERSION = '1.0.0-demo';

const paperProfileParameters = (): ModelParameter[] =>
  PAPER_PARAMETERS.map((parameter) => ({ ...parameter }));

const demoProfileParameters = (): ModelParameter[] =>
  paperProfileParameters().map((parameter) => {
    const synthetic = DEMO_SYNTHETIC_PARAMETERS[parameter.key];
    if (synthetic === undefined) return { ...parameter };
    return {
      ...parameter,
      value: synthetic,
      status: 'synthetic-demo-only' as const,
      reviewStatus: 'synthetic' as const,
      provenance: 'Synthetic development value, not a paper finding',
      notes: `${parameter.notes} DEMO value only; never use for research output.`.trim()
    };
  });

const buildConfig = (input: {
  version: string;
  profile: 'paper' | 'demo';
  parameters: ModelParameter[];
  active: boolean;
  createdBy: string;
  reviewStatus: ReviewStatus;
  notes: string;
  effectiveDate: string | null;
  reviewedBy: string | null;
  baselineYear: number;
  sstDatasetId?: string | null;
  tourismDatasetId?: string | null;
}): ModelConfigRecord => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    _id: id,
    id,
    version: input.version,
    active: input.active,
    profile: input.profile,
    studyAreaId: STUDY_AREA.id,
    baselineYear: input.baselineYear,
    sstDatasetId: input.sstDatasetId ?? null,
    tourismDatasetId: input.tourismDatasetId ?? null,
    archivedAt: null,
    parameters: input.parameters,
    conditionConvention: structuredClone(CONDITION_CONVENTION),
    solver: structuredClone(SOLVER_DEFAULTS),
    reviewStatus: input.reviewStatus,
    reviewedBy: input.reviewedBy,
    createdBy: input.createdBy,
    createdAt: now,
    effectiveDate: input.effectiveDate,
    notes: input.notes
  };
};

/** Missing parameters never fall back to zero. */
export const missingParameters = (parameters: ModelParameter[]): ModelParameter[] =>
  parameters.filter((parameter) => parameter.value === null || !Number.isFinite(parameter.value));

export const provisionalParameters = (parameters: ModelParameter[]): string[] =>
  parameters.filter((parameter) => parameter.status === 'provisional' || parameter.status === 'reported' && parameter.reviewStatus === 'unreviewed')
    .map((parameter) => parameter.key);

export const parameterByKey = (parameters: ModelParameter[], key: string): ModelParameter | undefined =>
  parameters.find((parameter) => parameter.key === key);

export class ModelConfigService {
  /** Creates the immutable paper-profile baseline on first boot. */
  public async ensureSeeded(): Promise<void> {
    const active = await db.findActiveModelConfig();
    if (active) return;
    const configs = await db.listModelConfigs(5);
    if (configs.length > 0) {
      await db.setActiveModelConfig(configs[0]._id);
      return;
    }
    const record = buildConfig({
      version: PAPER_CONFIG_VERSION,
      profile: 'paper',
      parameters: paperProfileParameters(),
      active: true,
      createdBy: 'system:paper',
      reviewStatus: 'unreviewed',
      notes: 'Published values only. alpha and g are intentionally unset: the API refuses to run the model until a researcher configures them from a cited source.',
      effectiveDate: '2006-01-01',
      reviewedBy: null,
      baselineYear: 2006
    });
    await db.createModelConfig(record);
    logger.info('Seeded the paper model configuration', { version: record.version });
  }

  public async getActive(): Promise<ModelConfigRecord | null> {
    return db.findActiveModelConfig();
  }

  /**
   * Returns the paper parameter baseline used to construct a run. Demo and
   * scenario runs must remain usable while the research profile is incomplete
   * (and while an environment is still being bootstrapped), so they may use an
   * in-memory paper baseline. Paper runs still require an active paper profile.
   */
  public async getRunBase(profile: 'paper' | 'demo' | 'scenario'): Promise<ModelConfigRecord | null> {
    const active = await this.getActive();
    if (active?.profile === 'paper') return active;
    if (profile === 'paper') return null;
    return buildConfig({
      version: PAPER_CONFIG_VERSION,
      profile: 'paper',
      parameters: paperProfileParameters(),
      active: false,
      createdBy: 'system:paper-run-baseline',
      reviewStatus: 'unreviewed',
      notes: 'Ephemeral paper baseline used only to support a demo or exploratory scenario while no paper configuration is active.',
      effectiveDate: '2006-01-01',
      reviewedBy: null,
      baselineYear: 2006
    });
  }

  public async getByVersion(version: string): Promise<ModelConfigRecord> {
    const record = await db.findModelConfigByVersion(version);
    if (!record) throw notFound(`No model configuration version ${version}`);
    return record;
  }

  public async list(limit = 50): Promise<ModelConfigRecord[]> {
    return db.listModelConfigs(limit);
  }

  public async demoAvailable(): Promise<boolean> {
    return config.model.allowDemoProfile;
  }

  public async assertDemoAllowed(): Promise<void> {
    if (!config.model.allowDemoProfile) {
      throw forbidden('The synthetic demo profile is disabled on this environment');
    }
  }

  /** Versions are immutable: a change always creates a new version. */
  public async createVersion(input: {
    baseVersion: string;
    changes: Record<string, number>;
    notes: string;
    createdById: string;
    createdByLabel: string;
    effectiveDate: string | null;
    reviewStatus: ReviewStatus;
    sourceDatasetIds?: Record<string, string>;
    sstDatasetId?: string | null;
    tourismDatasetId?: string | null;
  }): Promise<ModelConfigRecord> {
    const base = await this.getByVersion(input.baseVersion);
    if (base.profile === 'demo') throw forbidden('The demo profile cannot be used as a base version');
    if (base.archivedAt) throw forbidden('An archived configuration cannot be edited');
    for (const [kind, id] of [['sst', input.sstDatasetId], ['tourism', input.tourismDatasetId]] as const) {
      if (id === undefined || id === null) continue;
      const dataset = await db.findDatasetById(id);
      if (!dataset || dataset.kind !== kind || dataset.scope !== 'citywide-annual-average' || dataset.status === 'rejected') {
        throw badRequest(`Select an available citywide ${kind} dataset`);
      }
    }
    /** A parameter may only cite a dataset the same researcher actually imported. */
    for (const [key, datasetId] of Object.entries(input.sourceDatasetIds ?? {})) {
      if (!parameterByKey(base.parameters, key)) throw badRequest(`Unknown parameter ${key} in sourceDatasetIds`);
      const dataset = await db.findDatasetById(datasetId);
      if (!dataset) throw badRequest(`Source dataset ${datasetId} for ${key} does not exist`);
      if (dataset.ownerId !== input.createdById) throw forbidden(`Source dataset ${datasetId} for ${key} belongs to another account`);
    }
    const selectedTourismId = input.tourismDatasetId === undefined ? base.tourismDatasetId : input.tourismDatasetId;
    const selectedTourism = selectedTourismId ? await db.findDatasetById(selectedTourismId) : null;
    const derivedGrowth = selectedTourism?.derivedValue?.key === 'g' && selectedTourism.derivedValue.value !== null
      ? selectedTourism.derivedValue.value : undefined;
    const parameters = base.parameters.map((parameter) => {
      const next = input.changes[parameter.key] ?? (parameter.key === 'g' && parameter.value === null ? derivedGrowth : undefined);
      if (next === undefined) return { ...parameter };
      if (!Number.isFinite(next)) throw forbidden(`Parameter ${parameter.key} must be a finite number`);
      return {
        ...parameter,
        value: next,
        status: 'configured' as const,
        reviewStatus: input.reviewStatus,
        sourceDatasetId: input.sourceDatasetIds?.[parameter.key] ?? (parameter.key === 'g' && next === derivedGrowth ? selectedTourism?.id : null),
        provenance: parameter.key === 'g' && next === derivedGrowth
          ? `Researcher-selected log-linear estimate from ${selectedTourism?.sourceCitation}`
          : input.sourceDatasetIds?.[parameter.key]
            ? `Configured by ${input.createdByLabel} from an imported dataset`
            : `Configured by ${input.createdByLabel}; see version notes`,
        effectiveDate: input.effectiveDate
      };
    });
    const record = buildConfig({
      version: `${base.version.split('+')[0]}+cfg-${crypto.randomBytes(4).toString('hex')}`,
      profile: base.profile,
      parameters,
      active: true,
      createdBy: input.createdByLabel,
      reviewStatus: input.reviewStatus,
      notes: input.notes,
      effectiveDate: input.effectiveDate,
      reviewedBy: input.reviewStatus === 'reviewed' ? input.createdByLabel : null,
      baselineYear: base.baselineYear,
      sstDatasetId: input.sstDatasetId === undefined ? base.sstDatasetId : input.sstDatasetId,
      tourismDatasetId: input.tourismDatasetId === undefined ? base.tourismDatasetId : input.tourismDatasetId
    });
    await db.createModelConfig(record);
    await db.setActiveModelConfig(record._id);
    logger.info('Created a new immutable model configuration version', { version: record.version, createdBy: input.createdByLabel });
    recordActivity({ kind: 'change', action: `Published model configuration ${record.version}`, actorId: input.createdById });
    return record;
  }

  public async activate(id: string, actorId: string): Promise<ModelConfigRecord> {
    const configs = await db.listModelConfigs(200);
    const target = configs.find((candidate) => candidate._id === id || candidate.id === id);
    if (!target) throw notFound('No such model configuration');
    if (target.archivedAt) throw forbidden('An archived configuration cannot be activated');
    await db.setActiveModelConfig(target._id);
    logger.info('Activated a model configuration version', { version: target.version, actorId });
    recordActivity({ kind: 'change', action: `Activated model configuration ${target.version}`, actorId });
    return { ...target, active: true };
  }

  public async archive(id: string): Promise<void> {
    const target = (await db.listModelConfigs(200)).find((candidate) => candidate.id === id || candidate._id === id);
    if (!target) throw notFound('No such model configuration');
    if (target.active) throw badRequest('Activate another version before archiving the active configuration');
    await db.archiveModelConfig(target._id);
    logger.info('Archived model configuration', { version: target.version });
    recordActivity({ kind: 'change', action: `Archived model configuration ${target.version}`, actorId: null });
  }

  public toPublic(record: ModelConfig): ModelConfig {
    return record;
  }

  /**
   * Readiness never assumes a configuration exists. With no active version every
   * required parameter is reported missing rather than silently treated as zero.
   */
  public async readiness(): Promise<{
    parameters: ModelParameter[];
    missing: ModelParameter[];
    provisional: string[];
    version: string | null;
    profile: 'paper' | 'demo' | null;
  }> {
    const active = await this.getActive();
    if (!active) {
      const parameters = paperProfileParameters();
      return {
        parameters,
        missing: missingParameters(parameters),
        provisional: provisionalParameters(parameters),
        version: null,
        profile: null
      };
    }
    return {
      parameters: active.parameters,
      missing: missingParameters(active.parameters),
      provisional: provisionalParameters(active.parameters),
      version: active.version,
      profile: active.profile
    };
  }

  public conflicts(): ResearchNote[] {
    return structuredClone(PAPER_CONFLICTS);
  }
}

export const modelConfigService = new ModelConfigService();
