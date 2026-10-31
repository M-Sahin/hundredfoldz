// The workshop's card picks ("Deal me 3"): the request, the coach loop with a scripted Claude, and
// the endpoint. Every pick must pass the server's checks before the player sees it.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, MessageParams, ModelCaller } from "../lib/server/anthropic";
import { coachPrompt, runCoach } from "../lib/server/coach";
import { handleCoach } from "../lib/server/coach-handler";
import { toCardInfo } from "../lib/server/scryfall";
import { parseCoachRequest, type CoachEvent, type CoachRequest } from "../lib/shared/coach";
import { setCommander, EMPTY_WORKSHOP } from "../lib/shared/workshop";
import { installFakeScryfall, lookupFake } from "./fixtures";

const REQ: CoachRequest = {
  commander: "Meren of Clan Nel Toth",
  bracket: 3,
  cards: [
    { name: "Sol Ring", qty: 1 },
    { name: "Sakura-Tribe Elder", qty: 1 },
    { name: "Swamp", qty: 10 },
  ],
  slot: "draw",
  passed: ["Grim Haruspex"],
  steer: "cheaper",
};

let n = 0;
const use = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
const reply = (...content: AssistantMessage["content"]): AssistantMessage => ({ content, stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 5000 } });

/** A scripted Claude: one answer per call, and the requests it saw. */
function scripted(turns: AssistantMessage[]) {
  const seen: MessageParams[] = [];
  const call: ModelCaller = async (params) => {
    seen.push(JSON.parse(JSON.stringify(params)));
    const next = turns.shift();
    if (!next) throw new Error("no more scripted turns");
    return next;
  };
  return { call, seen };
}
const lastResult = (p: MessageParams) => {
  const m = p.messages[p.messages.length - 1];
  return (m.content as any[]).map((b) => (b.type === "tool_result" ? b.content : b.text)).join("\n");
};

test("coach requests are checked and trimmed", () => {
  assert.equal(parseCoachRequest({ slot: "draw", cards: [] }), "Pick a commander first.");
  assert.equal(parseCoachRequest({ commander: "Meren", slot: "constructor", cards: [] }), "Pick what the cards are for.");
  assert.match(parseCoachRequest({ commander: "Meren", slot: "draw", cards: new Array(121).fill({ name: "Forest" }) }) as string, /at most 120/);
  const r = parseCoachRequest({ commander: " Meren ", slot: "wincon", bracket: 9, cards: [{ name: "Swamp", qty: 500 }, { name: "" }], passed: ["A", ""], steer: "  no   creatures  " });
  assert.deepEqual(r, { commander: "Meren", partner: null, bracket: 3, cards: [{ name: "Swamp", qty: 99 }], slot: "wincon", passed: ["A"], steer: "no creatures" });
});

test("the prompt carries the deck, the slot, what was passed on and the steer line", () => {
  const ws = { ...setCommander(EMPTY_WORKSHOP, toCardInfo(lookupFake("Meren of Clan Nel Toth"))), cards: [{ name: "Sol Ring", role: "ramp" as const, why: "", qty: 1, info: toCardInfo(lookupFake("Sol Ring")) }] };
  const p = coachPrompt(REQ, ws);
  assert.match(p, /Commander: Meren of Clan Nel Toth/);
  assert.match(p, /- Ramp: Sol Ring/);
  assert.match(p, /Deal them 3 cards for: card draw and card advantage\. Search with id<=bg f:commander\./);
  assert.match(p, /passed on these already; don't offer them again: Grim Haruspex/);
  assert.match(p, /What they asked for: "cheaper"/);
  assert.match(p, /at most 3 Game Changers; the deck has 0/);
});

test("picks that fail the checks are sent back, the good ones stream out, and it stops at three", async () => {
  const fake = installFakeScryfall();
  try {
    const { call, seen } = scripted([
      reply(use("search_cards", { query: "id<=bg f:commander otag:card-advantage" })),
      reply(
        use("offer_cards", {
          cards: [
            { name: "Harmonize", why: "Three cards for four mana." },
            { name: "Sol Ring", why: "Already there." },
            { name: "Lightning Bolt", why: "Off color." },
          ],
        }),
      ),
      reply(
        use("offer_cards", {
          cards: [
            { name: "Grim Haruspex", why: "Passed on before." },
            { name: "Phyrexian Arena", why: "A card every turn." },
          ],
        }),
      ),
      reply(use("offer_cards", { cards: [{ name: "Demonic Tutor", why: "Finds anything." }] })),
    ]);
    const events: CoachEvent[] = [];
    const picks = await runCoach(REQ, { model: "claude-haiku-5-5", callModel: call, emit: (e) => events.push(e) });
    assert.deepEqual(
      picks.map((p) => p.card.name),
      ["Harmonize", "Phyrexian Arena", "Demonic Tutor"],
    );
    assert.deepEqual(
      events.filter((e) => e.type === "pick").map((e) => (e as { card: { name: string } }).card.name),
      ["Harmonize", "Phyrexian Arena", "Demonic Tutor"],
    );
    assert.equal(seen.length, 4); // no call after the third pick
    assert.match(lastResult(seen[2]), /Sol Ring: Sol Ring is already in the deck/);
    assert.match(lastResult(seen[2]), /Lightning Bolt: Lightning Bolt is red, outside/);
    assert.match(lastResult(seen[2]), /Offer 2 more cards/);
    assert.match(lastResult(seen[3]), /Grim Haruspex: already offered or passed on/);
    // searches become plain-words status lines; usage is reported once at the end
    assert.ok(events.some((e) => e.type === "status" && /^Searching Scryfall for/.test(e.text)));
    const usage = events.filter((e) => e.type === "usage");
    assert.equal(usage.length, 1);
    assert.equal((usage[0] as { usage: { calls: number } }).usage.calls, 4);
    // the skill is the cached system prompt
    assert.match(JSON.stringify(seen[0].system), /mtg-master/);
    assert.equal((seen[0].system as any[])[0].cache_control.type, "ephemeral");
  } finally {
    fake.restore();
  }
});

test("a Game Changer the bracket has no room for isn't shown", async () => {
  const fake = installFakeScryfall();
  try {
    const { call, seen } = scripted([reply(use("offer_cards", { cards: [{ name: "Demonic Tutor", why: "x" }] })), { content: [{ type: "text", text: "That's all." }], stop_reason: "end_turn" }]);
    const picks = await runCoach({ ...REQ, bracket: 2 }, { model: "m", callModel: call, emit: () => {}, maxTurns: 2 });
    assert.equal(picks.length, 0);
    assert.match(lastResult(seen[1]), /a Game Changer, and Bracket 2 has no room/);
  } finally {
    fake.restore();
  }
});

test("lookups are capped; a full deck gets no picks", async () => {
  const fake = installFakeScryfall();
  try {
    const search = () => reply(use("search_cards", { query: "id<=bg f:commander" }));
    const { call, seen } = scripted([search(), search(), search(), search(), reply(use("offer_cards", { cards: [{ name: "Harmonize", why: "x" }] }))]);
    await runCoach(REQ, { model: "m", callModel: call, emit: () => {}, maxTurns: 5 });
    assert.match(lastResult(seen[4]), /No more lookups/);
    const events: CoachEvent[] = [];
    const full = { ...REQ, cards: [{ name: "Swamp", qty: 99 }] };
    assert.equal((await runCoach(full, { model: "m", callModel: scripted([]).call, emit: (e) => events.push(e) })).length, 0);
    assert.ok(events.some((e) => e.type === "error" && /has 100 cards/.test(e.message)));
  } finally {
    fake.restore();
  }
});

test("the endpoint needs the visitor's own key, and streams the deal as NDJSON", async () => {
  const fake = installFakeScryfall();
  try {
    const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/coach", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const none = await handleCoach(post(REQ));
    assert.equal(none.status, 402);
    assert.equal((await none.json()).code, "needs_key");
    assert.equal((await handleCoach(post(REQ, { "x-anthropic-key": "not-a-key" }))).status, 400);
    const { call } = scripted([reply(use("offer_cards", { cards: [{ name: "Harmonize", why: "a" }, { name: "Phyrexian Arena", why: "b" }, { name: "Night's Whisper", why: "c" }] }))]);
    const bad = await handleCoach(post({ ...REQ, slot: "nope" }), { callModel: call });
    assert.equal(bad.status, 400);
    const res = await handleCoach(post(REQ), { callModel: call });
    assert.equal(res.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as CoachEvent);
    assert.deepEqual(
      lines.filter((e) => e.type === "pick").map((e) => (e as { card: { name: string } }).card.name),
      ["Harmonize", "Phyrexian Arena", "Night's Whisper"],
    );
    assert.deepEqual(lines[lines.length - 1], { ...lines[lines.length - 1], type: "done", picks: 3 });
  } finally {
    fake.restore();
  }
});
