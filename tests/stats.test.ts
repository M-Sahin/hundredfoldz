// Stats: daily counts only (no ids), a fixed list of browser events, and a page only admins can read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { count, countError, readStats, resetStats, timeBucket, modelFamily } from "../lib/server/stats";
import { handleStatsEvent, handleStatsRead } from "../lib/server/stats-handler";
import { cleanErrorMessage, isClientEvent } from "../lib/shared/stats-events";
import { breakdown, pct, sum, totals } from "../lib/shared/stats-summary";
import { handleGenerate } from "../lib/server/generate-handler";
import { resetRateLimits } from "../lib/server/ratelimit";
import { DEMO_SEEDS } from "../lib/server/demo";
import { installFakeScryfall } from "./fixtures";

const STORE_VARS = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
async function clean<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const keep = { ...process.env };
  for (const k of [...STORE_VARS, "ADMIN_EMAILS", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
  resetStats();
  resetRateLimits();
  try {
    return await fn();
  } finally {
    process.env = keep;
  }
}

const today = new Date().toISOString().slice(0, 10);

test("only listed browser events are accepted", () => {
  assert.ok(isClientEvent("export|moxfield"));
  assert.ok(isClientEvent("share_sheet"));
  assert.ok(isClientEvent("key_sheet|free_used"));
  assert.ok(!isClientEvent("build_ok|free"), "server events can't be sent by a browser");
  assert.ok(!isClientEvent("export|pdf"));
  assert.ok(!isClientEvent("share_sheet|x"));
  assert.ok(!isClientEvent("export|moxfield|extra"));
  assert.ok(!isClientEvent(42));
});

test("error messages lose anything personal", () => {
  const m = cleanErrorMessage("Failed for murat@example.com at https://hundredfoldz.app/d/x7Kp2QaZ1 with sk-ant-api03-abcdef, code 500 id 9f8e7d6c5b4a");
  assert.ok(!/murat|example\.com|hundredfoldz\.app|sk-ant|500|9f8e/.test(m), m);
  assert.ok(m.startsWith("Failed for <email> at <url> with <key>"), m);
  assert.equal(cleanErrorMessage("Cannot read properties of undefined (reading 'x')"), "Cannot read properties of undefined (reading 'x')");
  assert.ok(cleanErrorMessage("x".repeat(500)).length <= 80);
});

test("counts per day in memory without a store; totals, breakdowns and rates", () =>
  clean({}, async () => {
    await count(["build_start|free", "build_start|free", "build_ok|free", "build_fail_why|no_deck"]);
    await count("build_fail|free");
    await countError("Boom");
    const { days, store } = await readStats(7);
    assert.equal(store, "memory");
    assert.equal(days.length, 7);
    assert.equal(days.at(-1)!.date, today);
    assert.deepEqual(days.at(-1)!.counts, { "build_start|free": 2, "build_ok|free": 1, "build_fail_why|no_deck": 1, "build_fail|free": 1 });
    assert.deepEqual(days.at(-1)!.errors, { Boom: 1 });
    const t = totals(days);
    assert.equal(sum(t, "build_start"), 2);
    assert.deepEqual(breakdown(t, "build_fail_why"), [["no_deck", 1]]);
    assert.equal(pct(1, 2), 50);
    assert.equal(pct(1, 0), null);
    assert.equal(timeBucket(30_000), "under_1m");
    assert.equal(timeBucket(150_000), "2_3m");
    assert.equal(modelFamily("claude-haiku-5-5"), "haiku");
  }));

test("in the shared store: one hash per day, kept 400 days, read back with HGETALL", () =>
  clean({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }, async () => {
    const sent: unknown[][] = [];
    const hashes = new Map<string, Map<string, number>>();
    const f = (async (_u: string, init: RequestInit) => {
      const cmds = JSON.parse(String(init.body)) as (string | number)[][];
      sent.push(...cmds);
      return Response.json(
        cmds.map(([op, k, field, by]) => {
          const h = hashes.get(String(k)) ?? new Map();
          hashes.set(String(k), h);
          if (op === "HINCRBY") h.set(String(field), (h.get(String(field)) ?? 0) + Number(by));
          if (op === "HGETALL") return { result: [...h].flat() };
          return { result: 1 };
        }),
      );
    }) as unknown as typeof fetch;
    await count(["share_link", "share_link"], { fetch: f });
    assert.deepEqual(sent[0], ["HINCRBY", `hf:stats:${today}`, "share_link", 1]);
    assert.ok(sent.some(([op, , ttl, nx]) => op === "EXPIRE" && ttl === 400 * 86400 && nx === "NX"));
    const { days, store } = await readStats(2, { fetch: f });
    assert.equal(store, "shared");
    assert.equal(days[1].counts.share_link, 2);
    // the store down: counting falls back to memory instead of failing the request
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await count("share_link", { fetch: down });
  }));

test("POST /api/stats counts listed events and cleaned errors, refuses the rest", () =>
  clean({}, async () => {
    const post = (body: unknown) => handleStatsEvent(new Request("http://x/api/stats", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" }, body: JSON.stringify(body) }));
    assert.equal((await post({ e: "export|arena" })).status, 204);
    assert.equal((await post({ e: "build_ok|free" })).status, 400);
    assert.equal((await post({ e: "client_error", m: "Oops for someone@mail.com" })).status, 204);
    const { days } = await readStats(1);
    assert.equal(days[0].counts["export|arena"], 1);
    assert.equal(days[0].counts["build_ok|free"], undefined);
    assert.deepEqual(days[0].errors, { "Oops for <email>": 1 });
  }));

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (email: string) => `${b64({ alg: "HS256" })}.${b64({ role: "authenticated", sub: "u1", email, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const read = (cookie?: string) => new Request("https://site.example/api/stats?days=7", { headers: cookie ? { cookie } : {} });

test("GET /api/stats: only for admins, and the session is checked with Supabase", () =>
  clean({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon" }, async () => {
    // Supabase says who the token really belongs to
    const f = (async (url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get("authorization") ?? "";
      if (String(url).endsWith("/auth/v1/user")) {
        if (auth.includes(token("me@example.com"))) return Response.json({ id: "u1", email: "me@example.com" });
        return Response.json({ msg: "invalid JWT" }, { status: 401 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    await count("share_link");
    assert.equal((await handleStatsRead(read(`hf_at=${token("me@example.com")}`), { fetch: f })).status, 404, "no ADMIN_EMAILS: nobody");
    process.env.ADMIN_EMAILS = "Me@Example.com, other@example.com";
    assert.equal((await handleStatsRead(read(), { fetch: f })).status, 404, "logged out");
    // a made-up token naming an admin's email: Supabase doesn't accept it
    const forged = token("other@example.com");
    assert.equal((await handleStatsRead(read(`hf_at=${forged}`), { fetch: f })).status, 404, "forged session");
    const ok = await handleStatsRead(read(`hf_at=${token("me@example.com")}`), { fetch: f });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.days.length, 7);
    assert.equal(j.days.at(-1).counts.share_link, 1);
  }));

test("a build is counted when it starts and when it ends, with how long it took", () =>
  clean({}, async () => {
    const fake = installFakeScryfall();
    const keep = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await handleGenerate(new Request("http://x/api/generate", { method: "POST", body: JSON.stringify({ seeds: DEMO_SEEDS, commander: null, budget: "any" }) }), { demoSpeed: 0 });
      await res.text();
      const c = (await readStats(1)).days[0].counts;
      assert.equal(c["build_start|demo"], 1);
      assert.equal(c["build_mode|new"], 1);
      assert.equal(c["build_ok|demo"], 1);
      assert.equal(c["build_time|under_1m"], 1);
      assert.equal(c["build_model|other"], undefined, "no model for the demo");
    } finally {
      if (keep) process.env.ANTHROPIC_API_KEY = keep;
      fake.restore();
    }
  }));

test("a failed build is counted with its reason", () =>
  clean({}, async () => {
    const fake = installFakeScryfall();
    const keep = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { ModelError } = await import("../lib/server/anthropic");
      const callModel = async () => {
        throw new ModelError("Claude API 529: Overloaded", 529);
      };
      const res = await handleGenerate(new Request("http://x/api/generate", { method: "POST", body: JSON.stringify({ seeds: DEMO_SEEDS, commander: null, budget: "any" }) }), { callModel: callModel as any });
      await res.text();
      const c = (await readStats(1)).days[0].counts;
      assert.equal(c["build_fail|demo"], 1, JSON.stringify(c));
      assert.equal(c["build_fail_why|overloaded"], 1);
    } finally {
      if (keep) process.env.ANTHROPIC_API_KEY = keep;
      fake.restore();
    }
  }));
