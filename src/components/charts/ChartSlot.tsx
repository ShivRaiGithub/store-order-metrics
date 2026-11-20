"use client";

import dynamic from "next/dynamic";
import type { ChartSpec } from "@/lib/charts";
import { ChartPlaceholder } from "./ChartPlaceholder";
import { ReturnsTable } from "./ReturnsTable";

// The chart library downloads on first use; the grey box covers that wait too.
const RevenueLineChart = dynamic(() => import("./RechartsViews").then((m) => m.RevenueLineChart), {
  ssr: false,
  loading: () => <ChartPlaceholder label="Loading chart…" />,
});
const OrdersBarChart = dynamic(() => import("./RechartsViews").then((m) => m.OrdersBarChart), {
  ssr: false,
  loading: () => <ChartPlaceholder label="Loading chart…" />,
});

const PENDING_LABELS: Record<string, string> = {
  get_sales: "Loading sales chart…",
  get_returns: "Loading returned orders…",
};

/**
 * One chart's place in an AI reply. Shows the grey placeholder until the
 * chart's data has arrived and the chart has rendered, then the chart itself.
 */
export function ChartSlot({ tool, spec }: { tool: string; spec: ChartSpec | null | undefined }) {
  if (!spec) return <ChartPlaceholder label={PENDING_LABELS[tool] ?? "Loading chart…"} />;
  switch (spec.kind) {
    case "line":
      return <RevenueLineChart spec={spec} />;
    case "bar":
      return <OrdersBarChart spec={spec} />;
    case "table":
      return <ReturnsTable spec={spec} />;
  }
}
