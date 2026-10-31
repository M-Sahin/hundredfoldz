// The deck workshop: building a deck card by card, its checks and coach notes, and its card search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCardInfo } from "../lib/server/scryfall";
import { handleCardSearch, readParams, searchQuery } from "../lib/server/card-search";
import { analyzeDeck, guessRole } from "../lib/shared/analysis";
import { validateDeck } from "../lib/shared/validate";
import {
  EMPTY_WORKSHOP,
  addCard,
  canAdd,
  canPair,
  claudeStep,
  coachNotes,
  deckChecks,
  fillBasics,
  fromDeck,
  landCount,
  partnerProblem,
  removeOne,
  sameCards,
  setCommander,
  setRole,
  toDeck,
  withInfo,
  workshopIdentity,
  workshopTotal,
  type WorkshopDeck,
} from "../lib/shared/workshop";
import type { CardInfo } from "../lib/shared/types";
import { fakeCard, installFakeScryfall, lookupFake } from "./fixtures";

const card = (name: string, extra: Record<string, unknown> = {}): CardInfo => toCardInfo(Object.keys(extra).length ? fakeCard(name, extra) : lookupFake(name));
const meren = card("Meren of Clan Nel Toth");
const withMeren = (): WorkshopDeck => setCommander(EMPTY_WORKSHOP, meren);
const many = (ws: WorkshopDeck, names: string[]) => names.reduce((w, n) => addCard(w, card(n)), ws);
const OWN = ["Sakura-Tribe Elder", "Cultivate", "Kodama's Reach", "Golgari Signet", "Sol Ring", "Putrefy", "Assassin's Trophy", "Eternal Witness"];

test("a commander sets the colors; cards outside them, banned cards and second copies are refused", () => {
  assert.equal(canAdd(EMPTY_WORKSHOP, card("Sol Ring")), "Pick a commander first.");
  const ws = withMeren();
  assert.deepEqual(workshopIdentity(ws), ["B", "G"]);
  assert.equal(canAdd(ws, card("Sol Ring")), null);
  assert.match(canAdd(ws, card("Lightning Bolt"))!, /red, outside Meren of Clan Nel Toth's colors/);
  assert.match(canAdd(ws, card("Mana Crypt"))!, /banned/);
  assert.match(canAdd(ws, meren)!, /is your commander/);
  const one = addCard(ws, card("Sol Ring"));
  assert.match(canAdd(one, card("Sol Ring"))!, /already in the deck/);
  // basics and "any number of cards named" stack up
  const rats = addCard(addCard(one, card("Relentless Rats")), card("Relentless Rats"));
  assert.equal(rats.cards.find((c) => c.name === "Relentless Rats")?.qty, 2);
  const swamps = addCard(addCard(one, card("Swamp")), card("Swamp"));
  assert.equal(swamps.cards.find((c) => c.name === "Swamp")?.qty, 2);
  assert.equal(workshopTotal(swamps), 4);
  assert.equal(removeOne(swamps, "Swamp").cards.find((c) => c.name === "Swamp")?.qty, 1);
  assert.equal(removeOne(one, "Sol Ring").cards.length, 0);
});

test("a full deck takes no more cards", () => {
  let ws = addCard(withMeren(), card("Forest"));
  ws = { ...ws, cards: ws.cards.map((c) => ({ ...c, qty: 99 })) };
  assert.equal(workshopTotal(ws), 100);
  assert.match(canAdd(ws, card("Sol Ring"))!, /has 100 cards/);
  assert.equal(claudeStep(ws).kind, "upgrade");
  assert.match(claudeStep(ws).problem!, /at least 30 different cards/);
});

test("roles come from the card's text, and the player can change them", () => {
  assert.equal(guessRole(card("Forest")), "land");
  assert.equal(guessRole(card("Cultivate", { oracle_text: "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", type_line: "Sorcery" })), "ramp");
  const ws = addCard(withMeren(), card("Sol Ring"));
  assert.equal(setRole(ws, "Sol Ring", "ramp").cards[0].role, "ramp");
});

test("a new commander leaves the 99, and a partner that can't pair goes", () => {
  const ws = addCard(withMeren(), card("Sol Ring"));
  const krenko = card("Krenko, Mob Boss", { color_identity: ["R"], type_line: "Legendary Creature — Goblin Warrior" });
  const moved = setCommander(addCard(ws, card("Fiend Artisan")), card("Fiend Artisan"));
  assert.equal(moved.commander?.name, "Fiend Artisan");
  assert.ok(!moved.cards.some((c) => c.name === "Fiend Artisan"));
  assert.ok(!canPair(meren));
  const tymna = card("Tymna the Weaver", { color_identity: ["W", "B"], type_line: "Legendary Creature — Human Cleric", oracle_text: "Partner" });
  const thrasios = card("Thrasios, Triton Hero", { color_identity: ["G", "U"], type_line: "Legendary Creature — Merfolk Wizard", oracle_text: "Partner" });
  const pair = { ...setCommander(EMPTY_WORKSHOP, tymna), partner: thrasios };
  assert.ok(canPair(tymna));
  assert.equal(partnerProblem(setCommander(EMPTY_WORKSHOP, tymna), thrasios), null);
  assert.deepEqual(workshopIdentity(pair), ["W", "U", "B", "G"]);
  assert.match(partnerProblem(setCommander(EMPTY_WORKSHOP, tymna), krenko)!, /can't be paired/);
  assert.equal(setCommander(pair, krenko).partner, null);
});

test("an unfinished deck's only problem isn't its size; the coach says what's short", () => {
  const ws = many(withMeren(), OWN);
  const deck = toDeck(ws);
  const v = validateDeck(deck, [], [], { bracket: ws.bracket });
  assert.ok(v.errors.every((e) => /^Deck has 9 cards/.test(e)));
  const checks = deckChecks(analyzeDeck(deck));
  assert.deepEqual(
    checks.map((c) => c.key),
    ["lands", "ramp", "draw", "removal", "wipe", "protection"],
  );
  assert.ok(checks.every((c) => c.status === "short"));
  const notes = coachNotes(ws, v, checks);
  assert.equal(notes[0].tone, "good");
  assert.match(notes[0].text, /fits Meren of Clan Nel Toth's colors \(black and green\)/);
  assert.equal(notes.filter((n) => n.tone === "warn").length, 2);
  assert.ok(notes.some((n) => /0 of the 3 Game Changers Bracket 3 allows/.test(n.text)));
});

test("problems in the deck come first, in the deck check's words", () => {
  const ws = { ...withMeren(), cards: [{ name: "Lightning Bolt", role: "removal" as const, why: "", qty: 1, info: card("Lightning Bolt") }] };
  const v = validateDeck(toDeck(ws), [], [], { bracket: 3 });
  const notes = coachNotes(ws, v, []);
  assert.equal(notes[0].tone, "bad");
  assert.match(notes[0].text, /Lightning Bolt \(R\) is outside the commander's color identity/);
});

test("basic lands fill up to 36 lands, split across the colors, never past 100", () => {
  // green spells too, so both colors need sources (the fixtures' spells all cost {1}{B})
  const green = { mana_cost: "{1}{G}", cmc: 2, color_identity: ["G"] };
  const ws = addCard(addCard(many(withMeren(), OWN), card("Rampant Growth", green)), card("Nature's Lore", green));
  const r = fillBasics(ws);
  assert.equal(r.added, 36);
  assert.equal(landCount(r.ws), 36);
  const basics = r.ws.cards.filter((c) => c.name === "Swamp" || c.name === "Forest");
  assert.equal(basics.length, 2);
  assert.equal(basics.reduce((n, c) => n + c.qty, 0), 36);
  // the basics had no Scryfall data yet
  assert.deepEqual(r.missing.sort(), ["Forest", "Swamp"]);
  const filled = withInfo(r.ws, [card("Swamp"), card("Forest")]);
  assert.ok(filled.cards.every((c) => c.info));
  assert.equal(fillBasics(filled).added, 0);
  // close to 100: only what fits
  const big = { ...withMeren(), cards: [{ name: "Relentless Rats", role: "synergy" as const, why: "", qty: 95, info: card("Relentless Rats") }] };
  assert.equal(fillBasics(big).added, 4);
});

test("Claude can finish an unfinished deck once it has a card, or review a full one", () => {
  assert.match(claudeStep(EMPTY_WORKSHOP).problem!, /Pick a commander/);
  assert.match(claudeStep(withMeren()).problem!, /Add a card or two/);
  assert.deepEqual(claudeStep(many(withMeren(), ["Sol Ring"])), { kind: "complete", problem: null });
});

test("a saved deck opens for editing with its name, bracket and cards", () => {
  const ws = { ...many(withMeren(), OWN), name: "Graveyard party", bracket: 2 };
  const back = fromDeck(toDeck(ws));
  assert.equal(back.name, "Graveyard party");
  assert.equal(back.bracket, 2);
  assert.equal(back.commander?.name, meren.name);
  assert.equal(back.cards.length, OWN.length);
  // a deck still named after its commander keeps following it
  assert.equal(fromDeck(toDeck({ ...ws, name: "" })).name, "");
  // opening the deck that's already in the workshop isn't replacing it
  assert.ok(sameCards(back, ws));
  assert.ok(!sameCards(back, removeOne(ws, "Sol Ring")));
});

test("search queries stay in the commander's colors and Commander-legal", () => {
  assert.equal(searchQuery({ q: "dies or sacrifice", colors: ["B", "G"], slot: "draw", type: "creature", mv: "0-2" }), "(dies or sacrifice) id<=bg f:commander otag:card-advantage -t:land t:creature mv<=2");
  assert.equal(searchQuery({ colors: [] }), "id:c f:commander");
  // plain words look in rules text and type lines too, not only names
  assert.equal(searchQuery({ q: "creature dies", colors: ["B"] }), '(creature dies or o:"creature dies" or t:"creature dies") id<=b f:commander');
  assert.equal(searchQuery({ q: "t:goblin -t:creature", colors: ["R"] }), "(t:goblin -t:creature) id<=r f:commander");
  const p = readParams(new URL("http://x/api/cards/search?q=elf&id=gbx&slot=constructor&type=goblin&mv=9"));
  assert.deepEqual(p, { q: "elf", colors: ["G", "B"], slot: undefined, type: undefined, mv: undefined });
});

test("the search endpoint asks Scryfall with the filters, and no matches is an empty list", async () => {
  const fake = installFakeScryfall();
  try {
    const empty = await handleCardSearch(new Request("http://x/api/cards/search?id=bg"));
    assert.equal(empty.status, 400);
    const r = await handleCardSearch(new Request("http://x/api/cards/search?id=bg&slot=removal"));
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(
      j.cards.map((c: CardInfo) => c.name),
      ["Blood Artist", "Zulaport Cutthroat"],
    );
    const sent = new URL(fake.calls.find((u) => u.includes("/cards/search"))!).searchParams.get("q");
    assert.equal(sent, "id<=bg f:commander otag:removal -otag:board-wipe -t:land");
    const none = await (await handleCardSearch(new Request("http://x/api/cards/search?id=bg&q=nothingmatches"))).json();
    assert.deepEqual(none, { total: 0, cards: [] });
  } finally {
    fake.restore();
  }
});
