import { createApp } from './app';
import { Database } from './repositories/database';
import { config } from './config';
import { modelConfigService } from './services/modelConfigService';
import { logger } from './logger';
import { ensureBootstrapUsers } from './services/bootstrapUsers';

// A concrete instance, never the `db` proxy: `createApp` hands this to
// `useDatabase`, and registering the proxy would make it resolve through
// itself on every property read.
const database = new Database();

async function start(): Promise<void> {
  await database.connect();
  // `createApp` registers this instance as the shared `db` handle, and the
  // services read that handle. It must therefore be built before anything asks
  // the database a question, including the seed.
  const app = createApp({ database });
  await ensureBootstrapUsers(database);
  await modelConfigService.ensureSeeded();
  const server = app.listen(config.port, () => {
    logger.info('CCOverT API listening', { port: config.port, environment: config.nodeEnv, database: database.isMemory ? 'memory' : 'mongodb' });
  });

  const shutdown = (signal: string): void => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      void database.disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  logger.error('CCOverT API failed to start', { error: error instanceof Error ? error.message : 'unknown' });
  process.exitCode = 1;
});

export { Database };
