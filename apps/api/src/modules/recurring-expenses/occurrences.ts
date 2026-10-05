import type { RecurrenceFrequency } from '@mypersonalfinance/shared';
import { addDays, daysInMonth, monthRange } from '../../lib/dates';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  dueDay: number;
  startDate: string;
  endDate: string | null;
}

/** Dates ("YYYY-MM-DD") on which a recurring expense falls inside the given month ("YYYY-MM"). */
export const occurrencesInMonth = (rule: RecurrenceRule, month: string): string[] => {
  const { from, to } = monthRange(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const inRange = (d: string) => d >= from && d <= to && d >= rule.startDate && (!rule.endDate || d <= rule.endDate);
  const clampDay = (day: number) => String(Math.min(day, daysInMonth(y, m))).padStart(2, '0');

  switch (rule.frequency) {
    case 'monthly': {
      const d = `${month}-${clampDay(rule.dueDay)}`;
      return inRange(d) ? [d] : [];
    }
    case 'yearly': {
      // Same month as the start date every year.
      if (rule.startDate.slice(5, 7) !== month.slice(5, 7)) return [];
      const d = `${month}-${clampDay(rule.dueDay)}`;
      return inRange(d) ? [d] : [];
    }
    case 'weekly':
    case 'biweekly': {
      const step = rule.frequency === 'weekly' ? 7 : 14;
      const dates: string[] = [];
      // Anchor at the start date and step forward; skip whole periods before the month.
      const start = new Date(`${rule.startDate}T00:00:00Z`).getTime();
      const monthStart = new Date(`${from}T00:00:00Z`).getTime();
      const periods = Math.max(0, Math.floor((monthStart - start) / (step * 86_400_000)));
      for (let d = addDays(rule.startDate, periods * step); d <= to; d = addDays(d, step)) {
        if (inRange(d)) dates.push(d);
      }
      return dates;
    }
  }
};
