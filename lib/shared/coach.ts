// The workshop's Claude help, on /api/coach: what the browser asks for and what comes back.
// - card picks ("Deal me 3"): Claude offers three cards for one slot of the deck (or one theme of
//   its plan); the server checks each before it's shown.
// - a deck plan: 3 to 5 themes for the commander, each with a Scryfall search the server has run
//   and found cards with. The themes become search chips and Deal me 3 targets.
// - a card verdict ("Is this card good here?"): two lines on one card in this deck, and a better
//   card for the job when there is one, checked like a pick before it's shown.
import type { CardInfo, Usage } from "./types";

export const COACH_SLOTS = {
  synergy: { label: "Synergy", ask: "cards that make the commander's plan work" },
  ramp: { label: "Ramp", ask: "ramp: mana rocks, land ramp or mana creatures" },
  draw: { label: "Card draw", ask: "card draw and card advantage" },
  removal: { label: "Removal", ask: "targeted removal and interaction" },
  wipe: { label: "Board wipes", ask: "board wipes" },
  protection: { label: "Protection", ask: "protection for the commander and the key pieces" },
  recursion: { label: "Recursion", ask: "recursion: getting cards back from the graveyard" },
  wincon: { label: "Win conditions", ask: "ways to win the game" },
  land: { label: "Lands", ask: "nonbasic lands that fix the colors or do something useful" },
} as const;
export type CoachSlot = keyof typeof COACH_SLOTS;

/** Claude Haiku: picks need speed more than depth (and cost the visitor a fraction of a cent). */
export const COACH_MODEL = "claude-haiku-5-5";
export const PICKS = 3;
/** A plan has 3 to 5 themes. */
export const PLAN_THEMES = { min: 3, max: 5 } as const;
/** A theme's search must find at least this many cards in the commander's colors. */
export const MIN_THEME_CARDS = 5;

/** The deck as the workshop sends it, for every kind of help. */
export interface CoachDeck {
  commander: string;
  partner?: string | null;
  bracket: number;
  /** The cards besides the commanders, as they are in the workshop. */
  cards: { name: string; qty: number }[];
}

export interface CoachRequest extends CoachDeck {
  slot: CoachSlot;
  /** Cards the player passed on in earlier deals: never offered again. */
  passed: string[];
  /** "cheaper", "no creatures", "under 3 mana": the optional Steer it line. */
  steer?: string;
  /** Deal for one theme of the deck's plan instead of a slot (the slot is then "synergy"). */
  theme?: { name: string; query: string };
}

export interface PlanRequest extends CoachDeck {
  mode: "plan";
}

export interface VerdictRequest extends CoachDeck {
  mode: "verdict";
  /** the card asked about: in the deck, or one the player is thinking of adding */
  card: string;
}

/** How well a card fits, in plain words. */
export const FITS = { great: "Great here", fine: "Fine here", weak: "Weak here" } as const;
export type Fit = keyof typeof FITS;

/** Claude's verdict on one card in this deck. */
export interface CardVerdict {
  card: string;
  fit: Fit;
  /** two short lines: what the card does for this deck, and the catch */
  lines: string[];
  /** a better card for the same job, checked on Scryfall and against the deck */
  better?: { card: CardInfo; why: string };
}

/** One theme of a deck plan. */
export interface PlanTheme {
  /** "Sacrifice for value": a few plain words */
  name: string;
  /** one line on why it fits the commander */
  why: string;
  /** the Scryfall search for it, without the color and format filters (the workshop's search adds them) */
  query: string;
  /** how many cards the search found when the server checked it */
  total: number;
}

/** Claude's plan for a workshop deck, kept with the deck in progress. */
export interface DeckPlan {
  commander: string;
  partner?: string | null;
  themes: PlanTheme[];
}

export type CoachEvent =
  | { type: "status"; text: string }
  | { type: "pick"; card: CardInfo; why: string }
  | { type: "theme"; theme: PlanTheme }
  | { type: "verdict"; verdict: CardVerdict }
  | { type: "usage"; usage: Usage; model: string }
  | { type: "error"; message: string; code?: string }
  /** `picks`: how many cards (or themes, or verdicts) were shown */
  | { type: "done"; ms: number; picks: number };

const name = (v: unknown) => String(v ?? "").trim().slice(0, 150);
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The deck part of any request, or why it can't be used. */
function parseDeck(body: any): CoachDeck | string {
  if (!body || typeof body !== "object") return "Invalid request.";
  const commander = name(body.commander);
  if (!commander) return "Pick a commander first.";
  if (!Array.isArray(body.cards) || body.cards.length > 120) return "Send the deck's cards (at most 120 entries).";
  const cards = body.cards
    .map((c: any) => ({ name: name(c?.name), qty: Math.max(1, Math.min(99, Math.round(Number(c?.qty) || 1))) }))
    .filter((c: { name: string }) => c.name);
  return {
    commander,
    partner: body.partner ? name(body.partner) : null,
    bracket: ([1, 2, 3, 4] as const).find((b) => b === Number(body.bracket)) ?? 3,
    cards,
  };
}

/** A card-picks request, or why it can't be used. */
export function parseCoachRequest(body: any): CoachRequest | string {
  if (!body || typeof body !== "object") return "Invalid request.";
  if (!name(body.commander)) return "Pick a commander first.";
  if (!Object.hasOwn(COACH_SLOTS, body.slot)) return "Pick what the cards are for.";
  const deck = parseDeck(body);
  if (typeof deck === "string") return deck;
  const { commander, partner, bracket, cards } = deck;
  const passed = (Array.isArray(body.passed) ? body.passed : []).map(name).filter(Boolean).slice(0, 60);
  const steer = line(body.steer, 160);
  const theme = { name: line(body.theme?.name, 40), query: line(body.theme?.query, 200) };
  return {
    commander,
    partner,
    bracket,
    cards,
    slot: body.slot as CoachSlot,
    passed,
    ...(steer ? { steer } : {}),
    ...(theme.name && theme.query ? { theme } : {}),
  };
}

/** A deck-plan request, or why it can't be used. */
export function parsePlanRequest(body: any): PlanRequest | string {
  const deck = parseDeck(body);
  return typeof deck === "string" ? deck : { mode: "plan", ...deck };
}

/** A card-verdict request, or why it can't be used. */
export function parseVerdictRequest(body: any): VerdictRequest | string {
  const deck = parseDeck(body);
  if (typeof deck === "string") return deck;
  const card = name(body.card);
  return card ? { mode: "verdict", ...deck, card } : "Pick a card to ask about.";
}

/** A plan read back from storage, or null when it isn't one. */
export function readPlan(v: unknown): DeckPlan | null {
  const p = v as DeckPlan | null;
  if (!p || typeof p !== "object" || typeof p.commander !== "string" || !Array.isArray(p.themes)) return null;
  const themes = p.themes.filter((t) => t && typeof t.name === "string" && typeof t.query === "string" && t.name && t.query).slice(0, PLAN_THEMES.max);
  return themes.length ? { commander: p.commander, partner: typeof p.partner === "string" ? p.partner : null, themes: themes.map((t) => ({ name: t.name, why: String(t.why ?? ""), query: t.query, total: Number(t.total) || 0 })) } : null;
}

// ---- what Deal me 3 can deal for -------------------------------------------

export interface PickTarget {
  /** "draw", or "theme:Sacrifice for value" */
  key: string;
  slot: CoachSlot;
  label: string;
  note?: string;
  theme?: PlanTheme;
}

/** The slots to offer, the deck's biggest gaps first, then the plan's themes (or synergy), then win conditions. */
export function pickSlots(checks: { key: string; label: string; have: number; want: readonly [number, number]; status: string }[], themes: PlanTheme[] = []): PickTarget[] {
  const toSlot: Record<string, CoachSlot> = { lands: "land", ramp: "ramp", draw: "draw", removal: "removal", wipe: "wipe", protection: "protection" };
  const short = checks
    .filter((c) => c.status === "short")
    .sort((a, b) => (b.want[0] - b.have) / b.want[0] - (a.want[0] - a.have) / a.want[0])
    .map((c): PickTarget => ({ key: toSlot[c.key], slot: toSlot[c.key], label: COACH_SLOTS[toSlot[c.key]].label, note: `${c.label}: ${c.have} of ${c.want[0]}–${c.want[1]}` }));
  const plan = themes.map((t): PickTarget => ({ key: `theme:${t.name}`, slot: "synergy", label: t.name, note: `Theme: ${t.name}`, theme: t }));
  const slot = (s: CoachSlot): PickTarget => ({ key: s, slot: s, label: COACH_SLOTS[s].label });
  return [...short.filter((s) => s.slot !== "land"), ...(plan.length ? plan : [slot("synergy")]), slot("wincon")];
}

