// The deck workshop: a Commander deck the player builds card by card. Pure functions over the deck
// in progress, shared by the page (components/Workshop.tsx) and the tests. The checks are the
// ones a finished build gets (validate.ts, analysis.ts), run in the browser as the deck grows.
import { COMMANDER_TEMPLATE, bracketInfo } from "./bracket";
import { guessRole, isLand, type DeckAnalysis } from "./analysis";
import { copyLimit, pairingAbilities, pairingProblem, rebalanceBasics } from "./validate";
import type { CardInfo, Color, Deck, DeckCard, Role, Validation } from "./types";
import { BASIC_FOR_COLOR, isBasicLand } from "./types";

export interface WorkshopDeck {
  /** The player's name for the deck; empty = named after the commander. */
  name: string;
  commander: CardInfo | null;
  partner: CardInfo | null;
  bracket: number;
  /** The cards besides the commanders, each with its Scryfall data; basics merged with qty. */
  cards: DeckCard[];
}

export const EMPTY_WORKSHOP: WorkshopDeck = { name: "", commander: null, partner: null, bracket: 3, cards: [] };

const WUBRG: Color[] = ["W", "U", "B", "R", "G"];
const COLOR_NAMES: Record<Color, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function workshopIdentity(ws: WorkshopDeck): Color[] {
  const id = new Set([...(ws.commander?.colorIdentity ?? []), ...(ws.partner?.colorIdentity ?? [])]);
  return WUBRG.filter((c) => id.has(c));
}

/** Cards in the deck, the commanders included (a finished deck has 100). */
export function workshopTotal(ws: WorkshopDeck): number {
  return (ws.commander ? 1 : 0) + (ws.partner ? 1 : 0) + ws.cards.reduce((n, c) => n + c.qty, 0);
}

export function deckName(ws: WorkshopDeck): string {
  return ws.name.trim() || (ws.commander ? `${ws.commander.name.split(",")[0].split(" // ")[0]}'s deck` : "Your deck");
}

/** "black and green", "white, blue and red", "colorless" */
export function colorWords(colors: Color[]): string {
  const w = colors.map((c) => COLOR_NAMES[c]);
  return w.length ? (w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`) : "colorless";
}

/** Why this card can't go in the deck right now, or null when it can. */
export function canAdd(ws: WorkshopDeck, c: CardInfo): string | null {
  if (!ws.commander) return "Pick a commander first.";
  if ([ws.commander, ws.partner].some((x) => x && same(x.name, c.name))) return `${c.name} is your commander.`;
  if (c.legalCommander === "banned") return `${c.name} is banned in Commander.`;
  if (c.legalCommander !== "legal") return `${c.name} isn't legal in Commander.`;
  const id = new Set(workshopIdentity(ws));
  const outside = c.colorIdentity.filter((x) => !id.has(x));
  if (outside.length) return `${c.name} is ${colorWords(outside)}, outside ${ws.commander.name.split(",")[0]}'s colors.`;
  const have = ws.cards.find((x) => same(x.name, c.name));
  if (have && have.qty >= copyLimit(c)) return `${c.name} is already in the deck. Commander allows one copy.`;
  if (workshopTotal(ws) >= 100) return "The deck has 100 cards. Cut one to make room.";
  return null;
}

/** The deck with one more copy of the card (check canAdd first). */
export function addCard(ws: WorkshopDeck, c: CardInfo, role: Role = guessRole(c)): WorkshopDeck {
  const have = ws.cards.find((x) => same(x.name, c.name));
  if (have) return { ...ws, cards: ws.cards.map((x) => (x === have ? { ...x, qty: x.qty + 1 } : x)) };
  return { ...ws, cards: [...ws.cards, { name: c.name, role, why: "", qty: 1, info: c }] };
}

/** One copy fewer (basics come off one at a time). */
export function removeOne(ws: WorkshopDeck, name: string): WorkshopDeck {
  const have = ws.cards.find((x) => same(x.name, name));
  if (!have) return ws;
  if (have.qty > 1) return { ...ws, cards: ws.cards.map((x) => (x === have ? { ...x, qty: x.qty - 1 } : x)) };
  return { ...ws, cards: ws.cards.filter((x) => x !== have) };
}

export function setRole(ws: WorkshopDeck, name: string, role: Role): WorkshopDeck {
  return { ...ws, cards: ws.cards.map((x) => (same(x.name, name) ? { ...x, role } : x)) };
}

/** Why this card can't lead the deck, or null. */
export function commanderProblem(c: CardInfo): string | null {
  if (c.legalCommander === "banned") return `${c.name} is banned in Commander.`;
  if (!c.canBeCommander) return `${c.name} can't be a commander: it isn't a legendary creature and doesn't say it can be your commander.`;
  return null;
}

/**
 * A new commander. Cards already in the deck stay (the checks point out any that no longer fit);
 * a partner that can't pair with the new commander is dropped; the commander leaves the 99.
 */
export function setCommander(ws: WorkshopDeck, c: CardInfo): WorkshopDeck {
  const partner = ws.partner && !pairingProblem(c, ws.partner) ? ws.partner : null;
  return { ...ws, commander: c, partner, cards: ws.cards.filter((x) => !same(x.name, c.name)) };
}

/** Can this commander have a second one (Partner, Friends forever, Background…)? */
export function canPair(c: CardInfo | null): boolean {
  if (!c) return false;
  const p = pairingAbilities(c);
  return p.partner || !!p.partnerWith || !!p.partnerGroup || p.friendsForever || p.choosesBackground || p.doctorsCompanion;
}

/** Why these two can't share the command zone, or null. */
export function partnerProblem(ws: WorkshopDeck, c: CardInfo): string | null {
  if (!ws.commander) return "Pick a commander first.";
  if (c.legalCommander === "banned") return `${c.name} is banned in Commander.`;
  const background = /\bBackground\b/.test(c.typeLine);
  if (!c.canBeCommander && !background) return `${c.name} can't be a commander.`;
  return pairingProblem(ws.commander, c);
}

export function setPartner(ws: WorkshopDeck, c: CardInfo | null): WorkshopDeck {
  return { ...ws, partner: c, cards: c ? ws.cards.filter((x) => !same(x.name, c.name)) : ws.cards };
}

/** The deck as the rest of the app knows it (analysis, validation, sharing, saving). */
export function toDeck(ws: WorkshopDeck): Deck {
  const cmd = (c: CardInfo): DeckCard => ({ name: c.name, role: "wincon", why: "Commander", qty: 1, info: c });
  return {
    name: deckName(ws),
    commander: ws.commander ? cmd(ws.commander) : { name: "(no commander yet)", role: "wincon", why: "", qty: 0 },
    ...(ws.partner ? { partner: cmd(ws.partner) } : {}),
    cards: ws.cards,
    strategy: "",
    winConditions: [],
    bracketNotes: "",
    colorIdentity: workshopIdentity(ws),
    bracket: ws.bracket,
  };
}

/** A saved or shared deck, opened for editing. Cards Scryfall didn't return are left out. */
export function fromDeck(deck: Deck): WorkshopDeck {
  const named = deck.name && !/'s deck$/.test(deck.name) ? deck.name : "";
  return {
    name: named,
    commander: deck.commander.info ?? null,
    partner: deck.partner?.info ?? null,
    bracket: deck.bracket ?? 3,
    cards: deck.cards.filter((c) => c.info).map((c) => ({ name: c.name, role: c.role, why: c.why, qty: c.qty, info: c.info })),
  };
}

/** The same commanders and cards (names and copies), whatever the order, names or roles. */
export function sameCards(a: WorkshopDeck, b: WorkshopDeck): boolean {
  const key = (w: WorkshopDeck) => JSON.stringify([w.commander?.name, w.partner?.name, w.cards.map((c) => `${c.qty} ${c.name.toLowerCase()}`).sort()]);
  return key(a) === key(b);
}

// ---- the checklist and the coach's notes -------------------------------------

export interface Check {
  key: "lands" | "ramp" | "draw" | "removal" | "wipe" | "protection";
  label: string;
  have: number;
  want: readonly [number, number];
  status: "short" | "ok" | "over";
}

const CHECK_LABELS: Record<Check["key"], string> = { lands: "Lands", ramp: "Ramp", draw: "Card draw", removal: "Removal", wipe: "Board wipes", protection: "Protection" };

/** The deck's counts against the usual Commander numbers, from the cards' own text. */
export function deckChecks(a: DeckAnalysis): Check[] {
  return (Object.keys(CHECK_LABELS) as Check["key"][]).map((key) => {
    const { have, want } = a.template[key] ?? { have: 0, want: COMMANDER_TEMPLATE[key] };
    return { key, label: CHECK_LABELS[key], have, want, status: have < want[0] ? "short" : have > want[1] ? "over" : "ok" };
  });
}

export interface Note {
  tone: "good" | "warn" | "bad" | "info";
  text: string;
}

/** What the coach says about the deck right now, most important first. Plain words, no key needed. */
export function coachNotes(ws: WorkshopDeck, validation: Validation, checks: Check[]): Note[] {
  if (!ws.commander) return [];
  const notes: Note[] = [];
  const total = workshopTotal(ws);
  // the deck isn't finished yet: its size isn't a problem, only what's in it
  const problems = validation.errors.filter((e) => !/^Deck has \d+ cards/.test(e));
  for (const e of problems) notes.push({ tone: "bad", text: e });
  if (!problems.length)
    notes.push({ tone: "good", text: total === 100 ? "100 cards, and every one is legal. Save it, or ask Claude for a review." : `Every card fits ${ws.commander.name.split(",")[0]}'s colors (${colorWords(workshopIdentity(ws))}) and is legal in Commander.` });
  // the biggest gaps first, relative to what decks usually run
  const gaps = checks.filter((c) => c.status === "short").sort((x, y) => (y.want[0] - y.have) / y.want[0] - (x.want[0] - x.have) / x.want[0]);
  for (const c of gaps.slice(0, 2)) notes.push({ tone: "warn", text: `${c.label}: ${c.have}. Most Commander decks run ${c.want[0]} to ${c.want[1]}.` });
  for (const c of checks.filter((x) => x.status === "over")) notes.push({ tone: "info", text: `${c.label}: ${c.have}, more than the usual ${c.want[0]} to ${c.want[1]}. Fine if the plan needs it.` });
  const b = bracketInfo(ws.bracket);
  const gc = validation.gameChangers.length;
  if (b.maxGameChangers < 99 && gc <= b.maxGameChangers)
    notes.push({ tone: "info", text: b.maxGameChangers === 0 ? `No Game Changers, as Bracket ${b.number} expects.` : `${gc} of the ${b.maxGameChangers} Game Changers Bracket ${b.number} allows.` });
  for (const w of validation.warnings.filter((w) => /mass land denial|extra-turn/.test(w))) notes.push({ tone: "warn", text: w });
  return notes;
}

/**
 * What Claude can do with the deck now: finish it (under 100 cards, the build page's complete
 * mode) or review it with up to 10 swaps (a full deck, upgrade mode). `problem` says why not yet;
 * the limits are the ones generate-handler's parseRequest enforces.
 */
export function claudeStep(ws: WorkshopDeck): { kind: "complete" | "upgrade"; problem: string | null } {
  const total = workshopTotal(ws);
  const kind = total < 100 ? "complete" : "upgrade";
  const own = ws.cards.filter((c) => !isBasicLand(c.name)).length;
  if (!ws.commander) return { kind, problem: "Pick a commander first." };
  if (total > 100) return { kind, problem: `Cut ${total - 100} to get to 100 first.` };
  if (kind === "complete" && !own) return { kind, problem: "Add a card or two first, so Claude knows where you're going." };
  if (kind === "upgrade" && own < 30) return { kind, problem: "A review needs at least 30 different cards besides basic lands." };
  return { kind, problem: null };
}

// ---- basic lands -------------------------------------------------------------

export function landCount(ws: WorkshopDeck): number {
  return ws.cards.filter((c) => (c.info ? isLand(c.info) : isBasicLand(c.name))).reduce((n, c) => n + c.qty, 0);
}

/**
 * Adds basic lands up to `target` lands (never past 100 cards) and splits all the basics across the
 * deck's colors by what its spells need. `missing` lists basics that still need their Scryfall data.
 */
export function fillBasics(ws: WorkshopDeck, target = 36): { ws: WorkshopDeck; added: number; missing: string[] } {
  const colors = workshopIdentity(ws);
  const add = Math.min(target - landCount(ws), 100 - workshopTotal(ws));
  if (!ws.commander || !colors.length || add <= 0) return { ws, added: 0, missing: [] };
  const deck = toDeck(ws);
  deck.cards = deck.cards.map((c) => ({ ...c }));
  const first = BASIC_FOR_COLOR[colors[0]];
  const pile = deck.cards.find((c) => same(c.name, first));
  if (pile) pile.qty += add;
  else deck.cards.push({ name: first, role: "land", why: "Basic land", qty: add });
  rebalanceBasics(deck);
  // a basic the deck didn't have before has no Scryfall data yet: borrow it from the old pile if the name matches
  const known = new Map(ws.cards.filter((c) => c.info).map((c) => [c.name.toLowerCase(), c.info!]));
  const cards = deck.cards.map((c) => (c.info ? c : { ...c, info: known.get(c.name.toLowerCase()) }));
  return { ws: { ...ws, cards }, added: add, missing: cards.filter((c) => !c.info).map((c) => c.name) };
}

/** Fill in Scryfall data for cards that don't have it yet (new basics). */
export function withInfo(ws: WorkshopDeck, infos: CardInfo[]): WorkshopDeck {
  const by = new Map(infos.map((i) => [i.name.toLowerCase(), i]));
  return { ...ws, cards: ws.cards.map((c) => (c.info ? c : { ...c, info: by.get(c.name.toLowerCase()) })) };
}
