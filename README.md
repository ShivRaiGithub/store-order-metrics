# Store Order Metrics

A Next.js (App Router, TypeScript) project with metric functions over a store's order history export (May–October 2025).

### Preview
Live Link: https://store-order-metrics.vercel.app/

6 Screenshots in /Screenshots:   
1. Winter Jackets Return question   
2. 5 Erik Vogt's acceptance questions: Question 1, 3, 5, 16, 19
   
All questions return expected and correct answers

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

## Time phrases ("last week", "last 30 days", "this season")

A merchant usually asks about a period in words, not exact dates. [`src/lib/periods.ts`](src/lib/periods.ts) turns those words into exact dates, so two people asking the same question get the same numbers.

| Phrase | Start date | End date |
| --- | --- | --- |
| `last week` | Monday of the previous week | Sunday of the previous week (all 7 days) |
| `this month` | The 1st of the current month | Today (inclusive) |
| `last N days` / `past N days` (N = 1–366) | N−1 days before today | Today. "Last 30 days" on 29 Oct = 30 Sep – 29 Oct |
| `this season` | 1st day of the current season | Today |
| `spring` / `summer` / `autumn` / `fall` / `winter` | The most recent one: if we're in it, its 1st day … | … through today; otherwise its last day |
| *(no period given)* | Same as `this month` | |
| *(any other phrase: "recently", "last month", "this quarter")* | Same as `last week` | The answer says the phrase has no fixed meaning, so it used last week |

Seasons are **meteorological**: spring Mar–May, summer Jun–Aug, autumn (fall) Sep–Nov, winter Dec–Feb. December belongs to the following January and February. On 29 Oct 2025, "this season" and "autumn" both mean 1 Sep – 29 Oct 2025, "summer" means 1 Jun – 31 Aug 2025, and "winter" means 1 Dec 2024 – 28 Feb 2025.

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
- **Phrases with no rule fall back to last week.** `resolvePeriod` itself throws `UnsupportedPeriodError` for them (for example `"recently"`, `"last month"`, `"winter 2024"`). The chat tools catch that error and use `FALLBACK_PERIOD` (`"last week"`), and the tool result's `rangeSource` reads e.g. `last week ("recently" has no fixed meaning)`. A malformed rule, such as `"last 0 days"`, or half a date range is still an error. To give a phrase its own meaning, add a rule and a test in `periods.ts`.
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

## Chat assistant

The home page (`/`) is a chat where a merchant asks a question in plain words and gets a streamed answer that **always states the exact dates it covers**, e.g. *"Last week (Mon 20 Oct 2025 – Sun 26 Oct 2025): ..."*. Each answer also shows a chip for every tool used, with its date range.

How it works:

1. The page posts the conversation to `POST /api/chat` ([`src/app/api/chat/route.ts`](src/app/api/chat/route.ts)).
2. [`src/lib/chat.ts`](src/lib/chat.ts) streams a completion from OpenRouter using the model in `.env`, with three tools available.
3. When the model calls a tool, [`src/lib/tools.ts`](src/lib/tools.ts) turns "last week" / "this month" into exact dates with `resolvePeriod`, runs the metric functions, and returns totals together with a ready-made `rangeLabel`. The model copies that label, so it never works out dates or weekdays itself.
4. The answer streams back to the page as newline-delimited JSON events (`text`, `tool`, `chart_pending`, `chart`, `error`, `done`).

### Charts in the answer

When a tool's result has a chart, the merchant sees the chart instead of a list of numbers, and the text below it keeps to the dates, the headline totals and one or two observations.

| Metric | View | When it's shown |
| --- | --- | --- |
| Revenue by date | Line chart (every day in the range, including days with no sales) | `get_sales` with `groupBy: "day"` |
| Orders by product | Horizontal bar chart, most orders first | `get_sales` with `groupBy: "product"` |
| Returned orders | Table: one row per returned item, with order, product, reason and refund, plus a total | `get_returns` (filtered by return date) |

Repeat-customer answers stay as text.

**Loading placeholders.** Each chart gets its own grey box with a spinner, inside the AI's reply, in the spot where the chart will appear:

1. As soon as the model starts calling a chart tool, the server sends `chart_pending` with an id, and the page shows a grey box for that id.
2. When the tool has run, the server sends `chart` with the same id and the data. If the call failed (for example, an unsupported period), it sends `chart: null` and the box is removed.
3. The grey box stays until the chart has actually rendered. That covers the chart library downloading on first use (`next/dynamic`) and the chart measuring its width. Then the finished chart replaces the box, at about the same size.
4. If the reply ends or is stopped before a chart's data arrives, its box is removed.

Charts use [Recharts](https://recharts.org). Colors come from CSS tokens in `globals.css`, with separate light and dark values. Each chart has one series, so its title names it and there's no legend. Hovering shows a tooltip.

### Tools

| Tool | Description the model sees (merchant wording) |
| --- | --- |
| `get_sales` | **Get sales and best sellers.** How much did I sell, how many orders and items, what did I give away in discounts, and which products sold best? By day or by product. Uses order dates. |
| `get_returns` | **Returns:** what came back, which products get returned most, why customers sent them back, and how much I refunded. Uses the date the item was returned. |
| `get_repeat_customers` | **Repeat customers: get the repeat customers share.** How many of my customers had bought from me before, how many were new, and how much the repeat customers spent. In total, by day or by product. Uses order dates. |

Every tool takes the same optional filters:

| Filter | Example | Notes |
| --- | --- | --- |
| `channel` | "online store only" → `"Online Store"` | One of the channels in the data: Online Store, Shop app, Point of Sale, Instagram. |
| `channel` (Meta) | "ad spend on Meta this month" → `"Instagram"` | "Meta", "meta ads" and "IG" mean the Instagram channel, the store's only Meta channel. The data has no ad-cost figures, so Meta questions are answered with **revenue from Instagram orders**, and the answer says so. |
| `productIds` | "winter jackets" → `["P-1001","P-1002","P-1003"]` | The model maps the merchant's words to catalog products and says which ones it used. |
| `category` | "accessories" → `"Accessories"` | One of the categories in the data. |

An unknown channel, category or product id comes back as an error, so the model corrects itself instead of showing empty numbers. Filters appear in the tool chip and in the chart subtitle (e.g. "Tue 30 Sept 2025 – Wed 29 Oct 2025 · Online Store").

The model's instructions include the **product catalog** built from the order data (ids, names, categories), the categories and the channels. For a product that isn't in the catalog ("fleece vests") it says there are no orders for it, and it doesn't offer figures it can't get. There is **no stock or inventory data**, and it says so.

### How the answer handles dates

- Time phrases ("last week", "this month", "last 30 days", "this season", "winter") are passed to the tool as a `period` and resolved by the rules above.
- **No period given** ("repeat customer share"): the tool uses this month, and the answer says so. The assistant doesn't ask first.
- Named dates, months or years ("October 2025", "1–15 Oct") are turned into exact start and end dates by the model.
- **Phrases with no rule** ("recently", "last month", "this quarter", "winter 2024") use **last week**. The assistant doesn't ask first. It says the phrase isn't a fixed period, so the answer covers last week, and that the merchant can ask for another period.
- Numbers come only from tool results. The tools return totals, so the model doesn't add up rows itself.

### Environment

Create `.env` in the project root (it is git-ignored):

```bash
OPEN_ROUTER_API_KEY=sk-or-...        # required
OPENROUTER_MODEL=openai/gpt-4o-mini   # required; must support tool calling
STORE_TODAY=2025-10-29               # optional: pin "today" (handy because the data ends in Oct 2025)
STORE_TIMEZONE=America/New_York      # optional: the store's time zone for "today"
```

Free models (`...:free`) are often rate-limited by their provider. The server retries a 429 or 5xx error 3 times. If the error persists, the page shows it; switch the model, or try again later.

## Getting started

```bash
npm install
npm test        # run the tests (Vitest)
npm run dev     # start the chat on http://localhost:3000 (needs .env, see above)
```

## Project layout

```
data/orders.csv            order history export
src/lib/orders.ts          CSV parser + loadOrders()
src/lib/metrics.ts         metric functions
src/lib/periods.ts         time phrase → exact date range rules
src/lib/tools.ts           chat tools: merchant-worded descriptions + runTool()
src/lib/chat.ts            OpenRouter streaming + tool-calling loop
src/lib/charts.ts          chart spec types sent to the page
src/lib/*.test.ts          tests (metrics checked against the CSV by hand)
src/app/page.tsx           chat page (replies = text bubbles + chart slots)
src/components/charts/     grey placeholder, line/bar charts, returns table
src/app/api/chat/route.ts  streaming chat endpoint
```

## Prompts Given to Claude Code

### Stage 1
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

### Stage 2

Build a chat page that streams response
Take a merchant question and answering with exact dates
Use OpenRouter Api key and model from .env - OPEN_ROUTER_API_KEY, OPENROUTER_MODEL

Write these merchant worded description for each tool:
return tools - Returns tool description
sale tools - Get sales and best sellers
repeat customers tool - Repeat customers - Get the repeat customers share

Commit, update readme and push code to github


### Stage 3
Implement charts to show data in chat page (chat route). 
Use these charts for each metric:
revenue by date - line chart
orders by product - bar chart
returned orders - table

Show charts to user instead of plain texts

Implement a grey box with a spinner to show to user until charts load.
Show the charts when the chart is completed and loaded
Show a grey box in place of a chart until the chart loads
Each chart gets its own grey box.
When data lands, finished charts take grey box's place
The grey box shows as AI's reply bubble
Each grey box belongs to the response by the AI and appears in place of chart until chart loads.
Update readme. Commit and push to GitHub

### Stage 4
Deploy repo to vercel
It is named as "store-order-metrics" on github
Upload .env securely to environment variables
Send back the deployed link