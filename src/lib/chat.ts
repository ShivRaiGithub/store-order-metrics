import type { OrderLine } from "./orders";
import { todayIn, type ResolveOptions } from "./periods";
import { formatRange, runTool, TOOL_DEFINITIONS, type ToolArgs } from "./tools";

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
  | { type: "tool"; name: string; args: ToolArgs; rangeLabel: string | null; rangeSource: string | null; error?: string }
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

  return `You are an analytics assistant for an online clothing store. You answer the merchant's questions about their sales, returns and repeat customers.

Today is ${formatRange({ startDate: today, endDate: today })} (${today}). ${coverage}

Rules:
1. Every number you give must come from a tool result. Quote the tool's "totals"; never add up rows yourself.
2. Begin every answer with the exact dates used, copied from the tool result's "rangeLabel", e.g. "Last week (Mon 20 Oct 2025 – Sun 26 Oct 2025): ...". Never leave the dates out.
3. "last week" and "this month" have fixed meanings. Pass them as the tool's "period" and never work out those dates yourself. Last week = Monday to Sunday of the previous week. This month = the 1st of this month through today.
4. When the merchant names exact dates, a month or a year (e.g. "October 2025", "1–15 Oct"), convert that to startDate/endDate. A month without a year means the most recent one on or before today.
5. Any other vague period ("last month", "recently", "this quarter", "past few weeks") has no agreed meaning. Do not guess. Say that "last week" and "this month" are supported, and ask for exact dates.
6. Returns are counted on the day the item was returned, not the day it was ordered. Say so when you answer about returns.
7. If a range has no data, say so and mention the dates the data covers.
8. Keep it short and plain: lead with the answer, then a few bullet points. Money with two decimals. No tables.`;
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
      }
    }

    const toolCalls = calls.filter(Boolean);
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
        ...(error ? { error } : {}),
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) });
    }
  }

  throw new Error(`The model did not finish answering within ${MAX_STEPS} steps.`);
}
