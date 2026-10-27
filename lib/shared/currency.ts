// Prices in euros (Cardmarket trend) for Europe, in dollars (TCGplayer market) everywhere else.
// Both come from Scryfall with every card, so switching needs no extra lookups.
import type { Budget, CardInfo } from "./types";

export type Currency = "EUR" | "USD";
export const CURRENCIES: Currency[] = ["EUR", "USD"];

// Where Cardmarket is the usual shop: the EU, the rest of the EEA and the other European countries
const EUROPE = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH GB UK AD MC SM VA AL BA ME MK RS XK MD UA GI FO GG JE IM AX".split(" "),
);

/** The currency for a visitor's country (ISO code from the host's geo header), or null if unknown. */
export function currencyForCountry(country: string | null | undefined): Currency | null {
  const c = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return EUROPE.has(c) ? "EUR" : "USD";
}

export function isCurrency(x: unknown): x is Currency {
  return x === "EUR" || x === "USD";
}

/** A card's price in this currency (null when the shop has none for it). */
export function cardPrice(info: Pick<CardInfo, "priceEur" | "priceUsd"> | null | undefined, c: Currency): number | null {
  if (!info) return null;
  return c === "USD" ? info.priceUsd : info.priceEur;
}

const SYMBOL: Record<Currency, string> = { EUR: "€", USD: "$" };
export const symbol = (c: Currency) => SYMBOL[c];

/** "€12", "$1,240", or with cents: "€0.35". */
export function money(x: number, c: Currency, cents = false): string {
  const v = cents ? x.toFixed(2) : Math.round(x).toLocaleString("en");
  return `${SYMBOL[c]}${v}`;
}

/** Where the prices come from, for the small print. */
export const PRICE_SOURCE: Record<Currency, string> = {
  EUR: "Cardmarket trend prices",
  USD: "TCGplayer market prices",
};

/**
 * The budget options' totals and the most a single card should cost, per currency. Dollar budgets are
 * a little higher: TCGplayer prices run above Cardmarket's for most Commander staples.
 */
export const BUDGETS: Record<Currency, Record<Exclude<Budget, "any">, { lo?: number; hi: number; perCard: number }>> = {
  EUR: { mid: { lo: 150, hi: 250, perCard: 20 }, budget: { hi: 75, perCard: 3 } },
  USD: { mid: { lo: 175, hi: 300, perCard: 25 }, budget: { hi: 100, perCard: 4 } },
};

/** The total a budget allows, or null for no limit. */
export function budgetCap(b: Budget, c: Currency): number | null {
  return b === "any" ? null : BUDGETS[c][b].hi;
}

/** "Roughly €150–250", "Under about $100" (for the budget picker). */
export function budgetHint(b: Budget, c: Currency): string {
  if (b === "any") return "Best cards, whatever they cost";
  const x = BUDGETS[c][b];
  return x.lo != null ? `Roughly ${SYMBOL[c]}${x.lo}–${x.hi}` : `Under about ${SYMBOL[c]}${x.hi}`;
}
