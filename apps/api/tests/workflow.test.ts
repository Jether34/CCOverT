import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

/**
 * These fixtures are produced by the real FastAPI service, so the TypeScript
 * contract is checked against actual model output instead of a hand-written
 * approximation. Regenerate with:
 *   python apps/api/tests/fixtures/dump_fixtures.py
 */
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as Record<string, unknown>;

process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-123456';
process.env.MODEL_SERVICE_TOKEN = 'test-service-token-0123456789abcdef';
process.env.ALLOW_DEMO_PROFILE = 'true';

type Agent = ReturnType<typeof request.agent>;

/**
 * Contract double for the Python model service. It validates the token, checks
 * the request shape, and replays real recorded responses. It contains no CCOverT
 * mathematics, because the solver lives in services/model-api only.
 */
const received: { predict: unknown[]; calibrate: unknown[] } = { predict: [], calibrate: [] };

const modelStub = http.createServer((req, res) => {
  const url = req.url ?? '';
  const token = req.headers['x-service-token'];
  if (token !== process.env.MODEL_SERVICE_TOKEN) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'bad token' } }));
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const send = (payload: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url === '/ready') {
      send({ status: 'ok' });
      return;
    }
    if (url === '/model/metadata') {
      send(readFixture('model-metadata.json'));
      return;
    }
    if (url === '/model/predict') {
      received.predict.push(body);
      const fixture = readFixture('predict-response.json');
      // The stub speaks the same wire contract as the real service: snake_case
      // fields, a full coral baseline, and per-value provenance objects.
      const parameters = body.parameters as Record<string, { value: number; unit: string; status: string; provenance: string; reviewStatus: string; source_dataset_id: string | null; effective_date: string | null }>;
      const horizonYears = Number(body.horizon_years);
      const baselineYear = Number(body.baseline_year);
      const annual = (fixture.annual as Record<string, unknown>[]).map((point, index) => ({
        ...point,
        year: baselineYear + index + 1,
        tYears: index + 1
      }));
      while (annual.length < horizonYears) {
        const previous = annual[annual.length - 1] as Record<string, number>;
        annual.push({
          ...previous,
          year: baselineYear + annual.length,
          tYears: annual.length,
          coverStartPercent: previous.coverEndPercent,
          coverEndPercent: previous.coverEndPercent - 0.19,
          coverIntervalMeanPercent: previous.coverEndPercent - 0.095
        });
      }
      const coverPercent = (body.coral_baseline as { cover_percent: number }).cover_percent;
      send({
        ...fixture,
        requestId: body.request_id ?? 'stub-request',
        profile: body.profile,
        isDemo: body.profile === 'demo',
        isScenario: body.profile === 'scenario',
        studyAreaId: body.study_area_id,
        studyAreaLabel: body.study_area_label,
        scope: body.scope,
        baselineYear,
        horizonYears,
        initialCoverPercent: coverPercent,
        modelConfigVersion: body.model_config_version,
        targetMeasure: '%LCC (HC+SC)',
        annual: annual.slice(0, horizonYears),
        // An assumed value comes back labelled as assumed and unreviewed,
        // exactly as the real service echoes it.
        parameters: Object.entries(parameters).map(([key, supplied]) => ({
          key,
          symbol: key,
          value: supplied.value,
          unit: supplied.unit,
          status: supplied.status,
          provenance: supplied.provenance,
          reviewStatus: supplied.reviewStatus,
          sourceDatasetId: supplied.source_dataset_id,
          effectiveDate: supplied.effective_date
        }))
      });
      return;
    }
    if (url === '/model/calibrate') {
      received.calibrate.push(body);
      send({
        equationVersion: 'ccoverT-1.0.0',
        modelVersion: 'ccoverT-paper-implementation',
        requestId: body.requestId ?? 'stub-request',
        parameterKey: body.parameterKey,
        value: 0.206491,
        searchBracket: [0, 0.5],
        observedCoverPercent: body.observedCoverPercent,
        observedCoverYear: body.observedCoverYear,
        fittedFinalCoverPercent: body.observedCoverPercent,
        absoluteResidualPercent: 0,
        method: 'bisection on g over the full RK4 integration of the CCOverT equation',
        note: 'Recorded calibration fixture.',
        warnings: ['g is a data fit, not a published paper value.']
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: url } }));
  });
});

let app: Express;
let researcher: Agent;
let computedRequest: Record<string, unknown> | null = null;
let createApp: (dependencies?: { database?: unknown }) => Express;
let modelConfigService: { ensureSeeded: () => Promise<void> };
let Database: new () => unknown;
let db: {
  findUserByEmail: (email: string) => Promise<{ _id: string } | null>;
  updateUser: (id: string, changes: Record<string, unknown>) => Promise<unknown>;
};

// File-level hooks: the stub is shared by every describe block below, so it must
// outlive each one and only close when the whole file is done.
beforeAll(async () => {
  // The stub must be listening before the API modules read MODEL_SERVICE_URL.
  await new Promise<void>((resolve) => {
    modelStub.listen(0, '127.0.0.1', resolve);
  });
  process.env.MODEL_SERVICE_URL = `http://127.0.0.1:${(modelStub.address() as AddressInfo).port}`;

  const appModule = await import('../src/app');
  const configModule = await import('../src/services/modelConfigService');
  const databaseModule = await import('../src/repositories/database');
  createApp = appModule.createApp as typeof createApp;
  modelConfigService = configModule.modelConfigService as typeof modelConfigService;
  Database = databaseModule.Database as unknown as new () => unknown;
  db = databaseModule.db as unknown as typeof db;

  app = createApp({ database: new Database() });
  await modelConfigService.ensureSeeded();

  researcher = request.agent(app);
  const signup = await researcher.post('/api/v1/auth/signup').send({ email: 'researcher@example.test', password: 'StrongPassword123', paperSite: 'Babuyan' });
  const url = new URL(signup.body.developmentVerificationUrl);
  await researcher.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
  await researcher.post('/api/v1/auth/login').send({ email: 'researcher@example.test', password: 'StrongPassword123' });
  const user = await db.findUserByEmail('researcher@example.test');
  if (!user) throw new Error('test researcher was not created');
  await db.updateUser(user._id, { role: 'researcher' });
  // Re-login so the session carries the elevated role.
  await researcher.post('/api/v1/auth/logout');
  await researcher.post('/api/v1/auth/login').send({ email: 'researcher@example.test', password: 'StrongPassword123' });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    modelStub.close(() => resolve());
  });
});

const coralCsv = ['year,value', '2006,57.25', '2010,52.10', '2016,46.20'].join('\n');
const sstCsv = ['year,value', '2006,30.42', '2010,30.46', '2016,30.51'].join('\n');
const tourismCsv = ['year,value', '2006,100000', '2010,108329', '2016,122140'].join('\n');

async function importDataset(agent: Agent, kind: string, label: string, citation: string, text: string): Promise<string> {
  const response = await agent
    .post('/api/v1/data-imports')
    .field('kind', kind)
    .field('label', label)
    .field('sourceCitation', citation)
    .field('unit', kind === 'sst' ? 'degC' : kind === 'tourism' ? 'annualArrivals' : 'percent')
    .field('scope', 'citywide-annual-average')
    .field('spatialCoverage', 'Puerto Princesa City, Palawan')
    .field('reviewStatus', 'validated')
    .attach('file', Buffer.from(text, 'utf8'), { filename: `${kind}.csv`, contentType: 'text/csv' });
  expect(response.status).toBe(201);
  return response.body.dataset.id as string;
}

const requestBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  studyAreaId: 'puerto-princesa-city',
  scope: 'citywide-annual-average',
  profile: 'paper',
  baselineYear: 2006,
  horizonYears: 10,
  coralBaseline: {
    coverPercent: 57,
    year: 2006,
    measure: '%LCC (HC+SC)',
    surveySource: 'Citywide reef survey 2006',
    surveyMethod: 'Citywide transect survey',
    surveyScope: 'citywide-annual-average',
    sameScopeConfirmed: true
  },
  sstDatasetId: null,
  tourismDatasetId: null,
  consentedLocation: null,
  solver: { substepsPerYear: 12 },
  ...overrides
});

describe('researcher workflow against a contract-double model service', () => {
  it('rejects self-reviewed publication and invalid parameter ranges before activation', async () => {
    const status = await researcher.get('/api/v1/model/status');
    const baseVersion = status.body.status.activeModelConfigVersion as string;
    const reviewed = await researcher.post('/api/v1/model/versions').send({
      baseVersion, changes: { alpha: 0.05 }, notes: 'Claiming review without an independent reviewer.', reviewStatus: 'reviewed'
    });
    expect(reviewed.status).toBe(403);
    const invalid = await researcher.post('/api/v1/model/versions').send({
      baseVersion, changes: { K: 150 }, notes: 'This exceeds the 0–100 cover scale.'
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_MODEL_PARAMETER');
  });
  it('refuses to run until alpha and g are configured', async () => {
    const blocked = await researcher.post('/api/v1/predictions').send(requestBody());
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('MODEL_PARAMETERS_NOT_CONFIGURED');
    expect(received.predict).toHaveLength(0);
  });

  it('runs the synthetic demo while the paper profile is incomplete', async () => {
    const demo = request.agent(app);
    const signup = await demo.post('/api/v1/auth/signup').send({ email: 'incomplete-demo@example.test', password: 'StrongPassword123', paperSite: 'Babuyan' });
    const url = new URL(signup.body.developmentVerificationUrl);
    await demo.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
    await demo.post('/api/v1/auth/login').send({ email: 'incomplete-demo@example.test', password: 'StrongPassword123' });

    const response = await demo.post('/api/v1/predictions').send(requestBody({ profile: 'demo' }));
    expect(response.status).toBe(201);
    expect(response.body.prediction.isDemo).toBe(true);
    expect(response.body.prediction.status).toBe('demo');
    expect(response.body.prediction.parameters.find((parameter: { key: string }) => parameter.key === 'alpha').status)
      .toBe('synthetic-demo-only');
  });

  it('prevents default users from editing shared research data', async () => {
    const user = request.agent(app);
    const signup = await user.post('/api/v1/auth/signup').send({ email: 'readonly-user@example.test', password: 'StrongPassword123', paperSite: 'Babuyan' });
    const url = new URL(signup.body.developmentVerificationUrl);
    await user.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
    await user.post('/api/v1/auth/login').send({ email: 'readonly-user@example.test', password: 'StrongPassword123' });
    const importResult = await user.post('/api/v1/data-imports').field('kind', 'sst').attach('file', Buffer.from(sstCsv), 'sst.csv');
    expect(importResult.status).toBe(403);
    const status = await user.get('/api/v1/model/status');
    expect((await user.post('/api/v1/model/versions').send({ baseVersion: status.body.status.activeModelConfigVersion, changes: { alpha: 0.05 }, notes: 'No user permission' })).status).toBe(403);
    expect((await user.post('/api/v1/predictions').send(requestBody({ profile: 'demo', sstDatasetId: 'not-a-choice' }))).status).toBe(400);
    expect((await user.get('/api/v1/developer/status')).status).toBe(403);
  });

  it('limits system configuration and account access to the developer', async () => {
    await db.createUser({ email: 'developer@example.test', passwordHash: await bcrypt.hash('StrongPassword123', 12), emailVerified: true, role: 'admin' });
    const developer = request.agent(app);
    expect((await developer.post('/api/v1/auth/login').send({ email: 'developer@example.test', password: 'StrongPassword123' })).status).toBe(200);
    const updated = await developer.patch('/api/v1/developer/config').send({ announcement: 'New citywide dataset available' });
    expect(updated.status).toBe(200);
    expect((await researcher.get('/api/v1/developer/config')).body.config.announcement).toBe('New citywide dataset available');
    const smtp = await developer.patch('/api/v1/developer/smtp').send({
      enabled: true, host: 'mail.example.test', port: 587, secure: false,
      user: 'mailer', password: 'SMTPPassword123', from: 'mail@example.test'
    });
    expect(smtp.status).toBe(200);
    expect(smtp.body.smtp.source).toBe('database');
    expect(JSON.stringify(smtp.body)).not.toContain('SMTPPassword123');
    expect((await db.getSmtpOverride())?.encryptedPassword).not.toContain('SMTPPassword123');
    expect((await developer.patch('/api/v1/developer/smtp').send({
      enabled: false, host: 'mail.example.test', port: 587, secure: false,
      user: 'mailer', from: 'mail@example.test'
    })).status).toBe(200);
    const account = await developer.post('/api/v1/developer/users').send({ email: 'added@example.test', password: 'StrongPassword123', role: 'client' });
    expect(account.status).toBe(201);
    expect((await developer.patch(`/api/v1/developer/users/${account.body.user.id}`).send({ disabled: true })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'added@example.test', password: 'StrongPassword123' })).status).toBe(401);
    const status = await developer.get('/api/v1/developer/status');
    expect(status.status).toBe(200);
    expect(status.body.activity.some((entry: { action: string }) => entry.action.includes('Updated system announcement'))).toBe(true);
    expect((await developer.post('/api/v1/developer/backups')).status).toBe(400);
  });

  it('imports an annual arrivals series and estimates g from tourism growth', async () => {
    const datasetId = await importDataset(researcher, 'tourism', 'Citywide tourist arrivals 2006-2016', 'Test tourism fixture 2024', tourismCsv);
    const list = await researcher.get('/api/v1/data-imports?kind=tourism');
    expect(list.body.datasets).toHaveLength(1);
    expect(list.body.datasets[0].records).toHaveLength(3);

    const tooFewYears = await importDataset(researcher, 'tourism', 'Single year arrivals series', 'Test tourism fixture 2024', 'year,value\n2006,100000');
    const fit = await researcher.post(`/api/v1/data-imports/${tooFewYears}/estimate-g`);
    expect(fit.status).toBe(422);
    expect(datasetId).toBeTruthy();
  });

  it('estimates g from arrivals without using coral-cover observations or the model service', async () => {
    const datasetId = await importDataset(researcher, 'tourism', 'Second tourism series', 'Test tourism fixture 2024', tourismCsv);
    const response = await researcher.post(`/api/v1/data-imports/${datasetId}/estimate-g`);
    expect(response.status).toBe(200);
    expect(response.body.dataset.derivedValue.key).toBe('g');
    expect(response.body.dataset.derivedValue.value).toBeCloseTo(0.02, 3);
    expect(response.body.dataset.derivedValue.method).toContain('ln(annual tourist arrivals)');
    expect(received.calibrate).toHaveLength(0);
  });

  it('lets a researcher publish unreviewed parameters and run an explicit scenario', async () => {
    const datasetId = (await researcher.get('/api/v1/data-imports?kind=tourism')).body.datasets
      .find((dataset: { label: string }) => dataset.label === 'Citywide tourist arrivals 2006-2016').id as string;
    const sstDatasetId = await importDataset(researcher, 'sst', 'Citywide SST 2006-2016', 'PAGASA sea-surface product fixture', sstCsv);

    const status = await researcher.get('/api/v1/model/status');
    expect(status.body.status.missingParameters.map((item: { key: string }) => item.key)).toEqual(['alpha', 'g']);

    const version = await researcher.post('/api/v1/model/versions').send({
      baseVersion: status.body.status.activeModelConfigVersion,
      changes: { alpha: 0.05, g: 0.02 },
      notes: 'Configured from imported datasets and reviewed against the paper.',
      reviewStatus: 'unreviewed',
      effectiveDate: '2006-01-01',
      sourceDatasetIds: { g: datasetId },
      sstDatasetId,
      tourismDatasetId: datasetId
    });
    expect(version.status).toBe(201);
    expect(version.body.version.profile).toBe('paper');
    const configured = version.body.version.parameters.find((parameter: { key: string }) => parameter.key === 'g');
    expect(configured.value).toBe(0.02);
    expect(configured.sourceDatasetId).toBe(datasetId);
    expect(configured.reviewStatus).toBe('unreviewed');

    const ready = await researcher.get('/api/v1/model/status');
    expect(ready.body.status.configured).toBe(false);
    expect(ready.body.status.service).toBe('available');
    expect(ready.body.status.equationVersion).toBe('ccoverT-1.0.0');

    const scenarioRequest = requestBody({ profile: 'scenario', assumedValues: [
      { key: 'g', value: 0.03, unit: 'per year', rationale: 'Sensitivity test against a higher growth rate.', range: null }
    ] });
    const prediction = await researcher
      .post('/api/v1/predictions')
      .set('Idempotency-Key', 'run-key-0000000001')
      .send(scenarioRequest);
    expect(prediction.status).toBe(201);
    const record = prediction.body.prediction;
    expect(record.idempotencyKey).toBe('run-key-0000000001');
    expect(record.modelConfigVersion).toBe(version.body.version.version);
    expect(record.isDemo).toBe(false);
    expect(record.isScenario).toBe(true);
    expect(record.validationStatus).toBe('not-validated');
    expect(record.annual).toHaveLength(10);
    expect(record.warnings.some((warning: string) => warning.includes('T0 was changed'))).toBe(true);
    expect(record.sources.some((source: { datasetId: string | null }) => source.datasetId === sstDatasetId)).toBe(true);
    const forwarded = received.predict[received.predict.length - 1] as {
      profile: string;
      study_area_id: string;
      model_config_version: string;
      parameters: Record<string, { value: number; status: string; reviewStatus: string }>;
    };
    expect(forwarded.study_area_id).toBe('puerto-princesa-city');
    expect(forwarded.model_config_version).toBeTruthy();
    expect(forwarded.parameters.g.value).toBe(0.02);
    expect(forwarded.parameters.alpha.value).toBe(0.05);
    computedRequest = scenarioRequest;
  });

  it('replays an identical idempotent request and rejects a different one', async () => {
    const replay = await researcher
      .post('/api/v1/predictions')
      .set('Idempotency-Key', 'run-key-0000000001')
      .send(computedRequest ?? requestBody());
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);

    const conflicting = await researcher
      .post('/api/v1/predictions')
      .set('Idempotency-Key', 'run-key-0000000001')
      .send({ ...(computedRequest ?? requestBody()), horizonYears: 20 });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const list = await researcher.get('/api/v1/predictions');
    expect(list.body.predictions).toHaveLength(2);
  });

  it('offers the prediction and its inputs for download', async () => {
    const id = (await researcher.get('/api/v1/predictions')).body.predictions[0].predictionId as string;
    const pdf = await researcher.get(`/api/v1/predictions/${id}/download`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const markdown = await researcher.get(`/api/v1/predictions/${id}/download?format=markdown`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.text).toContain('CCOverT');
    expect(markdown.text).not.toContain('DEMO result');

    const csv = await researcher.get(`/api/v1/predictions/${id}/download?format=csv`);
    expect(csv.status).toBe(200);
    // The CSV opens with a provenance comment, so the column header is row two.
    expect(csv.text.split('\n')[0]).toContain('CCOverT');
    expect(csv.text.split('\n')[1]).toContain('year');
    expect(csv.text.split('\n')[1]).toContain('tourismContributionPp');
    expect(csv.text).toContain('# parameters');
    expect(csv.text).toContain('# sources');

    const json = await researcher.get(`/api/v1/predictions/${id}/download?format=json`);
    expect(json.status).toBe(400);

    const other = request.agent(app);
    const signup = await other.post('/api/v1/auth/signup').send({ email: 'nosy@example.test', password: 'StrongPassword123', paperSite: 'Babuyan' });
    const url = new URL(signup.body.developmentVerificationUrl);
    await other.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
    await other.post('/api/v1/auth/login').send({ email: 'nosy@example.test', password: 'StrongPassword123' });
    expect((await other.get(`/api/v1/predictions/${id}`)).status).toBe(404);
    expect((await other.get(`/api/v1/predictions/${id}/download?format=json`)).status).toBe(400);
  });

  it('writes a grounded deterministic report with citations and no provider', async () => {
    const id = (await researcher.get('/api/v1/predictions')).body.predictions[0].predictionId as string;
    const report = await researcher.post('/api/v1/ai/reports').send({
      predictionIds: [id],
      uploadIds: [],
      question: 'What drives the decline in this run?'
    });
    expect(report.status).toBe(201);
    expect(report.body.report.provider).toBeNull();
    expect(report.body.report.warnings.join(' ')).toContain('deterministic summary of stored results');
    expect(report.body.report.body).toContain('57%');
    expect(report.body.report.body).toContain('Parameters configured from imported data: g');
    expect(report.body.report.body).toContain('T0 was changed');
    expect(report.body.report.citations.some((citation: { predictionId: string | null }) => citation.predictionId === id)).toBe(true);
    expect(report.body.report.warnings.length).toBeGreaterThan(0);

    const answeredWithoutProvider = await researcher.post('/api/v1/ai/reports').send({ predictionIds: [id], uploadIds: [] });
    expect(answeredWithoutProvider.status).toBe(201);
  });

  it('refuses a report for a prediction the caller does not own', async () => {
    const id = (await researcher.get('/api/v1/predictions')).body.predictions[0].predictionId as string;
    const other = request.agent(app);
    const signup = await other.post('/api/v1/auth/signup').send({ email: 'stranger@example.test', password: 'StrongPassword123', paperSite: 'Babuyan' });
    const url = new URL(signup.body.developmentVerificationUrl);
    await other.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
    await other.post('/api/v1/auth/login').send({ email: 'stranger@example.test', password: 'StrongPassword123' });
    const response = await other.post('/api/v1/ai/reports').send({ predictionIds: [id], uploadIds: [] });
    expect(response.status).toBe(404);
  });

  it('shows the run on the dashboard of its owner only', async () => {
    const dashboard = await researcher.get('/api/v1/dashboard');
    expect(dashboard.body.predictionCount).toBe(2);
    expect(dashboard.body.datasetCount).toBeGreaterThanOrEqual(3);
    expect(dashboard.body.latestPrediction).not.toBeNull();
    expect(dashboard.body.modelStatus.configured).toBe(false);
    expect(dashboard.body.modelStatus.provisionalParameters).toEqual(expect.arrayContaining(['K', 'beta']));
  });

  it('imports a completed Excel sheet using its embedded years and type', async () => {
    const template = await researcher.get('/api/v1/data-imports/template?startYear=2006&endYear=2007');
    expect(template.status).toBe(200);
    const book = new ExcelJS.Workbook();
    const { makeTemplate } = await import('../src/services/workbook');
    await book.xlsx.load(await makeTemplate(2006, 2007) as never);
    const sheet = book.getWorksheet('SST')!;
    sheet.getCell('B2').value = 'Workbook SST 2006-2007';
    sheet.getCell('B3').value = 'Researcher';
    sheet.getCell('B4').value = 'Workbook fixture 2024';
    sheet.getCell('B10').value = 30.19;
    sheet.getCell('B11').value = 30.2;
    const uploaded = await researcher.post('/api/v1/data-imports/bulk')
      .attach('file', Buffer.from(await book.xlsx.writeBuffer()), { filename: 'series.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.datasets).toHaveLength(1);
    expect(uploaded.body.datasets[0].records.map((point: { year: number }) => point.year)).toEqual([2006, 2007]);
  });

  it('archives only inactive model versions and preserves the active configuration', async () => {
    const versions = (await researcher.get('/api/v1/model/versions')).body.versions as Array<{ id: string; active: boolean; version: string }>;
    const active = versions.find((version) => version.active)!;
    const prior = versions.find((version) => !version.active)!;
    expect((await researcher.delete(`/api/v1/model/versions/${active.id}`)).status).toBe(400);
    expect((await researcher.delete(`/api/v1/model/versions/${prior.id}`)).status).toBe(204);
    expect((await researcher.post(`/api/v1/model/versions/${prior.id}/activate`)).status).toBe(403);
    expect((await researcher.get('/api/v1/model/status')).body.status.activeModelConfigVersion).toBe(active.version);
  });
});

describe('exploratory scenario runs while alpha and g are unconfigured', () => {
  // A separate database keeps the paper profile unconfigured, which is the
  // situation a scenario actually exists for.
  let scenarioApp: Express;
  let analyst: Agent;
  let analystCookie: string;

  beforeAll(async () => {
    scenarioApp = createApp({ database: new Database() });
    await modelConfigService.ensureSeeded();
    analyst = request.agent(scenarioApp);
    const signup = await analyst.post('/api/v1/auth/signup').send({ email: 'analyst@example.test', password: 'StrongPassword123', paperSite: 'Babuyan' });
    const url = new URL(signup.body.developmentVerificationUrl);
    await analyst.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
    await analyst.post('/api/v1/auth/login').send({ email: 'analyst@example.test', password: 'StrongPassword123' });
    // Configuring a model version is a researcher action, so this user needs the
    // role to prove the overwrite guard once values exist.
    const user = await db.findUserByEmail('analyst@example.test');
    if (!user) throw new Error('test analyst was not created');
    await db.updateUser(user._id, { role: 'researcher' });
    await analyst.post('/api/v1/auth/logout');
    const login = await analyst.post('/api/v1/auth/login').send({ email: 'analyst@example.test', password: 'StrongPassword123' });
    const setCookie = login.headers['set-cookie'];
    analystCookie = Array.isArray(setCookie) ? setCookie.map((entry) => entry.split(';')[0]).join('; ') : String(setCookie ?? '');
    expect(analystCookie).toContain('=');
  });

  it('refuses the paper profile and accepts a scenario instead', async () => {
    const blocked = await analyst.post('/api/v1/predictions').send(requestBody());
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('MODEL_PARAMETERS_NOT_CONFIGURED');
  });

  it('computes a run from assumed values, labels it, and keeps it out of validated counts', async () => {
    const response = await analyst
      .post('/api/v1/predictions')
      .set('Idempotency-Key', 'scenario-key-000001')
      .send(requestBody({
        profile: 'scenario',
        horizonYears: 20,
        assumedValues: [
          {
            key: 'alpha',
            value: 0.05,
            unit: 'per degC per year',
            rationale: 'Midpoint of a published range for comparable reef studies.',
            range: { min: 0.02, max: 0.08 }
          },
          {
            key: 'g',
            value: 0.02,
            unit: 'per year',
            rationale: 'Assumed flat tourism for a what-if against a growth trend.',
            range: { min: -0.01, max: 0.05 }
          }
        ]
      }));
    expect(response.status).toBe(201);
    const record = response.body.prediction;

    expect(record.status).toBe('scenario');
    expect(record.isScenario).toBe(true);
    expect(record.isDemo).toBe(false);
    expect(record.assumptions).toHaveLength(2);
    expect(record.assumptions.find((item: { key: string }) => item.key === 'alpha')).toMatchObject({
      value: 0.05,
      range: { min: 0.02, max: 0.08 }
    });
    expect(record.warnings[0]).toContain('not a validated prediction');

    // Assumed values are echoed as assumptions, never as paper values.
    const alpha = record.parameters.find((parameter: { key: string }) => parameter.key === 'alpha');
    expect(alpha.status).toBe('assumed');
    expect(alpha.reviewStatus).toBe('unreviewed');
    expect(alpha.provenance).toContain('Midpoint of a published range');
    // The provisional status of K and beta stays visible.
    expect(record.parameters.filter((parameter: { status: string }) => parameter.status === 'provisional').map((p: { key: string }) => p.key).sort())
      .toEqual(['K', 'beta']);

    // The values reached the model service with assumed provenance attached.
    const forwarded = received.predict[received.predict.length - 1] as {
      profile: string;
      parameters: Record<string, { value: number; status: string; reviewStatus: string; provenance: string }>;
    };
    expect(forwarded.profile).toBe('scenario');
    expect(forwarded.parameters.alpha.value).toBe(0.05);
    expect(forwarded.parameters.alpha.status).toBe('assumed');
    expect(forwarded.parameters.alpha.reviewStatus).toBe('unreviewed');
    expect(forwarded.parameters.g.status).toBe('assumed');

    // It exists in history but does not count as a validated prediction.
    const list = await analyst.get('/api/v1/predictions');
    expect(list.body.predictions).toHaveLength(2);
    expect(list.body.predictions.some((prediction: { status: string }) => prediction.status === 'scenario')).toBe(true);
    const dashboard = await analyst.get('/api/v1/dashboard');
    expect(dashboard.body.predictionCount).toBe(2);
    expect(dashboard.body.latestPrediction).not.toBeNull();

    const markdown = await analyst.get(`/api/v1/predictions/${record.predictionId}/download?format=markdown`);
    expect(markdown.text).toContain('Scenario assumptions');
    expect(markdown.text).toContain('Midpoint of a published range');
    // The report says which assumptions were actually applied, so a stored
    // assumption for an already-configured value cannot read as used.
    expect(markdown.text).toContain('| applied |');
    expect(markdown.text).toContain('| alpha | 0.05 | per degC per year | 0.02 to 0.08 | yes |');
    expect(markdown.text).toContain('SCENARIO');

    const report = await analyst.post('/api/v1/ai/reports').send({
      predictionIds: [record.predictionId],
      uploadIds: []
    });
    expect(report.status).toBe(201);
    expect(report.body.report.body).toContain('exploratory scenarios');
    expect(report.body.report.warnings.join(' ')).toContain('not validated predictions');
  });

  it('still requires a value for every missing parameter', async () => {
    const response = await analyst.post('/api/v1/predictions').send(requestBody({
      profile: 'scenario',
      assumedValues: [
        { key: 'alpha', value: 0.05, unit: 'per degC per year', rationale: 'Midpoint of a published range.', range: null }
      ]
    }));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('SCENARIO_ASSUMPTIONS_INCOMPLETE');
    expect(response.body.error.message).toContain('g');
  });

  it('never overwrites a configured value with an assumption', async () => {
    // A fresh agent per request: the shared one has served enough requests that
    // supertest's cached server is no longer reusable. The session cookie is
    // carried over explicitly, because sessions live in the database.
    const call = (): Agent => request.agent(scenarioApp).set('Cookie', analystCookie) as Agent;
    const status = await call().get('/api/v1/model/status');
    const version = await call()
      .post('/api/v1/model/versions')
      .send({
        baseVersion: status.body.status.activeModelConfigVersion,
        changes: { alpha: 0.05, g: 0.02 },
        notes: 'Configured so the overwrite guard can be checked.',
        reviewStatus: 'unreviewed',
        effectiveDate: '2006-01-01'
      });
    expect(version.status).toBe(201);

    const response = await call()
      .post('/api/v1/predictions')
      .set('Idempotency-Key', 'scenario-key-000002')
      .send(requestBody({
        profile: 'scenario',
        assumedValues: [
          { key: 'alpha', value: 0.5, unit: 'per degC per year', rationale: 'Deliberately extreme value to prove the guard.', range: null }
        ]
      }));
    expect(response.status).toBe(201);
    const record = response.body.prediction;
    const alpha = record.parameters.find((parameter: { key: string }) => parameter.key === 'alpha');
    expect(alpha.value).toBe(0.05);
    expect(alpha.status).not.toBe('assumed');
    expect(record.warnings.some((warning: string) => warning.includes('was not applied'))).toBe(true);
    // The submission is kept for the audit trail, and the report must show
    // that it was not the value the run used.
    expect(record.assumptions).toHaveLength(1);
    expect(record.assumptions[0].value).toBe(0.5);
    const markdown = await call()
      .get(`/api/v1/predictions/${record.predictionId}/download?format=markdown`);
    expect(markdown.text).toContain('| alpha | 0.5 | per degC per year | not stated | no, the configured value was used |');
  });

  it('refuses unreviewed paper data, wrong scope, and out-of-range baseline years', async () => {
    const call = (): Agent => request.agent(scenarioApp).set('Cookie', analystCookie) as Agent;
    const citywideId = await importDataset(call(), 'sst', 'Citywide SST series 2006-2016', 'Sea-surface temperature research fixture 2024', sstCsv);
    const paper = await call().post('/api/v1/predictions').send(requestBody({ sstDatasetId: citywideId }));
    expect(paper.status).toBe(503);
    expect(paper.body.error.message).toContain('independent review');

    const scenario = {
      profile: 'scenario',
      assumedValues: [{ key: 'alpha', value: 0.2, unit: 'per degC per year', rationale: 'Scope and coverage gate test.', range: null }]
    };
    const outside = await call().post('/api/v1/predictions').send(requestBody({
      ...scenario, baselineYear: 2005, sstDatasetId: citywideId,
      coralBaseline: { ...(requestBody().coralBaseline as Record<string, unknown>), year: 2005 }
    }));
    expect(outside.status).toBe(400);
    expect(outside.body.error.message).toContain('no observed SST value');

    const reefSite = await call().post('/api/v1/data-imports')
      .field('kind', 'sst').field('label', 'Reef-site SST').field('provider', 'Research fixture')
      .field('sourceCitation', 'Sea-surface temperature fixture 2024').field('unit', 'degC')
      .field('scope', 'reef-site').field('spatialCoverage', 'One reef site in Puerto Princesa')
      .attach('file', Buffer.from(sstCsv), { filename: 'reef-sst.csv', contentType: 'text/csv' });
    expect(reefSite.status).toBe(201);
    const wrongScope = await call().post('/api/v1/predictions').send(requestBody({ ...scenario, sstDatasetId: reefSite.body.dataset.id }));
    expect(wrongScope.status).toBe(400);
    expect(wrongScope.body.error.message).toContain('citywide annual average');
  });
});
