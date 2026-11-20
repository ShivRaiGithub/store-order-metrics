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
import { DEFAULT_PERIOD, FALLBACK_PERIOD, resolvePeriod, UnsupportedPeriodError, type DateRange, type ResolveOptions } from "./periods";

/**
 * Tools the chat model can call. Each one answers a merchant question for an
 * exact date range and echoes that range back, so the answer can state it.
 *
 * The model never works out dates for time phrases itself: it passes the
 * phrase as `period` and `resolvePeriod` applies the rules. With no period and
 * no dates, the tools use DEFAULT_PERIOD ("this month").
 *
 * Optional filters narrow the order lines first: sales channel, product ids,
 * product category. The model gets the catalog in its system prompt.
 */

const rangeParams = {
  period: {
    type: "string",
    description:
      'A time phrase the server turns into exact dates. Supported: "last week" (Mon–Sun of the previous week), "this month" (1st through today), "last N days" e.g. "last 30 days" (N days ending today), "this season" (start of the current meteorological season through today), or a season name "spring" / "summer" / "autumn" / "fall" / "winter" (the most recent one). Pass the phrase as the merchant said it; do not also pass startDate/endDate. For any other wording ("recently", "lately", "last month") still pass it as period: the server uses last week. Leave period and dates out entirely when the merchant gives no period at all: the server then uses "this month".',
  },
  startDate: {
    type: "string",
    description: "First day to include, YYYY-MM-DD. Use with endDate when the merchant names exact dates, a month or a year.",
  },
  endDate: {
    type: "string",
    description: "Last day to include, YYYY-MM-DD (inclusive).",
  },
  channel: {
    type: "string",
    description:
      'Only count orders from this sales channel, spelled exactly as in the catalog (e.g. "Online Store"). Leave out for all channels.',
  },
  productIds: {
    type: "array",
    items: { type: "string" },
    description:
      'Only count these products, by id from the catalog (e.g. ["P-1001","P-1002"]). Use when the merchant names products or a kind of product ("jackets", "the parka").',
  },
  category: {
    type: "string",
    description: 'Only count this product category, spelled exactly as in the catalog (e.g. "Outerwear").',
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
  channel?: string;
  productIds?: string[];
  category?: string;
}

export interface Catalog {
  products: { productId: string; productTitle: string; productCategory: string }[];
  categories: string[];
  channels: string[];
}

/** Products, categories and channels that appear in the order data. */
export function catalogOf(lines: OrderLine[]): Catalog {
  const products = new Map<string, Catalog["products"][number]>();
  for (const l of lines) {
    if (!products.has(l.productId)) {
      products.set(l.productId, { productId: l.productId, productTitle: l.productTitle, productCategory: l.productCategory });
    }
  }
  return {
    products: [...products.values()].sort((a, b) => a.productId.localeCompare(b.productId)),
    categories: [...new Set(lines.map((l) => l.productCategory))].sort(),
    channels: [...new Set(lines.map((l) => l.salesChannel))].sort(),
  };
}

/** Narrow the order lines by the optional filters. Throws on unknown values. */
function applyFilters(lines: OrderLine[], args: ToolArgs): { lines: OrderLine[]; filters: Record<string, unknown>; label: string | null } {
  const catalog = catalogOf(lines);
  const filters: Record<string, unknown> = {};
  const parts: string[] = [];
  let out = lines;

  if (args.channel) {
    const channel = catalog.channels.find((c) => c.toLowerCase() === args.channel!.trim().toLowerCase());
    if (!channel) throw new Error(`Unknown channel "${args.channel}". Channels: ${catalog.channels.join(", ")}`);
    out = out.filter((l) => l.salesChannel === channel);
    filters.channel = channel;
    parts.push(channel);
  }
  if (args.category) {
    const category = catalog.categories.find((c) => c.toLowerCase() === args.category!.trim().toLowerCase());
    if (!category) throw new Error(`Unknown category "${args.category}". Categories: ${catalog.categories.join(", ")}`);
    out = out.filter((l) => l.productCategory === category);
    filters.category = category;
    parts.push(category);
  }
  if (args.productIds && args.productIds.length > 0) {
    const ids = new Set(args.productIds.map((id) => id.trim().toUpperCase()));
    const known = catalog.products.filter((p) => ids.has(p.productId));
    const unknown = [...ids].filter((id) => !known.some((p) => p.productId === id));
    if (unknown.length) throw new Error(`Unknown product ids: ${unknown.join(", ")}. Use ids from the catalog.`);
    out = out.filter((l) => ids.has(l.productId));
    filters.products = known.map((p) => p.productTitle);
    parts.push(known.length <= 3 ? known.map((p) => p.productTitle).join(", ") : `${known.length} products`);
  }
  return { lines: out, filters, label: parts.length ? parts.join(" · ") : null };
}

export interface ToolResult {
  /** The exact range used, or null if the call failed before resolving one. */
  range: DateRange | null;
  /** What the range was based on, e.g. "last week" or "explicit dates". */
  rangeSource: string | null;
  /** Human-readable filters applied, e.g. "Online Store · Outerwear", or null. */
  filterLabel: string | null;
  /** JSON-serialisable payload sent back to the model. */
  data: unknown;
  /** Chart/table shown to the merchant on the chat page, if this tool has one. */
  chart?: ChartSpec;
}

function resolveRange(args: ToolArgs, options: ResolveOptions): { range: DateRange; source: string } {
  if (args.period) {
    try {
      return { range: resolvePeriod(args.period, options), source: args.period };
    } catch (err) {
      if (!(err instanceof UnsupportedPeriodError)) throw err;
      // No rule for this phrase ("recently", "last month"): use last week and say so.
      return {
        range: resolvePeriod(FALLBACK_PERIOD, options),
        source: `${FALLBACK_PERIOD} ("${args.period}" has no fixed meaning)`,
      };
    }
  }
  if (args.startDate && args.endDate) {
    return { range: { startDate: args.startDate, endDate: args.endDate }, source: "explicit dates" };
  }
  if (args.startDate || args.endDate) {
    throw new Error("Give both startDate and endDate, or a period.");
  }
  return { range: resolvePeriod(DEFAULT_PERIOD, options), source: `${DEFAULT_PERIOD} (no period given)` };
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
export function runTool(name: string, args: ToolArgs, allLines: OrderLine[], options: ResolveOptions = {}): ToolResult {
  let range: DateRange | null = null;
  let source: string | null = null;
  let filterLabel: string | null = null;
  try {
    const r = resolveRange(args, options);
    range = r.range;
    source = r.source;
    const f = applyFilters(allLines, args);
    const lines = f.lines;
    filterLabel = f.label;
    const { startDate, endDate } = range;
    const header = {
      startDate,
      endDate,
      rangeLabel: formatRange(range),
      rangeSource: source,
      ...(f.label ? { filters: f.filters } : {}),
    };

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
              filterLabel,
              points: days.map((d) => ({ date: d.date, netSales: d.netSales, orders: d.orders })),
              totalNetSales: totals.netSales,
            }
          : {
              kind: "bar",
              title: "Orders by product",
              rangeLabel: header.rangeLabel,
              filterLabel,
              bars: [...products]
                .sort((a, b) => b.orders - a.orders || b.netSales - a.netSales)
                .map((p) => ({ productTitle: p.productTitle, orders: p.orders, unitsSold: p.unitsSold, netSales: p.netSales })),
              totalOrders: totals.orders,
            };
        return {
          range,
          rangeSource: source,
          filterLabel,
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
          filterLabel,
          data: { ...header, basis: dateBasis, totals, rows },
          chart: {
            kind: "table",
            title: "Returned orders",
            rangeLabel: header.rangeLabel,
              filterLabel,
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
        return { range, rangeSource: source, filterLabel, data: { ...header, totals, ...(rows ? { rows } : {}) } };
      }

      default:
        throw new Error(`Unknown tool "${name}"`);
    }
  } catch (err) {
    return { range, rangeSource: source, filterLabel, data: { error: (err as Error).message } };
  }
}
