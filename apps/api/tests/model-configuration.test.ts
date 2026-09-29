import request from 'supertest';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Database } from '../src/repositories/database';

const { createApp } = await import('../src/app');
const { modelConfigService } = await import('../src/services/modelConfigService');
const { db } = await import('../src/repositories/database');

let app: Express;
let researcher: ReturnType<typeof request.agent>;

describe('shared active model configuration', () => {
  beforeAll(async () => {
    const database = new Database();
    app = createApp({ database });
    await modelConfigService.ensureSeeded();
    await db.createUser({
      email: 'parameter-researcher@example.test',
      passwordHash: await bcrypt.hash('StrongPassword123', 12),
      emailVerified: false,
      role: 'researcher'
    });
    researcher = request.agent(app);
    const login = await researcher.post('/api/v1/auth/login').send({
      email: 'parameter-researcher@example.test',
      password: 'StrongPassword123'
    });
    expect(login.status).toBe(200);
    expect(login.body.otpRequired).toBe(false);
  });

  it('publishes a changed parameter and exposes it as the active value for all clients', async () => {
    const before = await researcher.get('/api/v1/model/parameters');
    expect(before.status).toBe(200);
    const changedR = 0.0317;
    const published = await researcher.put('/api/v1/model/configuration').send({
      changes: { r: changedR, alpha: 0.05, g: 0.128708 },
      notes: 'Local end-to-end parameter propagation check'
    });
    expect(published.status).toBe(201);
    expect(published.body.version.active).toBe(true);

    const after = await researcher.get('/api/v1/model/parameters');
    expect(after.status).toBe(200);
    expect(after.body.activeVersion).toBe(published.body.version.version);
    expect(after.body.parameters.find((parameter: { key: string }) => parameter.key === 'r').value).toBe(changedR);
    expect(after.body.parameters.find((parameter: { key: string }) => parameter.key === 'alpha').value).toBe(0.05);
    expect(after.body.parameters.find((parameter: { key: string }) => parameter.key === 'g').value).toBe(0.128708);
  });
});
