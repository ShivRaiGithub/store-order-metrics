"use client";

/**
 * Recharts views. Loaded with next/dynamic, so the chart library only
 * downloads when the first chart is needed; a grey placeholder shows meanwhile.
 *
 * Each chart is a single series, so it has no legend box: the title names it.
 * Colors come from the .viz-root tokens in globals.css (light + dark).
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BarChartSpec, LineChartSpec } from "@/lib/charts";
import { ChartBubble, withFilters, longDate, money, moneyShort, shortDate } from "./ChartBubble";
import { ChartPlaceholder } from "./ChartPlaceholder";
import { useWidth } from "./useWidth";

const BUBBLE_CHROME = 34; // horizontal padding (2 × 16px) + border (2 × 1px)
const LINE_PLOT_HEIGHT = 230;
const axisTick = { fill: "var(--text-muted)", fontSize: 12 };

interface TipProps<T> {
  active?: boolean;
  payload?: { payload: T }[];
}

function TipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="viz-root rounded-lg border border-zinc-200 bg-[var(--surface-1)] px-3 py-2 text-xs shadow-sm dark:border-zinc-700">
      <div className="mb-1 font-medium text-[var(--text-primary)]">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 text-[var(--text-secondary)]">
          <span>{k}</span>
          <span className="tabular-nums text-[var(--text-primary)]">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue by date: line chart
// ---------------------------------------------------------------------------

type Point = LineChartSpec["points"][number];

function LineTip({ active, payload }: TipProps<Point>) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <TipBox
      title={longDate(p.date)}
      rows={[
        ["Revenue", money(p.netSales)],
        ["Orders", String(p.orders)],
      ]}
    />
  );
}

export function RevenueLineChart({ spec }: { spec: LineChartSpec }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const showDots = spec.points.length <= 31;
  return (
    <div ref={ref} className="w-full">
      {width === 0 ? (
        <ChartPlaceholder label="Drawing revenue by date…" />
      ) : (
        <ChartBubble
          title={spec.title}
          subtitle={withFilters(spec)}
          summary={`Net revenue ${money(spec.totalNetSales)}`}
        >
          <LineChart
            width={width - BUBBLE_CHROME}
            height={LINE_PLOT_HEIGHT}
            data={spec.points}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: "var(--grid)" }}
              minTickGap={24}
              interval="preserveStartEnd"
            />
            <YAxis tickFormatter={moneyShort} tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
              content={(p) => <LineTip {...(p as unknown as TipProps<Point>)} />}
            />
            <Line
              type="linear"
              dataKey="netSales"
              name="Revenue"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={showDots ? { r: 4, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartBubble>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders by product: horizontal bar chart (long product names stay readable)
// ---------------------------------------------------------------------------

type BarRow = BarChartSpec["bars"][number];

function BarTip({ active, payload }: TipProps<BarRow>) {
  const b = active ? payload?.[0]?.payload : undefined;
  if (!b) return null;
  return (
    <TipBox
      title={b.productTitle}
      rows={[
        ["Orders", String(b.orders)],
        ["Units", String(b.unitsSold)],
        ["Net sales", money(b.netSales)],
      ]}
    />
  );
}

export function OrdersBarChart({ spec }: { spec: BarChartSpec }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const plotHeight = Math.max(120, spec.bars.length * 30 + 24);
  const labelWidth = Math.min(180, Math.max(110, (width - BUBBLE_CHROME) * 0.35));
  return (
    <div ref={ref} className="w-full">
      {width === 0 ? (
        <ChartPlaceholder label="Drawing orders by product…" />
      ) : (
        <ChartBubble title={spec.title} subtitle={withFilters(spec)} summary={`${spec.totalOrders} orders`}>
          {spec.bars.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No orders in this period.</p>
          ) : (
            <BarChart
              layout="vertical"
              width={width - BUBBLE_CHROME}
              height={plotHeight}
              data={spec.bars}
              margin={{ top: 0, right: 28, bottom: 0, left: 0 }}
              barCategoryGap={6}
              accessibilityLayer
            >
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis
                type="number"
                allowDecimals={false}
                domain={[0, "dataMax"]}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: "var(--grid)" }}
              />
              <YAxis
                type="category"
                dataKey="productTitle"
                width={labelWidth}
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <Tooltip cursor={{ fill: "var(--grid)", opacity: 0.5 }} content={(p) => <BarTip {...(p as unknown as TipProps<BarRow>)} />} />
              <Bar dataKey="orders" name="Orders" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                <LabelList dataKey="orders" position="right" fill="var(--text-secondary)" fontSize={12} />
              </Bar>
            </BarChart>
          )}
        </ChartBubble>
      )}
    </div>
  );
}
