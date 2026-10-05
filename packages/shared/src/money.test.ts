import { describe, expect, it } from 'vitest';
import { computeNet, convertMoney, pctsSumTo100, splitByPct, sumMoney } from './money';

describe('money', () => {
  it('computes net from gross and deductions without float errors', () => {
    expect(computeNet('85000.00', ['2439.50', '2584.00', '6321.89'])).toBe('73654.61');
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
  });

  it('converts with a rate', () => {
    expect(convertMoney('100', '58.75')).toBe('5875.00');
  });

  it('splits so parts add up to the total', () => {
    expect(splitByPct('100.00', [33.33, 33.33, 33.34])).toEqual(['33.33', '33.33', '33.34']);
    expect(splitByPct('10.01', [50, 50])).toEqual(['5.00', '5.01']);
  });

  it('validates percentages', () => {
    expect(pctsSumTo100([50, 50])).toBe(true);
    expect(pctsSumTo100([60, 50])).toBe(false);
  });
});
