# Store Order Metrics

A Next.js (App Router, TypeScript) project with metric functions over a store's order history export (May–October 2025).

## Data

`data/orders.csv` is the order export. Each row is one **line item** in an order, with columns for order date, customer, product, quantity, price, discount, line total, sales channel, fulfillment status, and return details (`returned`, `return_date`, `return_reason`, `refund_amount`).

## Metric functions

All metric functions live in [`src/lib/metrics.ts`](src/lib/metrics.ts). Each one takes the parsed line items plus a **`startDate` and `endDate`** (`YYYY-MM-DD`, both inclusive). An invalid date, an impossible date such as `2025-02-31`, or a start that comes after the end throws an error.

```ts
import { loadOrders } from "@/lib/orders";
import { salesByDay } from "@/lib/metrics";

const lines = loadOrders(); // reads data/orders.csv
salesByDay(lines, "2025-10-01", "2025-10-31");
```

| Function | What it returns |
| --- | --- |
| `salesByDay(lines, start, end)` | One row per calendar day in the range: `orders`, `unitsSold`, `grossSales`, `discounts`, `netSales`. Days with no orders are included as zeros. |
| `salesByProduct(lines, start, end)` | One row per product sold in the range: `orders`, `unitsSold`, `grossSales`, `discounts`, `netSales`, sorted by net sales. |
| `returnsByProduct(lines, start, end, basis?)` | Products with at least one return: `unitsSold`, `unitsReturned`, `returnRate`, `refundAmount`, and a count per return reason. |
| `returningCustomersByDay(lines, start, end)` | One row per day: distinct `customers`, `returningCustomers`, `newCustomers`, `returningShare`, `returningNetSales`. |
| `returningCustomersByProduct(lines, start, end)` | One row per product: distinct `customers`, `returningCustomers`, `newCustomers`, `returningShare`, `returningUnits`, `returningNetSales`. |

### Definitions

- **Gross sales** = `quantity × unit_price`. **Net sales** = `line_total` (gross minus discount). Refunds are reported under returns and are not subtracted from sales.
- **Date range** applies to `order_date`, except `returnsByProduct` with `basis = "return"`.
- **`returnsByProduct` basis**
  - `"order"` (default): items *ordered* in the range and how many of them came back. Gives a true per-product `returnRate`.
  - `"return"`: items *returned* in the range, whenever they were ordered. `returnRate` is `null` because the units sold and the units returned come from different sets of orders.
- **Returning customer** is taken from the export's `is_repeat_customer` flag on each order. If a customer buys a product as new and later as returning within the same range, they are counted once, as returning.
- Money is rounded to 2 decimals. Ratios (`returnRate`, `returningShare`) are fractions from 0 to 1, rounded to 4 decimals.

## Getting started

```bash
npm install
npm test        # run the metric tests (Vitest)
npm run dev     # start the Next.js dev server on http://localhost:3000
```

## Project layout

```
data/orders.csv            order history export
src/lib/orders.ts          CSV parser + loadOrders()
src/lib/metrics.ts         metric functions
src/lib/metrics.test.ts    tests checked against the CSV by hand
src/app/                   Next.js app (default scaffold)
```
