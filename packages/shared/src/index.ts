/**
 * Shared contract for the CCOverT application: the versioned Express API, the
 * React client and the internal model service all speak these types.
 *
 * The model equation itself is implemented once, in Python. Nothing in this
 * package computes coral cover.
 */

export const APP_VERSION = '1.0.0';
export const API_VERSION = 'v1';
export const TARGET_MEASURE = '%LCC (HC+SC)';

export const MODEL_NOT_CONFIGURED = 'MODEL_NOT_CONFIGURED' as const;
export const MODEL_PARAMETERS_NOT_CONFIGURED = 'MODEL_PARAMETERS_NOT_CONFIGURED' as const;
export const MODEL_SERVICE_UNAVAILABLE = 'MODEL_SERVICE_UNAVAILABLE' as const;
export const MODEL_SERVICE_ERROR = 'MODEL_SERVICE_ERROR' as const;
export const INPUT_DATA_UNAVAILABLE = 'INPUT_DATA_UNAVAILABLE' as const;
export const AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED' as const;
export const AI_PROVIDER_UNAVAILABLE = 'AI_PROVIDER_UNAVAILABLE' as const;
export const VALIDATION_ERROR = 'VALIDATION_ERROR' as const;

export type ApiErrorCode =
  | typeof MODEL_NOT_CONFIGURED
  | typeof MODEL_PARAMETERS_NOT_CONFIGURED
  | typeof MODEL_SERVICE_UNAVAILABLE
  | typeof MODEL_SERVICE_ERROR
  | typeof INPUT_DATA_UNAVAILABLE
  | typeof AI_NOT_CONFIGURED
  | typeof AI_PROVIDER_UNAVAILABLE
  | typeof VALIDATION_ERROR
  | 'UNAUTHENTICATED'
  | 'EMAIL_NOT_VERIFIED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_VERIFICATION_TOKEN'
  | 'VERIFICATION_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTERNAL_ERROR'
  | string;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/* -------------------------------------------------------------------------- */
/* study area                                                                  */
/* -------------------------------------------------------------------------- */

export type StudyAreaScope = 'citywide-annual-average' | 'reef-site' | string;

export interface StudyArea {
  id: string;
  label: string;
  scope: StudyAreaScope;
  description: string;
  referenceOnly?: boolean;
}

export const STUDY_AREA: StudyArea = {
  id: 'puerto-princesa-city',
  label: 'Puerto Princesa City, Palawan, Philippines',
  scope: 'citywide-annual-average',
  description:
    'The paper models the annual average live coral cover of Puerto Princesa City. This is a citywide annual model, not a validated per-reef-site or per-coordinate forecast.'
};

/** Sites named in the paper. They are reference context, not validated sites. */
export const PAPER_SITES = [
  'Babuyan',
  'Bacungan',
  'Bahile',
  'Bancao - bancao',
  'Binduyan',
  'Buenavista',
  'Kamuning',
  'Luzviminda',
  'Macarascas',
  'Manalo',
  'Mangigisda',
  'New Pangganan',
  'Salavacion',
  'San Manuel',
  'San Rafael',
  'Sta. Cruz',
  'Sta. Lucia',
  'Tagburos',
  'Tanabag'
] as const;

export const PAPER_ORGANIZATION = [
  { name: 'Jhenica O. Gabuat', role: 'Grade 12 - Researcher', institution: 'Palawan National School' },
  { name: 'Nonie Mae C. Montojo', role: 'Research Adviser', institution: 'Palawan National School' },
  { name: 'Jessa Mae P. Abrina', role: 'Instructor I', institution: 'Palawan State University, College of Sciences, GEMS Department' }
] as const;

/* -------------------------------------------------------------------------- */
/* accounts                                                                    */
/* -------------------------------------------------------------------------- */

export type UserRole = 'user' | 'researcher' | 'admin';

export interface UserPreferences {
  theme: 'light' | 'dark';
  language: 'en' | 'fil';
}

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  preferences: UserPreferences;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  verificationRequired?: boolean;
  /** Only returned by a development-mode API; never in production. */
  developmentVerificationUrl?: string;
  /** Development-only reset link, same rule as the verification link. */
  developmentPasswordResetUrl?: string;
  /** Present when a mail catcher is configured so tests can read the inbox. */
  delivery?: MailDelivery;
}

export type MailDelivery = 'sent' | 'development-only' | 'mail-catcher';

export interface CurrentUserResponse {
  user: User;
  modelStatus: ModelStatus;
}

/* -------------------------------------------------------------------------- */
/* model parameters and configuration                                          */
/* -------------------------------------------------------------------------- */

export type ParameterStatus =
  | 'reported'
  | 'provisional'
  | 'unspecified-in-paper'
  | 'synthetic-demo-only'
  | 'assumed'
  | 'not-required-for-horizon'
  | 'configured';

export type ReviewStatus = 'unreviewed' | 'reviewed' | 'synthetic' | 'disputed';

export interface ModelParameter {
  key: string;
  symbol: string;
  value: number | null;
  unit: string;
  status: ParameterStatus;
  description: string;
  provenance: string;
  reviewStatus: ReviewStatus;
  effectiveDate: string | null;
  notes: string;
  /** Set when the value was fitted from an imported dataset. */
  sourceDatasetId?: string | null;
}

export interface ModelConfig {
  id: string;
  version: string;
  active: boolean;
  /** A configuration version is always paper or demo; scenario runs are per-request. */
  profile: 'paper' | 'demo';
  studyAreaId: string;
  baselineYear: number;
  sstDatasetId?: string | null;
  tourismDatasetId?: string | null;
  archivedAt?: string | null;
  parameters: ModelParameter[];
  conditionConvention: ConditionConvention;
  solver: SolverSettings;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  createdBy: string;
  createdAt: string;
  effectiveDate: string | null;
  notes: string;
}

export interface ConditionBand {
  label: string;
  minPercent: number;
  maxPercent: number;
  upperInclusive: boolean;
}

export interface ConditionConvention {
  id: string;
  label: string;
  source: string;
  bands: ConditionBand[];
}

export interface SolverSettings {
  method: 'rk4';
  substepsPerYear: number;
  intervalMeanQuadrature: 'trapezoid';
  stateOutput: 'end-of-year';
  notes: string;
}

export interface ModelStatus {
  /** Whether the Express API can reach the internal model service. */
  service: 'available' | 'unavailable';
  /** Whether every parameter the equation needs has a configured value. */
  configured: boolean;
  equationVersion: string | null;
  modelVersion: string | null;
  activeModelConfigVersion: string | null;
  missingParameters: MissingParameter[];
  provisionalParameters: string[];
  activeProfile: 'paper' | 'demo' | 'scenario' | null;
  demoProfileAvailable: boolean;
  /** Scenario runs are always available; no environment switch gates them. */
  scenarioProfileAvailable: true;
  conditionConvention: ConditionConvention;
  solver: SolverSettings;
  studyArea: StudyArea;
  paperConflicts: ResearchNote[];
  message: string;
}

export interface MissingParameter {
  key: string;
  reason: string;
  requiredBy: string;
  note: string;
}

export interface ResearchNote {
  id: string;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* sourced input data                                                          */
/* -------------------------------------------------------------------------- */

export type DatasetKind = 'sst' | 'tourism' | 'coral-cover';

export type DatasetValidationStatus = 'validated' | 'needs-review' | 'rejected';

export interface DatasetRecord {
  year: number;
  value: number;
}

export interface EnvironmentalDataset {
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
  /** Only set by the researcher's g estimation. */
  derivedValue?: DerivedValue | null;
}

/**
 * A value derived from an imported series, such as a fitted model parameter.
 * It is informational: a researcher must still create a reviewed model
 * configuration version before the value is used in a prediction.
 */
export interface DerivedValue {
  key: string;
  value: number;
  method: string;
  note: string;
  warnings?: string[];
  derivedAt?: string;
  modelConfigVersion?: string | null;
}

export interface DatasetImportResponse {
  dataset: EnvironmentalDataset;
  warnings: string[];
}

export interface DatasetListResponse {
  datasets: EnvironmentalDataset[];
}

/* -------------------------------------------------------------------------- */
/* predictions                                                                 */
/* -------------------------------------------------------------------------- */

export interface AnnualPredictionPoint {
  year: number;
  tYears: number;
  coverStartPercent: number;
  coverEndPercent: number;
  coverIntervalMeanPercent: number;
  temperatureStartC: number;
  temperatureEndC: number;
  tourismStartArrivals: number;
  tourismEndArrivals: number;
  growthRateMean: number;
  thermalRateMean: number;
  tourismRateMean: number;
  growthContributionPp: number;
  thermalContributionPp: number;
  tourismContributionPp: number;
  stateClassification: string | null;
  meanClassification: string | null;
}

export interface SourceRecord {
  name: string;
  source: string;
  unit: string;
  timeWindow: string;
  coverage: string | null;
  scope: string | null;
  datasetId: string | null;
  retrievedAt: string | null;
}

export interface ConsentedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  consentedAt: string;
  /** Never used as a model input; the paper model is citywide. */
  contextOnly: true;
}

export interface CoralBaselineInput {
  coverPercent: number;
  year: number;
  hardCoralPercent: number | null;
  softCoralPercent: number | null;
  measure: string;
  surveySource: string;
  surveyScope: StudyAreaScope;
  sameScopeConfirmed: boolean;
}

/**
 * A value the analyst supplied to explore a scenario. It is never a finding:
 * `rationale` records why it was chosen and `range` is the interval it was
 * drawn from, so a reader can see how much the result depends on the guess.
 */
export interface ScenarioAssumption {
  key: string;
  value: number;
  unit: string;
  rationale: string;
  range: { min: number; max: number } | null;
}

export interface PredictionRequest {
  studyAreaId: string;
  scope: StudyAreaScope;
  profile: 'paper' | 'demo' | 'scenario';
  baselineYear: number;
  horizonYears: number;
  coralBaseline: CoralBaselineInput;
  sstDatasetId: string | null;
  tourismDatasetId: string | null;
  consentedLocation: ConsentedLocation | null;
  solver: Pick<SolverSettings, 'substepsPerYear'>;
  /** Required for the scenario profile, and rejected for paper and demo. */
  assumedValues: ScenarioAssumption[];
}

export interface PredictionResponse {
  predictionId: string;
  requestId: string;
  status: PredictionStatus;
  isDemo: boolean;
  /**
   * True for an exploratory run built on analyst-supplied assumptions. Scenario
   * results are never validated predictions and are excluded from validated
   * counts and reports.
   */
  isScenario: boolean;
  /**
   * The assumptions supplied for this run. An assumption for a parameter that
   * was already configured is kept for the audit trail but is not applied, and
   * the run records a warning saying so.
   */
  assumptions: ScenarioAssumption[];
  equationVersion: string;
  modelVersion: string;
  modelConfigVersion: string;
  targetMeasure: string;
  studyArea: StudyArea;
  scope: StudyAreaScope;
  baselineYear: number;
  horizonYears: number;
  initialCoverPercent: number;
  finalCoverPercent: number;
  finalIntervalMeanPercent: number;
  stateClassification: string | null;
  meanClassification: string | null;
  classificationConvention: ConditionConvention;
  annual: AnnualPredictionPoint[];
  parameters: ModelParameter[];
  solver: SolverSettings;
  sources: SourceRecord[];
  warnings: string[];
  createdAt: string;
}

export type PredictionStatus = 'computed' | 'demo' | 'scenario' | 'unavailable';

/** Only `computed` runs without assumptions count as validated predictions. */
export const isValidatedPrediction = (prediction: {
  status: PredictionStatus;
  isDemo: boolean;
  isScenario?: boolean;
}): boolean => prediction.status === 'computed' && !prediction.isDemo && !prediction.isScenario;

export const SCENARIO_LABEL = 'Assumption—not a validated finding';
export const SCENARIO_DISCLAIMER =
  `${SCENARIO_LABEL}. Exploratory scenario, not a validated prediction: this run substitutes analyst-assumed values for parameters the paper leaves unspecified. It must not be cited as a finding or compared against a validated run.`;

export interface PredictionRecord extends PredictionResponse {
  userId?: string;
  idempotencyKey: string | null;
  request: PredictionRequest;
}

export interface PredictionListResponse {
  predictions: PredictionRecord[];
  total: number;
}

export interface CreatePredictionResponse {
  /** The full stored record, including the request and idempotency key. */
  prediction: PredictionRecord;
  /** True when an existing record was returned for a repeated idempotency key. */
  replayed: boolean;
}

/* -------------------------------------------------------------------------- */
/* uploads and AI reports                                                       */
/* -------------------------------------------------------------------------- */

export interface UploadRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  extractionStatus: 'text-available' | 'extraction-unsupported' | 'not-extracted';
  textPreview: string | null;
  pageCount: number | null;
  storageKey: string;
}

export type AiReportKind = 'single-prediction' | 'history-summary';

export interface AiReport {
  id: string;
  kind: AiReportKind;
  title: string;
  body: string;
  generatedBy: 'ai-provider' | 'deterministic-summary';
  provider: string | null;
  model: string | null;
  referencedPredictionIds: string[];
  referencedUploadIds: string[];
  /** Where in the uploaded documents the report drew evidence from. */
  citations: AiCitation[];
  warnings: string[];
  createdAt: string;
}

export interface AiCitation {
  predictionId: string | null;
  uploadId: string | null;
  filename: string | null;
  /** 1-based page number for PDFs; null for text/CSV/JSON sources. */
  page: number | null;
  excerpt: string;
}

export interface AiReportListResponse {
  reports: AiReport[];
}

export interface CreateAiReportRequest {
  predictionId?: string;
  predictionIds?: string[];
  uploadIds?: string[];
  question?: string;
}

export interface CreateAiReportResponse {
  report: AiReport;
}

/* -------------------------------------------------------------------------- */
/* dashboard, research and settings                                             */
/* -------------------------------------------------------------------------- */

export interface DashboardResponse {
  today: string;
  studyArea: StudyArea;
  locationStatus: LocationStatus;
  predictionCount: number;
  aiReportCount: number;
  datasetCount: number;
  latestPrediction: PredictionRecord | null;
  historySnapshot: PredictionRecord[];
  modelStatus: ModelStatus;
  emailVerified: boolean;
}

export interface LocationStatus {
  studyAreaConfirmed: boolean;
  consentedLocation: ConsentedLocation | null;
  /** Always false: the published model is not a per-coordinate forecast. */
  siteLevelForecastAvailable: false;
  message: string;
}

export interface ResearchSummary {
  title: string;
  organization: typeof PAPER_ORGANIZATION;
  sites: typeof PAPER_SITES;
  targetMeasure: string;
  equations: Record<string, string>;
  reportedAverageCover: PaperCoverPoint[];
  reportedProjectedCover: PaperCoverPoint[];
  reportedAccuracy: typeof PAPER_REPORTED_ACCURACY;
  accuracyDisclaimer: string;
  conditionConvention: ConditionConvention;
  paperConflicts: ResearchNote[];
  referenceDiagnostics: { label: string; value: string; note: string }[];
  stations: StudyArea[];
}

export interface PaperCoverPoint {
  year: number;
  percent: number;
  status: 'paper-reported' | 'paper-reported projection' | 'model-output';
}

export const PAPER_REPORTED_AVERAGE_COVER: PaperCoverPoint[] = [
  { year: 2006, percent: 57, status: 'paper-reported' },
  { year: 2016, percent: 46, status: 'paper-reported' }
];

export const PAPER_REPORTED_PROJECTED_COVER: PaperCoverPoint[] = (
  [
    [2006, 57], [2007, 57], [2008, 57], [2009, 56], [2010, 56], [2011, 55],
    [2012, 54], [2013, 52], [2014, 50], [2015, 49], [2016, 46], [2017, 44],
    [2018, 42], [2019, 40], [2020, 38], [2021, 38], [2022, 38], [2023, 38],
    [2024, 38], [2025, 37], [2026, 35], [2027, 34], [2028, 33], [2029, 32],
    [2030, 30], [2031, 28], [2032, 27], [2033, 24], [2034, 22], [2035, 20],
    [2036, 18]
  ] as const
).map(([year, percent]) => ({ year, percent, status: 'paper-reported projection' as const }));

export const PAPER_REPORTED_ACCURACY = {
  table4: [
    { year: 2006, observedPercent: 45.83, predictedPercent: 45.83, reportedAbsoluteErrorPercent: 0 },
    { year: 2016, observedPercent: 46.2, predictedPercent: 45.9, reportedAbsoluteErrorPercent: 0.3 }
  ],
  table5: [
    { year: 2006, observedPercent: 57.25, computedPercent: 57.25 },
    { year: 2016, observedPercent: 46.2, computedPercent: 46.171 }
  ]
} as const;

export const PAPER_REPORTED_MAE = 0.3;

export const PAPER_ACCURACY_DISCLAIMER =
  'The paper reports a mean absolute error of 0.30. That figure does not reconcile with the values shown in the ' +
  "paper's own results tables, and this application has not independently validated it. Treat it as a " +
  'paper-reported claim only.';

export const CONDITION_CONVENTION: ConditionConvention = {
  id: 'provisional-gap-free-v1',
  label: 'Provisional gap-free condition convention',
  source:
    "Application convention. The paper's condition categories disagree at 75% cover, so this gap-free " +
    'convention is used and its source is displayed with every condition label.',
  bands: [
    { label: 'Poor', minPercent: 0, maxPercent: 25, upperInclusive: false },
    { label: 'Fair', minPercent: 25, maxPercent: 50, upperInclusive: false },
    { label: 'Good', minPercent: 50, maxPercent: 75, upperInclusive: false },
    { label: 'Excellent', minPercent: 75, maxPercent: 100, upperInclusive: true }
  ]
};

export const SOLVER_DEFAULTS: SolverSettings = {
  method: 'rk4',
  substepsPerYear: 12,
  intervalMeanQuadrature: 'trapezoid',
  stateOutput: 'end-of-year',
  notes:
    'The paper does not identify a numerical solver or define within-year averaging. This application uses ' +
    'classical fourth-order Runge-Kutta with a fixed substep per year and reports both the end-of-year state ' +
    'and the trapezoidal interval mean of live coral cover.'
};

export const PAPER_CONFLICTS: ResearchNote[] = [
  {
    id: 'pagasa-air-temperature',
    severity: 'warning',
    title: 'PAGASA appendix pages are not an SST series',
    detail:
      "The appendix PAGASA pages show meteorological-station observations, including air temperature, not a " +
      'verified sea-surface-temperature time series. T(t) requires SST in degrees Celsius, so weather-station ' +
      'air temperature is never substituted.'
  },
  {
    id: 'validation-window-conflict',
    severity: 'warning',
    title: 'Validation window conflicts with the results tables',
    detail:
      'The accuracy section describes 2015-2017 validation, but the results tables compare 2006 and 2016. The ' +
      '2006 observed cover and some 2016 predictions also conflict between tables.'
  },
  {
    id: 'mae-not-reconciled',
    severity: 'warning',
    title: 'Reported MAE of 0.30 does not reconcile with the displayed values',
    detail: PAPER_ACCURACY_DISCLAIMER
  },
  {
    id: 'condition-category-conflict',
    severity: 'info',
    title: 'Condition categories disagree at 75% cover',
    detail:
      "The paper's condition wording is not gap-free at 75%. This application uses the configurable, gap-free " +
      `convention "${CONDITION_CONVENTION.id}" and always shows which convention produced a label.`
  },
  {
    id: 'unidentified-solver',
    severity: 'info',
    title: 'Solver and within-year averaging are not defined in the paper',
    detail: SOLVER_DEFAULTS.notes
  },
  {
    id: 'provisional-parameters',
    severity: 'warning',
    title: 'K and beta are provisional',
    detail:
      'K (70) and beta (5.6743e-8) appear only in the handwritten Appendix C calculation and are provisional ' +
      'pending verification of value and units.'
  },
  {
    id: 'baseline-year-inference',
    severity: 'info',
    title: 'The 2006 baseline year is an inference',
    detail:
      "The paper's use of 2006 as t = 0 is an inference. The configured baseline year is stored and displayed " +
      'with every prediction.'
  },
  {
    id: 'alpha-g-unspecified',
    severity: 'warning',
    title: 'alpha and g are not numerically specified in the paper',
    detail:
      'Both parameters are required by the published equation. They stay unset until an authorised researcher ' +
      'supplies a documented value, and no default is ever substituted.'
  }
];

/** Parameter values transcribed from the paper, with their review state. */
export const PAPER_PARAMETERS: ModelParameter[] = [
  {
    key: 'r',
    symbol: 'r',
    value: 0.028,
    unit: 'per year',
    status: 'reported',
    description: 'Intrinsic coral-cover growth rate.',
    provenance: 'CCOverT paper, model parameter table.',
    reviewStatus: 'reviewed',
    effectiveDate: null,
    notes: ''
  },
  {
    key: 'alpha',
    symbol: 'alpha',
    value: null,
    unit: 'per degree Celsius per year',
    status: 'unspecified-in-paper',
    description: 'Thermal stress sensitivity.',
    provenance: 'Not numerically specified in the available paper text.',
    reviewStatus: 'unreviewed',
    effectiveDate: null,
    notes: 'Required when SST can exceed Tcrit in the requested horizon. Zero is never substituted as a configured value; an inactive horizon is recorded explicitly.'
  },
  {
    key: 'beta',
    symbol: 'beta',
    value: 5.6743e-8,
    unit: 'per tourist arrival per year (inferred; units unclear in the paper)',
    status: 'provisional',
    description: 'Tourism-pressure sensitivity.',
    provenance: 'CCOverT paper, handwritten Appendix C calculation.',
    reviewStatus: 'unreviewed',
    effectiveDate: null,
    notes: 'Provisional: value and units still require verification.'
  },
  {
    key: 'gamma',
    symbol: 'gamma',
    value: 0.013,
    unit: 'degrees Celsius per year',
    status: 'reported',
    description: 'Linear sea-surface-temperature trend.',
    provenance: 'CCOverT paper, model parameter table.',
    reviewStatus: 'reviewed',
    effectiveDate: null,
    notes: 'T(t) must be sea-surface temperature; air temperature is not a substitute.'
  },
  {
    key: 'T0',
    symbol: 'T0',
    value: 30.19,
    unit: 'degrees Celsius',
    status: 'reported',
    description: 'Sea-surface temperature at the baseline year (t = 0).',
    provenance: 'CCOverT paper, model parameter table; source type not independently verified as SST.',
    reviewStatus: 'reviewed',
    effectiveDate: null,
    notes: 'Confirm that this 30.19 degrees Celsius source is sea-surface temperature; air temperature is not a substitute.'
  },
  {
    key: 'Tcrit',
    symbol: 'Tcrit',
    value: 31,
    unit: 'degrees Celsius',
    status: 'reported',
    description: 'Critical sea-surface-temperature threshold.',
    provenance: 'CCOverT paper, model parameter table.',
    reviewStatus: 'reviewed',
    effectiveDate: null,
    notes: ''
  },
  {
    key: 'V0',
    symbol: 'V0',
    value: 147806,
    unit: 'tourist arrivals per year',
    status: 'reported',
    description: 'Annual tourist arrivals at the baseline year.',
    provenance: 'CCOverT paper, model parameter table (baseline year 2006).',
    reviewStatus: 'reviewed',
    effectiveDate: null,
    notes: 'Confirm the study-area coverage of this citywide arrival count.'
  },
  {
    key: 'g',
    symbol: 'g',
    value: null,
    unit: 'per year',
    status: 'unspecified-in-paper',
    description: 'Continuous growth rate of annual tourist arrivals.',
    provenance: 'Not numerically specified in the available paper text.',
    reviewStatus: 'unreviewed',
    effectiveDate: null,
    notes: 'Required. Estimate only from a verified annual tourism series and record that series as the source.'
  },
  {
    key: 'K',
    symbol: 'K',
    value: 70,
    unit: 'coral-cover percentage points',
    status: 'provisional',
    description: 'Carrying capacity of live coral cover.',
    provenance: 'CCOverT paper, handwritten Appendix C calculation.',
    reviewStatus: 'unreviewed',
    effectiveDate: null,
    notes: 'Provisional: must use the same 0-100 percentage-point scale as C.'
  }
];

export const REQUIRED_PARAMETER_KEYS = ['r', 'alpha', 'beta', 'gamma', 'T0', 'Tcrit', 'V0', 'g', 'K'] as const;
export type RequiredParameterKey = (typeof REQUIRED_PARAMETER_KEYS)[number];

export const DEMO_PROFILE_LABEL = 'DEMO (synthetic, development only)';

export const DEMO_SYNTHETIC_PARAMETERS: Record<string, number> = { alpha: 0.05, g: 0.02 };

/* -------------------------------------------------------------------------- */
/* pure helpers shared by the client and the API                               */
/* -------------------------------------------------------------------------- */

export function isCompleteConditionBands(bands: ConditionBand[]): boolean {
  if (bands.length === 0) return false;
  const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);
  if (sorted[0].minPercent !== 0) return false;
  const last = sorted[sorted.length - 1];
  if (last.maxPercent !== 100 || !last.upperInclusive) return false;
  return sorted.every((band, index) => {
    const next = sorted[index + 1];
    if (band.minPercent < 0 || band.maxPercent > 100 || band.maxPercent <= band.minPercent) return false;
    if (band.upperInclusive && next) return false;
    return !next || band.maxPercent === next.minPercent;
  });
}

export function classifyPercent(percent: number, bands: ConditionBand[]): string | null {
  if (!Number.isFinite(percent) || !isCompleteConditionBands(bands)) return null;
  const match = bands.find((band) =>
    band.upperInclusive
      ? percent >= band.minPercent && percent <= band.maxPercent
      : percent >= band.minPercent && percent < band.maxPercent
  );
  return match ? match.label : null;
}

export function unconfiguredParameters(parameters: ModelParameter[]): ModelParameter[] {
  const byKey = new Map(parameters.map((parameter) => [parameter.key, parameter]));
  return REQUIRED_PARAMETER_KEYS.filter((key) => {
    const parameter = byKey.get(key);
    return !parameter || parameter.value === null || parameter.value === undefined;
  })
    .map((key) => byKey.get(key))
    .filter((parameter): parameter is ModelParameter => Boolean(parameter));
}

/**
 * The thermal term is exactly zero when the linear SST driver never exceeds
 * Tcrit over the requested interval. This is a horizon-specific readiness
 * exception, not a configured value for alpha.
 */
export function thermalTermInactiveForHorizon(parameters: ModelParameter[], horizonYears: number): boolean {
  if (!Number.isInteger(horizonYears) || horizonYears < 1) return false;
  const byKey = new Map(parameters.map((parameter) => [parameter.key, parameter.value]));
  const t0 = byKey.get('T0');
  const gamma = byKey.get('gamma');
  const tcrit = byKey.get('Tcrit');
  if (![t0, gamma, tcrit].every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  const start = t0 as number;
  const end = start + (gamma as number) * horizonYears;
  return Math.max(start, end) <= (tcrit as number);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Peak-to-trough change over a series, used for the trend summary. */
export function seriesTrend(points: { coverStartPercent?: number; coverEndPercent: number }[]): {
  delta: number | null;
  direction: 'rising' | 'falling' | 'flat' | 'unknown';
} {
  if (points.length < 2) return { delta: null, direction: 'unknown' };
  const first = points[0].coverStartPercent ?? points[0].coverEndPercent;
  const delta = points[points.length - 1].coverEndPercent - first;
  if (Math.abs(delta) < 0.05) return { delta, direction: 'flat' };
  return { delta, direction: delta > 0 ? 'rising' : 'falling' };
}
