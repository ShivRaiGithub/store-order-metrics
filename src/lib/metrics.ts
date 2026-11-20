import type { OrderLine } from "./orders";

/**
 * Metric functions over the order export.
 *
 * Every function takes `startDate` and `endDate` as `YYYY-MM-DD` strings.
 * The range is inclusive on both ends. A line item is in range when its
 * `orderDate` falls inside it, except for returns, which use `returnDate`.
 *
 * To turn a phrase like "last week" or "this month" into a range, use
 * `resolvePeriod` from ./periods, e.g.
 *   const { startDate, endDate } = resolvePeriod("last week");
 *

 * Money conventions:
 *  - grossSales = quantity * unitPrice (before discounts)
 *  - discounts  = discountAmount
 *  - netSales   = lineTotal (gross - discounts); refunds are NOT subtracted
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, name: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid date in YYYY-MM-DD format, got "${value}"`);
  }
  // Reject things like 2025-02-31 that Date.parse rolls over.
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a real calendar date: "${value}"`);
  }
}

/** Validate a start/end pair. Throws on bad format or start after end. */
export function validateRange(startDate: string, endDate: string): void {
  assertDate(startDate, "startDate");
  assertDate(endDate, "endDate");
  if (startDate > endDate) {
    throw new Error(`startDate (${startDate}) must be on or before endDate (${endDate})`);
  }
}

const inRange = (date: string | null, start: string, end: string) =>
  date !== null && date >= start && date <= end;

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Ratio rounded to 4 decimals (e.g. 0.3333). */
const ratio = (part: number, whole: number) => Math.round((part / whole) * 10000) / 10000;

/** Every calendar date from start to end inclusive. */
function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

function filterByOrderDate(lines: OrderLine[], start: string, end: string) {
  validateRange(start, end);
  return lines.filter((l) => inRange(l.orderDate, start, end));
}

// ---------------------------------------------------------------------------
// 1. Sales for each day
// ---------------------------------------------------------------------------

export interface DailySales {
  date: string;
  orders: number;
  unitsSold: number;
  grossSales: number;
  discounts: number;
  netSales: number;
}

/**
 * Sales totals for each calendar day in the range. Days with no orders are
 * included with zeros so the result is a continuous series.
 */
export function salesByDay(lines: OrderLine[], startDate: string, endDate: string): DailySales[] {
  const scoped = filterByOrderDate(lines, startDate, endDate);

  const byDay = new Map<string, { orders: Set<string>; units: number; gross: number; disc: number; net: number }>();
  for (const day of eachDay(startDate, endDate)) {
    byDay.set(day, { orders: new Set(), units: 0, gross: 0, disc: 0, net: 0 });
  }
  for (const l of scoped) {
    const b = byDay.get(l.orderDate)!;
    b.orders.add(l.orderId);
    b.units += l.quantity;
    b.gross += l.quantity * l.unitPrice;
    b.disc += l.discountAmount;
    b.net += l.lineTotal;
  }

  return [...byDay].map(([date, b]) => ({
    date,
    orders: b.orders.size,
    unitsSold: b.units,
    grossSales: round2(b.gross),
    discounts: round2(b.disc),
    netSales: round2(b.net),
  }));
}

// ---------------------------------------------------------------------------
// 2. Sales by each product
// ---------------------------------------------------------------------------

export interface ProductSales {
  productId: string;
  productTitle: string;
  productCategory: string;
  orders: number;
  unitsSold: number;
  grossSales: number;
  discounts: number;
  netSales: number;
}

/** Sales totals per product for orders placed in the range, sorted by netSales desc. */
export function salesByProduct(lines: OrderLine[], startDate: string, endDate: string): ProductSales[] {
  const scoped = filterByOrderDate(lines, startDate, endDate);

  const byProduct = new Map<string, ProductSales & { _orders: Set<string> }>();
  for (const l of scoped) {
    let p = byProduct.get(l.productId);
    if (!p) {
      p = {
        productId: l.productId,
        productTitle: l.productTitle,
        productCategory: l.productCategory,
        orders: 0,
        unitsSold: 0,
        grossSales: 0,
        discounts: 0,
        netSales: 0,
        _orders: new Set(),
      };
      byProduct.set(l.productId, p);
    }
    p._orders.add(l.orderId);
    p.unitsSold += l.quantity;
    p.grossSales += l.quantity * l.unitPrice;
    p.discounts += l.discountAmount;
    p.netSales += l.lineTotal;
  }

  return [...byProduct.values()]
    .map(({ _orders, ...p }) => ({
      ...p,
      orders: _orders.size,
      grossSales: round2(p.grossSales),
      discounts: round2(p.discounts),
      netSales: round2(p.netSales),
    }))
    .sort((a, b) => b.netSales - a.netSales || a.productId.localeCompare(b.productId));
}

// ---------------------------------------------------------------------------
// 3. Returns by each product
// ---------------------------------------------------------------------------

export type ReturnDateBasis = "order" | "return";

export interface ProductReturns {
  productId: string;
  productTitle: string;
  productCategory: string;
  /** Units sold in the range. Only meaningful for basis "order". */
  unitsSold: number;
  unitsReturned: number;
  /** unitsReturned / unitsSold (0..1). null when basis is "return". */
  returnRate: number | null;
  refundAmount: number;
  /** Count of returned units per stated reason. */
  reasons: Record<string, number>;
}

/**
 * Returns per product.
 *
 * Rule: a question about returns is filtered on the **return date**. So
 * "returns last week" means items returned last week, whenever they were ordered.
 *
 * `basis` picks which date the range applies to:
 *  - "return" (default): items *returned* in the range, whenever they were
 *    ordered. returnRate is null here because the sold and returned
 *    populations differ.
 *  - "order": items *ordered* in the range, and how many of them came back.
 *    Use this only when you need a per-product return rate.
 *
 * Only products with at least one return are included, sorted by unitsReturned desc.
 */
export function returnsByProduct(
  lines: OrderLine[],
  startDate: string,
  endDate: string,
  basis: ReturnDateBasis = "return",
): ProductReturns[] {
  validateRange(startDate, endDate);
  const scoped =
    basis === "order"
      ? lines.filter((l) => inRange(l.orderDate, startDate, endDate))
      : lines.filter((l) => l.returned && inRange(l.returnDate, startDate, endDate));

  const byProduct = new Map<string, ProductReturns>();
  for (const l of scoped) {
    let p = byProduct.get(l.productId);
    if (!p) {
      p = {
        productId: l.productId,
        productTitle: l.productTitle,
        productCategory: l.productCategory,
        unitsSold: 0,
        unitsReturned: 0,
        returnRate: null,
        refundAmount: 0,
        reasons: {},
      };
      byProduct.set(l.productId, p);
    }
    if (basis === "order") p.unitsSold += l.quantity;
    if (l.returned) {
      p.unitsReturned += l.quantity;
      p.refundAmount += l.refundAmount;
      const reason = l.returnReason ?? "Unspecified";
      p.reasons[reason] = (p.reasons[reason] ?? 0) + l.quantity;
    }
  }

  return [...byProduct.values()]
    .filter((p) => p.unitsReturned > 0)
    .map((p) => ({
      ...p,
      unitsSold: basis === "order" ? p.unitsSold : 0,
      returnRate: basis === "order" ? ratio(p.unitsReturned, p.unitsSold) : null,
      refundAmount: round2(p.refundAmount),
    }))
    .sort((a, b) => b.unitsReturned - a.unitsReturned || b.refundAmount - a.refundAmount);
}

// ---------------------------------------------------------------------------
// 4. Returning customers per day / by product
// ---------------------------------------------------------------------------
// A "returning customer" is one whose order has is_repeat_customer = true
// (i.e. they had bought from the store before that order).

export interface DailyReturningCustomers {
  date: string;
  customers: number;
  returningCustomers: number;
  newCustomers: number;
  /** returningCustomers / customers (0..1), null when no customers that day. */
  returningShare: number | null;
  /** Net sales from returning customers' orders that day. */
  returningNetSales: number;
}

/** Distinct customers per day, split into returning vs new. Includes zero days. */
export function returningCustomersByDay(
  lines: OrderLine[],
  startDate: string,
  endDate: string,
): DailyReturningCustomers[] {
  const scoped = filterByOrderDate(lines, startDate, endDate);

  const byDay = new Map<string, { all: Set<string>; ret: Set<string>; retNet: number }>();
  for (const day of eachDay(startDate, endDate)) {
    byDay.set(day, { all: new Set(), ret: new Set(), retNet: 0 });
  }
  for (const l of scoped) {
    const b = byDay.get(l.orderDate)!;
    b.all.add(l.customerId);
    if (l.isRepeatCustomer) {
      b.ret.add(l.customerId);
      b.retNet += l.lineTotal;
    }
  }

  return [...byDay].map(([date, b]) => ({
    date,
    customers: b.all.size,
    returningCustomers: b.ret.size,
    newCustomers: b.all.size - b.ret.size,
    returningShare: b.all.size === 0 ? null : ratio(b.ret.size, b.all.size),
    returningNetSales: round2(b.retNet),
  }));
}

export interface ProductReturningCustomers {
  productId: string;
  productTitle: string;
  productCategory: string;
  customers: number;
  returningCustomers: number;
  newCustomers: number;
  /** returningCustomers / customers (0..1). */
  returningShare: number;
  returningUnits: number;
  returningNetSales: number;
}

/**
 * Distinct customers who bought each product in the range, split into
 * returning vs new. Sorted by returningCustomers desc.
 *
 * Note: if one customer bought the product once as new and again as returning
 * within the range, they count once in `customers` and once in
 * `returningCustomers` (they are not counted as new).
 */
export function returningCustomersByProduct(
  lines: OrderLine[],
  startDate: string,
  endDate: string,
): ProductReturningCustomers[] {
  const scoped = filterByOrderDate(lines, startDate, endDate);

  const byProduct = new Map<
    string,
    { meta: OrderLine; all: Set<string>; ret: Set<string>; units: number; net: number }
  >();
  for (const l of scoped) {
    let p = byProduct.get(l.productId);
    if (!p) {
      p = { meta: l, all: new Set(), ret: new Set(), units: 0, net: 0 };
      byProduct.set(l.productId, p);
    }
    p.all.add(l.customerId);
    if (l.isRepeatCustomer) {
      p.ret.add(l.customerId);
      p.units += l.quantity;
      p.net += l.lineTotal;
    }
  }

  return [...byProduct.values()]
    .map((p) => ({
      productId: p.meta.productId,
      productTitle: p.meta.productTitle,
      productCategory: p.meta.productCategory,
      customers: p.all.size,
      returningCustomers: p.ret.size,
      newCustomers: p.all.size - p.ret.size,
      returningShare: ratio(p.ret.size, p.all.size),
      returningUnits: p.units,
      returningNetSales: round2(p.net),
    }))
    .sort((a, b) => b.returningCustomers - a.returningCustomers || a.productId.localeCompare(b.productId));
}

export interface ReturningCustomersSummary {
  customers: number;
  returningCustomers: number;
  newCustomers: number;
  /** returningCustomers / customers (0..1), null when nobody ordered. */
  returningShare: number | null;
  returningNetSales: number;
  netSales: number;
}

/**
 * Distinct customers across the whole range, split into returning vs new.
 * A customer counts as returning if any of their orders in the range is
 * flagged is_repeat_customer.
 */
export function returningCustomersSummary(
  lines: OrderLine[],
  startDate: string,
  endDate: string,
): ReturningCustomersSummary {
  const scoped = filterByOrderDate(lines, startDate, endDate);
  const all = new Set<string>();
  const ret = new Set<string>();
  let retNet = 0;
  let net = 0;
  for (const l of scoped) {
    all.add(l.customerId);
    net += l.lineTotal;
    if (l.isRepeatCustomer) {
      ret.add(l.customerId);
      retNet += l.lineTotal;
    }
  }
  return {
    customers: all.size,
    returningCustomers: ret.size,
    newCustomers: all.size - ret.size,
    returningShare: all.size === 0 ? null : ratio(ret.size, all.size),
    returningNetSales: round2(retNet),
    netSales: round2(net),
  };
}
