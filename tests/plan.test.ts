// The workshop's deck plan: Claude names 3 to 5 themes, each with a Scryfall search; the server runs
// every search in the commander's colors and keeps only themes that find cards. A plan costs one
// free deal, and is kept with the deck in progress until the commander changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, MessageParams, ModelCaller } from "../lib/server/anthropic";
import { coachPrompt, planPrompt, runPlan, themeQuery } from "../lib/server/coach";
import { handleCoach, handleCoachStatus } from "../lib/server/coach-handler";
import { resetFreeBuilds } from "../lib/server/free-builds";
import { resetRateLimits } from "../lib/server/ratelimit";
import { toCardInfo } from "../lib/server/scryfall";
import { parseCoachRequest, parsePlanRequest, pickSlots, readPlan, type CoachEvent, type DeckPlan, type PlanRequest, type PlanTheme } from "../lib/shared/coach";
import { EMPTY_WORKSHOP, currentPlan, setCommander, setPartner } from "../lib/shared/workshop";
import { fakeCard, installFakeScryfall, lookupFake } from "./fixtures";

const REQ: PlanRequest = { mode: "plan", commander: "Meren of Clan Nel Toth", bracket: 3, cards: [{ name: "Sol Ring", qty: 1 }] };

/** The fake Scryfall, with searches that find as many cards as the query says ("few" finds 2, "nothingmatches" none). */
function fakeScryfall() {
  const fake = installFakeScryfall();
  const inner = globalThis.fetch;
  const searches: string[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/cards/search")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      searches.push(q);
      if (!q.includes("few") && !q.includes("nothingmatches") && !q.includes("bad syntax")) {
        const data = ["Blood Artist", "Zulaport Cutthroat", "Viscera Seer", "Carrion Feeder", "Yawgmoth, Thran Physician", "Pitiless Plunderer"].map((n) => fakeCard(n));
        return new Response(JSON.stringify({ object: "list", total_cards: 140, data }), { headers: { "content-type": "application/json" } });
      }
      if (q.includes("bad syntax")) return new Response(JSON.stringify({ object: "error", details: "All of your terms were ignored." }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return inner(input, init);
  }) as typeof fetch;
  return { searches, restore: fake.restore };
}

let n = 0;
const use = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `p${++n}`, name, input });
const reply = (...content: AssistantMessage["content"]): AssistantMessage => ({ content, stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100 } });
function scripted(turns: AssistantMessage[]) {
  const seen: MessageParams[] = [];
  const call: ModelCaller = async (params) => {
    seen.push(JSON.parse(JSON.stringify(params)));
    return turns.shift() ?? { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" };
  };
  return { call, seen };
}
const lastResult = (p: MessageParams) => {
  const m = p.messages[p.messages.length - 1];
  return (m.content as any[]).map((b) => (b.type === "tool_result" ? b.content : b.text)).join("\n");
};
const theme = (name: string, query: string) => ({ name, why: `${name} fits Meren.`, query });

test("plan requests carry the deck; stored plans are read back carefully", () => {
  assert.equal(parsePlanRequest({ cards: [] }), "Pick a commander first.");
  assert.deepEqual(parsePlanRequest({ mode: "plan", commander: " Meren ", bracket: 2, cards: [{ name: "Sol Ring", qty: 3 }] }), { mode: "plan", commander: "Meren", partner: null, bracket: 2, cards: [{ name: "Sol Ring", qty: 3 }] });
  assert.equal(readPlan(null), null);
  assert.equal(readPlan({ commander: "Meren", themes: [{ name: "", query: "x" }] }), null);
  assert.deepEqual(readPlan({ commander: "Meren", themes: [{ name: "Tokens", query: "o:token", why: "w", total: "12" }, { bogus: 1 }] }), { commander: "Meren", partner: null, themes: [{ name: "Tokens", why: "w", query: "o:token", total: 12 }] });
});

test("a theme's search loses its own color and format filters (the workshop's search adds them)", () => {
  assert.equal(themeQuery('id<=bg f:commander o:"creature dies" -format:modern legal:commander'), 'o:"creature dies"');
  assert.equal(themeQuery("otag:sacrifice-outlet t:creature ci:bg"), "otag:sacrifice-outlet t:creature");
});

test("the plan prompt asks for themes with searches for this commander", () => {
  const ws = setCommander(EMPTY_WORKSHOP, toCardInfo(lookupFake("Meren of Clan Nel Toth")));
  const p = planPrompt(ws);
  assert.match(p, /Commander: Meren of Clan Nel Toth/);
  assert.match(p, /No cards in the deck yet/);
  assert.match(p, /Sketch 3 to 5 themes for Meren of Clan Nel Toth\..*id<=bg f:commander\)\. Answer with plan_deck\./);
});

test("themes whose search finds no cards (or too few, or repeats one) go back; the good ones stream out", async () => {
  const fake = fakeScryfall();
  try {
    const { call, seen } = scripted([
      reply(use("search_cards", { query: "id<=bg f:commander otag:sacrifice-outlet" })),
      reply(
        use("plan_deck", {
          themes: [
            theme("Sacrifice for value", "id<=bg f:commander otag:sacrifice-outlet"),
            theme("Nothing", "o:nothingmatches"),
            theme("Too narrow", 'o:"few"'),
            theme("Same search", "otag:sacrifice-outlet"),
            theme("Broken", "bad syntax"),
          ],
        }),
      ),
      reply(use("plan_deck", { themes: [theme("Graveyard loops", 'o:"return target creature card from your graveyard"'), theme("Death triggers", 'o:"whenever another creature you control dies"')] })),
    ]);
    const events: CoachEvent[] = [];
    const themes = await runPlan(REQ, { model: "claude-haiku-5-5", callModel: call, emit: (e) => events.push(e) });
    assert.deepEqual(
      themes.map((t) => [t.name, t.query, t.total]),
      [
        ["Sacrifice for value", "otag:sacrifice-outlet", 140],
        ["Graveyard loops", 'o:"return target creature card from your graveyard"', 140],
        ["Death triggers", 'o:"whenever another creature you control dies"', 140],
      ],
    );
    assert.deepEqual(
      events.filter((e) => e.type === "theme").map((e) => (e as { theme: PlanTheme }).theme.name),
      ["Sacrifice for value", "Graveyard loops", "Death triggers"],
    );
    assert.equal(seen.length, 3, "no call after three good themes");
    const back = lastResult(seen[2]);
    assert.match(back, /Nothing: its search finds no cards in the commander's colors/);
    assert.match(back, /Too narrow: its search finds only 2 cards; a theme needs at least 5/);
    assert.match(back, /Same search: another theme has that search/);
    assert.match(back, /Broken: Scryfall couldn't read the search/);
    assert.match(back, /Give 2 more themes/);
    // every theme was checked the way the workshop's search runs it: in Meren's colors, Commander-legal
    const checks = fake.searches.filter((q) => !q.startsWith("id<=bg f:commander otag"));
    assert.ok(checks.length >= 5);
    for (const q of checks) assert.match(q, /^\(.+\) id<=bg f:commander$/);
    // plans and picks share the cached system prompt and the tools
    assert.match(JSON.stringify(seen[0].system), /plan_deck/);
    assert.deepEqual(
      (seen[0].tools as any[]).map((t) => t.name),
      ["search_cards", "get_cards", "offer_cards", "plan_deck", "judge_card"],
    );
  } finally {
    fake.restore();
  }
});

test("five good themes end the plan at once; offering cards instead is turned away", async () => {
  const fake = fakeScryfall();
  try {
    const five = ["Tokens", "Sacrifice", "Recursion", "Counters", "Lifedrain"].map((t) => theme(t, `o:${t.toLowerCase()}`));
    const { call, seen } = scripted([reply(use("offer_cards", { cards: [{ name: "Sol Ring", why: "x" }] })), reply(use("plan_deck", { themes: [...five, theme("Sixth", "o:sixth")] }))]);
    const themes = await runPlan(REQ, { model: "m", callModel: call, emit: () => {} });
    assert.equal(themes.length, 5);
    assert.equal(seen.length, 2);
    assert.match(lastResult(seen[1]), /Not now: answer with plan_deck/);
  } finally {
    fake.restore();
  }
});

const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/coach", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers }, body: JSON.stringify(body) });
const lines = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as CoachEvent);

test("the endpoint streams a plan as NDJSON, and a free plan costs one deal (given back when it shows nothing)", async () => {
  const keep = { ...process.env };
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DEMO_MODE", "FREE_BUILDS", "FREE_DEALS", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  resetFreeBuilds();
  resetRateLimits();
  const fake = fakeScryfall();
  try {
    // no key, no free deals: a plan needs the visitor's key, like card picks
    const none = await handleCoach(post(REQ));
    assert.equal(none.status, 402);
    assert.equal((await none.json()).code, "needs_key");
    assert.equal((await handleCoach(post({ mode: "plan", cards: [] }), { callModel: scripted([]).call })).status, 400);

    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-site", FREE_DEALS: "2" });
    const first = await handleCoachStatus(new Request("http://x/api/coach", { headers: { "x-forwarded-for": "9.9.9.9" } }));
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
    const three = [theme("Tokens", "o:token"), theme("Sacrifice", "otag:sacrifice-outlet"), theme("Recursion", "otag:reanimate")];
    const ok = await handleCoach(post(REQ, { cookie }), { callModel: scripted([reply(use("plan_deck", { themes: three }))]).call });
    assert.equal(ok.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    const ev = await lines(ok);
    assert.deepEqual(
      ev.filter((e) => e.type === "theme").map((e) => (e as { theme: PlanTheme }).theme.name),
      ["Tokens", "Sacrifice", "Recursion"],
    );
    assert.deepEqual(ev[ev.length - 1], { ...ev[ev.length - 1], type: "done", picks: 3 });
    const left = async () => (await (await handleCoachStatus(new Request("http://x/api/coach", { headers: { cookie, "x-forwarded-for": "9.9.9.9" } }))).json()).remaining;
    assert.equal(await left(), 1);

    // nothing passed the checks: the deal is given back
    const empty = await handleCoach(post(REQ, { cookie }), { callModel: scripted([reply(use("plan_deck", { themes: [theme("Nothing", "o:nothingmatches")] }))]).call, timeBudgetMs: 6000 });
    assert.equal((await lines(empty)).filter((e) => e.type === "theme").length, 0);
    assert.equal(await left(), 1);
  } finally {
    fake.restore();
    process.env = keep;
  }
});

const PLAN: DeckPlan = { commander: "Meren of Clan Nel Toth", partner: null, themes: [{ name: "Sacrifice", why: "w", query: "otag:sacrifice-outlet", total: 140 }] };

test("the plan stays with the deck until the commanders change", () => {
  const meren = toCardInfo(lookupFake("Meren of Clan Nel Toth"));
  const ws = { ...setCommander(EMPTY_WORKSHOP, meren), plan: PLAN };
  assert.equal(currentPlan(ws), PLAN);
  assert.equal(setCommander(ws, meren).plan, PLAN, "the same commander picked again keeps it");
  const other = setCommander(ws, toCardInfo(lookupFake("Mazirek, Kraul Death Priest")));
  assert.equal(other.plan, null);
  assert.equal(currentPlan(other), null);
  // a plan for another commander (an old draft) isn't used
  assert.equal(currentPlan({ ...other, plan: PLAN }), null);
  assert.equal(setPartner(ws, toCardInfo(lookupFake("Tymna the Weaver"))).plan, null);
  assert.equal(setPartner(ws, null).plan, PLAN, "no partner before, none after");
});

test("Deal me 3 deals for the plan's themes instead of plain synergy", () => {
  const checks = [
    { key: "draw", label: "Card draw", have: 2, want: [9, 12] as const, status: "short" },
    { key: "ramp", label: "Ramp", have: 10, want: [10, 12] as const, status: "ok" },
  ];
  assert.deepEqual(
    pickSlots(checks).map((s) => s.key),
    ["draw", "synergy", "wincon"],
  );
  const t = pickSlots(checks, PLAN.themes);
  assert.deepEqual(
    t.map((s) => s.key),
    ["draw", "theme:Sacrifice", "wincon"],
  );
  assert.deepEqual(t[1], { key: "theme:Sacrifice", slot: "synergy", label: "Sacrifice", note: "Theme: Sacrifice", theme: PLAN.themes[0] });
});

test("a deal for a theme tells Claude the theme and its search", () => {
  const r = parseCoachRequest({ commander: "Meren of Clan Nel Toth", slot: "synergy", cards: [], theme: { name: "  Sacrifice  ", query: "otag:sacrifice-outlet" } });
  assert.ok(typeof r === "object");
  assert.deepEqual(r.theme, { name: "Sacrifice", query: "otag:sacrifice-outlet" });
  assert.equal((parseCoachRequest({ commander: "Meren", slot: "synergy", cards: [], theme: { name: "x" } }) as { theme?: unknown }).theme, undefined);
  const ws = setCommander(EMPTY_WORKSHOP, toCardInfo(lookupFake("Meren of Clan Nel Toth")));
  assert.match(coachPrompt(r, ws), /Deal them 3 cards for the deck's theme "Sacrifice"\. A search that finds cards for it: otag:sacrifice-outlet id<=bg f:commander\./);
});
