"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/chat";
import type { ChartSpec } from "@/lib/charts";
import { ChartSlot } from "@/components/charts/ChartSlot";
import { ReplyText } from "@/components/ReplyText";

interface ToolUse {
  name: string;
  rangeLabel: string | null;
  rangeSource: string | null;
  filterLabel: string | null;
  error?: string;
}

/** An AI reply is a sequence of text and chart parts, in the order they arrived. */
type Part =
  | { type: "text"; text: string }
  | { type: "chart"; id: string; tool: string; spec?: ChartSpec };

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; parts: Part[]; tools: ToolUse[]; error?: string; pending: boolean };

type Assistant = Extract<Message, { role: "assistant" }>;

const TOOL_LABELS: Record<string, string> = {
  get_sales: "Sales & best sellers",
  get_returns: "Returns",
  get_repeat_customers: "Repeat customers",
};

const EXAMPLES = [
  "Show my revenue by date for October 2025",
  "Which products had the most orders last week?",
  "What got returned last week, and why?",
  "Best sellers in the last 30 days, online store only",
  "What share of my customers were repeat customers this month?",
];

const textOf = (m: Message) =>
  m.role === "user"
    ? m.content
    : m.parts
        .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");

/** Apply one streamed event to the AI reply being built. */
function applyEvent(m: Assistant, event: ChatEvent): Assistant {
  switch (event.type) {
    case "text": {
      const last = m.parts.at(-1);
      const parts: Part[] =
        last?.type === "text"
          ? [...m.parts.slice(0, -1), { ...last, text: last.text + event.delta }]
          : [...m.parts, { type: "text", text: event.delta }];
      return { ...m, parts };
    }
    case "tool": {
      const { name, rangeLabel, rangeSource, filterLabel, error } = event;
      return { ...m, tools: [...m.tools, { name, rangeLabel, rangeSource, filterLabel, error }] };
    }
    case "chart_pending":
      return { ...m, parts: [...m.parts, { type: "chart", id: event.id, tool: event.tool }] };
    case "chart":
      return {
        ...m,
        parts: event.chart
          ? m.parts.map((p) => (p.type === "chart" && p.id === event.id ? { ...p, spec: event.chart! } : p))
          : m.parts.filter((p) => !(p.type === "chart" && p.id === event.id)), // failed call: drop the placeholder
      };
    case "error":
      return { ...m, error: event.message };
    default:
      return m;
  }
}

/** When the reply ends, drop placeholders whose chart never arrived. */
const finish = (m: Assistant): Assistant => ({
  ...m,
  pending: false,
  parts: m.parts.filter((p) => p.type !== "chart" || p.spec),
});

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const updateReply = (fn: (m: Assistant) => Assistant) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      return last?.role === "assistant" ? [...prev.slice(0, -1), fn(last)] : prev;
    });

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const history: Message[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", parts: [], tools: [], pending: true }]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history
            .map((m) => ({ role: m.role, content: textOf(m) }))
            .filter((m) => m.content.trim() !== ""),
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          updateReply((m) => applyEvent(m, event));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateReply((m) => ({ ...m, error: (err as Error).message }));
      }
    } finally {
      updateReply(finish);
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="border-b border-zinc-200 py-4 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Store assistant</h1>
        <p className="text-sm text-zinc-500">
          Ask about sales, returns and repeat customers. Every answer states the exact dates it covers.
        </p>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto py-6">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              Try one of these. &ldquo;Last week&rdquo; means Monday–Sunday of the previous week; &ldquo;this
              month&rdquo; means the 1st through today.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantReply key={i} m={m} />
          ),
        )}
        <div ref={endRef} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-zinc-200 py-4 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What were my returns last week?"
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
          autoFocus
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function AssistantReply({ m }: { m: Assistant }) {
  const lastIndex = m.parts.length - 1;
  return (
    <div className="space-y-2">
      {m.tools.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {m.tools.map((t, j) => (
            <span
              key={j}
              title={t.error}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                t.error
                  ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {TOOL_LABELS[t.name] ?? t.name}
              {t.rangeLabel && ` · ${t.rangeLabel}`}
              {t.rangeSource && t.rangeSource !== "explicit dates" && ` (${t.rangeSource})`}
              {t.filterLabel && ` · ${t.filterLabel}`}
              {t.error && " · needs dates"}
            </span>
          ))}
        </div>
      )}

      {m.pending && m.parts.length === 0 && (
        <div className="inline-flex gap-1 rounded-2xl rounded-tl-sm bg-zinc-100 px-4 py-3 dark:bg-zinc-900" aria-label="Thinking">
          {[0, 150, 300].map((d) => (
            <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      )}

      {m.parts.map((p, j) =>
        p.type === "chart" ? (
          <ChartSlot key={p.id} tool={p.tool} spec={p.spec} />
        ) : p.text.trim() === "" ? null : (
          <div
            key={j}
            className="w-fit max-w-full rounded-2xl rounded-tl-sm bg-zinc-100 px-4 py-2 leading-relaxed dark:bg-zinc-900"
          >
            <ReplyText text={p.text.trim()} />
            {m.pending && j === lastIndex && (
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-400 align-middle" />
            )}
          </div>
        ),
      )}

      {m.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{m.error}</p>
      )}
    </div>
  );
}
