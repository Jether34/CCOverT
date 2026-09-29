import type {
  AiReport,
  AiReportListResponse,
  ApiErrorBody,
  CreateAiReportRequest,
  CreateAiReportResponse,
  CreatePredictionResponse,
  DashboardResponse,
  DatasetImportResponse,
  DatasetListResponse,
  EnvironmentalDataset,
  ModelConfig,
  ModelParameter,
  ModelStatus,
  PredictionListResponse,
  PredictionRecord,
  PredictionResponse,
  ResearchSummary,
  SolverSettings,
  UploadRecord,
  User,
  UserPreferences
} from '@ccovert/shared';

const BASE = '/api/v1';

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;
  public readonly requestId: string | undefined;
  public readonly prediction: PredictionRecord | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
    this.requestId = body.error.requestId;
    this.prediction = body.prediction;
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const isFormData = init.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(isFormData || init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.headers ?? {})
      }
    });
  } catch {
    throw new ApiRequestError(0, {
      error: { code: 'NETWORK_ERROR', message: 'The server could not be reached. Check your connection and try again.' }
    });
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({
    error: { code: 'NETWORK_ERROR', message: 'The server returned an unreadable response.' }
  }));
  if (!response.ok) throw new ApiRequestError(response.status, body as ApiErrorBody);
  return body as T;
};

export const newIdempotencyKey = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, data?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data), headers }),
  put: <T>(path: string, data: unknown): Promise<T> => request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown): Promise<T> => request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData): Promise<T> => request<T>(path, { method: 'POST', body: formData })
};

export const authApi = {
  me: () => api.get<{ user: User }>('/auth/me'),
  login: (email: string, password: string, captchaToken?: string) => api.post<{ user?: User; otpRequired: boolean; email?: string }>('/auth/login', { email, password, captchaToken }),
  verifyLoginOtp: (email: string, code: string) => api.post<{ user: User }>('/auth/login/otp', { email, code }),
  signup: (email: string, password: string, paperSite?: string, captchaToken?: string) =>
    api.post<{ user: User; verificationRequired?: boolean; developmentVerificationUrl?: string }>('/auth/signup', { email, password, paperSite, captchaToken }),
  verify: (token: string) => api.post<{ user: User; verified: boolean }>('/auth/verify', { token }),
  forgotPassword: (email: string) => api.post<{ accepted: boolean }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post<{ reset: boolean }>('/auth/reset-password', { token, password }),
  logout: () => api.post<void>('/auth/logout')
};

export const preferencesApi = {
  update: (preferences: UserPreferences) => api.patch<{ preferences: UserPreferences }>('/settings', preferences)
};

export const modelApi = {
  status: () => api.get<{ status: ModelStatus }>('/model/status'),
  parameters: () => api.get<{ activeVersion: string | null; baselineYear: number; horizonYears: number; initialCoverPercent: number; initialCoverYear: number; initialCoverSource: string; parameters: ModelParameter[]; solver: SolverSettings }>('/model/parameters'),
  updateConfiguration: (input: { changes: Record<string, number>; notes: string }) => api.put<{ version: ModelConfig }>('/model/configuration', input),
  versions: () => api.get<{ versions: ModelConfig[] }>('/model/versions'),
  createVersion: (input: {
    baseVersion: string;
    changes: Record<string, number>;
    notes: string;
    effectiveDate: string | null;
    reviewStatus: 'unreviewed' | 'reviewed';
    sourceDatasetIds?: Record<string, string>;
    sstDatasetId?: string | null;
    tourismDatasetId?: string | null;
    baselineYear?: number;
    horizonYears?: number;
    initialCoverPercent?: number;
    initialCoverYear?: number;
    initialCoverSource?: string;
  }) => api.post<{ version: ModelConfig }>('/model/versions', input),
  activateVersion: (id: string) => api.post<{ version: ModelConfig }>(`/model/versions/${encodeURIComponent(id)}/activate`),
  archiveVersion: (id: string) => api.delete<void>(`/model/versions/${encodeURIComponent(id)}`)
};

export interface DatasetImportForm {
  kind: 'sst' | 'tourism' | 'coral-cover';
  label: string;
  provider: string;
  sourceCitation: string;
  unit: string;
  scope: 'citywide-annual-average' | 'reef-site';
  spatialCoverage: string;
  reviewStatus?: 'validated' | 'needs-review';
}

export const dataApi = {
  list: (kind?: 'sst' | 'tourism' | 'coral-cover') =>
    api.get<DatasetListResponse>(`/data-imports${kind ? `?kind=${kind}` : ''}`),
  import: (fields: DatasetImportForm, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', fields.kind);
    form.append('label', fields.label);
    form.append('provider', fields.provider);
    form.append('sourceCitation', fields.sourceCitation);
    form.append('unit', fields.unit);
    form.append('scope', fields.scope);
    form.append('spatialCoverage', fields.spatialCoverage);
    if (fields.reviewStatus) form.append('reviewStatus', fields.reviewStatus);
    return api.upload<DatasetImportResponse>('/data-imports', form);
  },
  estimateG: (datasetId: string) => api.post<{ dataset: EnvironmentalDataset }>(`/data-imports/${encodeURIComponent(datasetId)}/estimate-g`),
  importWorkbook: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<{ datasets: EnvironmentalDataset[]; warnings: string[] }>('/data-imports/bulk', form);
  }
};

export interface ScenarioAssumptionForm {
  key: string;
  value: number;
  unit: string;
  rationale: string;
  range: { min: number; max: number } | null;
}

export interface PredictionRequestForm {
  profile: 'paper' | 'demo' | 'scenario' | 'paper-reproduction';
  baselineYear: number;
  horizonYears: number;
  forecastEndYear?: number;
  coverPercent: number;
  coralBaselineYear?: number;
  surveySource: string;
  surveyMethod: string;
  sstDatasetId: string | null;
  tourismDatasetId: string | null;
  consentedLocation: { latitude: number; longitude: number; accuracyMeters: number | null; consentedAt: string; contextOnly: true } | null;
  substepsPerYear: number;
  /** Only sent for the scenario profile. */
  assumedValues?: ScenarioAssumptionForm[];
}

export const predictionsApi = {
  create: (input: PredictionRequestForm, idempotencyKey: string) => {
    const body = {
      studyAreaId: 'puerto-princesa-city',
      scope: 'citywide-annual-average',
      profile: input.profile,
      baselineYear: input.baselineYear,
      horizonYears: input.horizonYears,
      forecastEndYear: input.forecastEndYear ?? input.baselineYear + input.horizonYears,
      coralBaseline: {
        coverPercent: input.coverPercent,
        year: input.coralBaselineYear ?? input.baselineYear,
        hardCoralPercent: null,
        softCoralPercent: null,
        measure: '%LCC (HC+SC)',
        surveySource: input.surveySource,
        surveyMethod: input.surveyMethod,
        surveyScope: 'citywide-annual-average',
        sameScopeConfirmed: true
      },
      sstDatasetId: input.sstDatasetId,
      tourismDatasetId: input.tourismDatasetId,
      consentedLocation: input.consentedLocation,
      solver: { substepsPerYear: input.substepsPerYear },
      assumedValues: input.profile === 'scenario' ? input.assumedValues ?? [] : []
    };
    return api.post<CreatePredictionResponse>('/predictions', body, { 'idempotency-key': idempotencyKey });
  },
  list: (limit = 100) => api.get<PredictionListResponse>(`/predictions?limit=${limit}`),
  get: (id: string) => api.get<{ prediction: PredictionRecord }>(`/predictions/${encodeURIComponent(id)}`),
  reportsFor: (id: string) => api.get<{ reports: AiReport[] }>(`/predictions/${encodeURIComponent(id)}/reports`),
  downloadUrl: (id: string, format: 'pdf' | 'csv') =>
    `${BASE}/predictions/${encodeURIComponent(id)}/download?format=${format}`
};

export const uploadsApi = {
  list: () => api.get<{ uploads: UploadRecord[] }>('/uploads'),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<{ upload: UploadRecord }>('/uploads', form);
  },
  remove: (id: string) => api.delete<void>(`/uploads/${encodeURIComponent(id)}`)
};

export const aiApi = {
  status: () => api.get<{ configured: boolean; provider: string; fallback: string; note: string }>('/ai/status'),
  reports: () => api.get<AiReportListResponse>('/ai/reports'),
  report: (id: string) => api.get<{ report: AiReport }>(`/ai/reports/${encodeURIComponent(id)}`),
  createReport: (input: CreateAiReportRequest) => api.post<CreateAiReportResponse>('/ai/reports', input)
};

export const dashboardApi = {
  load: () => api.get<DashboardResponse>('/dashboard')
};

export const researchApi = {
  summary: () => api.get<ResearchSummary>('/research')
};

export const downloadPrediction = (id: string, format: 'pdf' | 'csv'): void => {
  window.location.href = predictionsApi.downloadUrl(id, format);
};

const describeDetails = (details: unknown): string | null => {
  if (typeof details !== 'string') return null;
  const trimmed = details.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** The server sends a field-level `details` string alongside the generic message. Surface both. */
export const getErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiRequestError)) return 'Something went wrong. Please try again.';
  const details = describeDetails(error.details);
  if (details === null || details === error.message) return error.message;
  return `${error.message} ${details}`;
};

export const getErrorCode = (error: unknown): string =>
  error instanceof ApiRequestError ? error.code : 'UNKNOWN';

export const isNotConfigured = (error: unknown): boolean => {
  if (!(error instanceof ApiRequestError)) return false;
  return error.status === 503 || error.code.endsWith('NOT_CONFIGURED') || error.code === 'INPUT_DATA_UNAVAILABLE';
};

export type { PredictionResponse };
