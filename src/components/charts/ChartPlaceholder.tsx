/**
 * Grey reply bubble with a spinner, shown in place of a chart until the chart
 * has its data and has rendered. Same size as the chart bubble it stands in
 * for, so nothing jumps when the chart takes its place.
 */
export function ChartPlaceholder({ label = "Loading chart…", height = CHART_BUBBLE_HEIGHT }: { label?: string; height?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ height }}
      className="flex w-full items-center justify-center gap-3 rounded-2xl rounded-tl-sm bg-zinc-200/70 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
    >
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500 dark:border-t-transparent" />
      {label}
    </div>
  );
}

/** Total height of a chart bubble: header + plot + padding. */
export const CHART_BUBBLE_HEIGHT = 320;
