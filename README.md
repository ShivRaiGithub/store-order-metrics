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

## Time phrases ("last week", "this month")

A merchant usually asks about a period in words, not exact dates. [`src/lib/periods.ts`](src/lib/periods.ts) turns those words into exact dates, so two people asking the same question get the same numbers.

| Phrase | Start date | End date |
| --- | --- | --- |
| `last week` | Monday of the previous week | Sunday of the previous week (all 7 days) |
| `this month` | The 1st of the current month | Today (inclusive) |

```ts
import { resolvePeriod } from "@/lib/periods";

// Today is Wednesday 2026-11-18
resolvePeriod("last week", { today: "2026-11-18" });
// → { startDate: "2026-11-09", endDate: "2026-11-15" }

resolvePeriod("this month", { today: "2026-11-18" });
// → { startDate: "2026-11-01", endDate: "2026-11-18" }

const { startDate, endDate } = resolvePeriod("last week", { timeZone: "America/New_York" });
salesByProduct(lines, startDate, endDate);
```

- **Today** is a calendar date. Pass `today` to get reproducible results, or `timeZone` so "today" means the store's local date. With neither, the server's local date is used.
- Case, spaces, `_` and `-` don't matter: `"Last_Week"` works the same as `"last week"`.
- **Any other phrase throws an error** (for example `"last month"`) instead of being guessed. To support a new phrase, add its rule and a test in `periods.ts`.
- **Questions about returns filter on the return date.** "Returns last week" means items *returned* last week, whenever they were ordered. `returnsByProduct` does this by default.

| Function | What it returns |
| --- | --- |
| `salesByDay(lines, start, end)` | One row per calendar day in the range: `orders`, `unitsSold`, `grossSales`, `discounts`, `netSales`. Days with no orders are included as zeros. |
| `salesByProduct(lines, start, end)` | One row per product sold in the range: `orders`, `unitsSold`, `grossSales`, `discounts`, `netSales`, sorted by net sales. |
| `returnsByProduct(lines, start, end, basis?)` | Products with at least one return: `unitsSold`, `unitsReturned`, `returnRate`, `refundAmount`, and a count per return reason. |
| `returningCustomersByDay(lines, start, end)` | One row per day: distinct `customers`, `returningCustomers`, `newCustomers`, `returningShare`, `returningNetSales`. |
| `returningCustomersByProduct(lines, start, end)` | One row per product: distinct `customers`, `returningCustomers`, `newCustomers`, `returningShare`, `returningUnits`, `returningNetSales`. |

### Definitions

- **Gross sales** = `quantity × unit_price`. **Net sales** = `line_total` (gross minus discount). Refunds are reported under returns and are not subtracted from sales.
- **Date range** applies to `order_date` for sales and customers, and to `return_date` for returns.
- **`returnsByProduct` basis**
  - `"return"` (default): items *returned* in the range, whenever they were ordered. `unitsSold` is `0` and `returnRate` is `null`, because the units sold and the units returned come from different sets of orders.
  - `"order"`: items *ordered* in the range and how many of them came back. Use this only when you need a per-product `returnRate`.
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
src/lib/periods.ts         time phrase → exact date range rules
src/lib/metrics.test.ts    tests checked against the CSV by hand
src/lib/periods.test.ts    tests for the time phrase rules
src/app/                   Next.js app (default scaffold)
```

## Prompts Given to Claude Code
Initiate a nextjs repo
Look at Store order @"Store Order History, May to October 2025.csv"  and create metric functions for these:

Sales for each day
Sale by each product
Return by each product
Returning customers per day or by product


salesByDay: orders, units, gross sales, discounts and net sales for every day in the range. Days with no orders show as zeros.
salesByProduct: the same totals for each product, sorted by net sales.
returnsByProduct: units returned, return rate, refund amount and a count per return reason, for each product. An optional last argument picks which date the range filters on:
"order" (default): items ordered in the range, which gives a real return rate.
"return": items returned in the range, whenever they were ordered. The return rate is left empty here, because the items sold and the items returned come from different orders.
returningCustomersByDay and returningCustomersByProduct: customers counted once each, split into returning and new, plus the returning customers' units and sales. "Returning" uses the CSV's is_repeat_customer column.


Take input as start date and end date for the functions

In metrics.ts every function needs an exact startDate and endDate, but I can't find anything that says what a merchant's "last week" or "last month" turns into, and that gap means two people could get different numbers for the same question.
These rules for vague time dates to exact dates:
last week = Monday till Sunday, all 7 days of previous week
this month = 1 of this month till today
date should filter for return date when asked for returns

Fill in the readme and push repo to github when done
