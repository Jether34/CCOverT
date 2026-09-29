import { z } from 'zod';
import { PAPER_SITES, REQUIRED_PARAMETER_KEYS, SOLVER_DEFAULTS, STUDY_AREA } from '@ccovert/shared';
import { config } from '../config';

/* -------------------------------------------------------------------------- */
/* accounts                                                                    */
/* -------------------------------------------------------------------------- */

export const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(128)
  .regex(/[a-z]/, 'Password must include a lowercase letter.')
  .regex(/[A-Z]/, 'Password must include an uppercase letter.')
  .regex(/[0-9]/, 'Password must include a number.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be no longer than 72 UTF-8 bytes.');

export const signupSchema = z.object({ email: emailSchema, password: passwordSchema, paperSite: z.enum(PAPER_SITES), captchaToken: z.string().trim().max(4000).optional() });
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema, captchaToken: z.string().trim().max(4000).optional() });
export const loginOtpSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code sent to your email.'), captchaToken: z.string().trim().max(4000).optional() });
export const verifySchema = z.object({ token: z.string().min(20).max(300) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(300),
  password: passwordSchema
});
export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark']),
  language: z.enum(['en', 'fil']),
  paperSite: z.enum(PAPER_SITES).nullable().optional()
});
export const idSchema = z.string().min(1).max(100);

/* -------------------------------------------------------------------------- */
/* datasets                                                                    */
/* -------------------------------------------------------------------------- */

const datasetKindSchema = z.enum(['sst', 'tourism', 'coral-cover']);
const studyAreaScopeSchema = z.enum(['citywide-annual-average', 'reef-site']);

export const datasetImportFieldsSchema = z.object({
  kind: datasetKindSchema,
  label: z.string().trim().min(2).max(200),
  provider: z.string().trim().max(200).optional().default('user-import'),
  sourceCitation: z.string().trim().min(4, 'A source citation is required.').max(600),
  unit: z.string().trim().min(1).max(60),
  scope: studyAreaScopeSchema,
  spatialCoverage: z.string().trim().min(2).max(300),
  reviewStatus: z.enum(['validated', 'needs-review']).optional()
});

export const datasetImportSchema = datasetImportFieldsSchema.extend({
  file: z.string().min(1, 'Attach a CSV file with year and value columns.')
});

export const datasetListQuerySchema = z.object({
  kind: datasetKindSchema.optional(),
  studyAreaId: z.string().trim().min(1).max(120).optional()
});

/* -------------------------------------------------------------------------- */
/* predictions                                                                 */
/* -------------------------------------------------------------------------- */

const consentedLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().min(0).max(100000).nullable().default(null),
  consentedAt: z.string().datetime({ offset: true }).optional()
});

const coralBaselineSchema = z.object({
  coverPercent: z.coerce.number().min(0).max(100),
  year: z.coerce.number().int().min(1900).max(2200),
  hardCoralPercent: z.coerce.number().min(0).max(100).nullable().optional().default(null),
  softCoralPercent: z.coerce.number().min(0).max(100).nullable().optional().default(null),
  measure: z.string().trim().min(1).max(80).default('%LCC (HC+SC)'),
  surveySource: z.string().trim().min(2, 'Name the survey or report the baseline came from.').max(400)
    .refine((value) => /(?:18|19|20|21)\d{2}/.test(value), 'Include the source year for the coral-cover baseline.'),
  surveyMethod: z.string().trim().min(3).max(300).nullable().optional().default(null),
  surveyScope: studyAreaScopeSchema,
  sameScopeConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Confirm the baseline scope matches the citywide model scope.' })
  })
});

/**
 * An analyst-supplied value. `rationale` is mandatory so a stored run always
 * explains why a guess was made, and an optional range records the interval the
 * value was drawn from.
 */
const scenarioAssumptionSchema = z.object({
  // The paper only leaves alpha and g unspecified. Other parameters must not
  // be smuggled into a per-run scenario assumption.
  key: z.enum(['alpha', 'g']),
  value: z.coerce.number().finite(),
  unit: z.string().trim().min(1).max(120),
  rationale: z.string().trim().min(1).max(600),
  range: z
    .object({
      min: z.coerce.number().finite(),
      max: z.coerce.number().finite()
    })
    .nullable()
    .optional()
    .default(null)
});

export const createPredictionSchema = z.object({
  studyAreaId: z.string().trim().min(1).max(120).default(STUDY_AREA.id),
  scope: studyAreaScopeSchema.default('citywide-annual-average'),
  profile: z.enum(['paper', 'demo', 'scenario', 'paper-reproduction']).default('paper'),
  baselineYear: z.coerce.number().int().min(1900).max(2100),
  horizonYears: z.coerce.number().int().min(1).max(100),
  forecastEndYear: z.coerce.number().int().min(1901).max(2200).optional(),
  coralBaseline: coralBaselineSchema,
  sstDatasetId: idSchema.nullable().optional().default(null),
  tourismDatasetId: idSchema.nullable().optional().default(null),
  consentedLocation: consentedLocationSchema.nullable().optional().default(null),
  solver: z.object({
    substepsPerYear: z.coerce.number().int().min(1).max(100000).default(SOLVER_DEFAULTS.substepsPerYear)
  }).default({ substepsPerYear: SOLVER_DEFAULTS.substepsPerYear }),
  assumedValues: z.array(scenarioAssumptionSchema).max(2).optional().default([])
}).superRefine((value, ctx) => {
  const forecastEndYear = value.forecastEndYear ?? value.baselineYear + value.horizonYears;
  const derivedHorizonYears = forecastEndYear - value.baselineYear;
  if (forecastEndYear <= value.baselineYear) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['forecastEndYear'],
      message: `The forecast ending year (${forecastEndYear}) must be after the model baseline year (${value.baselineYear}).`
    });
  }
  if (forecastEndYear > config.model.maxForecastYear) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['forecastEndYear'],
      message: `The forecast ending year cannot exceed the configured maximum year ${config.model.maxForecastYear}.`
    });
  }
  if (derivedHorizonYears < 1 || derivedHorizonYears > config.model.maxForecastHorizonYears) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['forecastEndYear'],
      message: `The forecast duration must be between 1 and ${config.model.maxForecastHorizonYears} years; received ${derivedHorizonYears}.`
    });
  }
  const expectedProfileBaseline = value.baselineYear;
  if (value.coralBaseline.year !== expectedProfileBaseline) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coralBaseline', 'year'],
      message: value.profile === 'paper-reproduction'
        ? `The paper-reproduction coralBaseline.year must match baselineYear (${value.baselineYear}); received ${value.coralBaseline.year}.`
        : `The baseline year must match the request model baseline year (${value.baselineYear}); received ${value.coralBaseline.year}.`
    });
  }
  if (value.profile === 'demo' && !config.model.allowDemoProfile) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['profile'],
      message: 'The synthetic demo profile is disabled on this environment.'
    });
  }

  // A scenario run is only meaningful if it says what it assumed. Anything else
  // must not smuggle assumptions past the provenance gate.
  if (value.profile === 'scenario' && value.assumedValues.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assumedValues'],
      message: 'A scenario run must supply at least one assumed value with a rationale.'
    });
  }
  if (value.profile !== 'scenario' && value.assumedValues.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assumedValues'],
      message: 'Assumed values are only accepted for the scenario profile.'
    });
  }
  const seen = new Set<string>();
  for (const [index, assumption] of value.assumedValues.entries()) {
    if (seen.has(assumption.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assumedValues', index, 'key'],
        message: `An assumed value for ${assumption.key} was already supplied.`
      });
    }
    seen.add(assumption.key);
    if (assumption.range && assumption.range.min > assumption.range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assumedValues', index, 'range'],
        message: `The assumed range for ${assumption.key} must not run backwards.`
      });
    }
    if (assumption.range && (assumption.value < assumption.range.min || assumption.value > assumption.range.max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assumedValues', index, 'value'],
        message: `The assumed value for ${assumption.key} must lie inside its stated range.`
      });
    }
  }
});

export const predictionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100)
});

export const downloadQuerySchema = z.object({
  format: z.enum(['pdf', 'csv', 'markdown']).optional().default('pdf')
});

/* -------------------------------------------------------------------------- */
/* AI reports                                                                  */
/* -------------------------------------------------------------------------- */

export const createAiReportRequestSchema = z.object({
  predictionId: idSchema.optional(),
  predictionIds: z.array(idSchema).max(20).optional(),
  uploadIds: z.array(idSchema).max(20).optional().default([]),
  question: z.string().trim().min(1).max(2000).optional().nullable().default(null)
}).transform((value) => {
  const predictionIds = [...(value.predictionIds ?? []), ...(value.predictionId ? [value.predictionId] : [])];
  return { predictionIds: [...new Set(predictionIds)], uploadIds: value.uploadIds ?? [], question: value.question ?? null };
});

/* -------------------------------------------------------------------------- */
/* model configuration                                                         */
/* -------------------------------------------------------------------------- */

const parameterKeySchema = z.enum(REQUIRED_PARAMETER_KEYS);

export const createModelConfigSchema = z.object({
  baseVersion: z.string().trim().min(1).max(60),
  changes: z.record(parameterKeySchema, z.coerce.number().finite()),
  notes: z.string().trim().min(4, 'Explain where these values come from.').max(2000),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date.').nullable().optional().default(null),
  baselineYear: z.coerce.number().int().min(1900).max(2100).optional(),
  horizonYears: z.coerce.number().int().min(1).max(100).optional(),
  initialCoverPercent: z.coerce.number().finite().min(0).max(100).optional(),
  initialCoverYear: z.coerce.number().int().min(1900).max(2100).optional(),
  initialCoverSource: z.string().trim().min(4).max(400).optional(),
  reviewStatus: z.enum(['unreviewed', 'reviewed']).default('unreviewed'),
  sourceDatasetIds: z.record(z.string().trim().min(1).max(200)).optional(),
  sstDatasetId: idSchema.nullable().optional(),
  tourismDatasetId: idSchema.nullable().optional()
}).refine((value) => Object.keys(value.changes).length > 0 || value.sstDatasetId !== undefined || value.tourismDatasetId !== undefined, {
  message: 'Provide at least one parameter value or choose a dataset.'
});

/**
 * The application has one active model configuration. Researchers may update
 * its numeric parameters, while baseline, datasets, solver, and profile stay
 * owned by the active configuration and are inherited automatically.
 */
export const updateActiveModelParametersSchema = z.object({
  changes: z.record(parameterKeySchema, z.coerce.number().finite()).refine(
    (changes) => Object.keys(changes).length > 0,
    'Provide at least one model parameter.'
  ),
  notes: z.string().trim().min(4, 'Explain where these values come from.').max(2000)
});

/* -------------------------------------------------------------------------- */
/* independent review                                                          */
/* -------------------------------------------------------------------------- */

export const datasetReviewSchema = z.object({
  status: z.enum(['validated', 'needs-review', 'rejected']),
  notes: z.string().trim().min(4, 'Record why this series is or is not trustworthy.').max(2000)
});

export const modelConfigReviewSchema = z.object({
  version: z.string().trim().min(1).max(60),
  notes: z.string().trim().min(4, 'Record what you checked before signing off.').max(2000)
});

/* -------------------------------------------------------------------------- */
/* uploads                                                                     */
/* -------------------------------------------------------------------------- */

export const uploadFieldsSchema = z.object({
  purpose: z.enum(['source-document', 'dataset']).optional().default('source-document')
});

/* -------------------------------------------------------------------------- */
/* shared parse helper                                                         */
/* -------------------------------------------------------------------------- */

export const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => schema.parse(body);
