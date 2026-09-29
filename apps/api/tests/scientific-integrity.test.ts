import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/services/datasets';
import { INTERPRETATION_LIMITS } from '../src/services/ai';

/**
 * Regression tests for the scientific-integrity audit.
 *
 * The `readiness` block documents two blocking defects that are *current
 * behaviour*, not desired behaviour. They are asserted deliberately so the
 * suite fails loudly if someone closes the gap and the assertions need to move.
 */
describe('CSV header resolution', () => {
  const rows = ['2006,29.1', '2007,29.3', '2008,29.4'].join('\n');

  it('accepts a realistic sea-surface temperature header carrying a unit suffix', () => {
    const parsed = parseCsv(`year,Sea Surface Temperature (degC)\n${rows}`, 'sst', 'degC');
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records[0]).toEqual({ year: 2006, value: 29.1 });
  });

  it('accepts a realistic tourist arrivals header', () => {
    const parsed = parseCsv(`Year,Tourist Arrivals\n${rows}`, 'tourism', 'annualArrivals');
    expect(parsed.records).toHaveLength(3);
  });

  it('accepts a coral cover percentage header', () => {
    const parsed = parseCsv(`year,Coral Cover (%)\n${rows}`, 'coral-cover', 'percent');
    expect(parsed.records).toHaveLength(3);
  });

  it('still resolves a plain value column', () => {
    expect(parseCsv(`year,value\n${rows}`, 'sst', 'degC').records).toHaveLength(3);
  });

  it('still rejects a file with no recognisable value column', () => {
    expect(() => parseCsv(`year,notes\n${rows}`, 'sst', 'degC')).toThrow(/value/i);
  });

  it('does not resolve a year column as the value column', () => {
    expect(() => parseCsv('year,year\n2006,2007', 'sst', 'degC')).toThrow(/"year" and "value" columns/);
  });
});

describe('tourism diagnostic', () => {
  it('does not present the driver rate as a percentage of cover', async () => {
    // The pre-run warning must describe beta*V as a rate only. The cumulative
    // cover loss is added after the model runs, from the interval-mean
    // contribution actually reported by the solver.
    const source = await import('node:fs/promises');
    const text = await source.readFile(
      new URL('../src/services/predictions.ts', import.meta.url),
      'utf8'
    );
    expect(text).not.toMatch(/% of current cover per year/);
    expect(text).toContain('cumulative tourism loss of');
  });
});

describe('AI interpretation limits', () => {
  it('states every mandatory limitation', () => {
    expect(INTERPRETATION_LIMITS).toHaveLength(4);
    expect(INTERPRETATION_LIMITS.join(' ')).toMatch(/thermal coefficient and tourism growth rate were not published/);
    expect(INTERPRETATION_LIMITS.join(' ')).toMatch(/sea-surface temperature/);
    expect(INTERPRETATION_LIMITS.join(' ')).toMatch(/analyst convention/);
    expect(INTERPRETATION_LIMITS.join(' ')).toMatch(/MAE of 0\.30/);
  });

  it('is attached by the server, not left to the provider prompt', async () => {
    const source = await import('node:fs/promises');
    const text = await source.readFile(new URL('../src/services/ai.ts', import.meta.url), 'utf8');
    // The limits must be re-attached after a provider response is accepted.
    expect(text).toMatch(/generatedBy === 'ai-provider'/);
    expect(text).toMatch(/limitationsSection\(\)\.join/);
  });
});

describe('paper-profile readiness (known blocking gaps)', () => {
  it('cannot mark a configuration version reviewed at creation time', async () => {
    const { modelConfigService } = await import('../src/services/modelConfigService');
    // The reviewed guard fires before any lookup, so no seeded state is needed.
    await expect(
      modelConfigService.createVersion({
        baseVersion: '0.0.0-does-not-matter',
        changes: { alpha: 0.05 },
        notes: 'Attempting to publish and self-approve in one step.',
        createdById: 'researcher-1',
        createdByLabel: 'researcher-1',
        effectiveDate: null,
        reviewStatus: 'reviewed'
      })
    ).rejects.toThrow(/independently reviewing/i);
  });

  it('exposes an independent-review method and no longer hardcodes reviewedBy to null', async () => {
    const { modelConfigService } = await import('../src/services/modelConfigService');
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(modelConfigService));
    // The audit found reviewedBy was only ever persisted as null, which made
    // paperReadiness unsatisfiable. The review path now exists.
    expect(surface.filter((name) => /review/i.test(name))).toContain('reviewVersion');

    const source = await import('node:fs/promises');
    const text = await source.readFile(
      new URL('../src/services/modelConfigService.ts', import.meta.url),
      'utf8'
    );
    // createVersion must still never claim an independent review; the review
    // endpoint is the only writer of reviewedBy.
    expect(text).toMatch(/reviewedBy: null,\n\s+baselineYear/);
    expect(text).toMatch(/reviewedBy: input\.reviewedByLabel/);
  });
});
