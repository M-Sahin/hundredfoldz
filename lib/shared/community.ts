// Profiles and public decks: the shapes the pages use and the rules for what players write.
// The database checks the same limits (supabase/migrations/20261102000000_profiles.sql).

export const HANDLE = /^[a-z0-9_]{3,24}$/;
export const LIMITS = { name: 40, bio: 300, description: 1000, reason: 300 } as const;
/** Three open reports from different accounts take a profile or deck down until an admin looks. */
export const REPORTS_TO_HIDE = 3;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Avatar {
  card: string;
  /** a Scryfall art crop */
  art: string;
  artist: string | null;
}

export interface PublicDeckSummary {
  id: string;
  name: string;
  commander: string;
  partner?: string | null;
  colors: string[];
  bracket?: number | null;
  likes: number;
  /** null when this site counts no views (no store) */
  views: number | null;
  at: number;
  /** only on the owner's own view of their profile */
  hidden?: boolean;
  /** the commander's art crop (Scryfall) for the deck's card, and its artist */
  art?: string | null;
  artist?: string | null;
}

export interface PublicProfile {
  handle: string;
  name: string;
  bio: string;
  avatar: Avatar | null;
  at: number;
  decks: PublicDeckSummary[];
}

export interface PublicDeck extends PublicDeckSummary {
  description: string;
  /** the deck itself, as in share links */
  d: string;
  author: { handle: string; name: string; avatarArt: string | null };
  basedOn: { id: string; name: string; handle: string; author: string } | null;
}

/** The player's own profile, for the profile form. */
export interface OwnProfile {
  handle: string;
  name: string;
  bio: string;
  avatar: Avatar | null;
}

export const profilePath = (handle: string) => `/u/${handle}`;
export const deckPath = (handle: string, id: string) => `/u/${handle}/${id}`;

/** Text a player wrote, made safe to keep: no control characters, spaces tidied, cut to size. Newlines stay when `lines`. */
export function cleanText(v: unknown, max: number, lines = false): string {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "");
  s = lines ? s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max).trim();
}

/** A handle as typed ("@Gail.Mercer") made into one ("gailmercer"), or null if it can't be. */
export function cleanHandle(v: unknown): string | null {
  const h = String(v ?? "").trim().replace(/^@/, "").toLowerCase();
  return HANDLE.test(h) ? h : null;
}

/** A handle suggestion from a name: "Gail Mercer" → "gail_mercer". */
export function suggestHandle(name: string): string {
  const h = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return h.length >= 3 ? h : `${h}_player`.replace(/^_/, "");
}

/** 1234 → "1.2k" */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export type DeckSort = "new" | "liked" | "viewed";

export function sortDecks<T extends { at: number; likes: number; views: number | null }>(decks: T[], sort: DeckSort): T[] {
  const key = (d: T) => (sort === "liked" ? d.likes : sort === "viewed" ? (d.views ?? 0) : d.at);
  return [...decks].sort((a, b) => key(b) - key(a) || b.at - a.at);
}
