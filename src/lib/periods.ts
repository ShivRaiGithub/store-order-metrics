/**
 * Turns the vague time phrases merchants use ("last week", "this month") into
 * the exact inclusive `startDate` / `endDate` pair the metric functions need.
 *
 * These rules are the single source of truth, so two people asking the same
 * question get the same numbers:
 *
 *  - "last week"    = Monday to Sunday (all 7 days) of the previous calendar week.
 *  - "this month"   = the 1st of the current month through today (inclusive).
 *  - "last N days"  = N days ending today: today and the N-1 days before it.
 *                     ("past N days" means the same.)
 *  - Seasons are meteorological: spring Mar–May, summer Jun–Aug,
 *    autumn/fall Sep–Nov, winter Dec–Feb (Dec belongs to the next year's Jan/Feb).
 *  - "this season"  = the 1st day of the current season through today.
 *  - "<season>"     = e.g. "winter": the most recent one. If we are in it now,
 *                     its 1st day through today; otherwise the whole of the last one.
 *  - No period given at all = "this month" (see DEFAULT_PERIOD).
 *  - A phrase with no rule ("recently", "last month") = "last week"
 *    (see FALLBACK_PERIOD). resolvePeriod itself throws
 *    UnsupportedPeriodError; the chat tools catch it and fall back, so the
 *    answer can say which rule was used. Add a new rule here, with a
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

/** Phrases the merchant can use, for prompts and error messages. */
export const SUPPORTED_PERIODS: readonly string[] = [
  "last week",
  "this month",
  "last N days",
  "this season",
  "spring",
  "summer",
  "autumn",
  "fall",
  "winter",
];

/** Used when the merchant gives no period at all. */
export const DEFAULT_PERIOD = "this month";

/** Used when the merchant's phrase matches no rule ("recently", "last month"). */
export const FALLBACK_PERIOD = "last week";

/** Thrown for a phrase that has no rule, so callers can fall back to FALLBACK_PERIOD. */
export class UnsupportedPeriodError extends Error {
  constructor(public readonly phrase: string) {
    super(`Unsupported period "${phrase}". Supported: ${SUPPORTED_PERIODS.map((p) => `"${p}"`).join(", ")}`);
    this.name = "UnsupportedPeriodError";
  }
}

const MAX_DAYS = 366;

type Season = "winter" | "spring" | "summer" | "autumn";
const SEASONS: Season[] = ["winter", "spring", "summer", "autumn"];
const SEASON_ALIASES: Record<string, Season> = {
  winter: "winter",
  spring: "spring",
  summer: "summer",
  autumn: "autumn",
  fall: "autumn",
};

/** Season of a 0-based month: Dec/Jan/Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn. */
const seasonOfMonth = (month: number): Season => SEASONS[Math.floor(((month + 1) % 12) / 3)];

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

/** First day of the season that contains `d`. */
function seasonStart(d: Date): Date {
  const m = d.getUTCMonth();
  const startMonth = Math.floor(((m + 1) % 12) / 3) * 3 - 1; // -1 = December of the previous year
  return new Date(Date.UTC(d.getUTCFullYear() - (m < 2 ? 1 : 0), (startMonth + 12) % 12, 1));
}

/** Most recent occurrence of a season, on or before today (cut off at today if it's the current one). */
function lastSeason(season: Season, today: Date): DateRange {
  if (seasonOfMonth(today.getUTCMonth()) === season) {
    return { startDate: fmt(seasonStart(today)), endDate: fmt(today) };
  }
  // Walk back month by month to the last month of the most recent occurrence.
  let y = today.getUTCFullYear();
  let m = today.getUTCMonth();
  while (seasonOfMonth(m) !== season) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0));
  return { startDate: fmt(seasonStart(lastDay)), endDate: fmt(lastDay) };
}

/** Resolve a time phrase to an exact inclusive date range. */
export function resolvePeriod(phrase: string, options: ResolveOptions = {}): DateRange {
  const today = parseDay(options.today ?? todayIn(options.timeZone));
  const period = normalise(phrase);

  const lastDays = period.match(/^(?:last|past) (\d+) days?$/);
  if (lastDays) {
    const n = Number(lastDays[1]);
    if (n < 1 || n > MAX_DAYS) throw new Error(`"${phrase}": the number of days must be between 1 and ${MAX_DAYS}`);
    return { startDate: fmt(addDays(today, -(n - 1))), endDate: fmt(today) };
  }
  if (period in SEASON_ALIASES) return lastSeason(SEASON_ALIASES[period], today);

  switch (period) {
    case "this season":
      return { startDate: fmt(seasonStart(today)), endDate: fmt(today) };
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
      throw new UnsupportedPeriodError(phrase);
  }
}
