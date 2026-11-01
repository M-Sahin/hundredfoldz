// The workshop's commander and partner pickers: only cards that can lead a deck, and only cards
// that can pair with the chosen commander (lib/server/commander-search.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCardInfo } from "../lib/server/scryfall";
import { LIMITS, resetRateLimits } from "../lib/server/ratelimit";
import { handleCommanderSearch, nameWords, partnerQuery, rankNames, suggest } from "../lib/server/commander-search";
import { canPair } from "../lib/shared/workshop";
import { fakeCard } from "./fixtures";

// synthetic cards, shaped like Scryfall's (not a source of truth)
const legend = (name: string, text = "", extra: Record<string, unknown> = {}) => fakeCard(name, { type_line: "Legendary Creature — Human", oracle_text: text, ...extra });
const background = (name: string) => fakeCard(name, { type_line: "Legendary Enchantment — Background", oracle_text: "Commander creatures you own have menace." });
const CARDS: Record<string, any> = {
  "Merry Plain": legend("Merry Plain", "Partner (You can have two commanders if both have partner.)"),
  "Tana Plain": legend("Tana Plain", "Partner"),
  "Ikra Plain": legend("Ikra Plain", "Partner"),
  "Pippin Paired": legend("Pippin Paired", "Partner with Merry Paired (When this creature enters, target player may put Merry Paired into their hand from their library.)"),
  "Merry Paired": legend("Merry Paired", "Partner with Pippin Paired"),
  "Kratos Group": legend("Kratos Group", "Partner—Father & son (You can have two commanders if both have this ability.)"),
  "Atreus Group": legend("Atreus Group", "Partner—Father & son"),
  "Cecily Friend": legend("Cecily Friend", "Friends forever (You can have two commanders if both have friends forever.)"),
  "Wernog Friend": legend("Wernog Friend", "Friends forever"),
  "Karlach Chooser": legend("Karlach Chooser", "Choose a Background (You can have a Background as a second commander.)"),
  "Folk Hero Bg": background("Folk Hero Bg"),
  "Noble Heritage Bg": background("Noble Heritage Bg"),
  "Rose Companion": legend("Rose Companion", "Doctor's companion (You can have two commanders if the other is the Doctor.)"),
  "The Tenth Doc": legend("The Tenth Doc", "Allons-y!", { type_line: "Legendary Creature — Time Lord Doctor" }),
  "Meren Loner": legend("Meren Loner", "At the beginning of your end step, return a creature."),
  "Merciless Banned": legend("Merciless Banned", "", { legalities: { commander: "banned" } }),
  "Mercenary Walker": fakeCard("Mercenary Walker", { type_line: "Legendary Planeswalker — Merc", oracle_text: "+1: Draw a card.\nMercenary Walker can be your commander." }),
  "Mermaid Ship": fakeCard("Mermaid Ship", { type_line: "Legendary Artifact — Vehicle", oracle_text: "Crew 3" }),
  "Ammerton Elder": legend("Ammerton Elder", "Vigilance"),
};
const info = (n: string) => toCardInfo(CARDS[n]);

/** A fake Scryfall: named lookups from CARDS, searches answered by `answer(q)` (card names). */
function fakeScryfall(answer: (q: string) => string[]) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    calls.push(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/cards/named") {
      const c = CARDS[url.searchParams.get("exact") ?? url.searchParams.get("fuzzy") ?? ""];
      return c ? json(c) : json({ object: "error", details: "not found" }, 404);
    }
    if (url.pathname === "/cards/search") {
      const names = answer(url.searchParams.get("q") ?? "");
      if (!names.length) return json({ object: "error", details: "Your query didn’t match any cards." }, 404);
      return json({ object: "list", total_cards: names.length, has_more: false, data: names.map((n) => CARDS[n]) });
    }
    return json({ object: "error", details: `no fixture for ${url}` }, 404);
  }) as typeof fetch;
  return { calls, searches: () => calls.filter((u) => u.includes("/cards/search")).map((u) => new URL(u).searchParams.get("q")), restore: () => (globalThis.fetch = original) };
}

test("typed names become Scryfall name words, never search syntax", () => {
  assert.equal(nameWords("Atraxa, Praetors' Voice"), "Atraxa Praetors' Voice");
  assert.equal(nameWords("  meren   of clan "), "meren of clan");
  assert.equal(nameWords('o:"draw" -t:land or (is:commander)'), "o draw t land is commander");
  assert.equal(nameWords("Lim-Dûl"), "Lim-Dûl");
  assert.equal(nameWords('""'), "");
});

test("names that start with what was typed come first, otherwise Scryfall's order", () => {
  assert.deepEqual(rankNames(["Cloud, Midgar Mercenary", "Ammerton Elder", "Meren of Clan Nel Toth"], "mer"), ["Meren of Clan Nel Toth", "Cloud, Midgar Mercenary", "Ammerton Elder"]);
  assert.deepEqual(rankNames(["B", "A"], ""), ["B", "A"]);
});

test("each pairing ability asks Scryfall for the cards it can pair with", () => {
  assert.equal(partnerQuery(info("Merry Plain")), "kw:partner");
  assert.equal(partnerQuery(info("Pippin Paired")), '!"Merry Paired"');
  assert.equal(partnerQuery(info("Kratos Group")), 'o:"Partner—Father & son"');
  assert.equal(partnerQuery(info("Cecily Friend")), 'o:"friends forever"');
  assert.equal(partnerQuery(info("Karlach Chooser")), "t:background");
  assert.equal(partnerQuery(info("Rose Companion")), '(t:"time lord" t:doctor)');
  assert.equal(partnerQuery(info("The Tenth Doc")), `o:"doctor's companion"`);
  assert.equal(partnerQuery(info("Meren Loner")), null);
  // the workshop offers "Add a partner" to every one of them, a Doctor included
  for (const n of ["Merry Plain", "Pippin Paired", "Kratos Group", "Cecily Friend", "Karlach Chooser", "Rose Companion", "The Tenth Doc"]) assert.ok(canPair(info(n)), n);
  assert.ok(!canPair(info("Meren Loner")));
});

test("the commander picker offers only cards that can lead a deck", async () => {
  const fake = fakeScryfall(() => ["Ammerton Elder", "Mermaid Ship", "Folk Hero Bg", "Merciless Banned", "Mercenary Walker", "Meren Loner"]);
  try {
    const r = await suggest({ q: "mer" });
    // a Background, a banned card and a Vehicle the deck check would refuse aren't offered
    assert.deepEqual(r.data, ["Mercenary Walker", "Meren Loner", "Ammerton Elder"]);
    assert.deepEqual(fake.searches(), ["is:commander f:commander mer"]);
    // one letter suggests nothing yet, and doesn't ask Scryfall
    assert.deepEqual((await suggest({ q: "m" })).data, []);
    assert.equal(fake.searches().length, 1);
  } finally {
    fake.restore();
  }
});

test("the partner picker offers only cards that can pair with the commander", async () => {
  // Scryfall's answer is a first cut; every card is checked the way a pick is checked
  const fake = fakeScryfall((q) =>
    q.startsWith("kw:partner")
      ? ["Merry Plain", "Tana Plain", "Pippin Paired", "Kratos Group", "Ikra Plain"]
      : q.startsWith("t:background")
        ? ["Folk Hero Bg", "Noble Heritage Bg", "Ammerton Elder"]
        : q.startsWith('!"Merry Paired"')
          ? ["Merry Paired"]
          : q.startsWith('o:"Partner—Father')
            ? ["Kratos Group", "Atreus Group"]
            : q.startsWith('(t:"time lord"')
              ? ["The Tenth Doc"]
              : [],
  );
  try {
    // plain Partner: other plain partners, not the commander itself, not "Partner with" or Partner—
    assert.deepEqual((await suggest({ q: "", with: "Merry Plain" })).data, ["Tana Plain", "Ikra Plain"]);
    // what's typed narrows it, and ranks by name
    assert.deepEqual((await suggest({ q: "ikra", with: "Merry Plain" })).data, ["Ikra Plain", "Tana Plain"]);
    assert.equal(fake.searches().at(-1), "kw:partner f:commander ikra");
    // Choose a Background: Backgrounds only
    assert.deepEqual((await suggest({ q: "", with: "Karlach Chooser" })).data, ["Folk Hero Bg", "Noble Heritage Bg"]);
    // Partner with: the one card
    assert.deepEqual((await suggest({ q: "", with: "Pippin Paired" })).data, ["Merry Paired"]);
    // a named Partner— ability: the other card with the same one
    assert.deepEqual((await suggest({ q: "", with: "Kratos Group" })).data, ["Atreus Group"]);
    // Doctor's companion: the Doctors
    assert.deepEqual((await suggest({ q: "", with: "Rose Companion" })).data, ["The Tenth Doc"]);
    // no pairing ability: nothing, without a search
    const before = fake.searches().length;
    assert.deepEqual((await suggest({ q: "x", with: "Meren Loner" })).data, []);
    assert.equal(fake.searches().length, before);
  } finally {
    fake.restore();
  }
});

test("the pickers' endpoint: names as JSON, an unknown commander is a 404, and it's rate limited", async () => {
  resetRateLimits();
  const fake = fakeScryfall((q) => (q.includes("tana") ? ["Tana Plain"] : []));
  try {
    const ok = await handleCommanderSearch(new Request("http://x/api/cards/commanders?with=Merry%20Plain&q=tana"));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { data: ["Tana Plain"] });
    assert.match(ok.headers.get("cache-control") ?? "", /s-maxage/);
    const none = await handleCommanderSearch(new Request("http://x/api/cards/commanders?q=zzzz"));
    assert.deepEqual(await none.json(), { data: [] });
    const unknown = await handleCommanderSearch(new Request("http://x/api/cards/commanders?with=Nobody%20Here"));
    assert.equal(unknown.status, 404);
    resetRateLimits();
    let last = 0;
    for (let i = 0; i < LIMITS.pickers.max; i++) last = (await handleCommanderSearch(new Request("http://x/api/cards/commanders?q=a"))).status;
    assert.equal(last, 200);
    assert.equal((await handleCommanderSearch(new Request("http://x/api/cards/commanders?q=a"))).status, 429);
  } finally {
    fake.restore();
    resetRateLimits();
  }
});
