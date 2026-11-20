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

describe("formatRange", () => {
  it("formats a single day", () => {
    expect(formatRange({ startDate: "2025-10-01", endDate: "2025-10-01" })).toBe("Wed 1 Oct 2025");
  });
});
