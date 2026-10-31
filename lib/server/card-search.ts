// GET /api/cards/search for the deck workshop: Scryfall search limited to the commander's colors
// and to Commander-legal cards, with filters for a slot (ramp, draw…), a card type and mana value.
// The slot filters use Scryfall Tagger tags, the ones scripts/calibrate-analysis.mjs checks the
// role detector against.
import { LIMITS, guard } from "./ratelimit";
import { search } from "./scryfall";
import type { Color } from "../shared/types";

export const SLOTS = {
  ramp: "otag:ramp -t:land",
  draw: "otag:card-advantage -t:land",
  removal: "otag:removal -otag:board-wipe -t:land",
  wipe: "otag:board-wipe",
  protection: "(otag:gives-hexproof or otag:gives-indestructible or otag:gives-shroud) -t:land",
  recursion: "(otag:reanimate or otag:regrowth) -t:land",
  land: "t:land",
} as const;
export type Slot = keyof typeof SLOTS;

export const TYPES = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "land"] as const;
export type CardType = (typeof TYPES)[number];

export const MVS = { "0-2": "mv<=2", "3": "mv=3", "4": "mv=4", "5+": "mv>=5" } as const;
export type Mv = keyof typeof MVS;

export interface SearchParams {
  q?: string;
  colors: Color[]; // the commander's color identity
  slot?: Slot;
  type?: CardType;
  mv?: Mv;
}

/**
 * Plain words ("creature dies") look in names, rules text and type lines; Scryfall's bare words only
 * match names. Text with Scryfall syntax in it (o:, t:, quotes, or…) goes as typed.
 */
function textQuery(q: string): string {
  if (!q || /[:<>=!"()]/.test(q) || /\b(or|and)\b/i.test(q) || /(^|\s)-\w/.test(q)) return q;
  return `${q} or o:"${q}" or t:"${q}"`;
}

/** The Scryfall query. The player's own text is wrapped in parentheses so an "or" can't escape the filters. */
export function searchQuery(p: SearchParams): string {
  const q = textQuery((p.q ?? "").trim().slice(0, 200));
  const id = p.colors.length ? `id<=${p.colors.join("").toLowerCase()}` : "id:c";
  return [q ? `(${q})` : "", id, "f:commander", p.slot ? SLOTS[p.slot] : "", p.type ? `t:${p.type}` : "", p.mv ? MVS[p.mv] : ""].filter(Boolean).join(" ");
}

/** Reads the URL's parameters; unknown values are ignored rather than refused. */
export function readParams(url: URL): SearchParams {
  const g = (k: string) => url.searchParams.get(k) ?? "";
  const colors = [...new Set(g("id").toUpperCase().split(""))].filter((c): c is Color => "WUBRG".includes(c));
  const slot = Object.hasOwn(SLOTS, g("slot")) ? (g("slot") as Slot) : undefined;
  const type = (TYPES as readonly string[]).includes(g("type")) ? (g("type") as CardType) : undefined;
  const mv = Object.hasOwn(MVS, g("mv")) ? (g("mv") as Mv) : undefined;
  return { q: g("q"), colors, slot, type, mv };
}

export async function handleCardSearch(request: Request): Promise<Response> {
  const limited = await guard(request, LIMITS.search, "Too many searches. Try again in a minute.");
  if (limited) return limited;
  const p = readParams(new URL(request.url));
  if (!p.q?.trim() && !p.slot && !p.type && !p.mv) return Response.json({ error: "Type a card name or text, or pick a filter." }, { status: 400 });
  try {
    const r = await search(searchQuery(p), "edhrec", 40);
    // a 404 from Scryfall means "no matches"; anything else is a query it couldn't read
    const none = r.error && /didn.t match any cards/i.test(r.error); // Scryfall writes "didn’t"
    return Response.json(
      { total: r.total, cards: r.cards, ...(r.error && !none ? { error: r.error } : {}) },
      { headers: { "Cache-Control": "public, s-maxage=3600" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
