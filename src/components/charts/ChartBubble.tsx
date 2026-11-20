import type { ReactNode } from "react";

/** The AI reply bubble that holds a finished chart or table. */
export function ChartBubble({
  title,
  subtitle,
  summary,
  children,
}: {
  title: string;
  subtitle: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <figure className="viz-root w-full rounded-2xl rounded-tl-sm border border-zinc-200 bg-[var(--surface-1)] p-4 dark:border-zinc-800">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="font-medium text-[var(--text-primary)]">{title}</div>
          <div className="text-xs text-[var(--text-secondary)]">{subtitle}</div>
        </div>
        {summary && <div className="text-sm text-[var(--text-secondary)]">{summary}</div>}
      </figcaption>
      {children}
    </figure>
  );
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const moneyShort = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : String(Math.round(n));

/** "20 Oct" from YYYY-MM-DD, in UTC so it never shifts a day. */
export const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

export const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Subtitle: the date range, plus any filters ("Online Store · Outerwear"). */
export const withFilters = (spec: { rangeLabel: string; filterLabel: string | null }) =>
  spec.filterLabel ? `${spec.rangeLabel} · ${spec.filterLabel}` : spec.rangeLabel;
