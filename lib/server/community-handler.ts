// Profiles and public decks: framework-independent handlers behind /api/profile, /api/likes,
// /api/views, /api/report and /api/admin/reports, and the loaders the /u/... pages use.
// The database decides who may see and change what (supabase/migrations/20261102000000_profiles.sql);
// these check the input, rate-limit, and turn errors into plain words.
import { authed, cfgOf, cookieHeaders, friendly, json, sameOrigin, type Deps } from "./account-handler";
import { clientIp, LIMITS, rateLimit, rateLimitAll, tooMany } from "./ratelimit";
import { count } from "./stats";
import * as scry from "./scryfall";
import { rest, rpc, SupabaseError, requestAuth } from "./supabase";
import { countView, viewCounts } from "./views";
import { LIMITS as TEXT, UUID, cleanHandle, cleanText, type Avatar, type OwnProfile, type PublicDeck, type PublicProfile } from "../shared/community";

const ART = /^https:\/\/cards\.scryfall\.io\/art_crop\/[A-Za-z0-9/._-]+(\?[0-9]+)?$/;
const PROFILE = "handle,name,bio,avatar_card,avatar_art,avatar_artist";

const avatarOf = (r: any): Avatar | null => (r?.avatar_art || r?.avatarArt ? { card: r.avatar_card ?? r.avatarCard ?? "", art: r.avatar_art ?? r.avatarArt, artist: r.avatar_artist ?? r.avatarArtist ?? null } : null);
const toOwn = (r: any): OwnProfile => ({ handle: r.handle, name: r.name, bio: r.bio ?? "", avatar: avatarOf(r) });
const colorsOf = (c: unknown) => String(c ?? "").split("").filter(Boolean);

// ---- the pages: anyone may read -----------------------------------------------------------

/** A profile and its public decks with their views, or null (no such profile, it's down, or no accounts here). */
export async function loadPublicProfile(handle: string, deps: Deps = {}): Promise<PublicProfile | null> {
  const cfg = cfgOf(deps);
  const h = cleanHandle(handle);
  if (!cfg || !h) return null;
  const p = await rpc<any>(cfg, "public_profile", { p_handle: h }, null, deps.fetch);
  if (!p || typeof p !== "object") return null;
  const decks: any[] = Array.isArray(p.decks) ? p.decks : [];
  const [views, art] = await Promise.all([
    viewCounts(decks.map((d) => d.id)),
    scry
      .getCollection([...new Set(decks.map((d) => String(d.commander)))].slice(0, 75))
      .then((r) => r.found)
      .catch(() => new Map<string, never>()),
  ]);
  const artOf = (name: string) => art.get(String(name).toLowerCase());
  return {
    handle: p.handle,
    name: p.name,
    bio: p.bio ?? "",
    avatar: avatarOf(p),
    at: Date.parse(p.createdAt) || 0,
    decks: decks.map((d, i) => ({ id: d.id, name: d.name, commander: d.commander, partner: d.partner ?? null, colors: colorsOf(d.colors), bracket: d.bracket ?? null, likes: d.likes ?? 0, views: views[i], at: Date.parse(d.createdAt) || 0, art: artOf(d.commander)?.artCrop ?? null, artist: artOf(d.commander)?.artist ?? null })),
  };
}

/** One public deck with its player, or null. */
export async function loadPublicDeck(id: string, deps: Deps = {}): Promise<PublicDeck | null> {
  const cfg = cfgOf(deps);
  if (!cfg || !UUID.test(id)) return null;
  const d = await rpc<any>(cfg, "public_deck", { p_deck: id.toLowerCase() }, null, deps.fetch);
  if (!d || typeof d !== "object") return null;
  const [views] = await viewCounts([d.id]);
  return {
    id: d.id,
    name: d.name,
    commander: d.commander,
    partner: d.partner ?? null,
    colors: colorsOf(d.colors),
    bracket: d.bracket ?? null,
    likes: d.likes ?? 0,
    views,
    at: Date.parse(d.createdAt) || 0,
    description: d.description ?? "",
    d: d.d,
    author: { handle: d.author?.handle, name: d.author?.name, avatarArt: d.author?.avatarArt ?? null },
    basedOn: d.basedOn ?? null,
  };
}

// ---- your own profile -----------------------------------------------------------------------

/** The picture: the card's art crop and artist, looked up on Scryfall (never taken from the browser). */
async function avatarFor(card: unknown): Promise<Avatar | null | string> {
  const name = cleanText(card, 150);
  if (!name) return null;
  const c = await scry.named(name).catch(() => null);
  if (!c) return `Couldn't find ${name} on Scryfall.`;
  if (!c.artCrop || !ART.test(c.artCrop)) return `${c.name} has no art to use. Pick another card.`;
  return { card: c.name, art: c.artCrop, artist: c.artist };
}

/**
 * GET /api/profile: your profile ({profile: null} before you make one).
 * PUT {handle, name, bio, avatarCard, hidden?: ids, shown?: ids}: make or change it; the deck lists
 * hide decks from it or show them on it. DELETE: take it down (your decks stay in My decks).
 */
export async function handleProfile(request: Request, deps: Deps = {}): Promise<Response> {
  const a = await authed(request, deps);
  if ("res" in a) return a.res!;
  const { cfg, auth } = a;
  const me = `profiles?user_id=eq.${auth.user.id}`;
  try {
    if (request.method === "GET") {
      const rows = await rest<any[]>(cfg, auth.token, `${me}&select=${PROFILE}`, { method: "GET" }, deps.fetch);
      return json({ profile: rows[0] ? toOwn(rows[0]) : null }, 200, auth.setCookies);
    }
    if (!sameOrigin(request)) return json({ error: "Bad request." }, 403, auth.setCookies);
    const lim = await rateLimitAll([
      [LIMITS.profileSave, auth.user.id],
      [LIMITS.profileSave, `ip:${clientIp(request)}`],
    ]);
    if (!lim.ok) {
      await count("community_refused|rate_limit");
      return tooMany("You've changed your profile a lot in the last hour. Try again in a bit.", lim, cookieHeaders(auth.setCookies));
    }
    if (request.method === "DELETE") {
      await rest(cfg, auth.token, me, { method: "DELETE" }, deps.fetch);
      await count("profile|removed");
      return json({ removed: true }, 200, auth.setCookies);
    }
    if (request.method !== "PUT") return json({ error: "Method not allowed." }, 405, auth.setCookies);
    if (Number(request.headers.get("content-length") ?? 0) > 100_000) return json({ error: "Too much at once." }, 413, auth.setCookies);
    const body = await request.json().catch(() => null);
    const handle = cleanHandle(body?.handle);
    if (!handle) return json({ error: "A handle is 3 to 24 letters, numbers or _.", field: "handle" }, 400, auth.setCookies);
    const name = cleanText(body?.name, TEXT.name);
    if (!name) return json({ error: "Give your profile a name.", field: "name" }, 400, auth.setCookies);
    const bio = cleanText(body?.bio, TEXT.bio, true);
    const avatar = await avatarFor(body?.avatarCard);
    if (typeof avatar === "string") return json({ error: avatar, field: "avatar" }, 400, auth.setCookies);
    const had = await rest<any[]>(cfg, auth.token, `${me}&select=handle`, { method: "GET" }, deps.fetch);
    const row = { user_id: auth.user.id, handle, name, bio, avatar_card: avatar?.card ?? null, avatar_art: avatar?.art ?? null, avatar_artist: avatar?.artist ?? null };
    let saved: any[];
    try {
      saved = await rest<any[]>(cfg, auth.token, `profiles?on_conflict=user_id&select=${PROFILE}`, { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) }, deps.fetch);
    } catch (e) {
      if (e instanceof SupabaseError && /profiles_handle_key|duplicate key/i.test(e.message)) {
        await count("community_refused|taken_handle");
        return json({ error: `@${handle} is taken. Try another handle.`, field: "handle" }, 409, auth.setCookies);
      }
      throw e;
    }
    // which decks show on the profile
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 1000) : []);
    for (const [list, hidden] of [[ids(body?.hidden), true], [ids(body?.shown), false]] as const) {
      if (list.length) await rest(cfg, auth.token, `decks?id=in.(${list.join(",")})`, { method: "PATCH", body: JSON.stringify({ hidden }) }, deps.fetch);
    }
    await count(had.length ? "profile|updated" : "profile|created");
    return json({ profile: toOwn(saved[0] ?? row) }, had.length ? 200 : 201, auth.setCookies);
  } catch (e) {
    return json({ error: friendly(e) }, e instanceof SupabaseError && e.status === 401 ? 401 : 502, auth.setCookies);
  }
}

/** GET /api/profile/handle?h=: is this handle free (your own counts as free)? */
export async function handleHandleCheck(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return json({ error: "Accounts aren't set up on this site." }, 404);
  const handle = cleanHandle(new URL(request.url).searchParams.get("h"));
  if (!handle) return json({ valid: false, free: false });
  const lim = await rateLimit(LIMITS.profileSave, `check:${clientIp(request)}`);
  if (!lim.ok) return tooMany("Too many checks. Try again in a bit.", lim);
  const auth = await requestAuth(request, cfg, deps.fetch).catch(() => null);
  const token = auth && auth.user ? auth.token : null;
  try {
    const free = await rpc<boolean>(cfg, "handle_free", { p_handle: handle }, token, deps.fetch);
    return json({ valid: true, free: !!free, handle }, 200, auth?.setCookies ?? []);
  } catch (e) {
    return json({ error: friendly(e) }, 502);
  }
}

// ---- likes, views, reports ----------------------------------------------------------------

/** GET /api/likes?deck=: did you like it? POST {deck, on}: like or unlike. */
export async function handleLike(request: Request, deps: Deps = {}): Promise<Response> {
  const a = await authed(request, deps);
  if ("res" in a) return a.res!;
  const { cfg, auth } = a;
  const url = new URL(request.url);
  try {
    if (request.method === "GET") {
      const deck = url.searchParams.get("deck") ?? "";
      if (!UUID.test(deck)) return json({ error: "Unknown deck." }, 404, auth.setCookies);
      const rows = await rest<any[]>(cfg, auth.token, `likes?deck_id=eq.${deck.toLowerCase()}&select=deck_id`, { method: "GET" }, deps.fetch);
      return json({ liked: rows.length > 0 }, 200, auth.setCookies);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, auth.setCookies);
    if (!sameOrigin(request)) return json({ error: "Bad request." }, 403, auth.setCookies);
    const body = await request.json().catch(() => null);
    const deck = String(body?.deck ?? "").toLowerCase();
    if (!UUID.test(deck)) return json({ error: "Unknown deck." }, 404, auth.setCookies);
    const lim = await rateLimit(LIMITS.like, auth.user.id);
    if (!lim.ok) {
      await count("community_refused|rate_limit");
      return tooMany("That's a lot of likes in an hour. Try again in a bit.", lim, cookieHeaders(auth.setCookies));
    }
    if (body?.on) {
      try {
        await rest(cfg, auth.token, "likes?on_conflict=user_id,deck_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: auth.user.id, deck_id: deck }) }, deps.fetch);
      } catch (e) {
        // the database says no: the deck isn't public (any more), or it's your own
        if (e instanceof SupabaseError && (e.status === 403 || /row-level security/i.test(e.message))) {
          await count("community_refused|not_public");
          return json({ error: "You can't like this deck: it's your own, or it isn't public any more." }, 403, auth.setCookies);
        }
        throw e;
      }
      await count("deck_like|on");
      return json({ liked: true }, 200, auth.setCookies);
    }
    await rest(cfg, auth.token, `likes?deck_id=eq.${deck}&user_id=eq.${auth.user.id}`, { method: "DELETE" }, deps.fetch);
    await count("deck_like|off");
    return json({ liked: false }, 200, auth.setCookies);
  } catch (e) {
    return json({ error: friendly(e) }, e instanceof SupabaseError && e.status === 401 ? 401 : 502, auth.setCookies);
  }
}

/** POST /api/views {deck}: count a view (once per visitor a day); returns {views} (null: not counted here). */
export async function handleView(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!sameOrigin(request)) return json({ error: "Bad request." }, 403);
  const cfg = cfgOf(deps);
  if (!cfg) return json({ views: null });
  const body = await request.json().catch(() => null);
  const deck = String(body?.deck ?? "").toLowerCase();
  if (!UUID.test(deck)) return json({ error: "Unknown deck." }, 404);
  const lim = await rateLimit(LIMITS.view, clientIp(request));
  if (!lim.ok) return json({ views: null });
  try {
    if (!(await rpc<boolean>(cfg, "deck_is_public", { p_deck: deck }, null, deps.fetch))) return json({ error: "Unknown deck." }, 404);
    const views = await countView(deck, request);
    if (views !== null) await count("deck_view");
    return json({ views });
  } catch {
    return json({ views: null });
  }
}

/** POST /api/report {kind: "deck" | "profile", deck?, handle?, reason}: report it to the admins. */
export async function handleReport(request: Request, deps: Deps = {}): Promise<Response> {
  const a = await authed(request, deps);
  if ("res" in a) return a.res!;
  const { cfg, auth } = a;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, auth.setCookies);
  if (!sameOrigin(request)) return json({ error: "Bad request." }, 403, auth.setCookies);
  const body = await request.json().catch(() => null);
  const kind = body?.kind === "profile" ? "profile" : body?.kind === "deck" ? "deck" : null;
  const reason = cleanText(body?.reason, TEXT.reason);
  if (!kind) return json({ error: "Report a deck or a profile." }, 400, auth.setCookies);
  if (!reason) return json({ error: "Say in a few words what's wrong." }, 400, auth.setCookies);
  const deck = kind === "deck" ? String(body?.deck ?? "").toLowerCase() : null;
  const handle = kind === "profile" ? cleanHandle(body?.handle) : null;
  if (kind === "deck" ? !UUID.test(deck!) : !handle) return json({ error: "Unknown deck or profile." }, 404, auth.setCookies);
  const lim = await rateLimit(LIMITS.report, auth.user.id);
  if (!lim.ok) {
    await count("community_refused|rate_limit");
    return tooMany("You've sent a lot of reports today. Thanks; the admins will look.", lim, cookieHeaders(auth.setCookies));
  }
  try {
    const ok = await rpc<boolean>(cfg, "file_report", { p_kind: kind, p_handle: handle, p_deck: deck, p_reason: reason }, auth.token, deps.fetch);
    if (!ok) return json({ error: "That isn't public any more." }, 404, auth.setCookies);
    await count(`report|${kind}`);
    return json({ reported: true }, 200, auth.setCookies);
  } catch (e) {
    return json({ error: friendly(e) }, 502, auth.setCookies);
  }
}

// ---- moderation: admins only (public.admins in the database) ----------------------------

/** GET /api/admin/reports: what's been reported. POST {kind, target, remove}: take it down or put it back. */
export async function handleAdminReports(request: Request, deps: Deps = {}): Promise<Response> {
  const a = await authed(request, deps);
  if ("res" in a) return a.res!;
  const { cfg, auth } = a;
  try {
    if (request.method === "GET") {
      const reports = await rpc<any[]>(cfg, "admin_reports", {}, auth.token, deps.fetch);
      return json({ reports: Array.isArray(reports) ? reports : [] }, 200, auth.setCookies);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, auth.setCookies);
    if (!sameOrigin(request)) return json({ error: "Bad request." }, 403, auth.setCookies);
    const body = await request.json().catch(() => null);
    const kind = body?.kind === "profile" || body?.kind === "deck" ? body.kind : null;
    const target = String(body?.target ?? "");
    if (!kind || !UUID.test(target) || typeof body?.remove !== "boolean") return json({ error: "Bad request." }, 400, auth.setCookies);
    await rpc(cfg, "admin_moderate", { p_kind: kind, p_target: target, p_remove: body.remove }, auth.token, deps.fetch);
    return json({ done: true }, 200, auth.setCookies);
  } catch (e) {
    if (e instanceof SupabaseError && /admins only/i.test(e.message)) return json({ error: "Only the site's admins can see reports." }, 403, auth.setCookies);
    return json({ error: friendly(e) }, 502, auth.setCookies);
  }
}
