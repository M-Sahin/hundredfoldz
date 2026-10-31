// The workshop's card picks ("Deal me 3"): what the browser asks for and what comes back. Claude
// offers three cards for one slot of the deck; the server checks each before it's shown.
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

export interface CoachRequest {
  commander: string;
  partner?: string | null;
  bracket: number;
  /** The cards besides the commanders, as they are in the workshop. */
  cards: { name: string; qty: number }[];
  slot: CoachSlot;
  /** Cards the player passed on in earlier deals: never offered again. */
  passed: string[];
  /** "cheaper", "no creatures", "under 3 mana": the optional Steer it line. */
  steer?: string;
}

export type CoachEvent =
  | { type: "status"; text: string }
  | { type: "pick"; card: CardInfo; why: string }
  | { type: "usage"; usage: Usage; model: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; ms: number; picks: number };

const name = (v: unknown) => String(v ?? "").trim().slice(0, 150);

/** The request, or why it can't be used. */
export function parseCoachRequest(body: any): CoachRequest | string {
  if (!body || typeof body !== "object") return "Invalid request.";
  const commander = name(body.commander);
  if (!commander) return "Pick a commander first.";
  if (!Object.hasOwn(COACH_SLOTS, body.slot)) return "Pick what the cards are for.";
  if (!Array.isArray(body.cards) || body.cards.length > 120) return "Send the deck's cards (at most 120 entries).";
  const cards = body.cards
    .map((c: any) => ({ name: name(c?.name), qty: Math.max(1, Math.min(99, Math.round(Number(c?.qty) || 1))) }))
    .filter((c: { name: string }) => c.name);
  const passed = (Array.isArray(body.passed) ? body.passed : []).map(name).filter(Boolean).slice(0, 60);
  const steer = typeof body.steer === "string" ? body.steer.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return {
    commander,
    partner: body.partner ? name(body.partner) : null,
    bracket: ([1, 2, 3, 4] as const).find((b) => b === Number(body.bracket)) ?? 3,
    cards,
    slot: body.slot as CoachSlot,
    passed,
    ...(steer ? { steer } : {}),
  };
}
