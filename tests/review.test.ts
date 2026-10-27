// The free deck review (findings from the numbers), the uploaded-deck view and Claude's review cleanup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deckFindings } from "../lib/shared/findings";
import { cleanReview } from "../lib/server/agent";
import { asViewedDeck, readDeck } from "../lib/server/bracket-check";
import type { DeckAnalysis } from "../lib/shared/analysis";
import type { OpenerReport } from "../lib/shared/openers";
import { installFakeScryfall } from "./fixtures";
import { DEMO_SUBMISSION } from "../lib/server/demo";

const analysis = (over: Partial<DeckAnalysis> = {}): DeckAnalysis =>
  ({
    lands: 36,
    mdfcLands: 0,
    tappedLands: 3,
    counts: { ramp: 10, draw: 4, removal: 9, wipe: 2, protection: 2, recursion: 1, tutor: 1 },
    template: {
      lands: { have: 33, want: [35, 38] },
      ramp: { have: 10, want: [9, 12] },
      draw: { have: 4, want: [9, 12] },
      removal: { have: 9, want: [8, 12] },
      wipe: { have: 2, want: [2, 4] },
      protection: { have: 3, want: [2, 5] },
    },
    curve: [0, 8, 12, 14, 10, 8, 6, 5],
    avgMv: 3.7,
    colors: [{ color: "G", pips: 30, sources: 14, target: 19, hardest: "Lotus Cobra" }],
    staples: [],
    stapleShare: 0.2,
    priceEur: 100,
    budgetCapEur: null,
    price: 100,
    currency: "EUR",
    budgetCap: null,
    unverifiedTags: [],
    byCard: {},
    ...over,
  }) as DeckAnalysis;

test("the numbers: weak and strong points with reasons", () => {
  const openers = { keep7: 0.5, landDrop4: 0.5, flood: 0.1, commanders: [{ name: "Meren", mv: 4, onCurve: 0.7, oneLate: 0.9 }] } as unknown as OpenerReport;
  const f = deckFindings(analysis(), openers, { ok: false, errors: ["Deck has 99 cards (needs exactly 100)."], warnings: [] } as any, [{ cards: ["A", "B"], results: ["Infinite mana"] }]);
  const weak = f.weak.map((x) => `${x.topic}: ${x.text}`).join("\n");
  const strong = f.strong.map((x) => `${x.topic}: ${x.text}`).join("\n");
  assert.match(weak, /Deck check: Deck has 99 cards/);
  assert.match(weak, /Lands: 33, below the usual 35 to 38/);
  assert.match(weak, /Card draw: 4, below the usual 9 to 12/);
  assert.match(weak, /Curve: Heavy/);
  assert.match(weak, /Mana: 14 green sources; Lotus Cobra wants about 19/);
  assert.match(weak, /Opening hands: Keeps its first seven only 50%/);
  assert.match(strong, /Ramp: 10/);
  assert.match(strong, /Commander: Meren comes down on turn 4 in 70%/);
  assert.match(strong, /Identity: Mostly cards for this deck's plan/);
  assert.match(strong, /1 combo/);
  assert.equal(f.combos.length, 1);
});

test("Claude's review is cleaned: strings only, capped, synergies need two cards", () => {
  assert.equal(cleanReview(null), undefined);
  assert.equal(cleanReview({ strengths: [], weaknesses: [], synergies: [] }), undefined);
  const r = cleanReview({ strengths: ["Good", 3, ""], weaknesses: Array(9).fill("x"), synergies: [{ cards: ["A"], why: "one card" }, { cards: ["A", "B"], why: "two" }, { cards: ["A", "B"] }] })!;
  assert.deepEqual(r.strengths, ["Good"]);
  assert.equal(r.weaknesses.length, 5);
  assert.deepEqual(r.synergies, [{ cards: ["A", "B"], why: "two" }]);
});

test("an uploaded list shows like a built deck: roles read from the card text, a name, the bracket", async () => {
  const fake = installFakeScryfall();
  try {
    const list = ["Commander", "1 Meren of Clan Nel Toth", "", "Deck", ...DEMO_SUBMISSION.cards.map((c) => `1 ${c.name}`), ...Object.entries(DEMO_SUBMISSION.basics ?? {}).map(([n, q]) => `${q} ${n}`)].join("\n");
    const { report, deck, notFound } = await readDeck(list);
    const v = asViewedDeck(deck, report.bracket, notFound);
    assert.equal(v.deck.name, "Meren of Clan Nel Toth's deck");
    // (the fake cards all say "X does a thing", so only type lines tell roles apart here)
    assert.ok(v.deck.cards.some((c) => /Forest|Swamp/.test(c.name) && c.role === "land"), "basics are lands");
    assert.ok(v.deck.cards.every((c) => ["ramp", "draw", "removal", "wipe", "protection", "recursion", "synergy", "land", "utility"].includes(c.role)));
    assert.ok(!v.deck.cards.some((c) => c.role === "wincon"), "nothing is guessed as a win condition");
    assert.equal(v.deck.bracket, Math.min(4, report.bracket));
    assert.ok(Array.isArray(v.validation.errors));
  } finally {
    fake.restore();
  }
});

test("roles from real card text: ramp, draw, removal", async () => {
  const { asViewedDeck } = await import("../lib/server/bracket-check");
  const info = (name: string, typeLine: string, oracleText: string) => ({ name, typeLine, oracleText, manaCost: "{1}", cmc: 1, colorIdentity: [], priceEur: 1, priceUsd: 1, legalCommander: "legal", canBeCommander: false, gameChanger: false, image: null, artCrop: null, artist: null, scryfallUri: "", edhrecRank: 1, producedMana: [] }) as any;
  const deck = {
    name: "x",
    commander: { name: "Meren of Clan Nel Toth", qty: 1, role: "wincon", why: "Commander", info: info("Meren of Clan Nel Toth", "Legendary Creature — Human Shaman", "Whenever another creature you control dies, you get an experience counter.") },
    cards: [
      { name: "Sol Ring", qty: 1, role: "utility", why: "", info: info("Sol Ring", "Artifact", "{T}: Add {C}{C}.") },
      { name: "Night's Whisper", qty: 1, role: "utility", why: "", info: info("Night's Whisper", "Sorcery", "You draw two cards and you lose 2 life.") },
      { name: "Murder", qty: 1, role: "utility", why: "", info: info("Murder", "Instant", "Destroy target creature.") },
      { name: "Swamp", qty: 30, role: "utility", why: "", info: info("Swamp", "Basic Land — Swamp", "({T}: Add {B}.)") },
    ],
    strategy: "",
    winConditions: [],
    bracketNotes: "",
    colorIdentity: ["B", "G"],
  } as any;
  const roles = Object.fromEntries(asViewedDeck(deck, 3).deck.cards.map((c) => [c.name, c.role]));
  assert.deepEqual(roles, { "Sol Ring": "ramp", "Night's Whisper": "draw", Murder: "removal", Swamp: "land" });
});
