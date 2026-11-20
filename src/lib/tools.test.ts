import { describe, expect, it } from "vitest";
import { loadOrders } from "./orders";
import { formatRange, runTool } from "./tools";

const lines = loadOrders();
const opts = { today: "2025-10-29" }; // a Wednesday

describe("runTool", () => {
  it("resolves 'last week' to exact dates and labels them", () => {
    const r = runTool("get_sales", { period: "last week" }, lines, opts);
    expect(r.range).toEqual({ startDate: "2025-10-20", endDate: "2025-10-26" });
    expect(r.data).toMatchObject({
      rangeLabel: "Mon 20 Oct 2025 – Sun 26 Oct 2025",
      rangeSource: "last week",
      groupBy: "product",
    });
  });

  it("get_sales totals match the daily rows", () => {
    const r = runTool("get_sales", { startDate: "2025-10-23", endDate: "2025-10-24", groupBy: "day" }, lines, opts);
    const data = r.data as { totals: Record<string, number>; rows: unknown[] };
    expect(data.totals).toEqual({ orders: 1, unitsSold: 2, grossSales: 265, discounts: 26.5, netSales: 238.5 });
    expect(data.rows).toHaveLength(1); // zero day omitted
  });

  it("get_returns filters on return date by default", () => {
    const r = runTool("get_returns", { period: "last week" }, lines, opts);
    expect(r.data).toMatchObject({ basis: "return date", totals: { unitsReturned: 4, refundAmount: 792.15 } });
  });

  it("get_repeat_customers gives the share for the period", () => {
    const r = runTool("get_repeat_customers", { period: "this month" }, lines, opts);
    expect(r.range).toEqual({ startDate: "2025-10-01", endDate: "2025-10-29" });
    expect((r.data as { totals: { returningShare: number } }).totals.returningShare).toBeGreaterThan(0);
  });

  it("falls back to last week for a phrase with no rule, and says so", () => {
    for (const period of ["recently", "last month", "this quarter"]) {
      const r = runTool("get_sales", { period }, lines, opts);
      expect(r.range).toEqual({ startDate: "2025-10-20", endDate: "2025-10-26" });
      expect(r.rangeSource).toBe(`last week ("${period}" has no fixed meaning)`);
      expect(r.chart).toBeDefined();
    }
  });

  it("still errors on a rule's bad input or half a date range", () => {
    expect(runTool("get_sales", { period: "last 0 days" }, lines, opts).data).toMatchObject({
      error: expect.stringMatching(/between 1 and 366/),
    });
    expect(runTool("get_sales", { startDate: "2025-10-01" }, lines, opts).data).toMatchObject({
      error: expect.stringMatching(/both startDate and endDate/),
    });
  });

  it("with no period at all, uses this month", () => {
    const r = runTool("get_repeat_customers", {}, lines, opts);
    expect(r.range).toEqual({ startDate: "2025-10-01", endDate: "2025-10-29" });
    expect(r.rangeSource).toBe("this month (no period given)");
  });

  it("resolves last 30 days and this season", () => {
    expect(runTool("get_sales", { period: "last 30 days" }, lines, opts).range).toEqual({ startDate: "2025-09-30", endDate: "2025-10-29" });
    expect(runTool("get_sales", { period: "this season" }, lines, opts).range).toEqual({ startDate: "2025-09-01", endDate: "2025-10-29" });
  });
});

describe("filters", () => {
  it("channel: online store only", () => {
    const all = runTool("get_sales", { period: "this month" }, lines, opts);
    const online = runTool("get_sales", { period: "this month", channel: "online store" }, lines, opts);
    // October Online Store lines: 219+24+219+159+212.40+159+197.10+41.40+94+88.20
    expect((online.data as { totals: { netSales: number } }).totals.netSales).toBe(1413.1);
    expect((all.data as { totals: { netSales: number } }).totals.netSales).toBe(2261.25);
    expect(online.filterLabel).toBe("Online Store");
    expect(online.chart?.filterLabel).toBe("Online Store");
  });

  it("products: winter jacket returns", () => {
    const r = runTool("get_returns", { period: "this season", productIds: ["P-1001", "P-1002", "P-1003"] }, lines, opts);
    expect(r.data).toMatchObject({ totals: { unitsReturned: 5 } }); // 3 parkas + 2 Northridge since 1 Sep
    expect(r.filterLabel).toBe("Alpine Down Parka, Northridge Insulated Jacket, Harbor Rain Shell");
  });

  it("category and unknown values", () => {
    const r = runTool("get_sales", { period: "this month", category: "accessories" }, lines, opts);
    expect((r.data as { totals: { unitsSold: number } }).totals.unitsSold).toBe(6); // beanie 1 + 3, gloves 1 + 1
    expect(runTool("get_sales", { channel: "Amazon" }, lines, opts).data).toMatchObject({ error: expect.stringMatching(/Unknown channel/) });
    expect(runTool("get_sales", { productIds: ["P-9999"] }, lines, opts).data).toMatchObject({ error: expect.stringMatching(/Unknown product/) });
  });
});

describe("charts", () => {
  it("revenue by date is a line chart with every day, including zero days", () => {
    const r = runTool("get_sales", { startDate: "2025-10-23", endDate: "2025-10-24", groupBy: "day" }, lines, opts);
    expect(r.chart).toMatchObject({ kind: "line", title: "Revenue by date", totalNetSales: 238.5 });
    expect(r.chart?.kind === "line" && r.chart.points.map((p) => p.netSales)).toEqual([238.5, 0]);
  });

  it("orders by product is a bar chart sorted by orders", () => {
    const r = runTool("get_sales", { period: "this month" }, lines, opts);
    expect(r.chart?.kind).toBe("bar");
    const bars = r.chart?.kind === "bar" ? r.chart.bars : [];
    expect(bars.map((b) => b.orders)).toEqual([...bars.map((b) => b.orders)].sort((a, b) => b - a));
    expect(bars[0]).toMatchObject({ productTitle: "Alpine Down Parka", orders: 4 });
  });

  it("returned orders is a table of returned line items by return date", () => {
    const r = runTool("get_returns", { period: "last week" }, lines, opts);
    expect(r.chart).toMatchObject({ kind: "table", title: "Returned orders", dateBasis: "return date", totalUnits: 4, totalRefund: 792.15 });
    expect(r.chart?.kind === "table" && r.chart.rows.map((row) => [row.orderId, row.returnDate])).toEqual([
      ["#2402", "2025-10-21"],
      ["#2455", "2025-10-23"],
      ["#2518", "2025-10-24"],
      ["#2706", "2025-10-26"],
    ]);
  });

  it("repeat customers and failed calls have no chart", () => {
    expect(runTool("get_repeat_customers", { period: "this month" }, lines, opts).chart).toBeUndefined();
    expect(runTool("get_sales", { channel: "Amazon" }, lines, opts).chart).toBeUndefined();
  });
});

describe("formatRange", () => {
  it("formats a single day", () => {
    expect(formatRange({ startDate: "2025-10-01", endDate: "2025-10-01" })).toBe("Wed 1 Oct 2025");
  });
});
