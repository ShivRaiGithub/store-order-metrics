"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/chat";

interface ToolUse {
  name: string;
  rangeLabel: string | null;
  rangeSource: string | null;
  error?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tools?: ToolUse[];
  error?: string;
  pending?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  get_sales: "Sales & best sellers",
  get_returns: "Returns",
  get_repeat_customers: "Repeat customers",
};

const EXAMPLES = [
  "What were my best sellers in October 2025?",
  "Which products got returned most last week, and why?",
  "What share of my customers were repeat customers this month?",
  "How much did I sell each day from 20 to 26 Oct 2025?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const history = [...messages, { role: "user" as const, content: q }];
    setMessages([...history, { role: "assistant", content: "", tools: [], pending: true }]);
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
            .filter((m) => m.content.trim() !== "")
            .map(({ role, content }) => ({ role, content })),
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
          if (event.type === "text") {
            updateLast((m) => ({ ...m, content: m.content + event.delta }));
          } else if (event.type === "tool") {
            const { name, rangeLabel, rangeSource, error } = event;
            updateLast((m) => ({ ...m, tools: [...(m.tools ?? []), { name, rangeLabel, rangeSource, error }] }));
          } else if (event.type === "error") {
            updateLast((m) => ({ ...m, error: event.message }));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateLast((m) => ({ ...m, error: (err as Error).message }));
      }
    } finally {
      updateLast((m) => ({ ...m, pending: false }));
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
              <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.tools && m.tools.length > 0 && (
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
                      {t.error && " · needs dates"}
                    </span>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap leading-relaxed">
                {m.content}
                {m.pending && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-400 align-middle" />}
              </div>
              {m.error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                  {m.error}
                </p>
              )}
            </div>
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
