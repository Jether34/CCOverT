import { config } from './config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = levels[(config.logLevel as LogLevel) in levels ? (config.logLevel as LogLevel) : 'info'];

/** Keys that must never reach the log stream. */
const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'apitoken',
  'apikey',
  'authorization',
  'cookie',
  'setcookie',
  'svctoken',
  'servicetoken',
  'x-service-token',
  'sessionsecret',
  'secret',
  'mnem'
]);

const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...[truncated]`;
  return value;
};

const emit = (level: Exclude<LogLevel, 'silent'>, message: string, context?: Record<string, unknown>): void => {
  if (levels[level] < threshold) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: redact(context) as Record<string, unknown> } : {})
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context)
};
