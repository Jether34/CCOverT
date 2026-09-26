import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * npm workspace scripts run with the workspace directory as the working
 * directory, so a repository-root `.env` would be invisible to a bare
 * `dotenv.config()`. Walk up until a `.env` is found; environment variables that
 * are already set (Docker, CI, `dotenv -e`) always win because dotenv does not
 * override them.
 */
const findEnvFile = (start: string): string | null => {
  let directory = path.resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
};

const envFile = process.env.ENV_FILE ?? findEnvFile(process.cwd());
if (envFile) {
  dotenv.config({ path: envFile });
}

const asBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const asNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asList = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const generatedDevelopmentSecret = crypto.randomBytes(32).toString('hex');
const configuredSessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
const sessionSecret = configuredSessionSecret || (isProduction ? '' : generatedDevelopmentSecret);
const unsafeProductionSecrets = new Set(['replace-with-a-long-random-session-secret']);

if (isProduction && (sessionSecret.length < 32 || unsafeProductionSecrets.has(sessionSecret))) {
  throw new Error('SESSION_SECRET must be a non-placeholder value of at least 32 characters in production');
}

const mongoUri = process.env.MONGODB_URI?.trim() ?? '';
const useMemoryDb = asBoolean(process.env.USE_MEMORY_DB, !isProduction && !mongoUri);
if (isProduction && useMemoryDb) {
  throw new Error('USE_MEMORY_DB must be false in production');
}
if (isProduction && !useMemoryDb && !mongoUri) {
  throw new Error('MONGODB_URI is required in production');
}

const allowDemoProfile = asBoolean(process.env.ALLOW_DEMO_PROFILE, false);
if (isProduction && allowDemoProfile) {
  throw new Error('ALLOW_DEMO_PROFILE must be false in production: the demo profile uses synthetic values');
}

const modelServiceToken = process.env.MODEL_SERVICE_TOKEN?.trim() ?? '';
if (isProduction && modelServiceToken.length < 24) {
  throw new Error('MODEL_SERVICE_TOKEN must be at least 24 characters in production');
}

const modelServiceUrl = process.env.MODEL_SERVICE_URL?.trim() ?? 'http://localhost:8000';
if (isProduction && !modelServiceUrl.startsWith('https://') && !modelServiceUrl.startsWith('http://model')) {
  // The internal service is reached over the private network; TLS is only
  // required when it is not a Compose-internal hostname.
  if (!/^http:\/\/(model|localhost|127\.0\.0\.1)/.test(modelServiceUrl)) {
    throw new Error('MODEL_SERVICE_URL must use HTTPS or an internal service hostname in production');
  }
}

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  port: asNumber(process.env.PORT, 4000),
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  mongoUri,
  useMemoryDb,
  sessionSecret,
  sessionCookieName: 'ccover_t_session',
  sessionMaxAgeMs: 1000 * 60 * 60 * 24 * 7,
  trustProxy: asBoolean(process.env.TRUST_PROXY, false),
  cookieSecure: isProduction ? true : asBoolean(process.env.COOKIE_SECURE, false),
  logLevel: (process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info')).toLowerCase(),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: asNumber(process.env.SMTP_PORT, 587),
    secure: asBoolean(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? ''
  },
  /**
   * Mailpit/MailHog style inbox used by the local Compose stack. When set, the
   * API returns the captured message id so tests and the UI can open the inbox.
   */
  mailCatcher: {
    baseUrl: process.env.MAIL_CATCHER_URL?.trim() ?? '',
    enabled: asBoolean(process.env.MAIL_CATCHER_ENABLED, false)
  },
  devVerificationEnabled: isProduction ? false : asBoolean(process.env.DEV_VERIFICATION_ENABLED, true),
  model: {
    serviceUrl: modelServiceUrl.replace(/\/+$/, ''),
    serviceToken: modelServiceToken,
    timeoutMs: asNumber(process.env.MODEL_REQUEST_TIMEOUT_MS, 15000),
    allowDemoProfile
  },
  ai: {
    provider: process.env.AI_PROVIDER ?? 'disabled',
    url: process.env.AI_PROVIDER_URL ?? '',
    apiKey: process.env.AI_PROVIDER_API_KEY ?? '',
    model: process.env.AI_PROVIDER_MODEL ?? ''
  },
  data: {
    /** Sea-surface temperature provider. Disabled means "no feed configured". */
    sst: {
      provider: process.env.SST_PROVIDER ?? 'disabled',
      url: process.env.SST_PROVIDER_URL ?? '',
      apiKey: process.env.SST_PROVIDER_API_KEY ?? ''
    },
    /** Annual tourist arrivals provider. */
    tourism: {
      provider: process.env.TOURISM_PROVIDER ?? 'disabled',
      url: process.env.TOURISM_PROVIDER_URL ?? '',
      apiKey: process.env.TOURISM_PROVIDER_API_KEY ?? ''
    },
    /**
     * Optional context-only reef metrics (for example NOAA Coral Reef Watch
     * anomaly, HotSpot and DHW). These are displayed as context and are never
     * added to the published equation.
     */
    reefContext: {
      provider: process.env.REEF_CONTEXT_PROVIDER ?? 'disabled',
      url: process.env.REEF_CONTEXT_PROVIDER_URL ?? '',
      apiKey: process.env.REEF_CONTEXT_PROVIDER_API_KEY ?? ''
    }
  },
  uploads: {
    directory: path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')),
    maxBytes: asNumber(process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024)
  },
  /**
   * Per-route rate limiting is always on in production, on by default elsewhere,
   * and off only under NODE_ENV=test, where a whole suite shares one loopback IP
   * and would otherwise throttle itself instead of the behaviour under test.
   */
  rateLimitEnabled: isProduction ? true : isTest ? false : asBoolean(process.env.RATE_LIMIT_ENABLED, true),
  bootstrapAdminEmails: asList(process.env.BOOTSTRAP_ADMIN_EMAILS),
  bootstrapResearcherEmails: asList(process.env.BOOTSTRAP_RESEARCHER_EMAILS),
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
  bootstrapResearcherPassword: process.env.BOOTSTRAP_RESEARCHER_PASSWORD ?? '',
  dataRetentionDays: asNumber(process.env.DATA_RETENTION_DAYS, 365)
};

const isHttpsUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

const isHttpsOrigin = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

if (isProduction) {
  if (!isHttpsUrl(config.appUrl)) throw new Error('APP_URL must use HTTPS in production');
  if (config.webOrigins.length === 0 || config.webOrigins.some((origin) => !isHttpsOrigin(origin))) {
    throw new Error('WEB_ORIGIN must contain HTTPS browser origins in production');
  }
  if (config.ai.provider !== 'disabled' && !isHttpsUrl(config.ai.url)) throw new Error('AI_PROVIDER_URL must use HTTPS in production');
  for (const [name, provider] of Object.entries(config.data)) {
    if (provider.provider !== 'disabled' && !isHttpsUrl(provider.url)) {
      throw new Error(`${name.toUpperCase()}_PROVIDER_URL must use HTTPS in production`);
    }
  }
  if (!config.model.serviceToken) throw new Error('MODEL_SERVICE_TOKEN is required in production');
}

export const smtpConfigured = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from);
export const mailCatcherConfigured = config.mailCatcher.enabled && Boolean(config.mailCatcher.baseUrl);
export const aiProviderConfigured = config.ai.provider !== 'disabled' && Boolean(config.ai.url && config.ai.model);
