import bcrypt from 'bcryptjs';
import { config } from '../config';
import { db, type Database } from '../repositories/database';
import { logger } from '../logger';

/** Create explicitly configured development/deployment operators once. */
export async function ensureBootstrapUsers(database: Database = db): Promise<void> {
  const accounts = [
    { emails: config.bootstrapResearcherEmails, password: config.bootstrapResearcherPassword, role: 'researcher' as const },
    { emails: config.bootstrapAdminEmails, password: config.bootstrapAdminPassword, role: 'admin' as const }
  ];
  for (const account of accounts) {
    if (!account.password) continue;
    for (const email of account.emails) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) continue;
      const existing = await database.findUserByEmail(normalized);
      if (existing) {
        // Never promote an account that claimed an allowlisted address through
        // public signup. Existing accounts require an explicit admin review.
        if (existing.role !== account.role || !existing.emailVerified)
          logger.warn('Existing bootstrap address requires manual access review', { userId: existing.id, role: existing.role });
        continue;
      }
      await database.createUser({
        email: normalized,
        passwordHash: await bcrypt.hash(account.password, 12),
        emailVerified: true,
        role: account.role
      });
      logger.info('Created bootstrap account', { email: normalized, role: account.role });
    }
  }
}
