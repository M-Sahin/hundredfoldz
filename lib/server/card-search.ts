// GET /api/cards/search for the deck workshop: Scryfall search limited to the commander's colors
// and to Commander-legal cards, with filters for a slot (ramp, draw…), a card type and mana value.
// The slot filters use Scryfall Tagger tags, the ones scripts/calibrate-analysis.mjs checks the
// role detector against. Results come 40 at a time; "Show more" asks again with `from`.
import { LIMITS, guard } from "./ratelimit";
import { SCRYFALL_PAGE, searchPage } from "./scryfall";
import type { CardInfo, Color } from "../shared/types";

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
  /** how many results the player has already seen (0 = the first page) */
  from?: number;
}

/** Results per request. */
export const PAGE_SIZE = 40;
/** How deep "Show more" can go. */
export const MAX_FROM = 5000;

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
  const from = Math.min(MAX_FROM, Math.max(0, Math.floor(Number(g("from")) || 0)));
  return { q: g("q"), colors, slot, type, mv, from };
}

export interface CardPage {
  total: number;
  cards: CardInfo[];
  /** where the next request starts, or null when there are no more */
  next: number | null;
  error?: string;
}

/**
 * The PAGE_SIZE cards after the first `from`, most played first. Scryfall pages its results 175 at
 * a time, so a request can span the end of one page and the start of the next; both pages are
 * cached. A card can't appear twice in one answer.
 */
export async function searchFrom(q: string, from = 0): Promise<CardPage> {
  const page = Math.floor(from / SCRYFALL_PAGE) + 1;
  const first = await searchPage(q, "edhrec", page);
  let raw = first.cards.slice(from - (page - 1) * SCRYFALL_PAGE);
  let more = first.hasMore;
  if (raw.length < PAGE_SIZE && more) {
    const second = await searchPage(q, "edhrec", page + 1);
    raw = raw.concat(second.cards);
    more = second.hasMore;
  }
  const taken = raw.slice(0, PAGE_SIZE);
  const seen = new Set<string>();
  const cards = taken.filter((c) => {
    const k = c.name.toLowerCase();
    return !seen.has(k) && !!seen.add(k);
  });
  const end = from + taken.length;
  const next = taken.length && (raw.length > PAGE_SIZE || more) && end < MAX_FROM ? end : null;
  return { total: first.total, cards, next, ...(first.error ? { error: first.error } : {}) };
}

export async function handleCardSearch(request: Request): Promise<Response> {
  const limited = await guard(request, LIMITS.search, "Too many searches. Try again in a minute.");
  if (limited) return limited;
  const p = readParams(new URL(request.url));
  if (!p.q?.trim() && !p.slot && !p.type && !p.mv) return Response.json({ error: "Type a card name or text, or pick a filter." }, { status: 400 });
  try {
    const r = await searchFrom(searchQuery(p), p.from);
    // a 404 from Scryfall means "no matches"; anything else is a query it couldn't read
    const none = r.error && /didn.t match any cards/i.test(r.error); // Scryfall writes "didn’t"
    return Response.json(
      { total: r.total, cards: r.cards, next: r.next, ...(r.error && !none ? { error: r.error } : {}) },
      { headers: { "Cache-Control": "public, s-maxage=3600" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
