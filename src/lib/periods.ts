/**
 * Turns the vague time phrases merchants use ("last week", "this month") into
 * the exact inclusive `startDate` / `endDate` pair the metric functions need.
 *
 * These rules are the single source of truth, so two people asking the same
 * question get the same numbers:
 *
 *  - "last week"  = Monday to Sunday (all 7 days) of the previous calendar week.
 *  - "this month" = the 1st of the current month through today (inclusive).
 *
 * Any other phrase throws instead of being guessed. Add a new rule here, with a
 * test, before supporting it anywhere else.
 *
 * "Today" is a calendar date, not a timestamp. Pass `today` explicitly for
 * reproducible results, or `timeZone` (IANA name, e.g. "America/New_York") so
 * "today" means the store's local date rather than the server's.
 */

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export type Period = "last week" | "this month";

export const SUPPORTED_PERIODS: readonly Period[] = ["last week", "this month"];

export interface ResolveOptions {
  /** The reference date, YYYY-MM-DD. Defaults to the current date in `timeZone`. */
  today?: string;
  /** IANA time zone used to work out today's date when `today` is not given. */
  timeZone?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value: string): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (!DATE_RE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`today must be a valid date in YYYY-MM-DD format, got "${value}"`);
  }
  return d;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Today's calendar date (YYYY-MM-DD) in the given time zone, or the system's. */
export function todayIn(timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Normalise "Last Week", "last_week", "last-week" etc. to "last week". */
function normalise(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** Resolve a time phrase to an exact inclusive date range. */
export function resolvePeriod(phrase: string, options: ResolveOptions = {}): DateRange {
  const today = parseDay(options.today ?? todayIn(options.timeZone));
  const period = normalise(phrase);

  switch (period) {
    case "last week": {
      // getUTCDay: Sunday = 0 ... Saturday = 6. Days since this week's Monday:
      const sinceMonday = (today.getUTCDay() + 6) % 7;
      const thisMonday = addDays(today, -sinceMonday);
      return { startDate: fmt(addDays(thisMonday, -7)), endDate: fmt(addDays(thisMonday, -1)) };
    }
    case "this month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { startDate: fmt(first), endDate: fmt(today) };
    }
    default:
      throw new Error(
        `Unsupported period "${phrase}". Supported: ${SUPPORTED_PERIODS.map((p) => `"${p}"`).join(", ")}`,
      );
  }
}
