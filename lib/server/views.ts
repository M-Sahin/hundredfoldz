// Views of public decks, counted in the store (Upstash, store.ts): once per visitor a deck a day.
// Not in the database on purpose: its key is public, so anyone could call a counter there; the
// store is reached only from this server. Without a store, views aren't counted or shown (null).
// A visitor is a hash of their address and browser, kept two days: no ids, nothing readable.
import { kv, kvConfig } from "./store";
import { clientIp } from "./ratelimit";

const DAY = 24 * 3600;
const VIEWS = (deck: string) => `hf:views:${deck}`;

async function sha(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Count a view of a deck by the visitor behind this request; returns the deck's views (null without a store). */
export async function countView(deck: string, request: Request, now = Date.now()): Promise<number | null> {
  if (!kvConfig()) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const who = await sha(`hf-view:${clientIp(request)}|${request.headers.get("user-agent") ?? ""}|${deck}|${day}`);
  const first = await kv(["SET", `hf:seen:${who}`, 1, "EX", 2 * DAY, "NX"]);
  if (first === "OK") return Number(await kv(["INCR", VIEWS(deck)]));
  return Number((await kv(["GET", VIEWS(deck)])) ?? 0);
}

/** Views of several decks, in order (null without a store, or when the store doesn't answer). */
export async function viewCounts(decks: string[]): Promise<(number | null)[]> {
  if (!kvConfig() || !decks.length) return decks.map(() => null);
  try {
    const out: (number | null)[] = [];
    for (let i = 0; i < decks.length; i += 200) {
      const r = (await kv(["MGET", ...decks.slice(i, i + 200).map(VIEWS)])) as (string | null)[];
      out.push(...r.map((v) => Number(v ?? 0)));
    }
    return out;
  } catch {
    return decks.map(() => null);
  }
}
