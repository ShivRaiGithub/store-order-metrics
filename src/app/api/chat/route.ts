import { runChat, type ChatEvent, type ChatMessage } from "@/lib/chat";
import { loadOrders, type OrderLine } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HISTORY = 20;
const MAX_CHARS = 4000;

let cachedLines: OrderLine[] | null = null;
const getLines = () => (cachedLines ??= loadOrders());

function parseHistory(body: unknown): ChatMessage[] | null {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const clean: ChatMessage[] = [];
  for (const m of messages) {
    const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    clean.push({ role, content: content.slice(0, MAX_CHARS) });
  }
  if (clean.at(-1)?.role !== "user") return null;
  return clean.slice(-MAX_HISTORY);
}

export async function POST(req: Request) {
  const apiKey = process.env.OPEN_ROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    return Response.json(
      { error: "Set OPEN_ROUTER_API_KEY and OPENROUTER_MODEL in .env, then restart the server." },
      { status: 500 },
    );
  }

  const history = parseHistory(await req.json().catch(() => null));
  if (!history) {
    return Response.json(
      { error: 'Body must be { messages: [{ role: "user" | "assistant", content: string }] } ending with a user message.' },
      { status: 400 },
    );
  }

  const dateOptions = {
    today: process.env.STORE_TODAY || undefined,
    timeZone: process.env.STORE_TIMEZONE || undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await runChat(history, { apiKey, model, lines: getLines(), dateOptions, signal: req.signal }, send);
      } catch (err) {
        if (!req.signal.aborted) send({ type: "error", message: (err as Error).message });
      } finally {
        try {
          if (!req.signal.aborted) send({ type: "done" });
          controller.close();
        } catch {
          // client already disconnected
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
