import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./periods";
import { loadOrders } from "./orders";
import { returnsByProduct } from "./metrics";

describe("resolvePeriod: last week = Monday to Sunday of the previous week", () => {
  it("mid-week (Wednesday)", () => {
    expect(resolvePeriod("last week", { today: "2026-11-18" })).toEqual({
      startDate: "2026-11-09",
      endDate: "2026-11-15",
    });
  });

  it("on a Monday, last week is the 7 days just finished", () => {
    expect(resolvePeriod("last week", { today: "2026-11-16" })).toEqual({
      startDate: "2026-11-09",
      endDate: "2026-11-15",
    });
  });

  it("on a Sunday, the current week is not yet last week", () => {
    expect(resolvePeriod("last week", { today: "2026-11-22" })).toEqual({
      startDate: "2026-11-09",
      endDate: "2026-11-15",
    });
  });

  it("crosses a year boundary", () => {
    expect(resolvePeriod("last week", { today: "2026-01-01" })).toEqual({
      startDate: "2025-12-22",
      endDate: "2025-12-28",
    });
  });
});

describe("resolvePeriod: this month = the 1st through today", () => {
  it("mid-month", () => {
    expect(resolvePeriod("this month", { today: "2025-10-15" })).toEqual({
      startDate: "2025-10-01",
      endDate: "2025-10-15",
    });
  });

  it("on the 1st it is a single day", () => {
    expect(resolvePeriod("this month", { today: "2025-11-01" })).toEqual({
      startDate: "2025-11-01",
      endDate: "2025-11-01",
    });
  });
});

describe("resolvePeriod: last N days = N days ending today", () => {
  it("last 30 days includes today", () => {
    expect(resolvePeriod("last 30 days", { today: "2025-10-29" })).toEqual({
      startDate: "2025-09-30",
      endDate: "2025-10-29",
    });
  });

  it("past 7 days and last 1 day", () => {
    expect(resolvePeriod("past 7 days", { today: "2025-10-29" })).toEqual({ startDate: "2025-10-23", endDate: "2025-10-29" });
    expect(resolvePeriod("last 1 day", { today: "2025-10-29" })).toEqual({ startDate: "2025-10-29", endDate: "2025-10-29" });
  });

  it("rejects 0 or more than a year", () => {
    expect(() => resolvePeriod("last 0 days", { today: "2025-10-29" })).toThrow(/between 1 and 366/);
    expect(() => resolvePeriod("last 400 days", { today: "2025-10-29" })).toThrow(/between 1 and 366/);
  });
});

describe("resolvePeriod: meteorological seasons", () => {
  it("this season = start of the current season through today", () => {
    expect(resolvePeriod("this season", { today: "2025-10-29" })).toEqual({ startDate: "2025-09-01", endDate: "2025-10-29" });
    // Winter starts in December of the previous year.
    expect(resolvePeriod("this season", { today: "2026-01-15" })).toEqual({ startDate: "2025-12-01", endDate: "2026-01-15" });
    expect(resolvePeriod("this season", { today: "2025-12-03" })).toEqual({ startDate: "2025-12-01", endDate: "2025-12-03" });
  });

  it("a named season we are in runs to today; fall = autumn", () => {
    expect(resolvePeriod("fall", { today: "2025-10-29" })).toEqual({ startDate: "2025-09-01", endDate: "2025-10-29" });
    expect(resolvePeriod("Autumn", { today: "2025-10-29" })).toEqual({ startDate: "2025-09-01", endDate: "2025-10-29" });
  });

  it("a named season we are not in is the whole of the most recent one", () => {
    expect(resolvePeriod("summer", { today: "2025-10-29" })).toEqual({ startDate: "2025-06-01", endDate: "2025-08-31" });
    expect(resolvePeriod("winter", { today: "2025-10-29" })).toEqual({ startDate: "2024-12-01", endDate: "2025-02-28" });
    expect(resolvePeriod("winter", { today: "2024-06-10" })).toEqual({ startDate: "2023-12-01", endDate: "2024-02-29" }); // leap year
    expect(resolvePeriod("spring", { today: "2026-01-15" })).toEqual({ startDate: "2025-03-01", endDate: "2025-05-31" });
  });
});

describe("resolvePeriod: input handling", () => {
  it("accepts case and separator variants", () => {
    expect(resolvePeriod("Last_Week", { today: "2026-11-18" }).startDate).toBe("2026-11-09");
    expect(resolvePeriod("  THIS-MONTH ", { today: "2025-10-15" }).startDate).toBe("2025-10-01");
  });

  it("refuses phrases without a rule instead of guessing", () => {
    expect(() => resolvePeriod("last month", { today: "2025-10-15" })).toThrow(/Unsupported period/);
    expect(() => resolvePeriod("winter 2025", { today: "2025-10-15" })).toThrow(/Unsupported period/);
  });

  it("rejects an invalid today", () => {
    expect(() => resolvePeriod("last week", { today: "2025-13-01" })).toThrow(/YYYY-MM-DD/);
  });

  it("defaults today to the current date", () => {
    const { endDate } = resolvePeriod("this month");
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("returns for a phrase filter on return date", () => {
  it("returns last week = items returned Mon–Sun of last week", () => {
    const { startDate, endDate } = resolvePeriod("last week", { today: "2025-10-29" });
    expect([startDate, endDate]).toEqual(["2025-10-20", "2025-10-26"]);
    const r = returnsByProduct(loadOrders(), startDate, endDate);
    // Returned 10-21, 10-24, 10-26 (parkas) and 10-23 (jacket); 10-27 chino is outside.
    expect(r.map((p) => [p.productId, p.unitsReturned])).toEqual([
      ["P-1001", 3],
      ["P-1002", 1],
    ]);
  });
});
