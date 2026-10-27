// What's strong and what's weak about a deck, from the numbers alone: the role counts against the
// usual Commander ranges, the curve, the mana, the opening hands, combos and how generic the cards
// are. No Claude involved, so it's free and instant for any deck. Pure function.
import type { DeckAnalysis } from "./analysis";
import type { OpenerReport } from "./openers";
import type { Validation } from "./types";

export interface Finding {
  /** what it's about, e.g. "Card draw" */
  topic: string;
  text: string;
  cards?: string[];
}

export interface ComboFinding {
  cards: string[];
  results: string[];
  /** Commander Spellbook's rating: "R" Ruthless, "S" Spicy, "P" Powerful… */
  bracketTag?: string | null;
  url?: string;
}

export interface Findings {
  strong: Finding[];
  weak: Finding[];
  /** Cards that work together, as far as the numbers can tell: combos Commander Spellbook knows. */
  combos: ComboFinding[];
}

const LABEL: Record<string, string> = { lands: "Lands", ramp: "Ramp", draw: "Card draw", removal: "Removal", wipe: "Board wipes", protection: "Protection and recursion" };
const COLOR: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function deckFindings(a: DeckAnalysis, openers: OpenerReport | null, validation?: Validation, combos: ComboFinding[] = []): Findings {
  const strong: Finding[] = [];
  const weak: Finding[] = [];

  for (const e of validation?.errors ?? []) weak.push({ topic: "Deck check", text: e });

  // the usual counts for a Commander deck in brackets 2 and 3
  for (const [k, { have, want }] of Object.entries(a.template)) {
    const [lo, hi] = want;
    const label = LABEL[k] ?? k;
    if (have < lo) weak.push({ topic: label, text: `${have}, below the usual ${lo} to ${hi}.${k === "lands" ? " Expect missed land drops." : k === "ramp" ? " The deck will be a turn behind." : k === "draw" ? " It will run out of cards in long games." : k === "removal" ? " Few answers to other players' threats." : k === "wipe" ? " Hard to come back when someone runs away with the board." : " The deck's key pieces are easy to lose."}` });
    else if (have > hi && (k === "lands" || k === "wipe")) weak.push({ topic: label, text: `${have}, above the usual ${lo} to ${hi}.${k === "lands" ? " More floods than most decks." : " A creature deck hurts itself with many wipes."}` });
    else if (have >= lo && (k === "ramp" || k === "draw" || k === "removal")) strong.push({ topic: label, text: `${have}, in or above the usual ${lo} to ${hi}.` });
  }

  // curve
  const top = a.curve.slice(6).reduce((n, x) => n + x, 0);
  if (a.avgMv && a.avgMv <= 2.8) strong.push({ topic: "Curve", text: `Low: an average mana value of ${a.avgMv.toFixed(2)}, so it gets going early.` });
  else if (a.avgMv >= 3.6) weak.push({ topic: "Curve", text: `Heavy: an average mana value of ${a.avgMv.toFixed(2)}. Cheaper spells or more ramp would help.` });
  if (top >= 10) weak.push({ topic: "Curve", text: `${top} cards cost six or more: hands can be slow to start.` });

  // mana
  const lands = a.lands + a.mdfcLands;
  const short = a.colors.filter((c) => c.target && c.target - c.sources >= 2);
  for (const c of short) {
    const name = COLOR[c.color] ?? c.color;
    const card = c.hardest ?? "the early cards";
    // a target above the land count isn't reachable: say what it means instead of a number nobody can hit
    if (c.target >= lands)
      weak.push({ topic: "Mana", text: `${card} needs a lot of ${name} early; with ${c.sources} ${name} sources it will often come down late.`, ...(c.hardest ? { cards: [c.hardest] } : {}) });
    else weak.push({ topic: "Mana", text: `${c.sources} ${name} sources; ${card} want${c.hardest ? "s" : ""} about ${c.target} to come down on time.`, ...(c.hardest ? { cards: [c.hardest] } : {}) });
  }
  if (a.colors.length && !short.length) strong.push({ topic: "Mana", text: "Enough sources of every color for the early cards." });
  if (a.tappedLands > 8) weak.push({ topic: "Mana", text: `${a.tappedLands} lands always enter tapped: that adds up to lost turns.` });

  // opening hands (goldfished)
  if (openers) {
    if (openers.keep7 >= 0.7) strong.push({ topic: "Opening hands", text: `Keeps its first seven ${pct(openers.keep7)} of the time.` });
    else if (openers.keep7 < 0.55) weak.push({ topic: "Opening hands", text: `Keeps its first seven only ${pct(openers.keep7)} of the time: too few or too many lands in many hands.` });
    if (openers.landDrop4 < 0.55) weak.push({ topic: "Opening hands", text: `Has a fourth land on turn four in ${pct(openers.landDrop4)} of games.` });
    for (const c of openers.commanders) {
      if (c.onCurve >= 0.6) strong.push({ topic: "Commander", text: `${c.name} comes down on turn ${c.mv} in ${pct(c.onCurve)} of games.` });
      else if (c.oneLate < 0.5) weak.push({ topic: "Commander", text: `${c.name} is out by turn ${c.mv + 1} in only ${pct(c.oneLate)} of games.` });
    }
    if (openers.flood >= 0.3) weak.push({ topic: "Opening hands", text: `Floods (seven or more lands in the first 14 cards) in ${pct(openers.flood)} of games.` });
  }

  // how specific the deck is to its commander
  if (a.stapleShare >= 0.45) weak.push({ topic: "Identity", text: `${pct(a.stapleShare)} of the spells are generic staples: little that's special to this commander.` });
  else if (a.stapleShare > 0 && a.stapleShare <= 0.25) strong.push({ topic: "Identity", text: `Mostly cards for this deck's plan, not generic staples (${pct(a.stapleShare)} staples).` });

  if (combos.length) strong.push({ topic: "Combos", text: `${combos.length} combo${combos.length === 1 ? "" : "s"} Commander Spellbook knows, below.` });

  return { strong, weak, combos };
}
