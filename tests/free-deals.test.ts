// Free deals: the workshop's card picks on the site's key, FREE_DEALS a visitor a day, counted like
// free builds (browser, account, address, site) but separately and per day; a deal that shows no
// cards is given back; the tokens go into the same daily budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, ModelCaller } from "../lib/server/anthropic";
import { handleCoach, handleCoachStatus } from "../lib/server/coach-handler";
import { claimFreeBuild, freeConfig, freeDealsConfig, freeStatus, resetFreeBuilds, visitor, type Quota } from "../lib/server/free-builds";
import { resetRateLimits } from "../lib/server/ratelimit";
import type { CoachEvent } from "../lib/shared/coach";
import { installFakeScryfall } from "./fixtures";

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const keep = { ...process.env };
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DEMO_MODE", "FREE_BUILDS", "FREE_DEALS", "OWN_KEYS", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
  resetFreeBuilds();
  resetRateLimits();
  try {
    return await fn();
  } finally {
    process.env = keep;
  }
}

const DAY = 24 * 3600 * 1000;
const deals: Quota = { scope: "deal", perVisitor: 5, perIpPerDay: 15, perDay: 2000, tokensPerDay: 1e12, model: "claude-haiku-5-5" };
const req = (cookie = "", ip = "1.2.3.4") => new Request("http://x/api/coach", { headers: { cookie, "x-forwarded-for": ip } });

test("off unless the site has a key and FREE_DEALS; the address limit defaults to three visitors' worth", () =>
  withEnv({ FREE_DEALS: "5" }, async () => {
    assert.equal(freeDealsConfig(), null, "no site key");
    process.env.ANTHROPIC_API_KEY = "sk-ant-site";
    const c = freeDealsConfig()!;
    assert.deepEqual(c, { scope: "deal", perVisitor: 5, perIpPerDay: 15, perDay: 2000, tokensPerDay: 150_000_000, model: "claude-haiku-5-5" });
    assert.equal(freeConfig(), null, "free deals don't turn on free builds");
    process.env.DEMO_MODE = "1";
    assert.equal(freeDealsConfig(), null);
  }));

test("five a day, back the next day, and counted apart from free builds", () =>
  withEnv({}, async () => {
    const v = visitor(req(`hf_dev=${"d".repeat(24)}`));
    const now = Date.UTC(2026, 9, 31, 12);
    for (let i = 0; i < 5; i++) assert.ok((await claimFreeBuild(deals, v, { now })).ok);
    assert.deepEqual(await claimFreeBuild(deals, v, { now }), { ok: false, reason: "used" });
    assert.equal((await freeStatus(deals, v, { now })).remaining, 0);
    // free builds weren't touched
    const builds = { perVisitor: 3, perIpPerDay: 10, perDay: 300, tokensPerDay: 1e12, model: "claude-haiku-5-5" };
    assert.equal((await freeStatus(builds, v, { now })).remaining, 3);
    // tomorrow: five again
    assert.equal((await freeStatus(deals, v, { now: now + DAY })).remaining, 5);
    assert.ok((await claimFreeBuild(deals, v, { now: now + DAY })).ok);
  }));

let n = 0;
const offer = (names: string[]): AssistantMessage => ({ content: [{ type: "tool_use", id: `o${++n}`, name: "offer_cards", input: { cards: names.map((name) => ({ name, why: "fits" })) } }], stop_reason: "tool_use", usage: { input_tokens: 2000, output_tokens: 200 } });
const caller = (turns: AssistantMessage[]): ModelCaller => async () => turns.shift() ?? { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" };
const DEAL = { commander: "Meren of Clan Nel Toth", bracket: 3, cards: [{ name: "Sol Ring", qty: 1 }], slot: "draw", passed: [] };
const post = (cookie: string) => new Request("http://x/api/coach", { method: "POST", headers: { "content-type": "application/json", cookie, "x-forwarded-for": "5.6.7.8" }, body: JSON.stringify(DEAL) });
const events = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as CoachEvent);

test("without a key, a visitor gets FREE_DEALS a day on the site's key; a deal with no cards is given back", () =>
  withEnv({ ANTHROPIC_API_KEY: "sk-ant-site", FREE_DEALS: "2" }, async () => {
    const fake = installFakeScryfall();
    try {
      // the status call hands a new browser its id
      const first = await handleCoachStatus(req("", "5.6.7.8"));
      const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
      assert.match(cookie, /^hf_dev=/);
      assert.deepEqual(await first.json(), { enabled: true, limit: 2, used: 0, remaining: 2, model: "claude-haiku-5-5" });

      const ok = await handleCoach(post(cookie), { callModel: caller([offer(["Harmonize", "Phyrexian Arena", "Night's Whisper"])]) });
      assert.equal(ok.status, 200);
      assert.equal((await events(ok)).filter((e) => e.type === "pick").length, 3);
      assert.equal((await (await handleCoachStatus(req(cookie, "5.6.7.8"))).json()).remaining, 1);

      // Claude found nothing that passed the checks: it doesn't count
      const none = await handleCoach(post(cookie), { callModel: caller([offer(["Sol Ring"])]), timeBudgetMs: 6000 });
      assert.equal((await events(none)).filter((e) => e.type === "pick").length, 0);
      assert.equal((await (await handleCoachStatus(req(cookie, "5.6.7.8"))).json()).remaining, 1);

      await events(await handleCoach(post(cookie), { callModel: caller([offer(["Harmonize", "Phyrexian Arena", "Night's Whisper"])]) }));
      const refused = await handleCoach(post(cookie), { callModel: caller([]) });
      assert.equal(refused.status, 402);
      const j = await refused.json();
      assert.equal(j.code, "free_deals_used");
      assert.match(j.error, /today's 2 free deals/);
    } finally {
      fake.restore();
    }
  }));

test("a site without FREE_DEALS still needs the visitor's own key", () =>
  withEnv({ ANTHROPIC_API_KEY: "sk-ant-site" }, async () => {
    const r = await handleCoach(post(""));
    assert.equal(r.status, 402);
    assert.equal((await r.json()).code, "needs_key");
    assert.deepEqual(await (await handleCoachStatus(req())).json(), { enabled: false });
  }));
