import { readFileSync } from "node:fs";
import path from "node:path";

export type FulfillmentStatus = "fulfilled" | "partially_fulfilled" | "unfulfilled";

/** One row of the order export: a single line item within an order. */
export interface OrderLine {
  orderId: string;
  lineItemId: string;
  orderDate: string; // YYYY-MM-DD
  customerId: string;
  isRepeatCustomer: boolean;
  productId: string;
  productTitle: string;
  productCategory: string;
  variant: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  salesChannel: string;
  fulfillmentStatus: FulfillmentStatus;
  returned: boolean;
  returnDate: string | null; // YYYY-MM-DD
  returnReason: string | null;
  refundAmount: number;
}

export const DEFAULT_CSV_PATH = path.join(process.cwd(), "data", "orders.csv");

/** Split one CSV line, honouring double-quoted fields and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const num = (v: string) => (v === "" ? 0 : Number(v));
const bool = (v: string) => v.trim().toLowerCase() === "true";
const opt = (v: string) => (v === "" ? null : v);

/** Parse the store's order-export CSV text into typed line items. */
export function parseOrdersCsv(text: string): OrderLine[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`CSV is missing column "${name}"`);
    return i;
  };
  const c = {
    orderId: idx("order_id"),
    lineItemId: idx("line_item_id"),
    orderDate: idx("order_date"),
    customerId: idx("customer_id"),
    isRepeat: idx("is_repeat_customer"),
    productId: idx("product_id"),
    productTitle: idx("product_title"),
    productCategory: idx("product_category"),
    variant: idx("variant"),
    quantity: idx("quantity"),
    unitPrice: idx("unit_price"),
    discount: idx("discount_amount"),
    lineTotal: idx("line_total"),
    channel: idx("sales_channel"),
    fulfillment: idx("fulfillment_status"),
    returned: idx("returned"),
    returnDate: idx("return_date"),
    returnReason: idx("return_reason"),
    refund: idx("refund_amount"),
  };

  return lines.slice(1).map((line) => {
    const f = splitCsvLine(line);
    return {
      orderId: f[c.orderId],
      lineItemId: f[c.lineItemId],
      orderDate: f[c.orderDate],
      customerId: f[c.customerId],
      isRepeatCustomer: bool(f[c.isRepeat]),
      productId: f[c.productId],
      productTitle: f[c.productTitle],
      productCategory: f[c.productCategory],
      variant: f[c.variant],
      quantity: num(f[c.quantity]),
      unitPrice: num(f[c.unitPrice]),
      discountAmount: num(f[c.discount]),
      lineTotal: num(f[c.lineTotal]),
      salesChannel: f[c.channel],
      fulfillmentStatus: f[c.fulfillment] as FulfillmentStatus,
      returned: bool(f[c.returned]),
      returnDate: opt(f[c.returnDate]),
      returnReason: opt(f[c.returnReason]),
      refundAmount: num(f[c.refund]),
    };
  });
}

/** Read and parse the order CSV from disk (server-side only). */
export function loadOrders(csvPath: string = DEFAULT_CSV_PATH): OrderLine[] {
  return parseOrdersCsv(readFileSync(csvPath, "utf8"));
}
