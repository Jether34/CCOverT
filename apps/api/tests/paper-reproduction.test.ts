import { describe, expect, it } from 'vitest';
import { estimateTourismGrowth, FUTURE_TOURISM_PROJECTION_WARNING } from '../src/services/predictions';
import { isValidatedPrediction, PAPER_REPRODUCTION_TOURISM_PERIODS } from '@ccovert/shared';
import { createPredictionSchema } from '../src/utils/validation';

const paperRequest = (baselineYear: number, coralYear = baselineYear) => ({
  studyAreaId: 'puerto-princesa-city',
  scope: 'citywide-annual-average',
  profile: 'paper-reproduction',
  baselineYear,
  horizonYears: 30,
  coralBaseline: {
    coverPercent: 57,
    year: coralYear,
    measure: '%LCC (HC+SC)',
    surveySource: 'CCOverT paper reported 2006 baseline',
    surveyScope: 'citywide-annual-average',
    sameScopeConfirmed: true
  },
  assumedValues: []
});

describe('paper-reproduction safeguards', () => {
  it('estimates g with the requested log-linear model', () => {
    const g = estimateTourismGrowth([
      { year: 2006, value: 100 },
      { year: 2007, value: 100 * Math.exp(0.02) },
      { year: 2008, value: 100 * Math.exp(0.04) }
    ], 2006);
    expect(g).toBeCloseTo(0.02, 10);
  });

  it('never treats paper-reproduction as validated', () => {
    expect(isValidatedPrediction({
      status: 'paper-reproduction', isDemo: false, isScenario: false,
      isPaperReproduction: true, validationStatus: 'independently-validated'
    })).toBe(false);
  });

  it('defines a gap-free post-2026 continuation and the required warning', () => {
    expect(PAPER_REPRODUCTION_TOURISM_PERIODS).toEqual(expect.arrayContaining([
      expect.objectContaining({ startYear: 2023, endYear: 2026, growthRate: 0.128708 }),
      expect.objectContaining({ startYear: 2027, endYear: 9999, growthRate: 0.128708 })
    ]));
    expect(FUTURE_TOURISM_PROJECTION_WARNING).toBe(
      'Tourism values after 2026 are model projections using g = 0.128708; no observed tourism data was used for those years.'
    );
  });

  it('accepts the default and alternate selected paper-reproduction start years', () => {
    expect(createPredictionSchema.safeParse(paperRequest(2006)).success).toBe(true);
    expect(createPredictionSchema.safeParse(paperRequest(2012, 2012)).success).toBe(true);
  });

  it('rejects a paper-reproduction start when the C0 year does not match it', () => {
    const rejected = createPredictionSchema.safeParse(paperRequest(2020, 2006));
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues.map((issue) => issue.message).join(' ')).toContain('baselineYear');
  });

  it.each([2020, 2036, 2050])('accepts paper-reproduction forecast ending year %s without moving the baseline', (forecastEndYear) => {
    const parsed = createPredictionSchema.safeParse({ ...paperRequest(2006), forecastEndYear, horizonYears: forecastEndYear - 2006 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.baselineYear).toBe(2006);
      expect(parsed.data.coralBaseline.year).toBe(2006);
      expect(parsed.data.forecastEndYear).toBe(forecastEndYear);
    }
  });

  it('rejects a forecast ending year that is not after the baseline', () => {
    const rejected = createPredictionSchema.safeParse({ ...paperRequest(2006), forecastEndYear: 2006, horizonYears: 1 });
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues.map((issue) => issue.message).join(' ')).toContain('must be after the model baseline year');
  });

  it('rejects a coral baseline year that differs from the profile baseline', () => {
    const rejected = createPredictionSchema.safeParse({ ...paperRequest(2006, 2022), forecastEndYear: 2036 });
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues.map((issue) => issue.message).join(' ')).toContain('must match baselineYear');
  });

  it('accepts a different start year for a normal profile when its C0 year matches', () => {
    const parsed = createPredictionSchema.safeParse({
      ...paperRequest(2012, 2012),
      profile: 'paper',
      forecastEndYear: 2020,
      horizonYears: 8,
      coralBaseline: { ...paperRequest(2012, 2012).coralBaseline, coverPercent: 45, surveySource: 'Independent citywide survey 2012' }
    });
    expect(parsed.success).toBe(true);
  });

  it('enforces the configured maximum horizon', () => {
    const rejected = createPredictionSchema.safeParse({ ...paperRequest(2006), forecastEndYear: 2107, horizonYears: 101 });
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues.map((issue) => issue.message).join(' ')).toContain('forecast duration');
  });
});
