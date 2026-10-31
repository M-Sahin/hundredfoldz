// Free builds: a few builds per visitor on this site's own Claude key, with a cheap model.
// On when ANTHROPIC_API_KEY and FREE_BUILDS (the number per visitor) are set. After that, visitors
// bring their own key. Stronger models always need the visitor's own key.
//
// A visitor is counted three ways, and every count has to be under its limit:
// - per browser: a random id in an httpOnly cookie (hf_dev), kept for a year;
// - per account, when logged in (so logging in on a new device doesn't reset the count);
// - per IP address per day (FREE_BUILDS_PER_IP_PER_DAY), so clearing cookies doesn't help much;
// and the whole site has a daily cap (FREE_BUILDS_PER_DAY) that bounds what free builds can cost.
//
// Free deals (the workshop's "Deal me 3" card picks) are counted the same way under their own
// keys (FREE_DEALS a visitor, per day rather than for good), and share the daily token budget.
// Keys are hashed, like the rate limits: the store never holds ids, user ids or addresses.
// A build that fails on our side is given back; a build the visitor stops is not.
import { kvConfig } from "./store";
import { COOKIE, cookie, isSecure, readCookies, tokenUser } from "./supabase";
import { clientIp } from "./ratelimit";
import { COACH_MODEL } from "../shared/coach";

export const DEVICE_COOKIE = "hf_dev";
const DEVICE_ID = /^[A-Za-z0-9_-]{22,64}$/;
const YEAR = 365 * 24 * 3600;
const DAY = 24 * 3600;

/** What's counted, and the limits. */
export interface Quota {
  /** "free": free builds, counted for good (the default); "deal": free card picks, counted per day */
  scope?: "free" | "deal";
  /** per visitor; 0 = off */
  perVisitor: number;
  perIpPerDay: number;
  perDay: number;
  /** tokens free builds and free deals may use per day, all visitors together (input, output and cache) */
  tokensPerDay: number;
  model: string;
}

export interface FreeConfig extends Quota {
  effort: string;
}

const tokensPerDay = () => Math.max(100_000, Number(process.env.FREE_TOKENS_PER_DAY) || 150_000_000);

export function freeConfig(): FreeConfig | null {
  if (!process.env.ANTHROPIC_API_KEY?.trim() || process.env.DEMO_MODE === "1") return null;
  const perVisitor = Math.max(0, Math.floor(Number(process.env.FREE_BUILDS) || 0));
  if (!perVisitor) return null;
  const effort = (process.env.FREE_EFFORT ?? "").trim();
  return {
    perVisitor,
    perIpPerDay: Math.max(1, Number(process.env.FREE_BUILDS_PER_IP_PER_DAY) || 10),
    perDay: Math.max(1, Number(process.env.FREE_BUILDS_PER_DAY) || 300),
    tokensPerDay: tokensPerDay(),
    model: process.env.FREE_MODEL?.trim() || "claude-haiku-5-5",
    effort: ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : "high",
  };
}

/** Free deals in the workshop: FREE_DEALS a visitor a day on the site's key (Claude Haiku). Off unless set. */
export function freeDealsConfig(): Quota | null {
  if (!process.env.ANTHROPIC_API_KEY?.trim() || process.env.DEMO_MODE === "1") return null;
  const perVisitor = Math.max(0, Math.floor(Number(process.env.FREE_DEALS) || 0));
  if (!perVisitor) return null;
  return {
    scope: "deal",
    perVisitor,
    perIpPerDay: Math.max(1, Number(process.env.FREE_DEALS_PER_IP_PER_DAY) || perVisitor * 3),
    perDay: Math.max(1, Number(process.env.FREE_DEALS_PER_DAY) || 2000),
    tokensPerDay: tokensPerDay(),
    model: COACH_MODEL,
  };
}

async function hash(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hf-free:${s}`)));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newDeviceId(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Who is asking: the browser id (new if there's none yet), the account if logged in, the address. */
export interface Visitor {
  device: string;
  /** Set-Cookie for a new browser id, to send back with the response */
  setCookie: string | null;
  user: string | null;
  ip: string;
}

export function visitor(request: Request): Visitor {
  const c = readCookies(request);
  let device = c[DEVICE_COOKIE] ?? "";
  let setCookie: string | null = null;
  if (!DEVICE_ID.test(device)) {
    device = newDeviceId();
    setCookie = cookie(DEVICE_COOKIE, device, YEAR, isSecure(request));
  }
  // the account's id from the session cookie, unverified: a forged one can only add a limit,
  // never lift one (the browser and address counts still apply)
  const token = c[COOKIE.access];
  const user = token ? (tokenUser(token)?.id ?? null) : null;
  return { device, setCookie, user, ip: clientIp(request) };
}

const dayNumber = (now: number) => Math.floor(now / 1000 / DAY);

async function counterKeys(v: Visitor, now: number, scope: Quota["scope"] = "free") {
  const day = dayNumber(now);
  // free builds count a visitor for good; free deals count them per day
  const per = scope === "deal" ? { p: `hf:deal`, mine: `${day}:`, ttl: 2 * DAY } : { p: "hf:free", mine: "", ttl: YEAR };
  const keys: { key: string; ttl: number; kind: "visitor" | "ip" | "site" }[] = [
    { key: `${per.p}:dev:${per.mine}${await hash(v.device)}`, ttl: per.ttl, kind: "visitor" },
    { key: `${per.p}:ip:${day}:${await hash(v.ip)}`, ttl: 2 * DAY, kind: "ip" },
    { key: `${per.p}:day:${day}`, ttl: 2 * DAY, kind: "site" },
  ];
  if (v.user) keys.push({ key: `${per.p}:user:${per.mine}${await hash(v.user)}`, ttl: per.ttl, kind: "visitor" });
  return keys;
}

// ---- storage: Upstash when configured, else this instance's memory ---------------------
const memory = new Map<string, { n: number; until: number }>();
export function resetFreeBuilds() {
  memory.clear();
}

type Fetch = typeof fetch;

async function pipeline(cmds: (string | number)[][], f: Fetch = fetch): Promise<unknown[]> {
  const kv = kvConfig()!;
  const res = await f(`${kv.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${kv.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(3000),
  });
  const j = (await res.json()) as { result?: unknown; error?: string }[];
  if (!res.ok || !Array.isArray(j)) throw new Error(`HTTP ${res.status}`);
  return j.map((x) => x?.result);
}

async function read(keys: string[], now: number, f?: Fetch): Promise<number[]> {
  if (kvConfig()) {
    try {
      return (await pipeline(keys.map((k) => ["GET", k]), f)).map((x) => Number(x) || 0);
    } catch {
      /* fall through to memory */
    }
  }
  return keys.map((k) => {
    const m = memory.get(k);
    return m && m.until > now ? m.n : 0;
  });
}

async function add(items: { key: string; ttl: number }[], by: 1 | -1, now: number, f?: Fetch): Promise<number[]> {
  if (kvConfig()) {
    try {
      // EXPIRE … NX: the first build starts the clock; later ones don't extend it
      const cmds = items.flatMap(({ key, ttl }) => [[by === 1 ? "INCR" : "DECR", key], ["EXPIRE", key, ttl, "NX"]]);
      const out = await pipeline(cmds, f);
      return items.map((_, i) => Number(out[i * 2]) || 0);
    } catch (e) {
      console.warn(`free build store unavailable, counting per instance: ${(e as Error).message}`);
    }
  }
  return items.map(({ key, ttl }) => {
    const m = memory.get(key);
    const live = m && m.until > now ? m : { n: 0, until: now + ttl * 1000 };
    live.n = Math.max(0, live.n + by);
    memory.set(key, live);
    if (memory.size > 20000) memory.delete(memory.keys().next().value as string);
    return live.n;
  });
}

// ---- the public API --------------------------------------------------------------------

export interface FreeStatus {
  limit: number;
  used: number;
  remaining: number;
  model: string;
  /** why there are none left right now, when it isn't this visitor's own count */
  blocked?: "ip" | "site";
}

/** How many free builds (or today's free deals) this visitor has left (doesn't count anything). */
export async function freeStatus(cfg: Quota, v: Visitor, deps: { now?: number; fetch?: Fetch } = {}): Promise<FreeStatus> {
  const now = deps.now ?? Date.now();
  const keys = await counterKeys(v, now, cfg.scope);
  const counts = await read(keys.map((k) => k.key), now, deps.fetch);
  const used = Math.max(0, ...counts.filter((_, i) => keys[i].kind === "visitor"));
  const ip = counts[keys.findIndex((k) => k.kind === "ip")];
  const site = counts[keys.findIndex((k) => k.kind === "site")];
  const remaining = Math.max(0, cfg.perVisitor - used);
  const [tokens] = await read([tokenKey(now)], now, deps.fetch);
  const blocked = remaining > 0 ? (site >= cfg.perDay || tokens >= cfg.tokensPerDay ? "site" : ip >= cfg.perIpPerDay ? "ip" : undefined) : undefined;
  return { limit: cfg.perVisitor, used: Math.min(used, cfg.perVisitor), remaining: blocked ? 0 : remaining, model: cfg.model, ...(blocked ? { blocked } : {}) };
}

export type Claim = { ok: true; remaining: number; refund: () => Promise<void> } | { ok: false; reason: "used" | "ip" | "site" };

const tokenKey = (now: number) => `hf:free:tok:${dayNumber(now)}`;

/** Add what a free build used to today's total (the daily token budget). */
export async function spendFreeTokens(n: number, deps: { now?: number; fetch?: Fetch } = {}): Promise<void> {
  const now = deps.now ?? Date.now();
  if (!(n > 0)) return;
  if (kvConfig()) {
    try {
      await pipeline([["INCRBY", tokenKey(now), Math.round(n)], ["EXPIRE", tokenKey(now), 2 * DAY, "NX"]], deps.fetch);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  const m = memory.get(tokenKey(now));
  memory.set(tokenKey(now), { n: (m && m.until > now ? m.n : 0) + Math.round(n), until: m && m.until > now ? m.until : now + 2 * DAY * 1000 });
}

/**
 * Count one free build, if every limit allows it. `refund` gives the visitor's build back when it
 * failed; the address and site-wide counts stay, so failing builds on purpose can't run up the bill.
 */
export async function claimFreeBuild(cfg: Quota, v: Visitor, deps: { now?: number; fetch?: Fetch } = {}): Promise<Claim> {
  const now = deps.now ?? Date.now();
  // the daily token budget: once today's free builds and deals have used it, there are none left today
  const [tokens] = await read([tokenKey(now)], now, deps.fetch);
  if (tokens >= cfg.tokensPerDay) return { ok: false, reason: "site" };
  const keys = await counterKeys(v, now, cfg.scope);
  const counts = await add(keys, 1, now, deps.fetch);
  const over = (i: number) => {
    const k = keys[i].kind;
    return counts[i] > (k === "visitor" ? cfg.perVisitor : k === "ip" ? cfg.perIpPerDay : cfg.perDay);
  };
  const bad = keys.findIndex((_, i) => over(i));
  if (bad >= 0) {
    await add(keys, -1, now, deps.fetch); // nothing was used: put every count back
    const k = keys[bad].kind;
    return { ok: false, reason: k === "visitor" ? "used" : k };
  }
  const used = Math.max(...counts.filter((_, i) => keys[i].kind === "visitor"));
  let refunded = false;
  return {
    ok: true,
    remaining: Math.max(0, cfg.perVisitor - used),
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await add(
        keys.filter((k) => k.kind === "visitor"),
        -1,
        now,
        deps.fetch,
      ).catch(() => {});
    },
  };
}

export function dealRefusal(reason: "used" | "ip" | "site", cfg: Quota): string {
  if (reason === "used") return `You've used today's ${cfg.perVisitor === 1 ? "free deal" : `${cfg.perVisitor} free deals`}. Add your own Claude API key for more, or come back tomorrow.`;
  if (reason === "ip") return "Free deals from your network are used up for today. Add your own Claude API key, or try again tomorrow.";
  return "Today's free deals are all used up. Add your own Claude API key, or try again tomorrow.";
}

export function freeRefusal(reason: "used" | "ip" | "site", cfg: Quota): string {
  if (reason === "used") return `You've used your ${cfg.perVisitor === 1 ? "free build" : `${cfg.perVisitor} free builds`}. Add your own Claude API key to keep building.`;
  if (reason === "ip") return "Free builds from your network are used up for today. Add your own Claude API key, or try again tomorrow.";
  return "Today's free builds are all used up. Add your own Claude API key, or try again tomorrow.";
}
