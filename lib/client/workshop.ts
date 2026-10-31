"use client";
// The deck workshop in the browser: the deck in progress (kept between visits), and saving it to
// My decks the way the build page does: into the account when logged in, else into this browser.
import type { Deck } from "../shared/types";
import { EMPTY_WORKSHOP, type WorkshopDeck } from "../shared/workshop";
import { encodeDeck } from "../shared/share";
import { myDecks, storage, type SavedDeck } from "./api";
import { cloudDecks, loadAccount } from "./account";

const draftStore = storage<WorkshopDeck>("hundredfold:workshop");

/** The deck being built (with every card's Scryfall data, so a reload needs no lookups). */
export const workshopDraft = {
  get(): WorkshopDeck {
    const v = draftStore.get();
    return v && Array.isArray(v.cards) ? { ...EMPTY_WORKSHOP, ...v } : EMPTY_WORKSHOP;
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
  if ((await loadAccount()).user) {
    await cloudDecks.save(entry);
    return "account";
  }
  myDecks.add(entry);
  return "browser";
}
