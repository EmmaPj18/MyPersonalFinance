import type { RecurrenceFrequency, WeekendRule } from './constants';

/**
 * A repeating schedule for incomes and fixed expenses. Dates are ISO strings ("YYYY-MM-DD")
 * and all math is done in UTC so results don't depend on the machine's time zone.
 */
export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Day of the month (1–31; values past the month's end mean "last day"). Not used by weekly/biweekly. */
  day: number;
  /** Second day of the month for semimonthly schedules (e.g. 15 and 30). */
  secondDay?: number | null;
  /** First possible date. Weekly/biweekly step from it; quarterly/yearly take their month from it. */
  startDate: string;
  endDate?: string | null;
  /** Move dates that fall on Saturday/Sunday to the previous or next business day. */
  weekendRule?: WeekendRule;
}

const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDaysIso = (iso: string, days: number) => fromTime(toTime(iso) + days * DAY_MS);
export const daysInMonthOf = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();
export const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: `${month}-01`, to: `${month}-${String(daysInMonthOf(y, m)).padStart(2, '0')}` };
};

const ymd = (y: number, m1: number, day: number) =>
  `${y}-${String(m1).padStart(2, '0')}-${String(Math.min(day, daysInMonthOf(y, m1))).padStart(2, '0')}`;

const adjustForWeekend = (iso: string, rule: WeekendRule | undefined) => {
  if (!rule || rule === 'none') return iso;
  const weekday = new Date(toTime(iso)).getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (weekday !== 0 && weekday !== 6) return iso;
  if (rule === 'previous') return addDaysIso(iso, weekday === 6 ? -1 : -2);
  return addDaysIso(iso, weekday === 6 ? 2 : 1);
};

/** Scheduled dates before the weekend adjustment, covering at least [from, to]. */
const rawDates = (rule: RecurrenceRule, from: string, to: string): string[] => {
  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    const step = (rule.frequency === 'weekly' ? 7 : 14) * DAY_MS;
    const start = toTime(rule.startDate);
    const periods = Math.max(0, Math.floor((toTime(from) - start) / step));
    const dates: string[] = [];
    for (let t = start + periods * step; t <= toTime(to); t += step) dates.push(fromTime(t));
    return dates;
  }
  const startMonth = +rule.startDate.slice(0, 4) * 12 + (+rule.startDate.slice(5, 7) - 1);
  const dates: string[] = [];
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7);
  const lastKey = +to.slice(0, 4) * 12 + (+to.slice(5, 7) - 1);
  while (y * 12 + (m - 1) <= lastKey) {
    const offset = y * 12 + (m - 1) - startMonth;
    const days =
      rule.frequency === 'monthly'
        ? [rule.day]
        : rule.frequency === 'semimonthly'
          ? [rule.day, rule.secondDay ?? Math.min(rule.day + 15, 31)]
          : rule.frequency === 'quarterly'
            ? offset % 3 === 0
              ? [rule.day]
              : []
            : offset % 12 === 0
              ? [rule.day]
              : [];
    for (const d of days) dates.push(ymd(y, m, d));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return dates;
};

/** Dates (after the weekend adjustment) on which the schedule falls within [from, to], sorted. */
export const occurrencesBetween = (rule: RecurrenceRule, from: string, to: string): string[] => {
  if (to < from) return [];
  // Widen the window so dates moved across the boundary by the weekend rule are not lost.
  const raw = rawDates(rule, addDaysIso(from, -3), addDaysIso(to, 3)).filter(
    (d) => d >= rule.startDate && (!rule.endDate || d <= rule.endDate),
  );
  const adjusted = raw.map((d) => adjustForWeekend(d, rule.weekendRule)).filter((d) => d >= from && d <= to);
  return [...new Set(adjusted)].sort();
};

export const occurrencesInMonth = (rule: RecurrenceRule, month: string) => {
  const { from, to } = monthBounds(month);
  return occurrencesBetween(rule, from, to);
};

/** Next occurrence strictly after `after`, looking up to ~13 months ahead. */
export const nextOccurrence = (rule: RecurrenceRule, after: string): string | null =>
  occurrencesBetween(rule, addDaysIso(after, 1), addDaysIso(after, 400))[0] ?? null;

/** How many times per year the schedule repeats (for monthly-equivalent totals). */
export const occurrencesPerYear: Record<RecurrenceFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};
