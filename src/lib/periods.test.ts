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

describe("resolvePeriod: input handling", () => {
  it("accepts case and separator variants", () => {
    expect(resolvePeriod("Last_Week", { today: "2026-11-18" }).startDate).toBe("2026-11-09");
    expect(resolvePeriod("  THIS-MONTH ", { today: "2025-10-15" }).startDate).toBe("2025-10-01");
  });

  it("refuses phrases without a rule instead of guessing", () => {
    expect(() => resolvePeriod("last month", { today: "2025-10-15" })).toThrow(/Unsupported period/);
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
