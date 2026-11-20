import { describe, expect, it } from "vitest";
import { loadOrders } from "./orders";
import {
  returningCustomersByDay,
  returningCustomersByProduct,
  returnsByProduct,
  salesByDay,
  salesByProduct,
  validateRange,
} from "./metrics";

const lines = loadOrders();
const ALL = ["2025-05-01", "2025-10-31"] as const;

describe("loadOrders", () => {
  it("parses every line item", () => {
    expect(lines).toHaveLength(28);
    expect(lines[0]).toMatchObject({
      orderId: "#1047",
      quantity: 2,
      unitPrice: 28,
      lineTotal: 56,
      isRepeatCustomer: false,
      returned: false,
      returnDate: null,
    });
  });
});

describe("validateRange", () => {
  it("rejects bad formats, impossible dates and reversed ranges", () => {
    expect(() => validateRange("2025/10/01", "2025-10-31")).toThrow(/YYYY-MM-DD/);
    expect(() => validateRange("2025-02-31", "2025-03-01")).toThrow(/real calendar date/);
    expect(() => validateRange("2025-10-31", "2025-10-01")).toThrow(/on or before/);
  });
});

describe("salesByDay", () => {
  it("totals a multi-line order and fills empty days with zeros", () => {
    const days = salesByDay(lines, "2025-10-23", "2025-10-24");
    expect(days).toEqual([
      { date: "2025-10-23", orders: 1, unitsSold: 2, grossSales: 265, discounts: 26.5, netSales: 238.5 },
      { date: "2025-10-24", orders: 0, unitsSold: 0, grossSales: 0, discounts: 0, netSales: 0 },
    ]);
  });

  it("net sales over the full range equals the sum of line totals", () => {
    const total = salesByDay(lines, ...ALL).reduce((s, d) => s + d.netSales, 0);
    const expected = lines.reduce((s, l) => s + l.lineTotal, 0);
    expect(total).toBeCloseTo(expected, 2);
  });
});

describe("salesByProduct", () => {
  it("aggregates the Alpine Down Parka", () => {
    const parka = salesByProduct(lines, ...ALL).find((p) => p.productId === "P-1001");
    expect(parka).toEqual({
      productId: "P-1001",
      productTitle: "Alpine Down Parka",
      productCategory: "Outerwear",
      orders: 4,
      unitsSold: 4,
      grossSales: 876,
      discounts: 21.9,
      netSales: 854.1,
    });
  });

  it("respects the date range", () => {
    const may = salesByProduct(lines, "2025-05-01", "2025-05-31");
    expect(may.map((p) => p.productId).sort()).toEqual(["P-1003", "P-1006", "P-1009"]);
  });
});

describe("returnsByProduct", () => {
  it("by order date gives a return rate", () => {
    const r = returnsByProduct(lines, ...ALL);
    expect(r[0]).toEqual({
      productId: "P-1001",
      productTitle: "Alpine Down Parka",
      productCategory: "Outerwear",
      unitsSold: 4,
      unitsReturned: 3,
      returnRate: 0.75,
      refundAmount: 657,
      reasons: { "Too small": 1, "Too large": 1, Defective: 1 },
    });
    const jacket = r.find((p) => p.productId === "P-1002")!;
    expect(jacket.unitsReturned).toBe(2);
    expect(jacket.refundAmount).toBe(263.94);
    expect(jacket.returnRate).toBe(0.5);
  });

  it("by return date counts what came back in the window", () => {
    const r = returnsByProduct(lines, "2025-10-21", "2025-10-27", "return");
    expect(r.map((p) => [p.productId, p.unitsReturned, p.returnRate])).toEqual([
      ["P-1001", 3, null],
      ["P-1002", 1, null],
      ["P-1009", 1, null],
    ]);
  });
});

describe("returningCustomersByDay", () => {
  it("splits returning vs new customers per day", () => {
    const [oct9] = returningCustomersByDay(lines, "2025-10-09", "2025-10-09");
    expect(oct9).toMatchObject({ customers: 1, returningCustomers: 1, newCustomers: 0, returningShare: 1, returningNetSales: 144 });
    const [oct18] = returningCustomersByDay(lines, "2025-10-18", "2025-10-18");
    expect(oct18).toMatchObject({ customers: 1, returningCustomers: 0, newCustomers: 1, returningShare: 0 });
    const [oct10] = returningCustomersByDay(lines, "2025-10-10", "2025-10-10");
    expect(oct10.returningShare).toBeNull();
  });
});

describe("returningCustomersByProduct", () => {
  it("counts distinct customers per product", () => {
    const r = returningCustomersByProduct(lines, ...ALL);
    expect(r.find((p) => p.productId === "P-1002")).toMatchObject({
      customers: 3,
      returningCustomers: 2,
      newCustomers: 1,
      returningUnits: 3,
      returningNetSales: 437.25,
    });
    // C-10233 bought the tee as new (May) and as returning (Aug): counted once, as returning.
    expect(r.find((p) => p.productId === "P-1006")).toMatchObject({
      customers: 2,
      returningCustomers: 1,
      newCustomers: 1,
    });
  });
});
