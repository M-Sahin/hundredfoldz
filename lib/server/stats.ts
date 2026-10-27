// Daily event counts for the /stats page: builds started, finished and failed (and why), the free
// build wall, keys, saves, shares, exports and errors. Only counts are kept: no ids, no addresses,
// no cookies, nothing that says who did what. Stored in Upstash as one hash per day (kept 400 days);
// without the store, counted in this instance's memory. Counting never fails a request.
import { kvConfig } from "./store";
import type { ClientEvent, ServerEvent } from "../shared/stats-events";

const DAY_TTL = 400 * 24 * 3600;
const dayKey = (date: string) => `hf:stats:${date}`;
const errKey = (date: string) => `hf:stats:err:${date}`;
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

type Fetch = typeof fetch;
const memory = new Map<string, Map<string, number>>();
export function resetStats() {
  memory.clear();
}

async function pipeline(cmds: (string | number)[][], f: Fetch = fetch): Promise<unknown[]> {
  const kv = kvConfig()!;
  const res = await f(`${kv.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${kv.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(1500),
  });
  const j = (await res.json()) as { result?: unknown }[];
  if (!res.ok || !Array.isArray(j)) throw new Error(`HTTP ${res.status}`);
  return j.map((x) => x?.result);
}

function bump(key: string, field: string, by: number) {
  const h = memory.get(key) ?? new Map<string, number>();
  h.set(field, (h.get(field) ?? 0) + by);
  memory.set(key, h);
  if (memory.size > 500) memory.delete(memory.keys().next().value as string);
}

export interface CountDeps {
  fetch?: Fetch;
  now?: number;
}

/** Count events (each once, or by `by`). Never throws. */
export async function count(events: (ServerEvent | ClientEvent)[] | ServerEvent | ClientEvent, deps: CountDeps = {}): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return;
  const key = dayKey(today(deps.now));
  if (kvConfig()) {
    try {
      await pipeline([...list.map((e) => ["HINCRBY", key, e, 1]), ["EXPIRE", key, DAY_TTL, "NX"]], deps.fetch);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  for (const e of list) bump(key, e, 1);
}

/** Count a page error by its (cleaned) message, for the "most common errors" list. */
export async function countError(message: string, deps: CountDeps = {}): Promise<void> {
  if (!message) return;
  const key = errKey(today(deps.now));
  if (kvConfig()) {
    try {
      await pipeline([["HINCRBY", key, message, 1], ["EXPIRE", key, DAY_TTL, "NX"]], deps.fetch);
      return;
    } catch {
      /* fall through */
    }
  }
  bump(key, message, 1);
}

export interface StatsDay {
  date: string;
  counts: Record<string, number>;
  errors: Record<string, number>;
}

function toRecord(raw: unknown): Record<string, number> {
  // HGETALL over REST: a flat [field, value, field, value, …] list
  const out: Record<string, number> = {};
  if (Array.isArray(raw)) for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = Number(raw[i + 1]) || 0;
  return out;
}

/** The last `days` days, oldest first. */
export async function readStats(days: number, deps: CountDeps = {}): Promise<{ days: StatsDay[]; store: "shared" | "memory" }> {
  const now = deps.now ?? Date.now();
  const dates = Array.from({ length: days }, (_, i) => today(now - (days - 1 - i) * 86_400_000));
  if (kvConfig()) {
    try {
      const out = await pipeline(dates.flatMap((d) => [["HGETALL", dayKey(d)], ["HGETALL", errKey(d)]]), deps.fetch);
      return { store: "shared", days: dates.map((date, i) => ({ date, counts: toRecord(out[i * 2]), errors: toRecord(out[i * 2 + 1]) })) };
    } catch {
      /* fall through */
    }
  }
  const rec = (k: string) => Object.fromEntries(memory.get(k) ?? []);
  return { store: "memory", days: dates.map((date) => ({ date, counts: rec(dayKey(date)), errors: rec(errKey(date)) })) };
}

/** The bucket a finished build's time falls in. */
export function timeBucket(ms: number): "under_1m" | "1_2m" | "2_3m" | "3_4m" | "over_4m" {
  const m = ms / 60_000;
  return m < 1 ? "under_1m" : m < 2 ? "1_2m" : m < 3 ? "2_3m" : m < 4 ? "3_4m" : "over_4m";
}

/** The model family, for the model split. */
export function modelFamily(model: string): "haiku" | "sonnet" | "opus" | "other" {
  const m = model.toLowerCase();
  return m.includes("haiku") ? "haiku" : m.includes("sonnet") ? "sonnet" : m.includes("opus") ? "opus" : "other";
}
