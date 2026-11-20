import type { OrderLine } from "./orders";
import {
  returningCustomersByDay,
  returningCustomersByProduct,
  returningCustomersSummary,
  returnedOrders,
  returnsByProduct,
  salesByDay,
  salesByProduct,
  type ReturnDateBasis,
} from "./metrics";
import type { ChartSpec } from "./charts";
import { resolvePeriod, SUPPORTED_PERIODS, type DateRange, type ResolveOptions } from "./periods";

/**
 * Tools the chat model can call. Each one answers a merchant question for an
 * exact date range and echoes that range back, so the answer can state it.
 *
 * The model never works out dates for "last week" / "this month" itself: it
 * passes the phrase as `period` and `resolvePeriod` applies the rules.
 */

const rangeParams = {
  period: {
    type: "string",
    enum: [...SUPPORTED_PERIODS],
    description:
      'Use when the merchant says "last week" (Monday–Sunday of the previous week) or "this month" (the 1st through today). The server works out the exact dates. Do not also pass startDate/endDate.',
  },
  startDate: {
    type: "string",
    description: "First day to include, YYYY-MM-DD. Use with endDate when the merchant names exact dates, a month or a year.",
  },
  endDate: {
    type: "string",
    description: "Last day to include, YYYY-MM-DD (inclusive).",
  },
} as const;

/** OpenAI-compatible tool definitions (OpenRouter uses the same format). */
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_sales",
      description:
        "Get sales and best sellers. How much did I sell, how many orders and items, what did I give away in discounts, and which products sold best? Use groupBy \"day\" for sales for each day, or \"product\" for best sellers (sorted by net sales, highest first). Dates are order dates.",
      parameters: {
        type: "object",
        properties: {
          ...rangeParams,
          groupBy: {
            type: "string",
            enum: ["day", "product"],
            description: '"day" for a daily breakdown, "product" for best sellers. Defaults to "product".',
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_returns",
      description:
        "Returns: what came back, which products get returned most, why customers sent them back, and how much I refunded. Dates are the day the item was returned, not the day it was ordered. Only set basis to \"order\" when the merchant asks for a return rate (share of items sold in the period that came back).",
      parameters: {
        type: "object",
        properties: {
          ...rangeParams,
          basis: {
            type: "string",
            enum: ["return", "order"],
            description:
              '"return" (default): items returned in the period. "order": items ordered in the period and how many came back, which gives a return rate.',
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_repeat_customers",
      description:
        "Repeat customers: get the repeat customers share. How many of my customers had bought from me before, how many were new, and how much the repeat customers spent. Use groupBy \"day\" for each day or \"product\" to see which products repeat customers buy. Dates are order dates.",
      parameters: {
        type: "object",
        properties: {
          ...rangeParams,
          groupBy: {
            type: "string",
            enum: ["total", "day", "product"],
            description: '"total" for one figure for the whole period (default), "day" or "product" for a breakdown.',
          },
        },
      },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];

export interface ToolArgs {
  period?: string;
  startDate?: string;
  endDate?: string;
  groupBy?: string;
  basis?: string;
}

export interface ToolResult {
  /** The exact range used, or null if the call failed before resolving one. */
  range: DateRange | null;
  /** What the range was based on, e.g. "last week" or "explicit dates". */
  rangeSource: string | null;
  /** JSON-serialisable payload sent back to the model. */
  data: unknown;
  /** Chart/table shown to the merchant on the chat page, if this tool has one. */
  chart?: ChartSpec;
}

function resolveRange(args: ToolArgs, options: ResolveOptions): { range: DateRange; source: string } {
  if (args.period) return { range: resolvePeriod(args.period, options), source: args.period };
  if (args.startDate && args.endDate) {
    return { range: { startDate: args.startDate, endDate: args.endDate }, source: "explicit dates" };
  }
  throw new Error(
    `Give either period (${SUPPORTED_PERIODS.join(" or ")}) or both startDate and endDate. Ask the merchant for exact dates if their wording is not one of the supported periods.`,
  );
}

/** "Mon 20 Oct 2025 – Sun 26 Oct 2025" (or a single day). Computed in UTC so it never shifts. */
export function formatRange({ startDate, endDate }: DateRange): string {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).replace(",", "");
  return startDate === endDate ? f(startDate) : `${f(startDate)} – ${f(endDate)}`;
}

const sum = <T>(rows: T[], f: (r: T) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100;

/** Run a tool. Errors come back as `{ error }` so the model can recover. */
export function runTool(name: string, args: ToolArgs, lines: OrderLine[], options: ResolveOptions = {}): ToolResult {
  let range: DateRange | null = null;
  let source: string | null = null;
  try {
    const r = resolveRange(args, options);
    range = r.range;
    source = r.source;
    const { startDate, endDate } = range;
    const header = { startDate, endDate, rangeLabel: formatRange(range), rangeSource: source };

    switch (name as ToolName) {
      case "get_sales": {
        const days = salesByDay(lines, startDate, endDate);
        const totals = {
          orders: sum(days, (d) => d.orders),
          unitsSold: sum(days, (d) => d.unitsSold),
          grossSales: sum(days, (d) => d.grossSales),
          discounts: sum(days, (d) => d.discounts),
          netSales: sum(days, (d) => d.netSales),
        };
        const byDay = args.groupBy === "day";
        const products = byDay ? [] : salesByProduct(lines, startDate, endDate);
        const rows = byDay ? days.filter((d) => d.orders > 0) : products;
        const chart: ChartSpec = byDay
          ? {
              kind: "line",
              title: "Revenue by date",
              rangeLabel: header.rangeLabel,
              points: days.map((d) => ({ date: d.date, netSales: d.netSales, orders: d.orders })),
              totalNetSales: totals.netSales,
            }
          : {
              kind: "bar",
              title: "Orders by product",
              rangeLabel: header.rangeLabel,
              bars: [...products]
                .sort((a, b) => b.orders - a.orders || b.netSales - a.netSales)
                .map((p) => ({ productTitle: p.productTitle, orders: p.orders, unitsSold: p.unitsSold, netSales: p.netSales })),
              totalOrders: totals.orders,
            };
        return {
          range,
          rangeSource: source,
          data: { ...header, groupBy: byDay ? "day (days with no orders omitted)" : "product", totals, rows },
          chart,
        };
      }

      case "get_returns": {
        const basis: ReturnDateBasis = args.basis === "order" ? "order" : "return";
        const rows = returnsByProduct(lines, startDate, endDate, basis);
        const totals = {
          unitsReturned: sum(rows, (r) => r.unitsReturned),
          refundAmount: sum(rows, (r) => r.refundAmount),
        };
        const dateBasis = basis === "return" ? "return date" : "order date";
        const returned = returnedOrders(lines, startDate, endDate, basis);
        return {
          range,
          rangeSource: source,
          data: { ...header, basis: dateBasis, totals, rows },
          chart: {
            kind: "table",
            title: "Returned orders",
            rangeLabel: header.rangeLabel,
            dateBasis,
            rows: returned.map((r) => ({
              orderId: r.orderId,
              orderDate: r.orderDate,
              returnDate: r.returnDate,
              productTitle: r.productTitle,
              variant: r.variant,
              quantity: r.quantity,
              reason: r.reason,
              refundAmount: r.refundAmount,
            })),
            totalUnits: totals.unitsReturned,
            totalRefund: totals.refundAmount,
          },
        };
      }

      case "get_repeat_customers": {
        const totals = returningCustomersSummary(lines, startDate, endDate);
        const rows =
          args.groupBy === "day"
            ? returningCustomersByDay(lines, startDate, endDate).filter((d) => d.customers > 0)
            : args.groupBy === "product"
              ? returningCustomersByProduct(lines, startDate, endDate)
              : undefined;
        return { range, rangeSource: source, data: { ...header, totals, ...(rows ? { rows } : {}) } };
      }

      default:
        throw new Error(`Unknown tool "${name}"`);
    }
  } catch (err) {
    return { range, rangeSource: source, data: { error: (err as Error).message } };
  }
}
