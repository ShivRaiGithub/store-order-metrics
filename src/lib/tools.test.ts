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

  it("returns an error, not a guess, for unsupported or missing periods", () => {
    expect(runTool("get_sales", { period: "last month" }, lines, opts).data).toMatchObject({
      error: expect.stringMatching(/Unsupported period/),
    });
    expect(runTool("get_sales", {}, lines, opts).data).toMatchObject({
      error: expect.stringMatching(/startDate and endDate/),
    });
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
    expect(runTool("get_sales", { period: "last month" }, lines, opts).chart).toBeUndefined();
  });
});

describe("formatRange", () => {
  it("formats a single day", () => {
    expect(formatRange({ startDate: "2025-10-01", endDate: "2025-10-01" })).toBe("Wed 1 Oct 2025");
  });
});
