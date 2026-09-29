import crypto from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { EJSON } from 'bson';

export interface BackupArchive {
  createdAt: Date;
  collections: Record<string, unknown[]>;
}

export const createBackupArchive = (snapshot: BackupArchive): Buffer =>
  gzipSync(EJSON.stringify(snapshot));

/** Integrity check only: a separate staging restore drill is still required. */
export const verifyBackupArchive = (bytes: Buffer): { sha256: string; collections: Record<string, number> } => {
  if (bytes.length === 0 || bytes.length > 100_000_000) throw new Error('Backup archive is empty or exceeds the verification limit');
  const decoded = gunzipSync(bytes, { maxOutputLength: 500_000_000 });
  const parsed = EJSON.parse(decoded.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Backup archive has no valid manifest');
  const manifest = parsed as Partial<BackupArchive>;
  if (!(manifest.createdAt instanceof Date) || Number.isNaN(manifest.createdAt.getTime()) ||
      !manifest.collections || typeof manifest.collections !== 'object' || Array.isArray(manifest.collections)) {
    throw new Error('Backup archive manifest is invalid');
  }
  const collections: Record<string, number> = {};
  for (const [name, records] of Object.entries(manifest.collections)) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || !Array.isArray(records)) throw new Error('Backup archive contains an invalid collection');
    collections[name] = records.length;
  }
  return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), collections };
};
