import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { Database, useDatabase } from './repositories/database';
import { createAuthRouter } from './routes/auth';
import { createPredictionsRouter } from './routes/predictions';
import { createAiRouter } from './routes/ai';
import { createSettingsRouter } from './routes/settings';
import { createDashboardRouter } from './routes/dashboard';
import { createResearchRouter } from './routes/research';
import { createModelRouter } from './routes/model';
import { createDataImportsRouter } from './routes/dataImports';
import { createUploadsRouter } from './routes/uploads';
import { errorHandler, notFoundHandler } from './utils/errors';
import { logger } from './logger';
import { recordActivity } from './services/activity';
import { createDeveloperRouter } from './routes/developer';
import { modelClient } from './services/modelClient';
import { createAuthMiddleware } from './middleware/auth';
import { asyncHandler } from './utils/errors';

export interface AppDependencies {
  database?: Database;
}

const rateLimitHandler = (request: express.Request, response: express.Response): void => {
  response.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', requestId: request.requestId }
  });
};

const createRateLimiter = (limit: number) => {
  if (!config.rateLimitEnabled) {
    // Tests share one loopback address, so the limiter would throttle the
    // suite instead of the behaviour under test.
    return (_request: express.Request, _response: express.Response, next: express.NextFunction): void => next();
  }
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler
  });
};

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const database = dependencies.database ?? new Database();
  /**
   * Services and route middleware read the shared `db` handle, so the app points
   * it at the instance this app was built with. Without this, an injected test
   * database and the service layer would use two different stores.
   */
  useDatabase(database);
  const app = express();
  const responseCounts = new Map<number, number>();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // `true` reflects whatever origin asked, which is what local development
  // needs when the client is reached by more than one hostname. Production
  // uses the configured allowlist so a hostile page cannot read any response.
  app.use(cors({
    origin: config.nodeEnv === 'development' ? true : config.webOrigins,
    credentials: true
  }));

  /** Every response carries a request id, echoed from the browser when present. */
  app.use((request, response, next) => {
    const startedAt = Date.now();
    const incoming = request.get('x-request-id');
    const requestId = incoming && /^[\w-]{1,80}$/.test(incoming) ? incoming : randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    response.on('finish', () => {
      responseCounts.set(response.statusCode, (responseCounts.get(response.statusCode) ?? 0) + 1);
      recordActivity({ kind: 'request', action: `${request.method} ${request.path}`, actorId: request.user?.id ?? null, status: response.statusCode });
      logger.info('HTTP request completed', { requestId, method: request.method, path: request.path, status: response.statusCode, durationMs: Date.now() - startedAt });
    });
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/health', (request, response) => {
    response.json({
      status: 'ok',
      service: 'ccover-t-api',
      version: 1,
      environment: config.nodeEnv,
      database: database.isMemory ? 'memory' : 'mongodb',
      requestId: request.requestId
    });
  });

  app.get('/ready', asyncHandler(async (request, response) => {
    const [databaseReady, modelReady] = await Promise.all([database.isReady(), modelClient.isAvailable()]);
    response.status(databaseReady && modelReady ? 200 : 503).json({
      status: databaseReady && modelReady ? 'ready' : 'not-ready',
      database: databaseReady ? 'ready' : 'unavailable',
      modelService: modelReady ? 'ready' : 'unavailable',
      requestId: request.requestId
    });
  }));

  app.get('/metrics', createAuthMiddleware(database).requireRole('admin'), (_request, response) => {
    const lines = ['# TYPE ccovert_http_requests_total counter'];
    for (const [status, count] of [...responseCounts.entries()].sort(([a], [b]) => a - b)) {
      lines.push(`ccovert_http_requests_total{status="${status}"} ${count}`);
    }
    lines.push('# TYPE ccovert_process_uptime_seconds gauge', `ccovert_process_uptime_seconds ${process.uptime().toFixed(3)}`);
    response.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });

  const v1 = express.Router();
  v1.use('/auth', createRateLimiter(60), createAuthRouter(database));
  v1.use('/model', createRateLimiter(120), createModelRouter());
  v1.use('/data-imports', createRateLimiter(30), createDataImportsRouter());
  v1.use('/uploads', createRateLimiter(30), createUploadsRouter());
  v1.use('/predictions', createRateLimiter(60), createPredictionsRouter());
  v1.use('/ai', createRateLimiter(30), createAiRouter());
  v1.use('/settings', createSettingsRouter(database));
  v1.use('/dashboard', createRateLimiter(60), createDashboardRouter(database));
  v1.use('/research', createResearchRouter());
  v1.use('/developer', createDeveloperRouter(database));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  app.locals.database = database;
  logger.debug('Express app created', { environment: config.nodeEnv });
  return app;
}

export { Database };
