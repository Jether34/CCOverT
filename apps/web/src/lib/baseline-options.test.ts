import { describe, expect, it } from 'vitest';
import {
  PAPER_BASELINE_OPTIONS,
  PAPER_REPORTED_ACCURACY,
  PAPER_REPORTED_AVERAGE_COVER,
  PAPER_REPORTED_MAE
} from '@ccovert/shared';
import { applyBaselineOption, findBaselineOption } from '../pages/PredictPage';

/** Copied from apps/api/src/utils/validation.ts so this cannot drift from the API. */
const SOURCE_YEAR_RULE = /(?:18|19|20|21)\d{2}/;

describe('paper baseline options', () => {
  it('offers the distinct figures the paper prints, not one implied default', () => {
    const values = PAPER_BASELINE_OPTIONS.map((option) => option.coverPercent);
    expect(values).toContain(PAPER_REPORTED_ACCURACY.table5[0].observedPercent);
    expect(values).toContain(PAPER_REPORTED_AVERAGE_COVER[0].percent);
    expect(values).toContain(PAPER_REPORTED_ACCURACY.table4[0].observedPercent);
    expect(new Set(values).size).toBe(PAPER_BASELINE_OPTIONS.length);
  });

  it('reads its numbers from the paper constants so the list cannot drift', () => {
    const byId = (id: string) => PAPER_BASELINE_OPTIONS.find((option) => option.id === id);
    expect(byId('table5-observed')?.coverPercent).toBe(PAPER_REPORTED_ACCURACY.table5[0].observedPercent);
    expect(byId('reported-average')?.coverPercent).toBe(PAPER_REPORTED_AVERAGE_COVER[0].percent);
    expect(byId('table4-observed')?.coverPercent).toBe(PAPER_REPORTED_ACCURACY.table4[0].observedPercent);
  });

  /**
   * Regression: a hand-typed citation of "CCOverT paper Table 1" was rejected by
   * the API because it carried no year, and the UI only showed the generic
   * "Request validation failed". Every option must therefore ship a citation the
   * API accepts as-is.
   */
  it('ships a citation the API accepts without the user retyping a year', () => {
    for (const option of PAPER_BASELINE_OPTIONS) {
      expect(SOURCE_YEAR_RULE.test(option.source)).toBe(true);
      expect(option.source).toContain(String(option.year));
      expect(option.source.length).toBeGreaterThanOrEqual(2);
      expect(option.source.length).toBeLessThanOrEqual(400);
      expect(option.method.length).toBeGreaterThanOrEqual(3);
      expect(option.method.length).toBeLessThanOrEqual(300);
    }
  });

  it('keeps cover and year inside the range the API accepts', () => {
    for (const option of PAPER_BASELINE_OPTIONS) {
      expect(option.coverPercent).toBeGreaterThanOrEqual(0);
      expect(option.coverPercent).toBeLessThanOrEqual(100);
      expect(Number.isInteger(option.year)).toBe(true);
      expect(option.year).toBeGreaterThanOrEqual(1900);
      expect(option.year).toBeLessThanOrEqual(2200);
    }
  });

  it('flags only the figure that disagrees with the rest of the paper', () => {
    const conflicting = PAPER_BASELINE_OPTIONS.filter((option) => option.conflict);
    expect(conflicting).toHaveLength(1);
    expect(conflicting[0].coverPercent).toBe(PAPER_REPORTED_ACCURACY.table4[0].observedPercent);
    expect(conflicting[0].note).toContain(String(PAPER_REPORTED_MAE));
  });

  it('does not claim a survey method the paper never documents', () => {
    for (const option of PAPER_BASELINE_OPTIONS) {
      expect(option.method).toMatch(/not documented/i);
    }
  });
});

describe('applyBaselineOption', () => {
  const base = {
    profile: 'scenario' as const,
    baselineOptionId: 'my-own-survey',
    coverPercent: '',
    baselineYear: '2006',
    horizonYears: '10',
    surveySource: '',
    surveyMethod: '',
    substepsPerYear: '12',
    shareLocation: false,
    assumedAlpha: '',
    assumedAlphaUnit: 'per degC per year',
    assumedAlphaRationale: '',
    assumedAlphaMin: '',
    assumedAlphaMax: '',
    assumedG: '',
    assumedGUnit: 'per year',
    assumedGRationale: '',
    assumedGMin: '',
    assumedGMax: ''
  };

  it('fills cover, year, source, and method together from the chosen citation', () => {
    const option = findBaselineOption('table5-observed');
    expect(option).not.toBeNull();
    const form = applyBaselineOption(base, option!);
    expect(form.baselineOptionId).toBe('table5-observed');
    expect(Number(form.coverPercent)).toBe(option!.coverPercent);
    expect(Number(form.baselineYear)).toBe(option!.year);
    expect(form.surveySource).toBe(option!.source);
    expect(form.surveyMethod).toBe(option!.method);
  });

  it('clears the baseline when the user switches to their own survey', () => {
    const filled = applyBaselineOption(base, findBaselineOption('table4-observed'));
    const cleared = applyBaselineOption(filled, null);
    expect(cleared.baselineOptionId).toBe('my-own-survey');
    expect(cleared.coverPercent).toBe('');
    expect(cleared.surveySource).toBe('');
    expect(cleared.surveyMethod).toBe('');
  });

  it('leaves the horizon and profile untouched', () => {
    const form = applyBaselineOption(base, findBaselineOption('reported-average'));
    expect(form.horizonYears).toBe(base.horizonYears);
    expect(form.profile).toBe(base.profile);
  });

  it('returns null for an unknown id so nothing resolves to a silent default', () => {
    expect(findBaselineOption('my-own-survey')).toBeNull();
    expect(findBaselineOption('')).toBeNull();
    expect(findBaselineOption('nope')).toBeNull();
  });
});
