import { describe, expect, it } from 'vitest';
import { createBackupArchive, verifyBackupArchive } from '../src/services/backupArchive';

describe('backup archive integrity', () => {
  it('round-trips BSON Extended JSON and reports exact collection counts', () => {
    const bytes = createBackupArchive({ createdAt: new Date('2026-01-01T00:00:00Z'), collections: {
      users: [{ _id: 'u1' }], predictions: [{ _id: 'p1' }, { _id: 'p2' }]
    } });
    const verified = verifyBackupArchive(bytes);
    expect(verified.collections).toEqual({ users: 1, predictions: 2 });
    expect(verified.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => verifyBackupArchive(Buffer.from('corrupt archive'))).toThrow();
  });
});
