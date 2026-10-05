import { describe, expect, it } from 'vitest';
import { occurrencesInMonth } from './occurrences';

describe('occurrencesInMonth', () => {
  it('monthly clamps the due day to the month length', () => {
    const rule = { frequency: 'monthly' as const, dueDay: 31, startDate: '2026-01-01', endDate: null };
    expect(occurrencesInMonth(rule, '2026-02')).toEqual(['2026-02-28']);
    expect(occurrencesInMonth(rule, '2026-03')).toEqual(['2026-03-31']);
  });

  it('respects start and end dates', () => {
    const rule = { frequency: 'monthly' as const, dueDay: 5, startDate: '2026-03-10', endDate: '2026-05-01' };
    expect(occurrencesInMonth(rule, '2026-03')).toEqual([]);
    expect(occurrencesInMonth(rule, '2026-04')).toEqual(['2026-04-05']);
    expect(occurrencesInMonth(rule, '2026-05')).toEqual([]);
  });

  it('yearly only in the start month', () => {
    const rule = { frequency: 'yearly' as const, dueDay: 15, startDate: '2025-06-01', endDate: null };
    expect(occurrencesInMonth(rule, '2026-06')).toEqual(['2026-06-15']);
    expect(occurrencesInMonth(rule, '2026-07')).toEqual([]);
  });

  it('biweekly steps from the start date', () => {
    const rule = { frequency: 'biweekly' as const, dueDay: 1, startDate: '2026-09-04', endDate: null };
    expect(occurrencesInMonth(rule, '2026-10')).toEqual(['2026-10-02', '2026-10-16', '2026-10-30']);
  });
});
