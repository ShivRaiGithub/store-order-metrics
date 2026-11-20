import type { OrderLine } from "./orders";
import { todayIn, type ResolveOptions } from "./periods";
import { CHART_TOOLS, type ChartSpec } from "./charts";
import { catalogOf, formatRange, runTool, TOOL_DEFINITIONS, type ToolArgs } from "./tools";

/**
 * Chat loop against OpenRouter's OpenAI-compatible API, with streaming.
 *
 * Each step streams one completion. Text deltas go straight to the client.
 * If the model asks for tools, we run them, append the results and stream the
 * next step, until the model answers in plain text.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_STEPS = 6;
const RETRY_DELAYS_MS = [1500, 4000, 8000];

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Events streamed to the browser, one JSON object per line. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | {
      type: "tool";
      name: string;
      args: ToolArgs;
      rangeLabel: string | null;
      rangeSource: string | null;
      filterLabel: string | null;
      error?: string;
    }
  /** A chart tool was called: show a placeholder until its `chart` event arrives. */
  | { type: "chart_pending"; id: string; tool: string }
  /** The chart's data. `chart: null` means the call failed: drop the placeholder. */
  | { type: "chart"; id: string; chart: ChartSpec | null }
  | { type: "error"; message: string }
  | { type: "done" };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ApiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatConfig {
  apiKey: string;
  model: string;
  lines: OrderLine[];
  dateOptions: ResolveOptions;
  signal?: AbortSignal;
}

export function buildSystemPrompt(lines: OrderLine[], dateOptions: ResolveOptions): string {
  const today = dateOptions.today ?? todayIn(dateOptions.timeZone);
  const orderDates = lines.map((l) => l.orderDate).sort();
  const returnDates = lines.flatMap((l) => (l.returnDate ? [l.returnDate] : [])).sort();
  const coverage = orderDates.length
    ? `Orders in the data are dated ${orderDates[0]} to ${orderDates.at(-1)}; returns are dated up to ${returnDates.at(-1) ?? "n/a"}.`
    : "There is no order data.";
  const catalog = catalogOf(lines);
  const productList = catalog.products.map((p) => `- ${p.productId}: ${p.productTitle} (${p.productCategory})`).join("\n");

  return `You are an analytics assistant for an online clothing store. You answer the merchant's questions about their sales, returns and repeat customers.

Today is ${formatRange({ startDate: today, endDate: today })} (${today}). ${coverage}

Products that appear in the order data (this is the whole catalog you know about):
${productList}
Categories: ${catalog.categories.join(", ")}.
Sales channels: ${catalog.channels.join(", ")}.

Rules:
1. Every number you give must come from a tool result. Quote the tool's "totals"; never add up rows yourself.
2. Begin every answer with the exact dates used, copied from the tool result's "rangeLabel", e.g. "Last week (Mon 20 Oct 2025 – Sun 26 Oct 2025): ...". If the tool result has "filters", name them too (e.g. "Online Store only").
3. Time phrases have fixed meanings and the server works out the dates. Pass them as the tool's "period" exactly as said and never work out those dates yourself:
   - "last week" = Monday to Sunday of the previous week
   - "this month" = the 1st of this month through today
   - "last N days" / "past N days" = N days ending today (today included)
   - "this season" = start of the current meteorological season through today
   - "spring", "summer", "autumn"/"fall", "winter" = the most recent one (Spring Mar–May, Summer Jun–Aug, Autumn Sep–Nov, Winter Dec–Feb); if we are in it, its start through today
4. When the merchant names exact dates, a month or a year (e.g. "October 2025", "1–15 Oct"), convert that to startDate/endDate. A month without a year means the most recent one on or before today.
5. If the merchant gives no period at all, do not ask: call the tool without period or dates. The server uses this month, and the rangeSource says so. Mention that it is this month and that they can ask for another period.
6. Any other vague period ("recently", "lately", "last month", "this quarter", "past few weeks", "winter 2024") has no fixed meaning. Do not ask and do not pick dates yourself: pass the phrase as "period" and the server uses last week. Then say that, e.g. "\"Recently\" isn't a fixed period, so this is last week (Mon 20 Oct – Sun 26 Oct 2025)", and that they can ask for another period.
7. Products: map the merchant's words to catalog products and pass their ids as productIds (e.g. "jackets" or "winter jackets" → the Jacket, Parka and Shell products; "the parka" → the Alpine Down Parka). Pass category when they name a whole category, and channel when they name a sales channel ("online store only" → "Online Store"). Say which products you included. Do not ask which products they meant when the catalog makes it clear.
8. If the merchant asks about a product that is not in the catalog, say there are no orders for it in the data. Do not offer to look up its sales or returns.
9. There is no inventory or stock data. Say so for stock questions, and don't offer data you don't have.
9a. Meta / Instagram / "ad spend on Meta": Instagram is the store's Meta sales channel. Do not say there is no tool for it. Call get_sales with channel "Instagram" for the period asked (no period = this month) and answer with that revenue. Say in one short line that this is revenue from Instagram orders, since the data has no ad-cost figures.
10. Returns are counted on the day the item was returned, not the day it was ordered. Say so when you answer about returns.
11. If a range has no data, say so and mention the dates the data covers.
12. Keep it short and plain. Money with two decimals. No tables.
13. Charts are shown to the merchant automatically, right above your text: get_sales by day shows a "Revenue by date" line chart, get_sales by product shows an "Orders by product" bar chart, and get_returns shows a "Returned orders" table. When one is shown, do not list its rows again. Give the dates, the headline totals and at most two short observations (e.g. the best day or the top reason). For "revenue by date" or "each day" questions, use groupBy "day".`;
}

/** Parse an OpenAI-style SSE stream into JSON chunks. */
async function* sseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      // Lines starting with ":" are keep-alive comments from OpenRouter.
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // ignore partial / non-JSON lines
      }
    }
  }
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

export async function runChat(
  history: ChatMessage[],
  config: ChatConfig,
  send: (event: ChatEvent) => void,
): Promise<void> {
  const messages: ApiMessage[] = [
    { role: "system", content: buildSystemPrompt(config.lines, config.dateOptions) },
    ...history,
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const request = () =>
      fetch(OPENROUTER_URL, {
        method: "POST",
        signal: config.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Store Order Metrics",
        },
        body: JSON.stringify({ model: config.model, messages, tools: TOOL_DEFINITIONS, stream: true }),
      });
    // Free models are often rate-limited upstream; retry 429 / 5xx a few times.
    let res = await request();
    for (const wait of RETRY_DELAYS_MS) {
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, wait));
      res = await request();
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter request failed (${res.status}): ${detail.slice(0, 500)}`);
    }

    let text = "";
    const calls: ToolCall[] = [];
    const chartIds = new Map<number, string>();
    for await (const chunk of sseChunks(res.body)) {
      if (chunk.error) {
        const e = chunk.error as { message?: string };
        throw new Error(`OpenRouter error: ${e.message ?? JSON.stringify(e)}`);
      }
      const choices = chunk.choices as { delta?: StreamDelta }[] | undefined;
      const delta = choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        send({ type: "text", delta: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const call = (calls[tc.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.function.name += tc.function.name;
        if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
        // Show the chart placeholder as soon as we know a chart tool is being called.
        if (!chartIds.has(tc.index) && CHART_TOOLS.has(call.function.name)) {
          const id = `${step}-${tc.index}`;
          chartIds.set(tc.index, id);
          send({ type: "chart_pending", id, tool: call.function.name });
        }
      }
    }

    const toolCalls = calls.filter(Boolean);
    const chartIdFor = (call: ToolCall) => chartIds.get(calls.indexOf(call));
    if (toolCalls.length === 0) return; // final answer streamed

    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let args: ToolArgs = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // leave args empty; runTool reports the missing range back to the model
      }
      const result = runTool(call.function.name, args, config.lines, config.dateOptions);
      const error = (result.data as { error?: string }).error;
      send({
        type: "tool",
        name: call.function.name,
        args,
        rangeLabel: result.range ? formatRange(result.range) : null,
        rangeSource: result.rangeSource,
        filterLabel: result.filterLabel,
        ...(error ? { error } : {}),
      });
      const chartId = chartIdFor(call);
      if (chartId) send({ type: "chart", id: chartId, chart: result.chart ?? null });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) });
    }
  }

  throw new Error(`The model did not finish answering within ${MAX_STEPS} steps.`);
}
