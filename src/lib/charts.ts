/**
 * Chart specs sent from the server to the chat page. Kept free of Node imports
 * so the browser bundle can import the types.
 *
 * Which metric gets which view:
 *  - revenue by date   -> line chart   (get_sales, groupBy "day")
 *  - orders by product -> bar chart    (get_sales, groupBy "product")
 *  - returned orders   -> table        (get_returns)
 */

export interface LineChartSpec {
  kind: "line";
  title: string;
  rangeLabel: string;
  /** Filters applied, e.g. "Online Store · Outerwear". */
  filterLabel: string | null;
  /** Every day in the range, including days with no sales (0). */
  points: { date: string; netSales: number; orders: number }[];
  totalNetSales: number;
}

export interface BarChartSpec {
  kind: "bar";
  title: string;
  rangeLabel: string;
  /** Filters applied, e.g. "Online Store · Outerwear". */
  filterLabel: string | null;
  /** Sorted by orders, most first. */
  bars: { productTitle: string; orders: number; unitsSold: number; netSales: number }[];
  totalOrders: number;
}

export interface TableSpec {
  kind: "table";
  title: string;
  rangeLabel: string;
  /** Filters applied, e.g. "Online Store · Outerwear". */
  filterLabel: string | null;
  dateBasis: "return date" | "order date";
  rows: {
    orderId: string;
    orderDate: string;
    returnDate: string;
    productTitle: string;
    variant: string;
    quantity: number;
    reason: string;
    refundAmount: number;
  }[];
  totalUnits: number;
  totalRefund: number;
}

export type ChartSpec = LineChartSpec | BarChartSpec | TableSpec;

/** Tools that produce a chart. The page shows a placeholder as soon as one is called. */
export const CHART_TOOLS = new Set(["get_sales", "get_returns"]);
