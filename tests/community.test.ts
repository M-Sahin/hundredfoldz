// Profiles and public decks: the text rules, the profile API, likes, views, reports and the page
// loaders, against a fake Supabase (and a fake store for views). The database's own rules are
// checked against a real Postgres by supabase/tests (see its README).
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAdminReports, handleHandleCheck, handleLike, handleProfile, handleReport, handleView, loadPublicDeck, loadPublicProfile } from "../lib/server/community-handler";
import { handleDeck, handleDecks, resetLimits } from "../lib/server/account-handler";
import { cleanHandle, cleanText, shortCount, sortDecks, suggestHandle } from "../lib/shared/community";
import { fakeCard } from "./fixtures";

const cfg = { url: "https://proj.supabase.co", anonKey: "anon-key" };
const SITE = "https://hundredfoldz.example";
process.env.SITE_URL = SITE;
const ART = "https://cards.scryfall.io/art_crop/front/1/2/12345678-aaaa.jpg?1562";
const DECK = "11111111-2222-3333-4444-555555555555";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64({ role: "authenticated", ...claims })}.sig`;
const token = (sub = "u1") => jwt({ sub, email: `${sub}@example.com`, exp: Math.floor(Date.now() / 1000) + 3600 });

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function fakeSupabase(routes: (c: Call) => { status?: number; body?: unknown } | undefined) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])), body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const r = routes(c) ?? { status: 404, body: { message: "not found" } };
    const status = r.status ?? 200;
    return new Response(status === 204 || r.body === undefined ? null : JSON.stringify(r.body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function req(path: string, init: { method?: string; user?: string | null; body?: unknown; origin?: string | null; ua?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "hundredfoldz.example", "x-forwarded-proto": "https", "user-agent": init.ua ?? "test", "x-forwarded-for": init.ip ?? "203.0.113.7" };
  if (init.user !== null) headers.cookie = `hf_at=${token(init.user ?? "u1")}`;
  if (init.origin !== null && init.method && init.method !== "GET") headers.origin = init.origin ?? SITE;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${SITE}${path}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}

/** Scryfall's /cards/named and /cards/collection, with real-looking art crops. */
function withScryfall<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const card = (name: string) => fakeCard(name, { image_uris: { normal: ART, art_crop: ART }, artist: "Some Artist" });
    if (url.includes("/cards/named")) {
      const p = new URL(url).searchParams;
      const n = p.get("exact") ?? p.get("fuzzy") ?? "";
      return n === "Nowhere Card" ? new Response(JSON.stringify({ object: "error" }), { status: 404 }) : new Response(JSON.stringify(card(n)));
    }
    if (url.endsWith("/cards/collection")) {
      const ids = JSON.parse(init.body).identifiers as { name: string }[];
      return new Response(JSON.stringify({ object: "list", data: ids.map((i) => card(i.name)), not_found: [] }));
    }
    return original(input, init);
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("text rules: handles, names, bios, sorting, counts", () => {
  assert.equal(cleanHandle("@Gail_M"), "gail_m");
  assert.equal(cleanHandle("ga"), null);
  assert.equal(cleanHandle("gail mercer"), null);
  assert.equal(cleanHandle("x".repeat(25)), null);
  assert.equal(suggestHandle("Gail Mercer"), "gail_mercer");
  assert.equal(suggestHandle("Zoë Ü"), "zoe_u");
  assert.equal(suggestHandle("é"), "e_player");
  assert.equal(cleanText("  Hi\u0000  there‮  ", 40), "Hi there");
  assert.equal(cleanText("line one\r\n\r\n\r\n\r\nline   two", 100, true), "line one\n\nline two");
  assert.equal(cleanText("a".repeat(400), 300).length, 300);
  assert.equal(cleanText(42, 10), "");
  assert.equal(shortCount(999), "999");
  assert.equal(shortCount(2410), "2.4k");
  assert.equal(shortCount(3000), "3k");
  assert.equal(shortCount(45_600), "46k");
  const decks = [
    { id: "a", at: 3, likes: 1, views: 50 },
    { id: "b", at: 1, likes: 9, views: null },
    { id: "c", at: 2, likes: 9, views: 70 },
  ];
  assert.deepEqual(sortDecks(decks, "new").map((d) => d.id), ["a", "c", "b"]);
  assert.deepEqual(sortDecks(decks, "liked").map((d) => d.id), ["c", "b", "a"]);
  assert.deepEqual(sortDecks(decks, "viewed").map((d) => d.id), ["c", "a", "b"]);
});

test("profile: made with the picture looked up on Scryfall; deck lists hide and show; a taken handle says so", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => {
    if (c.method === "GET" && c.url.includes("/rest/v1/profiles?user_id=eq.u1")) return { body: [] };
    if (c.method === "POST" && c.url.includes("/rest/v1/profiles?on_conflict=user_id")) {
      if (c.body.handle === "taken") return { status: 409, body: { message: 'duplicate key value violates unique constraint "profiles_handle_key"' } };
      return { status: 201, body: [c.body] };
    }
    if (c.method === "PATCH" && c.url.includes("/rest/v1/decks?id=in.")) return { status: 204 };
    return undefined;
  });
  const deps = { config: cfg, fetch: f };

  const bad = await handleProfile(req("/api/profile", { method: "PUT", body: { handle: "no spaces", name: "Gail" } }), deps);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, "handle");
  const noName = await handleProfile(req("/api/profile", { method: "PUT", body: { handle: "gail", name: "   " } }), deps);
  assert.equal((await noName.json()).field, "name");
  const csrf = await handleProfile(req("/api/profile", { method: "PUT", origin: "https://evil.example", body: { handle: "gail", name: "Gail" } }), deps);
  assert.equal(csrf.status, 403);

  const keep = "22222222-2222-3333-4444-555555555555";
  const r = await withScryfall(() => handleProfile(req("/api/profile", { method: "PUT", body: { handle: "@Gail", name: " Gail  Mercer ", bio: "Golgari\r\nforever", avatarCard: "Sakura-Tribe Elder", hidden: [DECK, "not-an-id"], shown: [keep] } }), deps));
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.deepEqual(j.profile, { handle: "gail", name: "Gail Mercer", bio: "Golgari\nforever", avatar: { card: "Sakura-Tribe Elder", art: ART, artist: "Some Artist" } });
  const saved = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/profiles"))!;
  assert.equal(saved.headers.authorization, `Bearer ${token()}`, "saved with the player's own token");
  assert.equal(saved.body.user_id, "u1");
  assert.equal(saved.body.avatar_art, ART, "the art comes from Scryfall, not the browser");
  const patches = calls.filter((c) => c.method === "PATCH");
  assert.deepEqual(
    patches.map((c) => [decodeURIComponent(c.url.split("?")[1]), c.body.hidden]),
    [
      [`id=in.(${DECK})`, true],
      [`id=in.(${keep})`, false],
    ],
  );

  const missing = await withScryfall(() => handleProfile(req("/api/profile", { method: "PUT", body: { handle: "gail", name: "Gail", avatarCard: "Nowhere Card" } }), deps));
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /Couldn't find Nowhere Card/);

  const taken = await handleProfile(req("/api/profile", { method: "PUT", body: { handle: "taken", name: "Gail" } }), deps);
  assert.equal(taken.status, 409);
  assert.match((await taken.json()).error, /@taken is taken/);

  const out = await handleProfile(req("/api/profile", { user: null }), deps);
  assert.equal(out.status, 401);
});

test("handle check: asks the database, with the player's token when logged in", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => (c.url.endsWith("/rpc/handle_free") ? { body: c.body.p_handle !== "gail" } : undefined));
  const deps = { config: cfg, fetch: f };
  assert.deepEqual(await (await handleHandleCheck(req("/api/profile/handle?h=Gail", { user: null }), deps)).json(), { valid: true, free: false, handle: "gail" });
  assert.equal(calls[0].headers.authorization, undefined, "a visitor asks as anon (the key isn't a JWT here)");
  assert.deepEqual(await (await handleHandleCheck(req("/api/profile/handle?h=newbie"), deps)).json(), { valid: true, free: true, handle: "newbie" });
  assert.equal(calls.at(-1)!.headers.authorization, `Bearer ${token()}`);
  assert.deepEqual(await (await handleHandleCheck(req("/api/profile/handle?h=a b"), deps)).json(), { valid: false, free: false });
});

test("decks: hidden and a description can be changed; the list says which are hidden", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => {
    if (c.method === "PATCH") return { body: [{ id: DECK, name: "Meren", commander: "Meren of Clan Nel Toth", colors: "BG", created_at: "2026-10-28T00:00:00Z", hidden: c.body.hidden ?? false, description: c.body.description ?? "", likes: 3 }] };
    if (c.method === "GET") return { body: [{ id: DECK, name: "Meren", commander: "Meren of Clan Nel Toth", colors: "BG", created_at: "2026-10-28T00:00:00Z", hidden: true, description: "", likes: 3 }] };
    return undefined;
  });
  const deps = { config: cfg, fetch: f };
  const list = await (await handleDecks(req("/api/decks"), deps)).json();
  assert.equal(list.decks[0].hidden, true);
  assert.equal(list.decks[0].likes, 3);
  assert.match(calls[0].url, /hidden,description,likes/);
  const r = await handleDeck(req(`/api/decks/${DECK}`, { method: "PATCH", body: { hidden: false, description: "My\r\n\r\n\r\nFriday deck." } }), DECK, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1)!.body, { hidden: false, description: "My\n\nFriday deck." }, "only what changed; the name stays");
  const nothing = await handleDeck(req(`/api/decks/${DECK}`, { method: "PATCH", body: { likes: 99 } }), DECK, deps);
  assert.equal(nothing.status, 400, "likes can't be set from the browser");
});

test("before the profiles migration, My decks still lists and saves (without the new columns)", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => {
    if (/hidden|description|likes/.test(c.url)) return { status: 400, body: { code: "42703", message: "column decks.hidden does not exist" } };
    if (c.method === "GET") return { body: [{ id: DECK, name: "Meren", commander: "Meren of Clan Nel Toth", colors: "BG", created_at: "2026-10-28T00:00:00Z" }] };
    return undefined;
  });
  const r = await handleDecks(req("/api/decks"), { config: cfg, fetch: f });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).decks[0].name, "Meren");
  const n = calls.length;
  await handleDecks(req("/api/decks"), { config: cfg, fetch: f });
  assert.equal(calls.length, n + 1, "remembered: one request, not two");
});

test("likes: on and off with the player's token; the database refusing says why", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => {
    if (c.method === "POST" && c.url.includes("/rest/v1/likes")) return c.body.deck_id === DECK ? { status: 201 } : { status: 403, body: { message: 'new row violates row-level security policy for table "likes"' } };
    if (c.method === "DELETE") return { status: 204 };
    if (c.method === "GET") return { body: [{ deck_id: DECK }] };
    return undefined;
  });
  const deps = { config: cfg, fetch: f };
  assert.deepEqual(await (await handleLike(req("/api/likes", { method: "POST", body: { deck: DECK.toUpperCase(), on: true } }), deps)).json(), { liked: true });
  const post = calls.at(-1)!;
  assert.deepEqual(post.body, { user_id: "u1", deck_id: DECK });
  assert.match(post.headers.prefer, /ignore-duplicates/, "liking twice isn't an error");
  assert.deepEqual(await (await handleLike(req("/api/likes", { method: "POST", body: { deck: DECK, on: false } }), deps)).json(), { liked: false });
  assert.match(calls.at(-1)!.url, new RegExp(`likes\\?deck_id=eq.${DECK}&user_id=eq.u1`));
  assert.deepEqual(await (await handleLike(req(`/api/likes?deck=${DECK}`), deps)).json(), { liked: true });
  const own = await handleLike(req("/api/likes", { method: "POST", body: { deck: "99999999-2222-3333-4444-555555555555", on: true } }), deps);
  assert.equal(own.status, 403);
  assert.match((await own.json()).error, /your own, or it isn't public/);
  assert.equal((await handleLike(req("/api/likes", { method: "POST", user: null, body: { deck: DECK, on: true } }), deps)).status, 401);
  assert.equal((await handleLike(req("/api/likes", { method: "POST", body: { deck: "x", on: true } }), deps)).status, 404);
});

test("views: once per visitor a deck a day, only for public decks, none without a store", async () => {
  resetLimits();
  const { f } = fakeSupabase((c) => (c.url.endsWith("/rpc/deck_is_public") ? { body: c.body.p_deck === DECK } : undefined));
  const deps = { config: cfg, fetch: f };
  const keep = { ...process.env };
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  try {
    assert.deepEqual(await (await handleView(req("/api/views", { method: "POST", body: { deck: DECK } }), deps)).json(), { views: null });

    // a store that keeps keys
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "t";
    const store = new Map<string, string>();
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).startsWith("https://kv.example")) {
        const [cmd, key, ...rest] = JSON.parse(init.body) as string[];
        let result: unknown = null;
        if (cmd === "SET") result = rest.includes("NX") && store.has(key) ? null : (store.set(key, String(rest[0])), "OK");
        else if (cmd === "INCR") store.set(key, String(Number(store.get(key) ?? 0) + 1)), (result = Number(store.get(key)));
        else if (cmd === "GET") result = store.get(key) ?? null;
        else if (cmd === "MGET") result = [key, ...rest].map((k) => store.get(k) ?? null);
        else result = 1; // rate limits and stats counters
        return new Response(JSON.stringify({ result }));
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const view = async (ua: string) => (await (await handleView(req("/api/views", { method: "POST", ua, body: { deck: DECK } }), deps)).json()).views;
      assert.equal(await view("phone"), 1);
      assert.equal(await view("phone"), 1, "the same visitor again: not counted");
      assert.equal(await view("laptop"), 2);
      assert.equal((await handleView(req("/api/views", { method: "POST", body: { deck: "99999999-2222-3333-4444-555555555555" } }), deps)).status, 404, "not a public deck");
      assert.ok(![...store.keys()].some((k) => k.includes("203.0.113.7")), "addresses are hashed");
      assert.equal((await handleView(req("/api/views", { method: "POST", origin: "https://evil.example", body: { deck: DECK } }), deps)).status, 403);
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    process.env = keep;
  }
});

test("reports: logged in, with a reason, sent to the database's file_report", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => (c.url.endsWith("/rpc/file_report") ? { body: c.body.p_deck !== "99999999-2222-3333-4444-555555555555" } : undefined));
  const deps = { config: cfg, fetch: f };
  assert.equal((await handleReport(req("/api/report", { method: "POST", user: null, body: { kind: "deck", deck: DECK, reason: "spam" } }), deps)).status, 401);
  assert.equal((await handleReport(req("/api/report", { method: "POST", body: { kind: "deck", deck: DECK, reason: "  " } }), deps)).status, 400);
  assert.deepEqual(await (await handleReport(req("/api/report", { method: "POST", body: { kind: "deck", deck: DECK, reason: "Spam\nlinks" } }), deps)).json(), { reported: true });
  assert.deepEqual(calls.at(-1)!.body, { p_kind: "deck", p_handle: null, p_deck: DECK, p_reason: "Spam links" });
  assert.equal(calls.at(-1)!.headers.authorization, `Bearer ${token()}`);
  assert.equal((await handleReport(req("/api/report", { method: "POST", body: { kind: "profile", handle: "@Gail", reason: "rude" } }), deps)).status, 200);
  assert.equal(calls.at(-1)!.body.p_handle, "gail");
  assert.equal((await handleReport(req("/api/report", { method: "POST", body: { kind: "deck", deck: "99999999-2222-3333-4444-555555555555", reason: "x" } }), deps)).status, 404);
});

test("admin queue: the database decides who's an admin", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => {
    if (c.url.endsWith("/rpc/admin_reports")) return c.headers.authorization === `Bearer ${token("boss")}` ? { body: [{ kind: "deck", target: DECK, count: 3 }] } : { status: 400, body: { message: "admins only" } };
    if (c.url.endsWith("/rpc/admin_moderate")) return { status: 204 };
    return undefined;
  });
  const deps = { config: cfg, fetch: f };
  const no = await handleAdminReports(req("/api/admin/reports"), deps);
  assert.equal(no.status, 403);
  assert.deepEqual((await (await handleAdminReports(req("/api/admin/reports", { user: "boss" }), deps)).json()).reports, [{ kind: "deck", target: DECK, count: 3 }]);
  assert.equal((await handleAdminReports(req("/api/admin/reports", { method: "POST", user: "boss", body: { kind: "deck", target: DECK, remove: true } }), deps)).status, 200);
  assert.deepEqual(calls.at(-1)!.body, { p_kind: "deck", p_target: DECK, p_remove: true });
  assert.equal((await handleAdminReports(req("/api/admin/reports", { method: "POST", user: "boss", body: { kind: "deck", target: DECK } }), deps)).status, 400);
});

test("page loaders: the public functions' answers, with commander art and no views without a store", async () => {
  const keep = { ...process.env };
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  try {
    const { f, calls } = fakeSupabase((c) => {
      if (c.url.endsWith("/rpc/public_profile"))
        return c.body.p_handle === "gail"
          ? { body: { handle: "gail", name: "Gail", bio: "Hi", avatarCard: "Sakura-Tribe Elder", avatarArt: ART, avatarArtist: "Some Artist", createdAt: "2026-10-02T10:00:00Z", decks: [{ id: DECK, name: "Meren", commander: "Meren of Clan Nel Toth", partner: null, colors: "BG", bracket: 3, likes: 4, createdAt: "2026-10-28T00:00:00Z" }] } }
          : { body: null };
      if (c.url.endsWith("/rpc/public_deck")) return { body: c.body.p_deck === DECK ? { id: DECK, name: "Meren", commander: "Meren of Clan Nel Toth", colors: "BG", likes: 4, createdAt: "2026-10-28T00:00:00Z", description: "Mine", d: "abc", author: { handle: "gail", name: "Gail", avatarArt: ART }, basedOn: null } : null };
      return undefined;
    });
    const deps = { config: cfg, fetch: f };
    const p = await withScryfall(() => loadPublicProfile("@GAIL", deps));
    assert.equal(calls[0].body.p_handle, "gail");
    assert.deepEqual(p?.avatar, { card: "Sakura-Tribe Elder", art: ART, artist: "Some Artist" });
    assert.deepEqual(p?.decks[0], { id: DECK, name: "Meren", commander: "Meren of Clan Nel Toth", partner: null, colors: ["B", "G"], bracket: 3, likes: 4, views: null, at: Date.parse("2026-10-28T00:00:00Z"), art: ART, artist: "Some Artist" });
    assert.equal(await loadPublicProfile("nobody", deps), null);
    assert.equal(await loadPublicProfile("x y", deps), null, "not a handle: no database call");
    const d = await loadPublicDeck(DECK.toUpperCase(), deps);
    assert.equal(d?.author.handle, "gail");
    assert.equal(d?.description, "Mine");
    assert.equal(await loadPublicDeck("not-a-uuid", deps), null);
    assert.equal(await loadPublicProfile("gail", { config: null }), null, "no accounts on this site: no profiles");
  } finally {
    process.env = keep;
  }
});
