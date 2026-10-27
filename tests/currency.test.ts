// Prices in euros for Europe and dollars elsewhere: the country header, the budgets, the engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetCap, budgetHint, cardPrice, currencyForCountry, money } from "../lib/shared/currency";
import { publicConfig, visitorCurrency } from "../lib/server/config";
import { parseRequest } from "../lib/server/generate-handler";
import { userPrompt } from "../lib/server/prompt";
import { analyzeDeck } from "../lib/shared/analysis";
import { price } from "../lib/shared/deck-utils";
import { buyDeckLinks } from "../lib/shared/buy";
import type { CardInfo, Deck } from "../lib/shared/types";

test("Europe gets euros, everywhere else dollars, unknown stays unknown", () => {
  assert.equal(currencyForCountry("NL"), "EUR");
  assert.equal(currencyForCountry("gb"), "EUR");
  assert.equal(currencyForCountry("NO"), "EUR");
  assert.equal(currencyForCountry("US"), "USD");
  assert.equal(currencyForCountry("JP"), "USD");
  assert.equal(currencyForCountry(""), null);
  assert.equal(currencyForCountry("XX1"), null);
  const r = (h: Record<string, string>) => new Request("http://x/api/config", { headers: h });
  assert.equal(visitorCurrency(r({ "x-vercel-ip-country": "US" })), "USD");
  assert.equal(visitorCurrency(r({ "cf-ipcountry": "DE" })), "EUR");
  assert.equal(visitorCurrency(r({})), "EUR");
  assert.equal(publicConfig(r({ "x-vercel-ip-country": "CA" })).currency, "USD");
});

test("money and budgets", () => {
  assert.equal(money(1240.4, "USD"), "$1,240");
  assert.equal(money(0.35, "EUR", true), "€0.35");
  assert.equal(budgetHint("budget", "EUR"), "Under about €75");
  assert.equal(budgetHint("mid", "USD"), "Roughly $175–300");
  assert.equal(budgetCap("any", "USD"), null);
  assert.equal(cardPrice({ priceEur: 1, priceUsd: 2 }, "USD"), 2);
});

const info = (name: string, eur: number | null, usd: number | null): CardInfo =>
  ({ name, manaCost: "{1}", cmc: 1, typeLine: "Artifact", oracleText: "", colorIdentity: [], priceEur: eur, priceUsd: usd, legalCommander: "legal" }) as unknown as CardInfo;
const deck = {
  name: "Test",
  commander: { name: "Cmdr", qty: 1, role: "commander", info: info("Cmdr", 2, 3) },
  cards: [
    { name: "Sol Ring", qty: 1, role: "ramp", info: info("Sol Ring", 1.5, 1) },
    { name: "Rare Thing", qty: 1, role: "synergy", info: info("Rare Thing", null, 10) },
    { name: "Forest", qty: 30, role: "land", info: info("Forest", 0.1, 0.2) },
  ],
  colorIdentity: [],
} as unknown as Deck;

test("the deck's price in either currency, basics left out", () => {
  assert.deepEqual(price(deck, "EUR"), { total: 3.5, missing: 1 });
  assert.deepEqual(price(deck, "USD"), { total: 14, missing: 0 });
  const a = analyzeDeck(deck, { budget: "budget", currency: "USD" });
  assert.equal(a.currency, "USD");
  assert.equal(a.budgetCap, 100);
  assert.ok(a.price > 14, "the analysis counts basics too"); // 14 + 30 × 0.2
  assert.equal(a.budgetCapEur, 75, "the euro fields stay for the evals");
});

test("a dollar build asks for a dollar budget; euros stay the default", () => {
  const usd = parseRequest({ seeds: ["a", "b", "c", "d", "e"], commander: null, budget: "budget", currency: "USD" });
  const eur = parseRequest({ seeds: ["a", "b", "c", "d", "e"], commander: null, budget: "budget", currency: "GBP" });
  assert.ok(typeof usd !== "string" && usd.currency === "USD");
  assert.ok(typeof eur !== "string" && eur.currency === undefined);
  const seeds = ["a", "b", "c", "d", "e"].map((n) => info(n, 1, 1));
  assert.match(userPrompt(usd as any, seeds), /under ~\$100 total \(Scryfall USD prices \(TCGplayer\)/);
  assert.match(userPrompt(eur as any, seeds), /under ~€75 total \(Scryfall EUR prices \(Cardmarket\)/);
});

test("dollar visitors see the US shops first", () => {
  assert.deepEqual(buyDeckLinks(deck, {}, "USD").map((l) => l.shop), ["tcgplayer", "cardkingdom", "cardmarket"]);
  assert.deepEqual(buyDeckLinks(deck, {}, "EUR").map((l) => l.shop), ["cardmarket", "tcgplayer", "cardkingdom"]);
});
