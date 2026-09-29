import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { createAuthMiddleware } from '../middleware/auth';
import type { Database } from '../repositories/database';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { sameOriginMiddleware } from '../utils/session';
import { listActivity, recordActivity } from '../services/activity';
import { modelConfigService } from '../services/modelConfigService';
import { encryptSmtpPassword, publicSmtp } from '../services/smtpSettings';
import { emailSchema, passwordSchema } from '../utils/validation';
import { createBackupArchive, verifyBackupArchive } from '../services/backupArchive';

const backupDirectory = path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), 'backups'));
const safeUser = (user: Awaited<ReturnType<Database['findUserById']>>) => user && ({
  id: user.id, email: user.email, role: user.role, emailVerified: user.emailVerified,
  disabledAt: user.disabledAt ?? null, createdAt: user.createdAt
});

export function createDeveloperRouter(database: Database): Router {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware(database);

  router.get('/config', requireAuth, asyncHandler(async (_request, response) => {
    // This endpoint is consumed by the shared app shell. Expose only the
    // developer-authored announcement; SMTP/system configuration stays admin-only
    // behind /developer/status.
    const setting = await database.getSystemSetting();
    response.json({ config: { announcement: setting.announcement } });
  }));

  router.get('/status', requireRole('admin'), asyncHandler(async (_request, response) => {
    const backups = await fs.readdir(backupDirectory).catch(() => []);
    const [users, datasets, versions, setting, smtpOverride] = await Promise.all([
      database.listUsers(), database.listDatasets(), modelConfigService.list(200), database.getSystemSetting(), database.getSmtpOverride()
    ]);
    response.json({
      database: database.isMemory ? 'memory' : 'mongodb',
      smtp: publicSmtp(smtpOverride),
      providers: { sst: config.data.sst.provider, tourism: config.data.tourism.provider, ai: config.ai.provider },
      counts: { users: users.length, datasets: datasets.length, modelVersions: versions.length },
      backups: backups.filter((name) => /^ccover-backup-\d{8}T\d{6}\.json\.gz$/.test(name)),
      backupAvailable: !database.isMemory,
      config: setting,
      users: users.map(safeUser),
      activity: listActivity()
    });
  }));

  router.patch('/config', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const input = z.object({ announcement: z.string().trim().max(300) }).parse(request.body);
    await database.saveSystemSetting(input.announcement, request.user!.email);
    recordActivity({ kind: 'change', action: 'Updated system announcement', actorId: request.user!.id });
    response.json({ config: await database.getSystemSetting() });
  }));

  router.patch('/smtp', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const input = z.object({
      enabled: z.boolean(), host: z.string().trim().min(1).max(200), port: z.number().int().min(1).max(65535),
      secure: z.boolean(), user: z.string().trim().min(1).max(200),
      password: z.string().max(500).optional(), from: z.string().trim().email().max(254)
    }).parse(request.body);
    const previous = await database.getSmtpOverride();
    const encryptedPassword = input.password ? encryptSmtpPassword(input.password) : previous?.encryptedPassword;
    if (!encryptedPassword) throw badRequest('Enter an SMTP password before enabling database SMTP settings');
    await database.saveSmtpOverride({ enabled: input.enabled, host: input.host, port: input.port, secure: input.secure, user: input.user, encryptedPassword, from: input.from });
    recordActivity({ kind: 'change', action: 'Updated SMTP configuration', actorId: request.user!.id });
    response.json({ smtp: publicSmtp(await database.getSmtpOverride()) });
  }));

  router.patch('/users/:id', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const input = z.object({ role: z.enum(['client', 'user', 'researcher', 'admin']).optional(), disabled: z.boolean().optional() }).parse(request.body);
    const target = await database.findUserById(String(request.params.id));
    if (!target) throw notFound('User not found');
    if (target.id === request.user!.id && (input.disabled || input.role && input.role !== 'admin')) throw forbidden('You cannot remove your own developer access');
    const updated = await database.updateUser(target.id, {
      ...(input.role ? { role: input.role } : {}),
      ...(input.disabled !== undefined ? { disabledAt: input.disabled ? new Date().toISOString() : null } : {})
    });
    recordActivity({ kind: 'change', action: `Updated access for ${target.email}`, actorId: request.user!.id });
    response.json({ user: safeUser(updated) });
  }));

  router.post('/users', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const input = z.object({ email: emailSchema, password: passwordSchema, role: z.enum(['client', 'researcher', 'admin']) }).parse(request.body);
    if (await database.findUserByEmail(input.email)) throw conflict('An account with that email already exists');
    const user = await database.createUser({ email: input.email, passwordHash: await bcrypt.hash(input.password, 12), emailVerified: true, role: input.role });
    recordActivity({ kind: 'change', action: `Created ${input.role} account ${input.email}`, actorId: request.user!.id });
    response.status(201).json({ user: safeUser(user) });
  }));

  router.post('/backups', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    if (database.isMemory) throw badRequest('Persistent database backups require MongoDB. This instance uses temporary in-memory storage.');
    const mongo = mongoose.connection.db;
    if (!mongo) throw badRequest('MongoDB is not connected');
    const collections = await mongo.listCollections().toArray();
    const snapshot: Record<string, unknown[]> = {};
    for (const collection of collections) snapshot[collection.name] = await mongo.collection(collection.name).find({}).toArray();
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
    const filename = `ccover-backup-${timestamp}.json.gz`;
    await fs.mkdir(backupDirectory, { recursive: true });
    const archive = createBackupArchive({ createdAt: new Date(), collections: snapshot });
    verifyBackupArchive(archive);
    await fs.writeFile(path.join(backupDirectory, filename), archive, { flag: 'wx', mode: 0o600 });
    recordActivity({ kind: 'change', action: `Created database backup ${filename}`, actorId: request.user!.id });
    response.status(201).json({ filename });
  }));

  router.post('/backups/:filename/verify', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const filename = String(request.params.filename);
    if (!/^ccover-backup-\d{8}T\d{6}\.json\.gz$/.test(filename)) throw badRequest('Invalid backup filename');
    const bytes = await fs.readFile(path.join(backupDirectory, filename)).catch(() => { throw notFound('Backup archive not found'); });
    const result = verifyBackupArchive(bytes);
    recordActivity({ kind: 'change', action: `Verified backup archive ${filename}`, actorId: request.user!.id });
    response.json({ filename, ...result, restoreDrillCompleted: false });
  }));

  return router;
}
