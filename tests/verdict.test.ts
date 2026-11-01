// "Is this card good here?": Claude judges one card in the workshop deck in two lines, and may name
// a better card for the same job. The better card is checked like a pick (Scryfall, legal, colors,
// not in the deck, Game Changers) as if it took the card's place. A verdict costs one free deal.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, MessageParams, ModelCaller } from "../lib/server/anthropic";
import { runVerdict, verdictPrompt } from "../lib/server/coach";
import { handleCoach, handleCoachStatus } from "../lib/server/coach-handler";
import { resetFreeBuilds } from "../lib/server/free-builds";
import { resetRateLimits } from "../lib/server/ratelimit";
import { toCardInfo } from "../lib/server/scryfall";
import { parseVerdictRequest, type CardVerdict, type CoachEvent, type VerdictRequest } from "../lib/shared/coach";
import { EMPTY_WORKSHOP, setCommander } from "../lib/shared/workshop";
import { installFakeScryfall, lookupFake } from "./fixtures";

const REQ: VerdictRequest = {
  mode: "verdict",
  commander: "Meren of Clan Nel Toth",
  bracket: 3,
  cards: [
    { name: "Sol Ring", qty: 1 },
    { name: "Llanowar Elves", qty: 1 },
    { name: "Swamp", qty: 10 },
  ],
  card: "Llanowar Elves",
};

let n = 0;
const judge = (input: unknown): AssistantMessage => ({ content: [{ type: "tool_use", id: `v${++n}`, name: "judge_card", input }], stop_reason: "tool_use", usage: { input_tokens: 1500, output_tokens: 120 } });
function scripted(turns: AssistantMessage[]) {
  const seen: MessageParams[] = [];
  const call: ModelCaller = async (params) => {
    seen.push(JSON.parse(JSON.stringify(params)));
    return turns.shift() ?? { content: [{ type: "text", text: "Hmm." }], stop_reason: "end_turn" };
  };
  return { call, seen };
}
const lastResult = (p: MessageParams) => {
  const m = p.messages[p.messages.length - 1];
  return (m.content as any[]).map((b) => (b.type === "tool_result" ? b.content : b.text)).join("\n");
};
const LINES = ["Ramp on turn one, so Meren lands a turn early.", "It's a small body late, but it feeds Meren's sacrifices."];

test("verdict requests name the card", () => {
  assert.equal(parseVerdictRequest({ commander: "Meren", cards: [] }), "Pick a card to ask about.");
  assert.equal(parseVerdictRequest({ card: "Sol Ring", cards: [] }), "Pick a commander first.");
  assert.deepEqual(parseVerdictRequest({ mode: "verdict", commander: "Meren", cards: [], card: " Sol Ring " }), { mode: "verdict", commander: "Meren", partner: null, bracket: 3, cards: [], card: "Sol Ring" });
});

test("the prompt says whether the card is in the deck, with its full text", () => {
  const meren = setCommander(EMPTY_WORKSHOP, toCardInfo(lookupFake("Meren of Clan Nel Toth")));
  const elves = toCardInfo(lookupFake("Llanowar Elves"));
  const ws = { ...meren, cards: [{ name: "Llanowar Elves", role: "ramp" as const, why: "", qty: 1, info: elves }] };
  assert.match(verdictPrompt(ws, elves), /is Llanowar Elves good in it\?[\s\S]*It's in the deck: Llanowar Elves[\s\S]*Answer with judge_card/);
  assert.match(verdictPrompt(meren, elves), /They're thinking of adding it/);
});

test("a better card that fails the checks goes back once; the verdict comes with the one that passes", async () => {
  const fake = installFakeScryfall();
  try {
    const { call, seen } = scripted([
      judge({ fit: "fine", lines: LINES, better: { name: "Lightning Bolt", why: "Off color." } }),
      judge({ fit: "fine", lines: LINES, better: { name: "Sakura-Tribe Elder", why: "Ramps and sacrifices itself for Meren." } }),
    ]);
    const events: CoachEvent[] = [];
    const v = await runVerdict(REQ, { model: "claude-haiku-5-5", callModel: call, emit: (e) => events.push(e) });
    assert.equal(v?.card, "Llanowar Elves");
    assert.equal(v?.fit, "fine");
    assert.deepEqual(v?.lines, LINES);
    assert.equal(v?.better?.card.name, "Sakura-Tribe Elder");
    assert.equal(v?.better?.why, "Ramps and sacrifices itself for Meren.");
    assert.equal(seen.length, 2);
    assert.match(lastResult(seen[1]), /Couldn't show Lightning Bolt: Lightning Bolt is red, outside/);
    // one verdict event, shown once it's final
    assert.equal(events.filter((e) => e.type === "verdict").length, 1);
    assert.match(JSON.stringify(seen[0].system), /judge_card/);
  } finally {
    fake.restore();
  }
});

test("no better card, or two that fail: the verdict goes out without one", async () => {
  const fake = installFakeScryfall();
  try {
    const plain = await runVerdict(REQ, { model: "m", callModel: scripted([judge({ fit: "great", lines: LINES })]).call, emit: () => {} });
    assert.deepEqual(plain, { card: "Llanowar Elves", fit: "great", lines: LINES });
    // already in the deck, then the card itself: both turned down, and the lines still show
    const { call, seen } = scripted([judge({ fit: "weak", lines: LINES, better: { name: "Sol Ring", why: "x" } }), judge({ fit: "weak", lines: LINES, better: { name: "Llanowar Elves", why: "x" } })]);
    const v = await runVerdict(REQ, { model: "m", callModel: call, emit: () => {} });
    assert.deepEqual(v, { card: "Llanowar Elves", fit: "weak", lines: LINES });
    assert.match(lastResult(seen[1]), /Couldn't show Sol Ring: Sol Ring is already in the deck/);
    assert.equal(seen.length, 2);
    // a lines string with a line break is two lines; an unknown fit is "fine"
    const s = await runVerdict(REQ, { model: "m", callModel: scripted([judge({ fit: "superb", lines: "One.\nTwo." })]).call, emit: () => {} });
    assert.deepEqual(s, { card: "Llanowar Elves", fit: "fine", lines: ["One.", "Two."] });
  } finally {
    fake.restore();
  }
});

test("a full deck can still swap: the better card takes the judged card's place", async () => {
  const fake = installFakeScryfall();
  try {
    const full = { ...REQ, cards: [...REQ.cards.filter((c) => c.name !== "Swamp"), { name: "Swamp", qty: 97 }] };
    const v = await runVerdict(full, { model: "m", callModel: scripted([judge({ fit: "fine", lines: LINES, better: { name: "Sakura-Tribe Elder", why: "y" } })]).call, emit: () => {} });
    assert.equal(v?.better?.card.name, "Sakura-Tribe Elder");
  } finally {
    fake.restore();
  }
});

test("the commander and unknown cards get no verdict", async () => {
  const fake = installFakeScryfall();
  try {
    const events: CoachEvent[] = [];
    assert.equal(await runVerdict({ ...REQ, card: "Meren of Clan Nel Toth" }, { model: "m", callModel: scripted([]).call, emit: (e) => events.push(e) }), null);
    assert.ok(events.some((e) => e.type === "error" && /is your commander/.test(e.message)));
    assert.equal(await runVerdict({ ...REQ, card: "Not A Real Card" }, { model: "m", callModel: scripted([]).call, emit: (e) => events.push(e) }), null);
    assert.ok(events.some((e) => e.type === "error" && /Couldn't find Not A Real Card/.test(e.message)));
  } finally {
    fake.restore();
  }
});

const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/coach", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7", ...headers }, body: JSON.stringify(body) });
const lines = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as CoachEvent);

test("the endpoint streams a verdict; a free one costs a deal, given back when nothing was shown", async () => {
  const keep = { ...process.env };
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DEMO_MODE", "FREE_BUILDS", "FREE_DEALS", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  resetFreeBuilds();
  resetRateLimits();
  const fake = installFakeScryfall();
  try {
    assert.equal((await handleCoach(post(REQ))).status, 402);
    assert.equal((await handleCoach(post({ ...REQ, card: "" }), { callModel: scripted([]).call })).status, 400);
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-site", FREE_DEALS: "3" });
    const status = () => new Request("http://x/api/coach", { headers: { cookie, "x-forwarded-for": "7.7.7.7" } });
    let cookie = "";
    cookie = ((await handleCoachStatus(status())).headers.get("set-cookie") ?? "").split(";")[0];
    const ok = await handleCoach(post(REQ, { cookie }), { callModel: scripted([judge({ fit: "fine", lines: LINES })]).call });
    const ev = await lines(ok);
    const v = ev.find((e) => e.type === "verdict") as { verdict: CardVerdict } | undefined;
    assert.deepEqual(v?.verdict.lines, LINES);
    assert.deepEqual(ev[ev.length - 1], { ...ev[ev.length - 1], type: "done", picks: 1 });
    const left = async () => (await (await handleCoachStatus(status())).json()).remaining;
    assert.equal(await left(), 2);
    // Claude never answered with judge_card: nothing shown, the deal is given back
    const none = await handleCoach(post(REQ, { cookie }), { callModel: scripted([]).call, timeBudgetMs: 6000 });
    assert.equal((await lines(none)).filter((e) => e.type === "verdict").length, 0);
    assert.equal(await left(), 2);
  } finally {
    fake.restore();
    process.env = keep;
  }
});
