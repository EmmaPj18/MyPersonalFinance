import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrencesBetween, occurrencesInMonth, type RecurrenceRule } from './recurrence';

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({ frequency: 'monthly', day: 1, startDate: '2026-01-01', ...r });

describe('recurrence', () => {
  it('monthly clamps the day to the end of the month', () => {
    expect(occurrencesInMonth(rule({ day: 31 }), '2026-02')).toEqual(['2026-02-28']);
    expect(occurrencesInMonth(rule({ day: 31 }), '2026-04')).toEqual(['2026-04-30']);
  });

  it('respects start and end dates', () => {
    const r = rule({ day: 5, startDate: '2026-03-10', endDate: '2026-05-01' });
    expect(occurrencesInMonth(r, '2026-03')).toEqual([]);
    expect(occurrencesInMonth(r, '2026-04')).toEqual(['2026-04-05']);
    expect(occurrencesInMonth(r, '2026-05')).toEqual([]);
  });

  it('semimonthly pays twice (15 and last day)', () => {
    expect(occurrencesInMonth(rule({ frequency: 'semimonthly', day: 15, secondDay: 31 }), '2026-02')).toEqual([
      '2026-02-15',
      '2026-02-28',
    ]);
  });

  it('quarterly and yearly take their month from the start date', () => {
    const q = rule({ frequency: 'quarterly', day: 10, startDate: '2026-02-01' });
    expect(occurrencesBetween(q, '2026-01-01', '2026-12-31')).toEqual(['2026-02-10', '2026-05-10', '2026-08-10', '2026-11-10']);
    const y = rule({ frequency: 'yearly', day: 15, startDate: '2025-06-01' });
    expect(occurrencesInMonth(y, '2026-06')).toEqual(['2026-06-15']);
    expect(occurrencesInMonth(y, '2026-07')).toEqual([]);
  });

  it('weekly and biweekly step from the start date', () => {
    const b = rule({ frequency: 'biweekly', startDate: '2026-09-04' });
    expect(occurrencesInMonth(b, '2026-10')).toEqual(['2026-10-02', '2026-10-16', '2026-10-30']);
    expect(occurrencesInMonth(rule({ frequency: 'weekly', startDate: '2026-10-03' }), '2026-10')).toHaveLength(5);
  });

  it('moves weekend dates to a business day, even across months', () => {
    // 2026-10-31 is a Saturday.
    expect(occurrencesInMonth(rule({ day: 31, weekendRule: 'previous' }), '2026-10')).toEqual(['2026-10-30']);
    expect(occurrencesInMonth(rule({ day: 31, weekendRule: 'next' }), '2026-10')).toEqual([]);
    expect(occurrencesInMonth(rule({ day: 31, weekendRule: 'next' }), '2026-11')).toEqual(['2026-11-02', '2026-11-30']);
  });

  it('finds the next occurrence', () => {
    expect(nextOccurrence(rule({ frequency: 'semimonthly', day: 15, secondDay: 30 }), '2026-10-17')).toBe('2026-10-30');
    expect(nextOccurrence(rule({ day: 5, endDate: '2026-10-10' }), '2026-10-17')).toBeNull();
  });
});
