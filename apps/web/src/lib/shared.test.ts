import { describe, expect, it } from 'vitest';
import {
  CONDITION_CONVENTION,
  DEMO_SYNTHETIC_PARAMETERS,
  PAPER_PARAMETERS,
  REQUIRED_PARAMETER_KEYS,
  classifyPercent,
  isCompleteConditionBands,
  seriesTrend,
  thermalTermInactiveForHorizon,
  unconfiguredParameters
} from '@ccovert/shared';

describe('condition convention', () => {
  it('ships a gap-free convention over 0-100', () => {
    expect(isCompleteConditionBands(CONDITION_CONVENTION.bands)).toBe(true);
  });

  it('rejects a convention with a gap at 75 percent', () => {
    const withGap = [
      { label: 'Poor', minPercent: 0, maxPercent: 25, upperInclusive: false },
      { label: 'Fair', minPercent: 25, maxPercent: 50, upperInclusive: false },
      { label: 'Good', minPercent: 50, maxPercent: 75, upperInclusive: false },
      { label: 'Excellent', minPercent: 76, maxPercent: 100, upperInclusive: true }
    ];
    expect(isCompleteConditionBands(withGap)).toBe(false);
    expect(classifyPercent(75.5, withGap)).toBeNull();
  });

  it('assigns every value in the range, including the disputed 75 percent', () => {
    for (let value = 0; value <= 100; value += 0.5) {
      expect(classifyPercent(value, CONDITION_CONVENTION.bands)).not.toBeNull();
    }
    expect(classifyPercent(24.99, CONDITION_CONVENTION.bands)).toBe('Poor');
    expect(classifyPercent(25, CONDITION_CONVENTION.bands)).toBe('Fair');
    expect(classifyPercent(50, CONDITION_CONVENTION.bands)).toBe('Good');
    expect(classifyPercent(75, CONDITION_CONVENTION.bands)).toBe('Excellent');
    expect(classifyPercent(100, CONDITION_CONVENTION.bands)).toBe('Excellent');
  });
});

describe('parameter completeness', () => {
  it('reports alpha and g as unconfigured from the paper values alone', () => {
    expect(unconfiguredParameters(PAPER_PARAMETERS).map((parameter) => parameter.key)).toEqual(['alpha', 'g']);
  });

  it('marks K and beta as provisional and never reviewed', () => {
    const provisional = PAPER_PARAMETERS.filter((parameter) => parameter.status === 'provisional');
    expect(provisional.map((parameter) => parameter.key).sort()).toEqual(['K', 'beta']);
    expect(provisional.every((parameter) => parameter.reviewStatus === 'unreviewed')).toBe(true);
  });

  it('covers every required parameter exactly once', () => {
    expect(PAPER_PARAMETERS.map((parameter) => parameter.key).sort()).toEqual([...REQUIRED_PARAMETER_KEYS].sort());
  });

  it('only supplies the two documented synthetic values in the demo profile', () => {
    expect(Object.keys(DEMO_SYNTHETIC_PARAMETERS).sort()).toEqual(['alpha', 'g']);
    expect(DEMO_SYNTHETIC_PARAMETERS.alpha).not.toBe(0);
    expect(DEMO_SYNTHETIC_PARAMETERS.g).not.toBe(0);
  });

  it('recognises the explicit inactive-thermal horizon exception', () => {
    expect(thermalTermInactiveForHorizon(PAPER_PARAMETERS, 10)).toBe(true);
    expect(thermalTermInactiveForHorizon(PAPER_PARAMETERS, 100)).toBe(false);
  });
});

describe('trend helper', () => {
  it('describes a falling series', () => {
    const points = [{ coverStartPercent: 57, coverEndPercent: 50 }, { coverEndPercent: 46 }];
    expect(seriesTrend(points).direction).toBe('falling');
  });

  it('reports unknown for a single point', () => {
    expect(seriesTrend([{ coverEndPercent: 50 }]).direction).toBe('unknown');
  });
});
