// GET /api/cards/commanders for the deck workshop's two pickers. Scryfall's autocomplete can't
// filter, so these use its search instead:
//   ?q=mer                        cards that can lead a deck (is:commander)
//   ?with=<commander>&q=          cards that can be the second commander next to it
// Every suggestion then goes through the same checks a pick gets (commanderProblem, partnerProblem
// in lib/shared/workshop.ts), so the picker never offers a card it would refuse.
import { LIMITS, guard } from "./ratelimit";
import { named, search } from "./scryfall";
import { EMPTY_WORKSHOP, commanderProblem, partnerProblem } from "../shared/workshop";
import { pairingAbilities } from "../shared/validate";
import type { CardInfo } from "../shared/types";

/** Suggestions per answer. */
export const MAX_SUGGESTIONS = 20;

/**
 * The typed name as Scryfall words. Bare words search card names (any part of the name) and
 * ignore punctuation, so "yuriko tigers" finds Yuriko, the Tiger's Shadow. Anything that could
 * read as search syntax (quotes, colons, a leading minus, "or") is dropped.
 */
export function nameWords(q: string): string {
  return q
    .normalize("NFKC")
    .slice(0, 100)
    .replace(/[^\p{L}\p{N}'’\-\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-'’]+/, ""))
    .filter((w) => w && !/^(or|and)$/i.test(w))
    .slice(0, 10)
    .join(" ");
}

const quoted = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

/**
 * A Scryfall query for the cards that might pair with this commander, from its own pairing ability
 * (null when it has none). It's a first cut: partnerProblem has the last word on each card.
 */
export function partnerQuery(cmd: CardInfo): string | null {
  const p = pairingAbilities(cmd);
  // "Partner with X" pairs with X and nothing else
  if (p.partnerWith) return `!${quoted(p.partnerWith)}`;
  const ors: string[] = [];
  if (p.partnerGroup) {
    const label = cmd.oracleText.match(/Partner\s*[—–-]\s*([^\n(]+?)\s*(?:\(|\n|$)/)?.[1]?.trim();
    if (label) ors.push(`o:${quoted(`Partner—${label}`)}`);
  }
  if (p.partner) ors.push("kw:partner");
  if (p.friendsForever) ors.push('o:"friends forever"');
  if (p.choosesBackground) ors.push("t:background");
  if (p.isBackground) ors.push('o:"choose a background"');
  if (p.doctorsCompanion) ors.push('(t:"time lord" t:doctor)');
  if (p.isDoctor) ors.push(`o:"doctor's companion"`);
  return ors.length ? (ors.length > 1 ? `(${ors.join(" or ")})` : ors[0]) : null;
}

const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/** Names that start with what was typed first, then names with a word that does; otherwise most played first. */
export function rankNames(names: string[], q: string): string[] {
  const t = plain(q);
  if (!t) return names;
  const first = t.split(" ")[0];
  const score = (n: string) => {
    const p = plain(n);
    return p.startsWith(t) ? 0 : p.split(" ").some((w) => w.startsWith(first)) ? 1 : 2;
  };
  return names.map((n, i) => ({ n, i, s: score(n) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.n);
}

export interface PickerParams {
  q: string;
  /** the chosen commander, when picking its partner */
  with?: string;
}

/** Suggested names for one of the pickers, checked the way a pick is checked. */
export async function suggest(p: PickerParams): Promise<{ data: string[]; error?: string; status?: number }> {
  const words = nameWords(p.q);
  let query: string;
  let ok: (c: CardInfo) => boolean;
  if (p.with?.trim()) {
    const cmd = await named(p.with.trim().slice(0, 150));
    if (!cmd) return { data: [], error: `No card named "${p.with}"`, status: 404 };
    const pq = partnerQuery(cmd);
    if (!pq) return { data: [] };
    const ws = { ...EMPTY_WORKSHOP, commander: cmd };
    query = `${pq} f:commander${words ? ` ${words}` : ""}`;
    ok = (c) => c.name.toLowerCase() !== cmd.name.toLowerCase() && !partnerProblem(ws, c);
  } else {
    // the commander picker suggests from the second letter, like autocomplete
    if (plain(words).replace(/\s/g, "").length < 2) return { data: [] };
    query = `is:commander f:commander ${words}`;
    ok = (c) => !commanderProblem(c);
  }
  const r = await search(query, "edhrec", 40);
  // Scryfall's 404 is "no matches"; any other error is a search it couldn't read
  if (r.error && !/didn.t match any cards/i.test(r.error)) return { data: [], error: r.error };
  return { data: rankNames(r.cards.filter(ok).map((c) => c.name), p.q).slice(0, MAX_SUGGESTIONS) };
}

export async function handleCommanderSearch(request: Request): Promise<Response> {
  const limited = await guard(request, LIMITS.pickers, "Too many searches. Try again in a minute.");
  if (limited) return limited;
  const url = new URL(request.url);
  try {
    const r = await suggest({ q: url.searchParams.get("q") ?? "", with: url.searchParams.get("with") ?? undefined });
    const body = { data: r.data, ...(r.error ? { error: r.error } : {}) };
    if (r.status) return Response.json(body, { status: r.status });
    return Response.json(body, { headers: r.error ? { "Cache-Control": "no-store" } : { "Cache-Control": "public, s-maxage=3600" } });
  } catch (e) {
    return Response.json({ data: [], error: (e as Error).message }, { status: 502 });
  }
}
