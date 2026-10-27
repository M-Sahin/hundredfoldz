// Commanders to start from, for the setup page: the most-played new commanders (first printed in
// the last few months), by Scryfall's EDHREC rank (how many EDHREC decks play the card), so this
// needs no EDHREC access of our own. Only new ones: across all cards that rank measures play in
// the 99 as much as in the command zone (Ragavan tops it), so an all-time list wouldn't mean
// "popular commanders"; among this season's new legends it's a fair signal of what people build.
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
const SHOW = 10;

export async function trendingCommanders(now = Date.now()): Promise<{ fresh: TrendingCommander[]; since: string }> {
  const since = new Date(now - NEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  // not:reprint: the card's first printing is that recent (an old commander reprinted in a new precon isn't new)
  const r = await search(`is:commander legal:commander game:paper not:reprint date>=${since}`, "edhrec", 40);
  const fresh = r.cards
    .filter((c) => c.canBeCommander && c.legalCommander === "legal" && c.edhrecRank != null)
    .slice(0, SHOW)
    .map((c) => ({ name: c.name, artCrop: c.artCrop, image: c.image, colorIdentity: c.colorIdentity, typeLine: c.typeLine }));
  return { fresh, since };
}
