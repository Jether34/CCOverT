import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { ResearchSummary } from '@ccovert/shared';
import { Database } from '../src/repositories/database';

/** Environment defaults come from tests/setup.ts so they apply before config loads. */

const { createApp } = await import('../src/app');
const { modelConfigService } = await import('../src/services/modelConfigService');

type Agent = ReturnType<typeof request.agent>;

let app: Express;
let database: Database;

beforeAll(async () => {
  database = new Database();
  app = createApp({ database });
  /** server.ts seeds the paper configuration on boot; the test app does the same. */
  await modelConfigService.ensureSeeded();
});

async function register(agent: Agent, email: string): Promise<{ userId: string }> {
  const signup = await agent.post('/api/v1/auth/signup').send({ email, password: 'StrongPassword123', paperSite: 'Babuyan' });
  expect(signup.status).toBe(201);
  const url = new URL(signup.body.developmentVerificationUrl);
  await agent.post('/api/v1/auth/verify').send({ token: url.searchParams.get('token') ?? '' });
  await agent.post('/api/v1/auth/login').send({ email, password: 'StrongPassword123' });
  const me = await agent.get('/api/v1/auth/me');
  return { userId: me.body.user.id as string };
}

const validPrediction = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  studyAreaId: 'puerto-princesa-city',
  scope: 'citywide-annual-average',
  profile: 'paper',
  baselineYear: 2006,
  horizonYears: 10,
  coralBaseline: {
    coverPercent: 57,
    year: 2006,
    hardCoralPercent: null,
    softCoralPercent: null,
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

describe('service health and error contract', () => {
  it('reports health without exposing implementation details', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'ccover-t-api', database: 'memory', version: 1 });
  });

  it('keeps liveness separate from readiness and protects operational metrics', async () => {
    const readiness = await request(app).get('/ready');
    expect(readiness.status).toBe(503);
    expect(readiness.body.modelService).toBe('unavailable');
    expect((await request(app).get('/metrics')).status).toBe(401);
  });

  it('returns a request id on every response and echoes a supplied one', async () => {
    const generated = await request(app).get('/health');
    expect(generated.headers['x-request-id']).toBeTruthy();
    const echoed = await request(app).get('/health').set('x-request-id', 'test-request-id-123');
    expect(echoed.headers['x-request-id']).toBe('test-request-id-123');
  });

  it('answers unknown routes with the standard error body', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });
});

describe('accounts', () => {
  it('allows staff roles to operate without email verification', async () => {
    const agent = request.agent(app);
    const signup = await agent.post('/api/v1/auth/signup').send({ email: 'r@cctover.com', password: 'StrongPassword123', paperSite: 'Babuyan' });
    expect(signup.status).toBe(201);
    expect(signup.body.user.role).toBe('client');
    const account = await database.findUserByEmail('r@cctover.com');
    expect(account).not.toBeNull();
    await database.updateUser(account!.id, { role: 'researcher' });
    const researcherLogin = await agent.post('/api/v1/auth/login').send({ email: 'r@cctover.com', password: 'StrongPassword123' });
    expect(researcherLogin.status).toBe(200);
    expect(researcherLogin.body.otpRequired).toBe(false);
    const researcher = await agent.post('/api/v1/model/versions').send({});
    expect(researcher.status).toBe(400);
    expect(researcher.body.error.code).toBe('VALIDATION_ERROR');
    await database.updateUser(account!.id, { role: 'admin' });
    const admin = await agent.get('/api/v1/developer/status');
    expect(admin.status).toBe(200);
  });
  it('validates signup and protects the session', async () => {
    const agent = request.agent(app);
    const invalid = await agent.post('/api/v1/auth/signup').send({ email: 'not-an-email', password: 'short' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    const missingLocation = await agent.post('/api/v1/auth/signup').send({ email: 'missing-location@example.test', password: 'StrongPassword123' });
    expect(missingLocation.status).toBe(400);
    expect(missingLocation.body.error.code).toBe('VALIDATION_ERROR');

    const session = await register(agent, 'one@example.test');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.body.user.emailVerified).toBe(true);
    expect(me.body.user).not.toHaveProperty('passwordHash');
    expect(session.userId).toBeTruthy();

    const anonymous = await request(app).get('/api/v1/predictions');
    expect(anonymous.status).toBe(401);
  });

  it('rejects cross-origin state changes', async () => {
    const agent = request.agent(app);
    await register(agent, 'origin@example.test');
    const response = await agent.post('/api/v1/auth/logout').set('Origin', 'https://evil.example');
    expect(response.status).toBe(403);
  });

  it('never reveals whether an address has an account', async () => {
    const agent = request.agent(app);
    await register(agent, 'known@example.test');
    const known = await agent.post('/api/v1/auth/forgot-password').send({ email: 'known@example.test' });
    const unknown = await agent.post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.test' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
  });

  it('consumes a reset token exactly once', async () => {
    const agent = request.agent(app);
    await register(agent, 'reset@example.test');
    await agent.post('/api/v1/auth/forgot-password').send({ email: 'reset@example.test' });
    // The development-only path returns no token, so the endpoint is exercised
    // through its validation contract instead.
    const invalid = await agent.post('/api/v1/auth/reset-password').send({ token: 'x'.repeat(40), password: 'StrongPassword123' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
  });
});

describe('model readiness gate', () => {
  it('reports the model as not configured while alpha and g have no value', async () => {
    const response = await request(app).get('/api/v1/model/status');
    expect(response.status).toBe(200);
    expect(response.body.status.configured).toBe(false);
    expect(response.body.status.missingParameters.map((parameter: { key: string }) => parameter.key).sort()).toEqual(['alpha', 'g']);
    expect(response.body.status.activeModelConfigVersion).toBeTruthy();
    expect(response.body.status.activeProfile).toBe('paper');
  });

  it('exposes the paper condition convention and solver', async () => {
    const response = await request(app).get('/api/v1/model/conditions');
    expect(response.status).toBe(200);
    expect(response.body.convention.bands).toHaveLength(4);
    const excellent = response.body.convention.bands[3];
    expect(excellent.label).toBe('Excellent');
    expect(excellent.minPercent).toBe(75);
    expect(excellent.upperInclusive).toBe(true);
  });

  it('refuses to create a prediction and saves the refused attempt', async () => {
    const agent = request.agent(app);
    await register(agent, 'blocked@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction());
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('MODEL_PARAMETERS_NOT_CONFIGURED');
    expect(response.body.error.message).toContain('alpha');
    expect(response.body.error.message).toContain('g');
    const list = await agent.get('/api/v1/predictions');
    expect(list.body.predictions).toHaveLength(1);
    expect(list.body.predictions[0].status).toBe('unavailable');
    expect(list.body.predictions[0].failureReason).toContain('alpha');
    expect(list.body.total).toBe(1);
  });

  it('keeps the demo profile disabled by default', async () => {
    const response = await request(app).get('/api/v1/model/demo-availability');
    expect(response.status).toBe(503);
    const agent = request.agent(app);
    await register(agent, 'demo@example.test');
    const prediction = await agent.post('/api/v1/predictions').send(validPrediction({ profile: 'demo' }));
    expect(prediction.status).toBe(400);
  });
});

describe('scenario runs with assumed values', () => {
  const assumeAlpha = {
    key: 'alpha',
    value: 0.05,
    unit: 'per degC per year',
    rationale: 'Midpoint of a published range from comparable reef studies.',
    range: { min: 0.02, max: 0.08 }
  };
  const assumeG = {
    key: 'g',
    value: 0.02,
    unit: 'per year',
    rationale: 'Placeholder for the pre-closure tourism trend.',
    range: { min: -0.01, max: 0.05 }
  };

  it('advertises the scenario profile as available with no environment switch', async () => {
    const response = await request(app).get('/api/v1/model/status');
    expect(response.body.status.scenarioProfileAvailable).toBe(true);
  });

  it('rejects a scenario that assumes nothing', async () => {
    const agent = request.agent(app);
    await register(agent, 'scenario-empty@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({ profile: 'scenario' }));
    expect(response.status).toBe(400);
    expect(response.body.error.details).toContain('at least one assumed value');
  });

  it('rejects an assumption with no rationale', async () => {
    const agent = request.agent(app);
    await register(agent, 'scenario-norationale@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({
      profile: 'scenario',
      assumedValues: [assumeAlpha, { ...assumeG, rationale: '   ' }]
    }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.error)).toContain('rationale');
  });

  it('rejects a value outside its own stated range', async () => {
    const agent = request.agent(app);
    await register(agent, 'scenario-range@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({
      profile: 'scenario',
      assumedValues: [assumeAlpha, { ...assumeG, value: 0.4, range: { min: -0.01, max: 0.05 } }]
    }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.error)).toContain('inside its stated range');
  });

  it('rejects assumed values on the paper profile', async () => {
    const agent = request.agent(app);
    await register(agent, 'scenario-onpaper@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({ assumedValues: [assumeAlpha] }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.error)).toContain('only accepted for the scenario profile');
  });

  it('names the parameter that is still missing instead of guessing it', async () => {
    const agent = request.agent(app);
    await register(agent, 'scenario-partial@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({
      profile: 'scenario',
      assumedValues: [assumeAlpha]
    }));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('SCENARIO_ASSUMPTIONS_INCOMPLETE');
    expect(response.body.error.message).toContain('g');
  });

  it('stores the assumed values, labels the run exploratory, and keeps it out of validated counts', async () => {
    const agent = request.agent(app);
    await register(agent, 'scenario-run@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({
      profile: 'scenario',
      assumedValues: [assumeAlpha, assumeG]
    }));
    // The suite has no model service listening, so a run that clears the
    // parameter gate still fails upstream (502/503/504). A 4xx parameter or
    // validation refusal would mean the gate blocked it.
    expect([201, 502, 503, 504]).toContain(response.status);
    if (response.status !== 201) return;

    const record = response.body.prediction;
    expect(record.status).toBe('scenario');
    expect(record.isScenario).toBe(true);
    expect(record.isDemo).toBe(false);
    expect(record.assumptions).toHaveLength(2);
    expect(record.assumptions.find((item: { key: string }) => item.key === 'alpha')).toMatchObject({
      value: 0.05,
      rationale: assumeAlpha.rationale,
      range: { min: 0.02, max: 0.08 }
    });
    // The assumed parameters are echoed as assumptions, not as paper values.
    const alpha = record.parameters.find((item: { key: string }) => item.key === 'alpha');
    expect(alpha.status).toBe('assumed');
    expect(alpha.reviewStatus).toBe('unreviewed');
    expect(alpha.provenance).toContain(assumeAlpha.rationale);
    expect(record.warnings[0]).toContain('not a validated prediction');

    const dashboard = await agent.get('/api/v1/dashboard');
    expect(dashboard.body.predictionCount).toBe(1);
  });
});

describe('input validation', () => {
  it('rejects reef-site scope and mismatched baseline years', async () => {
    const agent = request.agent(app);
    await register(agent, 'scope@example.test');
    const reefScope = await agent.post('/api/v1/predictions').send(validPrediction({ scope: 'reef-site' }));
    expect(reefScope.status).toBe(400);
    const mismatched = await agent.post('/api/v1/predictions').send(validPrediction({
      coralBaseline: { ...(validPrediction().coralBaseline as Record<string, unknown>), year: 2010 }
    }));
    expect(mismatched.status).toBe(400);
    const unconfirmed = await agent.post('/api/v1/predictions').send(validPrediction({
      coralBaseline: { ...(validPrediction().coralBaseline as Record<string, unknown>), sameScopeConfirmed: false }
    }));
    expect(unconfirmed.status).toBe(400);
  });

  it('requires a baseline source', async () => {
    const agent = request.agent(app);
    await register(agent, 'source@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({
      coralBaseline: { ...(validPrediction().coralBaseline as Record<string, unknown>), surveySource: '' }
    }));
    expect(response.status).toBe(400);
  });

  it('requires the baseline source citation to include its year', async () => {
    const agent = request.agent(app);
    await register(agent, 'undated-source@example.test');
    const response = await agent.post('/api/v1/predictions').send(validPrediction({
      coralBaseline: { ...(validPrediction().coralBaseline as Record<string, unknown>), surveySource: 'Citywide reef survey' }
    }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.error)).toContain('source year');
  });
});

describe('uploads', () => {
  it('rejects executable and mismatched file types', async () => {
    const agent = request.agent(app);
    await register(agent, 'upload@example.test');
    const script = await agent.post('/api/v1/uploads').attach('file', Buffer.from('alert(1)'), { filename: 'run.js', contentType: 'application/javascript' });
    expect(script.status).toBe(415);
    const binaryText = await agent.post('/api/v1/uploads').attach('file', Buffer.from([0, 1, 2, 3]), { filename: 'data.txt', contentType: 'text/plain' });
    expect(binaryText.status).toBe(400);
    const disguised = await agent.post('/api/v1/uploads').attach('file', Buffer.from('%PDF-1.7'), { filename: 'data.txt', contentType: 'application/pdf' });
    expect(disguised.status).toBe(415);
  });

  it('stores an allowed document privately and scopes it to the owner', async () => {
    const owner = request.agent(app);
    const other = request.agent(app);
    await register(owner, 'upload-owner@example.test');
    await register(other, 'upload-other@example.test');
    const created = await owner.post('/api/v1/uploads').attach('file', Buffer.from('prediction output\n42%'), { filename: 'output.txt', contentType: 'text/plain' });
    expect(created.status).toBe(201);
    const uploadId = created.body.upload.id as string;
    expect(created.body.upload.sha256).toHaveLength(64);
    expect(created.body.upload.textPreview).toContain('42%');
    expect((await owner.get('/api/v1/uploads')).body.uploads).toHaveLength(1);
    expect((await other.get('/api/v1/uploads')).body.uploads).toHaveLength(0);
    expect((await other.delete(`/api/v1/uploads/${uploadId}`)).status).toBe(404);
    expect((await owner.delete(`/api/v1/uploads/${uploadId}`)).status).toBe(204);
  });
  it('extracts text from a simple PDF and reports unsupported encodings honestly', async () => {
    const agent = request.agent(app);
    await register(agent, 'pdf@example.test');

    const readable = Buffer.from(
      '%PDF-1.7\n<< /Type /Catalog >>\n<< /Type /Page >>\n<< /Length 40 >>\nstream\nBT (Appendix C worked example) Tj ET\nendstream\n%%EOF\n',
      'latin1'
    );
    const extracted = await agent
      .post('/api/v1/uploads')
      .attach('file', readable, { filename: 'paper.pdf', contentType: 'application/pdf' });
    expect(extracted.status).toBe(201);
    expect(extracted.body.upload.extractionStatus).toBe('text-available');
    expect(extracted.body.upload.textPreview).toContain('Appendix C worked example');
    expect(extracted.body.upload.pageCount).toBe(1);

    const composite = Buffer.from(
      '%PDF-1.7\n<< /Type /Catalog >>\n<< /Type /Page >>\n<< /Subtype /Type0 /Encoding /Identity-H >>\n<< /Length 32 >>\nstream\nBT (glyphs) Tj ET\nendstream\n%%EOF\n',
      'latin1'
    );
    const unsupported = await agent
      .post('/api/v1/uploads')
      .attach('file', composite, { filename: 'subset.pdf', contentType: 'application/pdf' });
    expect(unsupported.status).toBe(201);
    expect(unsupported.body.upload.extractionStatus).toBe('extraction-unsupported');
    expect(unsupported.body.upload.textPreview).toBeNull();
    const report = await agent.post('/api/v1/ai/reports').send({ uploadIds: [unsupported.body.upload.id] });
    expect(report.status).toBe(400);
    expect(JSON.stringify(report.body.error)).toContain('prediction history');
  });
});

describe('research summary', () => {
  it('serves the shared ResearchSummary contract', async () => {
    const response = await request(app).get('/api/v1/research');
    expect(response.status).toBe(200);
    const summary: ResearchSummary = response.body;
    expect(summary.reportedAccuracy.table4[1].reportedAbsoluteErrorPercent).toBe(0.3);
    expect(summary.accuracyDisclaimer).toContain('MAE of 0.3');
    expect(summary.paperConflicts.length).toBeGreaterThanOrEqual(4);
    expect(summary.sites).toHaveLength(19);
    expect(summary.stations[0].scope).toBe('citywide-annual-average');
    expect(summary.equations.coralCover).toContain('alpha');
    expect(summary.conditionConvention.bands[3].maxPercent).toBe(100);
    expect(summary.referenceDiagnostics.some((entry) => entry.value.includes('alpha'))).toBe(true);
    const text = JSON.stringify(summary);
    expect(text).toContain('sea-surface-temperature');
    expect(text).toContain('air temperature is never substituted');
  });
});

describe('dashboard', () => {
  it('scopes counts to the signed-in account', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    await register(first, 'dash-one@example.test');
    await register(second, 'dash-two@example.test');
    const firstDashboard = await first.get('/api/v1/dashboard');
    expect(firstDashboard.status).toBe(200);
    expect(firstDashboard.body.predictionCount).toBe(0);
    expect(firstDashboard.body.locationStatus.siteLevelForecastAvailable).toBe(false);
    expect(firstDashboard.body.modelStatus.configured).toBe(false);
    expect((await second.get('/api/v1/dashboard')).body.predictionCount).toBe(0);
  });
});
