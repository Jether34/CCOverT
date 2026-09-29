import mongoose from 'mongoose';
import type { Database } from '../repositories/database';
import { logger } from '../logger';

/**
 * Forward-only, idempotent data migrations. Mongoose defaults cover new
 * records; these updates make older production records explicit before they
 * are used by the scientific and reporting gates.
 */
export const CURRENT_SCHEMA_VERSION = 3;

export async function runMigrations(database: Database): Promise<void> {
  if (database.isMemory || !mongoose.connection.db) return;
  const migrations = mongoose.connection.db.collection<{ _id: string; version: number; appliedAt: Date }>('schemaMigrations');
  const marker = await migrations.findOne({ _id: 'ccovert' });
  const version = marker?.version ?? 0;
  if (version >= CURRENT_SCHEMA_VERSION) return;

  if (version < 1) {
    await mongoose.connection.db.collection('predictions').updateMany(
      { validationStatus: { $exists: false } },
      { $set: { validationStatus: 'not-validated' } }
    );
  }
  if (version < 2) {
    // Existing imported data must re-enter the explicit review workflow. Do
    // not promote old records to validated merely because they predate review.
    await mongoose.connection.db.collection('datasets').updateMany(
      { status: { $exists: false } },
      { $set: { status: 'needs-review' } }
    );
    await mongoose.connection.db.collection('users').updateMany(
      { role: 'user' },
      { $set: { role: 'client' } }
    );
    await mongoose.connection.db.collection('modelConfigs').updateMany(
      { horizonYears: { $exists: false } },
      { $set: { horizonYears: 10, initialCoverPercent: 57, initialCoverYear: 2006, initialCoverSource: 'Legacy configuration; researcher confirmation required' } }
    );
  }
  // Backfill the explicit model window fields introduced after the original
  // configuration schema. They are derived from each immutable baseline and
  // horizon; they never change the scientific parameters.
  await mongoose.connection.db.collection('modelConfigs').updateMany(
    { $or: [{ predictionStartYear: { $exists: false } }, { forecastEndYear: { $exists: false } }] },
    [{ $set: {
      predictionStartYear: { $ifNull: ['$predictionStartYear', '$baselineYear'] },
      forecastEndYear: { $ifNull: ['$forecastEndYear', { $add: ['$baselineYear', '$horizonYears'] }] }
    } }]
  );
  await migrations.updateOne(
    { _id: 'ccovert' },
    { $set: { version: CURRENT_SCHEMA_VERSION, appliedAt: new Date() }, $setOnInsert: { _id: 'ccovert' } },
    { upsert: true }
  );
  logger.info('Applied database migrations', { from: version, to: CURRENT_SCHEMA_VERSION });
}
