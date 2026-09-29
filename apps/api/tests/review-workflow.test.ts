import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import { Database } from '../src/repositories/database';

/**
 * Closes the two structural blockers found in the production audit:
 *
 *  1. `reviewedBy` could never be set, so `paperReadiness` was unsatisfiable.
 *  2. A dataset could never reach `validated`, because `importCsv` discarded the
 *     client-supplied status and nothing else could change it.
 *
 * Policy under test: an admin validates datasets; a verified researcher other
 * than the author records the independent review of a configuration version.
 */

const { createApp } = await import('../src/app');
const { modelConfigService } = await import('../src/services/modelConfigService');
const { db } = await import('../src/repositories/database');

type Agent = ReturnType<typeof request.agent>;

let app: Express;
let database: Database;
let admin: Agent;
let author: Agent;
let secondResearcher: Agent;

const sstCsv = ['year,Sea Surface Temperature (degC)', '2006,30.42', '2010,30.46', '2016,30.51'].join('\n');
const tourismCsv = ['year,Tourist Arrivals', '2006,100000', '2010,108329', '2016,122140'].join('\n');

beforeAll(async () => {
  database = new Database();
  app = createApp({ database });
  await modelConfigService.ensureSeeded();

  admin = request.agent(app);
  await db.createUser({
    email: 'admin@example.test',
    passwordHash: await bcrypt.hash('StrongPassword123', 12),
    emailVerified: true,
    role: 'admin'
  });
  await admin.post('/api/v1/auth/login').send({ email: 'admin@example.test', password: 'StrongPassword123' });

  author = await verifiedResearcher('author@example.test');
  secondResearcher = await verifiedResearcher('second@example.test');
});

async function verifiedResearcher(email: string): Promise<Agent> {
  const agent = request.agent(app);
  const signup = await agent.post('/api/v1/auth/signup').send({ email, password: 'StrongPassword123', paperSite: 'Babuyan' });
  expect(signup.status).toBe(201);
  const url = new URL(signup.body.developmentVerificationUrl);
  await agent.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
  const user = await db.findUserByEmail(email);
  if (!user) throw new Error(`${email} was not created`);
  await db.updateUser(user._id, { role: 'researcher' });
  await agent.post('/api/v1/auth/login').send({ email, password: 'StrongPassword123' });
  return agent;
}

async function importSeries(agent: Agent, kind: string, text: string, label: string): Promise<string> {
  const response = await agent
    .post('/api/v1/data-imports')
    .field('kind', kind)
    .field('label', label)
    .field('provider', 'Test fixture provider')
    .field('sourceCitation', 'Independent test fixture 2026')
    .field('unit', kind === 'sst' ? 'degC' : 'annualArrivals')
    .field('scope', 'citywide-annual-average')
    .field('spatialCoverage', kind === 'sst' ? 'Citywide SST gridded product' : 'Puerto Princesa City, Palawan')
    // Deliberately ask for validation: the import must ignore this.
    .field('reviewStatus', 'validated')
    .attach('file', Buffer.from(text, 'utf8'), { filename: `${kind}.csv`, contentType: 'text/csv' });
  expect(response.status).toBe(201);
  return response.body.dataset.id as string;
}

describe('dataset validation is admin-only and never self-declared', () => {
  it('discards a client-supplied validated status on import', async () => {
    const id = await importSeries(author, 'sst', sstCsv, 'Citywide SST gridded product');
    const stored = await db.findDatasetById(id);
    expect(stored?.status).toBe('needs-review');
    expect(stored?.review ?? null).toBeNull();
  });

  it('refuses a dataset review from a researcher', async () => {
    const id = await importSeries(author, 'sst', sstCsv, 'Second SST product');
    const response = await author
      .post(`/api/v1/data-imports/${id}/review`)
      .send({ status: 'validated', notes: 'Trying to approve my own import.' });
    expect(response.status).toBe(403);
  });

  it('requires a written note from an admin', async () => {
    const id = await importSeries(author, 'tourism', tourismCsv, 'Citywide annual arrivals');
    const response = await admin.post(`/api/v1/data-imports/${id}/review`).send({ status: 'validated', notes: '' });
    expect(response.status).toBe(400);
  });

  it('records the admin decision with reviewer provenance', async () => {
    const id = await importSeries(author, 'tourism', tourismCsv, 'Citywide annual arrivals (reviewed)');
    const response = await admin
      .post(`/api/v1/data-imports/${id}/review`)
      .send({ status: 'validated', notes: 'Citation, checksum, and citywide scope checked against the source register.' });
    expect(response.status).toBe(200);
    expect(response.body.dataset.status).toBe('validated');
    expect(response.body.dataset.review.reviewedByLabel).toBe('admin@example.test');
    expect(response.body.dataset.review.status).toBe('validated');
    const stored = await db.findDatasetById(id);
    expect(stored?.status).toBe('validated');
  });

  it('lets an admin reject a series', async () => {
    const id = await importSeries(author, 'tourism', tourismCsv, 'Arrivals to be rejected');
    const response = await admin
      .post(`/api/v1/data-imports/${id}/review`)
      .send({ status: 'rejected', notes: 'Scope is reef-site, not citywide.' });
    expect(response.status).toBe(200);
    expect(response.body.dataset.status).toBe('rejected');
  });
});

describe('independent configuration review', () => {
  it('still refuses to publish a version as already reviewed', async () => {
    const active = await modelConfigService.getActive();
    const response = await author.post('/api/v1/model/versions').send({
      baseVersion: active!.version,
      changes: { alpha: 0.05 },
      notes: 'Self-approval attempt in a single step.',
      reviewStatus: 'reviewed'
    });
    expect(response.status).toBe(403);
  });

  it('refuses a review from the author of the version', async () => {
    const active = await modelConfigService.getActive();
    const published = await author.post('/api/v1/model/versions').send({
      baseVersion: active!.version,
      changes: { alpha: 0.05, g: 0.02 },
      notes: 'Values taken from the cited regional assessment.',
      reviewStatus: 'unreviewed'
    });
    expect(published.status).toBe(201);
    const authorEmail = (await db.findUserByEmail('author@example.test'))!;

    const response = await author.post('/api/v1/model/versions/review').send({
      version: published.body.version.version,
      notes: 'Reviewing my own publication.'
    });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/you published this configuration version/i);
    expect(authorEmail.email).toBe('author@example.test');
  });

  it('records a different researcher as the independent reviewer, as a new version', async () => {
    const active = await modelConfigService.getActive();
    const published = await author.post('/api/v1/model/versions').send({
      baseVersion: active!.version,
      changes: { alpha: 0.04, g: 0.018 },
      notes: 'Values checked against the cited source document.',
      reviewStatus: 'unreviewed'
    });
    expect(published.status).toBe(201);
    const baseVersion = published.body.version.version as string;

    const reviewed = await secondResearcher.post('/api/v1/model/versions/review').send({
      version: baseVersion,
      notes: 'Confirmed both values against the source and checked the units.'
    });
    expect(reviewed.status).toBe(201);
    const record = reviewed.body.version;
    // Immutability: a review publishes a new version rather than editing one.
    expect(record.version).not.toBe(baseVersion);
    expect(record.reviewStatus).toBe('reviewed');
    expect(record.reviewedBy).toBe('second@example.test');
    expect(record.createdBy).not.toBe(record.reviewedBy);
    expect(record.notes).toContain('Independent review of');
  });

  it('does not let a review promote provisional parameters', async () => {
    const active = await modelConfigService.getActive();
    const published = await author.post('/api/v1/model/versions').send({
      baseVersion: active!.version,
      changes: { alpha: 0.04, g: 0.018 },
      notes: 'Values checked against the cited source document.',
      reviewStatus: 'unreviewed'
    });
    const reviewed = await secondResearcher.post('/api/v1/model/versions/review').send({
      version: published.body.version.version,
      notes: 'Checked values, units, and provenance.'
    });
    expect(reviewed.status).toBe(201);
    const readiness = await modelConfigService.paperReadiness(reviewed.body.version);
    // A review attests to the version; it must not launder a provisional value.
    expect(readiness.reasons.join(' ')).toMatch(/K is not independently reviewed/);
    expect(readiness.reasons.join(' ')).toMatch(/beta is not independently reviewed/);
  });

  it('refuses to review the same version twice', async () => {
    const active = await modelConfigService.getActive();
    const published = await author.post('/api/v1/model/versions').send({
      baseVersion: active!.version,
      changes: { alpha: 0.03 },
      notes: 'Another unpublished version for the duplicate-review check.',
      reviewStatus: 'unreviewed'
    });
    const first = await secondResearcher.post('/api/v1/model/versions/review').send({
      version: published.body.version.version,
      notes: 'First review of this version.'
    });
    expect(first.status).toBe(201);
    const second = await author.post('/api/v1/model/versions/review').send({
      version: published.body.version.version,
      notes: 'Attempting a second review of the same version.'
    });
    expect(second.status).toBe(403);
  });
});
