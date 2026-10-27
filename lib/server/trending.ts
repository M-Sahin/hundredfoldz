// Commanders to start from, for the setup page: the most-built new commanders (first printed in the
// last few months) and the most-built commanders of all time. "Most built" is Scryfall's EDHREC
// rank (how many EDHREC decks play the card), so this needs no EDHREC access of our own.
import { search } from "./scryfall";
import type { CardInfo } from "../shared/types";

export interface TrendingCommander {
  name: string;
  artCrop: string | null;
  image: string | null;
  colorIdentity: CardInfo["colorIdentity"];
  typeLine: string;
}

const NEW_DAYS = 120;
const SHOW = 8;

const pickOut = (cards: CardInfo[]): TrendingCommander[] =>
  cards
    .filter((c) => c.canBeCommander && c.legalCommander === "legal" && c.edhrecRank != null)
    .slice(0, SHOW)
    .map((c) => ({ name: c.name, artCrop: c.artCrop, image: c.image, colorIdentity: c.colorIdentity, typeLine: c.typeLine }));

export async function trendingCommanders(now = Date.now()): Promise<{ fresh: TrendingCommander[]; allTime: TrendingCommander[]; since: string }> {
  const since = new Date(now - NEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  // not:reprint: the card's first printing is that recent (an old commander reprinted in a new precon isn't new)
  const [fresh, allTime] = await Promise.all([
    search(`is:commander legal:commander game:paper not:reprint date>=${since}`, "edhrec", 40),
    search("is:commander legal:commander game:paper", "edhrec", 40),
  ]);
  return { fresh: pickOut(fresh.cards), allTime: pickOut(allTime.cards), since };
}
