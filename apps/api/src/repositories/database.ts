import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mongoose, { Schema } from 'mongoose';
import type {
  AiReport,
  ConsentedLocation,
  CoralBaselineInput,
  DatasetKind,
  DatasetRecord,
  DatasetValidationStatus,
  DerivedValue,
  ModelConfig,
  ModelParameter,
  PredictionRequest,
  PredictionResponse,
  PredictionStatus,
  ResearchNote,
  SourceRecord,
  StudyAreaScope,
  UploadRecord,
  UserPreferences,
  UserRole
} from '@ccovert/shared';
import { config } from '../config';

/* -------------------------------------------------------------------------- */
/* stored record shapes                                                        */
/* -------------------------------------------------------------------------- */

export interface UserRecord {
  _id: string;
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  role: UserRole;
  preferences: UserPreferences;
  createdAt: string;
  disabledAt?: string | null;
  lastVerifiedLoginIp?: string | null;
}

export interface SmtpOverride {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  encryptedPassword: string;
  from: string;
}

export interface VerificationTokenRecord {
  _id: string;
  userId: string;
  purpose: 'email-verification' | 'password-reset' | 'login-otp';
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface ModelConfigRecord extends ModelConfig {
  _id: string;
}

export interface EnvironmentalDatasetRecord {
  _id: string;
  id: string;
  kind: DatasetKind;
  studyAreaId: string;
  label: string;
  provider: string;
  sourceCitation: string;
  unit: string;
  scope: StudyAreaScope;
  spatialCoverage: string;
  temporalCoverage: { firstYear: number; lastYear: number; yearCount: number };
  records: DatasetRecord[];
  status: DatasetValidationStatus;
  ownerId: string | null;
  createdAt: string;
  checksumSha256?: string;
  derivedValue: DerivedValue | null;
  updatedAt?: string;
  /**
   * Set only by the admin review endpoint. `importCsv` never writes it, which is
   * why an imported series cannot claim to be validated on its own.
   */
  review?: DatasetReviewRecord | null;
}

export interface DatasetReviewRecord {
  status: DatasetValidationStatus;
  reviewedById: string;
  reviewedByLabel: string;
  notes: string;
  reviewedAt: string;
}

export interface PredictionRecordStored {
  _id: string;
  id: string;
  userId: string;
  status: PredictionStatus;
  validationStatus?: 'not-validated' | 'independently-validated';
  isDemo: boolean;
  /** True for an exploratory run built on analyst-assumed parameters. */
  isScenario: boolean;
  isPaperReproduction?: boolean;
  alphaResolution?: 'explicit' | 'inactive-for-horizon';
  tourismGrowthPeriods?: PredictionResponse['tourismGrowthPeriods'];
  /** The assumed values this run depends on; empty for paper and demo runs. */
  assumptions: PredictionResponse['assumptions'];
  requestId: string;
  equationVersion: string;
  modelVersion: string;
  modelConfigVersion: string;
  modelConfigBaselineYear?: number;
  targetMeasure: string;
  studyArea: PredictionResponse['studyArea'];
  scope: StudyAreaScope;
  baselineYear: number;
  predictionStartYear?: number;
  horizonYears: number;
  forecastEndYear?: number;
  initialCoverPercent: number;
  finalCoverPercent: number;
  finalIntervalMeanPercent: number;
  stateClassification: string | null;
  meanClassification: string | null;
  classificationConvention: PredictionResponse['classificationConvention'];
  annual: PredictionResponse['annual'];
  parameters: ModelParameter[];
  solver: PredictionResponse['solver'];
  sources: SourceRecord[];
  warnings: string[];
  failureReason?: string | null;
  request: PredictionRequest;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface UploadRecordStored extends UploadRecord {
  _id: string;
  userId: string;
}

export interface AiReportRecordStored extends AiReport {
  _id: string;
  userId: string;
}

/* -------------------------------------------------------------------------- */
/* mongoose schemas                                                           */
/* -------------------------------------------------------------------------- */

const preferencesSchema = new Schema({
  theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  language: { type: String, enum: ['en', 'fil'], default: 'en' },
  paperSite: { type: String, default: null }
}, { _id: false });

const userSchema = new Schema({
  _id: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, required: true, default: false },
  role: { type: String, enum: ['client', 'user', 'researcher', 'admin'], default: 'client', index: true },
  disabledAt: { type: String, default: null },
  lastVerifiedLoginIp: { type: String, default: null },
  preferences: { type: preferencesSchema, required: true },
  createdAt: { type: Date, required: true }
}, { collection: 'users' });

const tokenSchema = new Schema({
  _id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  purpose: { type: String, enum: ['email-verification', 'password-reset', 'login-otp'], required: true },
  tokenHash: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, required: true }
}, { collection: 'authTokens' });
tokenSchema.index({ userId: 1, purpose: 1 });

const modelParameterSchema = new Schema({
  key: { type: String, required: true },
  symbol: { type: String, required: true },
  value: { type: Number, default: null },
  unit: { type: String, required: true },
  status: { type: String, required: true },
  description: { type: String, required: true },
  provenance: { type: String, required: true },
  reviewStatus: { type: String, required: true },
  effectiveDate: { type: String, default: null },
  notes: { type: String, default: '' },
  sourceDatasetId: { type: String, default: null }
}, { _id: false });

const modelConfigSchema = new Schema({
  _id: { type: String, required: true },
  id: { type: String, required: true },
  version: { type: String, required: true, unique: true, index: true },
  active: { type: Boolean, required: true, default: false, index: true },
  profile: { type: String, enum: ['paper', 'demo'], required: true },
  studyAreaId: { type: String, required: true },
  baselineYear: { type: Number, required: true },
  predictionStartYear: { type: Number, required: true },
  horizonYears: { type: Number, required: true, default: 10 },
  forecastEndYear: { type: Number, required: true },
  initialCoverPercent: { type: Number, required: true, default: 57 },
  initialCoverYear: { type: Number, required: true, default: 2006 },
  initialCoverSource: { type: String, required: true, default: 'Researcher-configured baseline; source confirmation required' },
  sstDatasetId: { type: String, default: null },
  tourismDatasetId: { type: String, default: null },
  archivedAt: { type: String, default: null },
  parameters: { type: [modelParameterSchema], required: true },
  conditionConvention: { type: Schema.Types.Mixed, required: true },
  solver: { type: Schema.Types.Mixed, required: true },
  reviewStatus: { type: String, required: true },
  reviewedBy: { type: String, default: null },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, required: true },
  effectiveDate: { type: String, default: null },
  notes: { type: String, default: '' }
}, { collection: 'modelConfigs' });

const datasetSchema = new Schema({
  _id: { type: String, required: true },
  id: { type: String, required: true },
  kind: { type: String, enum: ['sst', 'tourism', 'coral-cover'], required: true, index: true },
  studyAreaId: { type: String, required: true, index: true },
  label: { type: String, required: true },
  provider: { type: String, required: true },
  sourceCitation: { type: String, required: true },
  checksumSha256: { type: String, default: null },
  unit: { type: String, required: true },
  scope: { type: String, required: true },
  spatialCoverage: { type: String, required: true },
  temporalCoverage: { type: Schema.Types.Mixed, required: true },
  records: { type: [Schema.Types.Mixed], required: true },
  status: { type: String, enum: ['validated', 'needs-review', 'rejected'], required: true },
  ownerId: { type: String, default: null },
  createdAt: { type: Date, required: true },
  derivedValue: { type: Schema.Types.Mixed, default: null },
  review: { type: Schema.Types.Mixed, default: null }
}, { collection: 'environmentalDatasets' });
const systemSettingSchema = new Schema({
  _id: { type: String, required: true },
  announcement: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: String, default: '' },
  smtp: { type: Schema.Types.Mixed, default: null }
}, { collection: 'systemSettings' });
datasetSchema.index({ kind: 1, studyAreaId: 1, createdAt: -1 });

const sourceSchema = new Schema({
  name: { type: String, required: true },
  source: { type: String, required: true },
  provider: { type: String, default: null },
  unit: { type: String, required: true },
  timeWindow: { type: String, required: true },
  coverage: { type: String, default: null },
  scope: { type: String, default: null },
  datasetId: { type: String, default: null },
  retrievedAt: { type: String, default: null },
  checksumSha256: { type: String, default: null }
}, { _id: false });

const annualSchema = new Schema({
  year: { type: Number, required: true },
  tYears: { type: Number, required: true },
  coverStartPercent: { type: Number, required: true },
  coverEndPercent: { type: Number, required: true },
  coverIntervalMeanPercent: { type: Number, required: true },
  temperatureStartC: { type: Number, required: true },
  temperatureEndC: { type: Number, required: true },
  tourismStartArrivals: { type: Number, required: true },
  tourismEndArrivals: { type: Number, required: true },
  tourismGrowthRate: { type: Number, default: null },
  tourismPeriodStartYear: { type: Number, default: null },
  tourismPeriodEndYear: { type: Number, default: null },
  growthRateMean: { type: Number, required: true },
  thermalRateMean: { type: Number, required: true },
  tourismRateMean: { type: Number, required: true },
  growthContributionPp: { type: Number, required: true },
  thermalContributionPp: { type: Number, required: true },
  tourismContributionPp: { type: Number, required: true },
  stateClassification: { type: String, default: null },
  meanClassification: { type: String, default: null }
}, { _id: false });

const predictionSchema = new Schema({
  _id: { type: String, required: true },
  id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  validationStatus: { type: String, default: 'not-validated' },
  status: { type: String, required: true },
  isDemo: { type: Boolean, required: true, default: false },
  isScenario: { type: Boolean, required: true, default: false },
  isPaperReproduction: { type: Boolean, default: false },
  alphaResolution: { type: String, default: null },
  tourismGrowthPeriods: { type: [Schema.Types.Mixed], default: [] },
  assumptions: { type: [Schema.Types.Mixed], default: [] },
  requestId: { type: String, required: true },
  equationVersion: { type: String, required: true },
  modelVersion: { type: String, required: true },
  modelConfigVersion: { type: String, required: true, index: true },
  modelConfigBaselineYear: { type: Number, default: null },
  targetMeasure: { type: String, required: true },
  studyArea: { type: Schema.Types.Mixed, required: true },
  scope: { type: String, required: true },
  baselineYear: { type: Number, required: true },
  horizonYears: { type: Number, required: true },
  initialCoverPercent: { type: Number, required: true },
  finalCoverPercent: { type: Number, required: true },
  finalIntervalMeanPercent: { type: Number, required: true },
  stateClassification: { type: String, default: null },
  meanClassification: { type: String, default: null },
  classificationConvention: { type: Schema.Types.Mixed, required: true },
  annual: { type: [annualSchema], required: true },
  parameters: { type: [modelParameterSchema], required: true },
  solver: { type: Schema.Types.Mixed, required: true },
  sources: { type: [sourceSchema], required: true },
  warnings: { type: [String], required: true },
  failureReason: { type: String, default: null },
  request: { type: Schema.Types.Mixed, required: true },
  idempotencyKey: { type: String, default: null },
  createdAt: { type: Date, required: true }
}, { collection: 'predictions' });
predictionSchema.index({ userId: 1, createdAt: -1 });
predictionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const uploadSchema = new Schema({
  _id: { type: String, required: true },
  id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  uploadedAt: { type: Date, required: true },
  extractionStatus: { type: String, required: true },
  textPreview: { type: String, default: null },
  pageCount: { type: Number, default: null },
  storageKey: { type: String, required: true }
}, { collection: 'uploads' });

const citationSchema = new Schema({
  predictionId: { type: String, default: null },
  uploadId: { type: String, default: null },
  filename: { type: String, default: null },
  page: { type: Number, default: null },
  excerpt: { type: String, required: true }
}, { _id: false });

const aiReportSchema = new Schema({
  _id: { type: String, required: true },
  id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['single-prediction', 'history-summary'], required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  generatedBy: { type: String, required: true },
  provider: { type: String, default: null },
  model: { type: String, default: null },
  referencedPredictionIds: { type: [String], required: true },
  referencedUploadIds: { type: [String], required: true },
  citations: { type: [citationSchema], required: true },
  warnings: { type: [String], required: true },
  createdAt: { type: Date, required: true }
}, { collection: 'aiReports' });
aiReportSchema.index({ userId: 1, createdAt: -1 });

function getModel(name: string, schema: Schema): any {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

const UserModel = getModel('User', userSchema);
const TokenModel = getModel('AuthToken', tokenSchema);
const ModelConfigModel = getModel('ModelConfig', modelConfigSchema);
const DatasetModel = getModel('EnvironmentalDataset', datasetSchema);
const PredictionModel = getModel('Prediction', predictionSchema);
const UploadModel = getModel('Upload', uploadSchema);
const AiReportModel = getModel('AiReport', aiReportSchema);
const SystemSettingModel = getModel('SystemSetting', systemSettingSchema);

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

const defaultPreferences = (): UserPreferences => ({ theme: 'light', language: 'en', paperSite: null });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const isDuplicateKey = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 11000);

export function isDuplicateKeyError(error: unknown): boolean {
  return isDuplicateKey(error);
}

const sortByCreatedAtDesc = <T extends { createdAt: string }>(records: T[]): T[] =>
  [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Mongoose documents store `id` as a virtual; lean results may not carry it. */
const withId = <T>(record: Record<string, unknown>): T => ({
  ...(clone(record) as T),
  id: (record.id as string | undefined) ?? (record._id as string)
});

/* -------------------------------------------------------------------------- */
/* database                                                                    */
/* -------------------------------------------------------------------------- */

interface MemoryStore {
  users: Map<string, UserRecord>;
  tokens: Map<string, VerificationTokenRecord>;
  modelConfigs: Map<string, ModelConfigRecord>;
  datasets: Map<string, EnvironmentalDatasetRecord>;
  predictions: Map<string, PredictionRecordStored>;
  uploads: Map<string, UploadRecordStored>;
  aiReports: Map<string, AiReportRecordStored>;
}

export class Database {
  public readonly memory: MemoryStore = {
    users: new Map(),
    tokens: new Map(),
    modelConfigs: new Map(),
    datasets: new Map(),
    predictions: new Map(),
    uploads: new Map(),
    aiReports: new Map()
  };

  private connected = false;
  private memorySystemSetting: { announcement: string; updatedBy: string; updatedAt: string; smtp: SmtpOverride | null } = { announcement: '', updatedBy: '', updatedAt: '', smtp: null };

  public async getSystemSetting(): Promise<{ announcement: string; updatedBy: string; updatedAt: string }> {
    if (this.isMemory) return { announcement: this.memorySystemSetting.announcement, updatedBy: this.memorySystemSetting.updatedBy, updatedAt: this.memorySystemSetting.updatedAt };
    const record = await SystemSettingModel.findById('global').lean().exec();
    return { announcement: record?.announcement ?? '', updatedBy: record?.updatedBy ?? '', updatedAt: record?.updatedAt ?? '' };
  }

  public async saveSystemSetting(announcement: string, updatedBy: string): Promise<void> {
    const value = { announcement, updatedBy, updatedAt: new Date().toISOString() };
    if (this.isMemory) { this.memorySystemSetting = { ...this.memorySystemSetting, ...value }; return; }
    await SystemSettingModel.updateOne({ _id: 'global' }, { $set: value }, { upsert: true }).exec();
  }

  public async getSmtpOverride(): Promise<SmtpOverride | null> {
    if (this.isMemory) return this.memorySystemSetting.smtp;
    const record = await SystemSettingModel.findById('global').lean().exec();
    return (record?.smtp as SmtpOverride | null) ?? null;
  }

  public async saveSmtpOverride(smtp: SmtpOverride): Promise<void> {
    if (this.isMemory) { this.memorySystemSetting.smtp = smtp; return; }
    await SystemSettingModel.updateOne({ _id: 'global' }, { $set: { smtp } }, { upsert: true }).exec();
  }

  public get isMemory(): boolean {
    return config.useMemoryDb || !config.mongoUri;
  }

  public async isReady(): Promise<boolean> {
    if (this.isMemory) return true;
    if (!this.connected || mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  public async connect(): Promise<void> {
    if (this.connected) return;
    if (this.isMemory) {
      this.connected = true;
      return;
    }
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([
      UserModel.syncIndexes(),
      TokenModel.syncIndexes(),
      ModelConfigModel.syncIndexes(),
      DatasetModel.syncIndexes(),
      PredictionModel.syncIndexes(),
      UploadModel.syncIndexes(),
      AiReportModel.syncIndexes()
    ]);
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (!this.connected || this.isMemory) return;
    await mongoose.disconnect();
    this.connected = false;
  }

  /* -- users ----------------------------------------------------------- */

  public async createUser(input: {
    email: string;
    passwordHash: string;
    emailVerified?: boolean;
    role?: UserRole;
    preferences?: UserPreferences;
  }): Promise<UserRecord> {
    const now = new Date();
    const id = crypto.randomUUID();
    const record: UserRecord = {
      _id: id,
      id,
      email: input.email,
      passwordHash: input.passwordHash,
      emailVerified: input.emailVerified ?? false,
      role: input.role ?? 'client',
      disabledAt: null,
      lastVerifiedLoginIp: null,
      preferences: input.preferences ?? defaultPreferences(),
      createdAt: now.toISOString()
    };
    if (this.isMemory) {
      if ([...this.memory.users.values()].some((user) => user.email === record.email)) {
        const error = new Error('duplicate email') as Error & { code: number };
        error.code = 11000;
        throw error;
      }
      this.memory.users.set(record._id, record);
      return clone(record);
    }
    const created = await UserModel.create({ ...record, createdAt: now });
    return this.mapUser(created.toObject());
  }

  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    if (this.isMemory) {
      const user = [...this.memory.users.values()].find((candidate) => candidate.email === normalized);
      return user ? clone(user) : null;
    }
    const user = await UserModel.findOne({ email: normalized }).lean().exec();
    return user ? this.mapUser(user as unknown as UserRecord) : null;
  }

  public async findUserById(id: string): Promise<UserRecord | null> {
    if (this.isMemory) {
      const user = this.memory.users.get(id);
      return user ? clone(user) : null;
    }
    const user = await UserModel.findById(id).lean().exec();
    return user ? this.mapUser(user as unknown as UserRecord) : null;
  }

  public async listUsers(): Promise<UserRecord[]> {
    if (this.isMemory) return sortByCreatedAtDesc([...this.memory.users.values()]).map(clone);
    const users = await UserModel.find().sort({ createdAt: -1 }).limit(500).lean().exec();
    return users.map((user: unknown) => this.mapUser(user as UserRecord));
  }

  public async updateUser(id: string, changes: Partial<UserRecord>): Promise<UserRecord | null> {
    if (this.isMemory) {
      const current = this.memory.users.get(id);
      if (!current) return null;
      const updated = { ...current, ...changes, _id: id, id: current.id };
      this.memory.users.set(id, updated);
      return clone(updated);
    }
    const setValues = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    const unsetValues = Object.fromEntries(Object.entries(changes).filter(([, value]) => value === undefined).map(([key]) => [key, '']));
    const update: Record<string, unknown> = {};
    if (Object.keys(setValues).length > 0) update.$set = setValues;
    if (Object.keys(unsetValues).length > 0) update.$unset = unsetValues;
    const user = Object.keys(update).length > 0
      ? await UserModel.findByIdAndUpdate(id, update, { new: true }).lean().exec()
      : await UserModel.findById(id).lean().exec();
    return user ? this.mapUser(user as unknown as UserRecord) : null;
  }

  public async deleteUser(id: string): Promise<boolean> {
    if (this.isMemory) return this.memory.users.delete(id);
    const result = await UserModel.deleteOne({ _id: id }).exec();
    return result.deletedCount === 1;
  }

  public async countUsersByRole(role: UserRole): Promise<number> {
    if (this.isMemory) return [...this.memory.users.values()].filter((user) => user.role === role).length;
    return UserModel.countDocuments({ role }).exec();
  }

  /* -- auth tokens ------------------------------------------------------ */

  public async createToken(input: {
    userId: string;
    purpose: VerificationTokenRecord['purpose'];
    tokenHash: string;
    expiresAt: Date;
  }): Promise<VerificationTokenRecord> {
    const now = new Date();
    const record: VerificationTokenRecord = {
      _id: crypto.randomUUID(),
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      usedAt: null,
      createdAt: now.toISOString()
    };
    if (this.isMemory) {
      this.memory.tokens.set(record._id, record);
      return clone(record);
    }
    const created = await TokenModel.create({ ...record, expiresAt: input.expiresAt, createdAt: now });
    return clone(created.toObject()) as VerificationTokenRecord;
  }

  public async findTokenByHash(tokenHash: string, purpose: VerificationTokenRecord['purpose']): Promise<VerificationTokenRecord | null> {
    if (this.isMemory) {
      const record = [...this.memory.tokens.values()].find((candidate) => candidate.tokenHash === tokenHash && candidate.purpose === purpose);
      return record ? clone(record) : null;
    }
    const record = await TokenModel.findOne({ tokenHash, purpose }).lean().exec();
    return record ? (clone(record) as VerificationTokenRecord) : null;
  }

  public async consumeToken(id: string): Promise<void> {
    if (this.isMemory) {
      const current = this.memory.tokens.get(id);
      if (current) this.memory.tokens.set(id, { ...current, usedAt: new Date().toISOString() });
      return;
    }
    await TokenModel.updateOne({ _id: id }, { $set: { usedAt: new Date() } }).exec();
  }

  public async invalidateTokensForUser(userId: string, purpose: VerificationTokenRecord['purpose']): Promise<void> {
    if (this.isMemory) {
      for (const [id, record] of this.memory.tokens) {
        if (record.userId === userId && record.purpose === purpose && !record.usedAt) {
          this.memory.tokens.set(id, { ...record, usedAt: new Date().toISOString() });
        }
      }
      return;
    }
    await TokenModel.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } }).exec();
  }

  /* -- model configuration ---------------------------------------------- */

  public async createModelConfig(record: ModelConfigRecord): Promise<ModelConfigRecord> {
    if (this.isMemory) {
      this.memory.modelConfigs.set(record._id, clone(record));
      return clone(record);
    }
    const created = await ModelConfigModel.create({ ...record, createdAt: new Date(record.createdAt) });
    return { ...(clone(created.toObject()) as ModelConfigRecord), id: (created.toObject() as { id?: string }).id ?? record.id };
  }

  public async findActiveModelConfig(): Promise<ModelConfigRecord | null> {
    if (this.isMemory) {
      const record = [...this.memory.modelConfigs.values()].find((candidate) => candidate.active);
      return record ? clone(record) : null;
    }
    const record = await ModelConfigModel.findOne({ active: true }).lean().exec();
    return record ? ({ ...(clone(record) as ModelConfigRecord), id: record.id ?? record._id } as ModelConfigRecord) : null;
  }

  public async findModelConfigByVersion(version: string): Promise<ModelConfigRecord | null> {
    if (this.isMemory) {
      const record = [...this.memory.modelConfigs.values()].find((candidate) => candidate.version === version);
      return record ? clone(record) : null;
    }
    const record = await ModelConfigModel.findOne({ version }).lean().exec();
    return record ? ({ ...(clone(record) as ModelConfigRecord), id: record.id ?? record._id } as ModelConfigRecord) : null;
  }

  public async listModelConfigs(limit = 50): Promise<ModelConfigRecord[]> {
    if (this.isMemory) {
      return sortByCreatedAtDesc([...this.memory.modelConfigs.values()]).slice(0, limit).map(clone);
    }
    const records = await ModelConfigModel.find().sort({ createdAt: -1 }).limit(limit).lean().exec();
    return records.map((record: Record<string, unknown>) => withId<ModelConfigRecord>(record as Record<string, unknown>));
  }

  public async setActiveModelConfig(id: string): Promise<void> {
    if (this.isMemory) {
      for (const [key, record] of this.memory.modelConfigs) {
        this.memory.modelConfigs.set(key, { ...record, active: key === id });
      }
      return;
    }
    await ModelConfigModel.updateMany({}, { $set: { active: false } }).exec();
    await ModelConfigModel.updateOne({ _id: id }, { $set: { active: true } }).exec();
  }

  public async archiveModelConfig(id: string): Promise<void> {
    if (this.isMemory) {
      const record = this.memory.modelConfigs.get(id);
      if (record) this.memory.modelConfigs.set(id, { ...record, archivedAt: new Date().toISOString() });
      return;
    }
    await ModelConfigModel.updateOne({ _id: id, active: false }, { $set: { archivedAt: new Date().toISOString() } }).exec();
  }

  /* -- datasets ---------------------------------------------------------- */

  public async createDataset(record: EnvironmentalDatasetRecord): Promise<EnvironmentalDatasetRecord> {
    if (this.isMemory) {
      this.memory.datasets.set(record._id, clone(record));
      return clone(record);
    }
    const created = await DatasetModel.create({ ...record, createdAt: new Date(record.createdAt) });
    const object = created.toObject();
    return { ...(clone(object) as EnvironmentalDatasetRecord), id: object.id ?? record.id };
  }

  public async findDatasetById(id: string): Promise<EnvironmentalDatasetRecord | null> {
    if (this.isMemory) {
      const record = this.memory.datasets.get(id);
      return record ? clone(record) : null;
    }
    const record = await DatasetModel.findById(id).lean().exec();
    return record ? ({ ...(clone(record) as EnvironmentalDatasetRecord), id: record.id ?? record._id } as EnvironmentalDatasetRecord) : null;
  }

  /** Partial update of a dataset, used to attach a derived value after a fit. */
  public async updateDataset(id: string, changes: Partial<EnvironmentalDatasetRecord>): Promise<EnvironmentalDatasetRecord> {
    if (this.isMemory) {
      const existing = this.memory.datasets.get(id);
      if (!existing) throw new Error(`No dataset with id ${id} exists`);
      const updated = { ...existing, ...clone(changes) };
      this.memory.datasets.set(id, updated);
      return clone(updated);
    }
    const record = await DatasetModel.findByIdAndUpdate(
      id,
      { $set: { ...clone(changes), updatedAt: new Date() } },
      { new: true }
    ).lean().exec();
    if (!record) throw new Error(`No dataset with id ${id} exists`);
    return { ...(clone(record) as EnvironmentalDatasetRecord), id: record.id ?? record._id } as EnvironmentalDatasetRecord;
  }

  public async listDatasets(filter: { kind?: DatasetKind; studyAreaId?: string } = {}): Promise<EnvironmentalDatasetRecord[]> {
    if (this.isMemory) {
      return sortByCreatedAtDesc([...this.memory.datasets.values()].filter((record) =>
        (!filter.kind || record.kind === filter.kind) && (!filter.studyAreaId || record.studyAreaId === filter.studyAreaId)
      )).map(clone);
    }
    const query: Record<string, unknown> = {};
    if (filter.kind) query.kind = filter.kind;
    if (filter.studyAreaId) query.studyAreaId = filter.studyAreaId;
    const records = await DatasetModel.find(query).sort({ createdAt: -1 }).limit(200).lean().exec();
    return records.map((record: Record<string, unknown>) => withId<EnvironmentalDatasetRecord>(record as Record<string, unknown>));
  }

  /* -- predictions -------------------------------------------------------- */

  public async createPrediction(record: PredictionRecordStored): Promise<PredictionRecordStored> {
    if (this.isMemory) {
      if (record.idempotencyKey) {
        const existing = [...this.memory.predictions.values()].find((candidate) =>
          candidate.userId === record.userId && candidate.idempotencyKey === record.idempotencyKey
        );
        if (existing) return clone(existing);
      }
      this.memory.predictions.set(record._id, clone(record));
      return clone(record);
    }
    const created = await PredictionModel.create({ ...record, createdAt: new Date(record.createdAt) });
    const object = created.toObject();
    return { ...(clone(object) as PredictionRecordStored), id: object.id ?? record.id };
  }

  public async findPredictionByIdempotencyKey(userId: string, idempotencyKey: string): Promise<PredictionRecordStored | null> {
    if (this.isMemory) {
      const record = [...this.memory.predictions.values()].find((candidate) =>
        candidate.userId === userId && candidate.idempotencyKey === idempotencyKey
      );
      return record ? clone(record) : null;
    }
    const record = await PredictionModel.findOne({ userId, idempotencyKey }).lean().exec();
    return record ? ({ ...(clone(record) as PredictionRecordStored), id: record.id ?? record._id } as PredictionRecordStored) : null;
  }

  public async listPredictions(userId: string, limit = 100): Promise<PredictionRecordStored[]> {
    if (this.isMemory) {
      return sortByCreatedAtDesc([...this.memory.predictions.values()].filter((record) => record.userId === userId))
        .slice(0, limit)
        .map(clone);
    }
    const records = await PredictionModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean().exec();
    return records.map((record: Record<string, unknown>) => withId<PredictionRecordStored>(record as Record<string, unknown>));
  }

  public async findPredictionForUser(id: string, userId: string): Promise<PredictionRecordStored | null> {
    if (this.isMemory) {
      const record = this.memory.predictions.get(id);
      return record && record.userId === userId ? clone(record) : null;
    }
    const record = await PredictionModel.findOne({ _id: id, userId }).lean().exec();
    return record ? ({ ...(clone(record) as PredictionRecordStored), id: record.id ?? record._id } as PredictionRecordStored) : null;
  }

  public async countPredictions(userId: string): Promise<number> {
    if (this.isMemory) return [...this.memory.predictions.values()].filter((record) => record.userId === userId).length;
    return PredictionModel.countDocuments({ userId }).exec();
  }

  /**
   * Counts only validated runs. Demo and scenario records are exploratory, so
   * they are excluded rather than reported as findings.
   */
  public async countValidatedPredictions(userId: string): Promise<number> {
    if (this.isMemory) {
      return [...this.memory.predictions.values()].filter(
        (record) => record.userId === userId && !record.isDemo && !record.isScenario && record.validationStatus === 'independently-validated'
      ).length;
    }
    return PredictionModel.countDocuments({ userId, isDemo: false, isScenario: false, validationStatus: 'independently-validated' }).exec();
  }

  /* -- uploads ------------------------------------------------------------ */

  public async createUpload(record: UploadRecordStored): Promise<UploadRecordStored> {
    if (this.isMemory) {
      this.memory.uploads.set(record._id, clone(record));
      return clone(record);
    }
    const created = await UploadModel.create({ ...record, uploadedAt: new Date(record.uploadedAt) });
    const object = created.toObject();
    return { ...(clone(object) as UploadRecordStored), id: object.id ?? record.id };
  }

  public async findUploadForUser(id: string, userId: string): Promise<UploadRecordStored | null> {
    if (this.isMemory) {
      const record = this.memory.uploads.get(id);
      return record && record.userId === userId ? clone(record) : null;
    }
    const record = await UploadModel.findOne({ _id: id, userId }).lean().exec();
    return record ? ({ ...(clone(record) as UploadRecordStored), id: record.id ?? record._id } as UploadRecordStored) : null;
  }

  public async listUploads(userId: string, limit = 50): Promise<UploadRecordStored[]> {
    if (this.isMemory) {
      return [...this.memory.uploads.values()]
        .filter((record) => record.userId === userId)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
        .slice(0, limit)
        .map(clone);
    }
    const records = await UploadModel.find({ userId }).sort({ uploadedAt: -1 }).limit(limit).lean().exec();
    return records.map((record: Record<string, unknown>) => withId<UploadRecordStored>(record as Record<string, unknown>));
  }

  public async deleteUploadForUser(id: string, userId: string): Promise<boolean> {
    const record = await this.findUploadForUser(id, userId);
    if (!record) return false;
    if (this.isMemory) {
      this.memory.uploads.delete(id);
    } else {
      const result = await UploadModel.deleteOne({ _id: id, userId }).exec();
      if (result.deletedCount !== 1) return false;
    }
    removeStoredFile(record.storageKey);
    return true;
  }

  /* -- AI reports ---------------------------------------------------------- */

  public async createAiReport(record: AiReportRecordStored): Promise<AiReportRecordStored> {
    if (this.isMemory) {
      this.memory.aiReports.set(record._id, clone(record));
      return clone(record);
    }
    const created = await AiReportModel.create({ ...record, createdAt: new Date(record.createdAt) });
    const object = created.toObject();
    return { ...(clone(object) as AiReportRecordStored), id: object.id ?? record.id };
  }

  public async invalidateAiReportsForPredictions(userId: string, predictionIds: string[]): Promise<number> {
    const ids = new Set(predictionIds);
    if (ids.size === 0) return 0;
    if (this.isMemory) {
      let removed = 0;
      for (const [id, report] of this.memory.aiReports.entries()) {
        if (report.userId === userId && report.referencedPredictionIds.some((predictionId) => ids.has(predictionId))) {
          this.memory.aiReports.delete(id);
          removed += 1;
        }
      }
      return removed;
    }
    const result = await AiReportModel.deleteMany({ userId, referencedPredictionIds: { $in: [...ids] } }).exec();
    return result.deletedCount ?? 0;
  }

  public async findAiReportForUser(id: string, userId: string): Promise<AiReportRecordStored | null> {
    if (this.isMemory) {
      const record = this.memory.aiReports.get(id);
      return record && record.userId === userId ? clone(record) : null;
    }
    const record = await AiReportModel.findOne({ _id: id, userId }).lean().exec();
    return record ? ({ ...(clone(record) as AiReportRecordStored), id: record.id ?? record._id } as AiReportRecordStored) : null;
  }

  public async listAiReports(userId: string, limit = 50): Promise<AiReportRecordStored[]> {
    if (this.isMemory) {
      return [...this.memory.aiReports.values()]
        .filter((record) => record.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    }
    const records = await AiReportModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean().exec();
    return records.map((record: Record<string, unknown>) => withId<AiReportRecordStored>(record as Record<string, unknown>));
  }

  public async countAiReports(userId: string): Promise<number> {
    if (this.isMemory) return [...this.memory.aiReports.values()].filter((record) => record.userId === userId).length;
    return AiReportModel.countDocuments({ userId }).exec();
  }

  public async listAiReportsForPrediction(userId: string, predictionId: string): Promise<AiReportRecordStored[]> {
    const reports = await this.listAiReports(userId, 200);
    return reports.filter((report) => report.referencedPredictionIds.includes(predictionId));
  }

  private mapUser(value: UserRecord): UserRecord {
    return {
      _id: value._id,
      id: value._id,
      email: value.email,
      passwordHash: value.passwordHash,
      emailVerified: value.emailVerified,
      role: value.role === 'user' ? 'client' : (value.role ?? 'client'),
      disabledAt: value.disabledAt ?? null,
      lastVerifiedLoginIp: value.lastVerifiedLoginIp ?? null,
      preferences: value.preferences ?? defaultPreferences(),
      createdAt: iso(value.createdAt)
    };
  }
}

/* -------------------------------------------------------------------------- */
/* database used by the service layer                                           */
/* -------------------------------------------------------------------------- */

/**
 * Services import `db` directly, so the instance the application runs against is
 * held here rather than captured at import time. `createApp({ database })` points
 * this at the injected database, which keeps tests and the running server on one
 * store instead of silently splitting state across two instances.
 */
let activeDatabase = new Database();

export const useDatabase = (database: Database): void => {
  if (database === db) {
    throw new Error('useDatabase requires a concrete Database, not the db proxy');
  }
  activeDatabase = database;
};

export const getDatabase = (): Database => activeDatabase;

export const db = new Proxy({} as Database, {
  get: (_target, property) => {
    const value = Reflect.get(activeDatabase, property) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(activeDatabase) : value;
  },
  has: (_target, property) => Reflect.has(activeDatabase, property)
});

/* -------------------------------------------------------------------------- */
/* private upload storage (never inside a public web directory)                */
/* -------------------------------------------------------------------------- */

export function resolveUploadPath(storageKey: string): string {
  const resolved = path.resolve(config.uploads.directory, storageKey);
  const root = path.resolve(config.uploads.directory);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Refusing to write outside the upload directory');
  }
  return resolved;
}

export function writeStoredFile(storageKey: string, bytes: Buffer): void {
  const target = resolveUploadPath(storageKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

export function readStoredFile(storageKey: string): Buffer | null {
  try {
    return fs.readFileSync(resolveUploadPath(storageKey));
  } catch {
    return null;
  }
}

function removeStoredFile(storageKey: string): void {
  try {
    fs.rmSync(resolveUploadPath(storageKey), { force: true });
  } catch {
    // A missing file is not an error: the metadata is already removed.
  }
}

export type { ConsentedLocation, CoralBaselineInput, ResearchNote };
