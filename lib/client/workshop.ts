"use client";
// The deck workshop in the browser: the deck in progress (kept between visits), and saving it to
// My decks the way the build page does: into the account when logged in, else into this browser.
import type { Deck } from "../shared/types";
import { EMPTY_WORKSHOP, type WorkshopDeck } from "../shared/workshop";
import { readPlan } from "../shared/coach";
import { encodeDeck } from "../shared/share";
import { myDecks, storage, type SavedDeck } from "./api";
import { cloudDecks, loadAccount } from "./account";

const draftStore = storage<WorkshopDeck>("hundredfold:workshop");
// the deck last saved from the workshop (its share payload), so a later visit can say it's saved
const savedStore = storage<{ d: string; where: "account" | "browser" }>("hundredfold:workshop-saved");

/** Was this deck, exactly as it is, saved from the workshop? Where to, or null. */
export const workshopSaved = {
  async where(deck: Deck): Promise<"account" | "browser" | null> {
    const s = savedStore.get();
    if (!s) return null;
    try {
      return (await encodeDeck(deck)) === s.d ? s.where : null;
    } catch {
      return null;
    }
  },
  clear() {
    savedStore.set(null);
  },
};

/** The deck being built (with every card's Scryfall data, so a reload needs no lookups) and its plan. */
export const workshopDraft = {
  get(): WorkshopDeck {
    const v = draftStore.get();
    return v && Array.isArray(v.cards) ? { ...EMPTY_WORKSHOP, ...v, plan: readPlan(v.plan) } : EMPTY_WORKSHOP;
  },
  set(ws: WorkshopDeck) {
    draftStore.set(ws.commander || ws.cards.length ? ws : null);
  },
};

/** Save to My decks. Returns where it went. */
export async function saveToMyDecks(deck: Deck): Promise<"account" | "browser"> {
  const d = await encodeDeck(deck);
  const entry: SavedDeck = {
    id: d.slice(-12) + Date.now().toString(36),
    at: Date.now(),
    name: deck.name,
    commander: deck.commander.name,
    partner: deck.partner?.name,
    colors: deck.colorIdentity,
    d,
  };
  const where = (await loadAccount()).user ? "account" : "browser";
  if (where === "account") await cloudDecks.save(entry);
  else myDecks.add(entry);
  savedStore.set({ d, where });
  return where;
}
