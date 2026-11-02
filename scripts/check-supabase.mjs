#!/usr/bin/env node
// Checks the migrations against a real (local) Supabase: two users, each sees and changes only
// their own decks, columns other than the name can't change, deleting an account removes its
// decks; then profiles, public decks, likes, reports and moderation with more users. Run after `supabase start` (CI: .github/workflows/accounts.yml):
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-supabase.mjs
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let esbuild;
try {
  esbuild = createRequire(import.meta.url)("esbuild");
} catch {
  esbuild = createRequire(import.meta.url)(process.env.ESBUILD_PATH || "/opt/npm-tools/node_modules/esbuild");
}
const entry = join(root, ".test-build", "accounts-entry.ts");
const out = join(root, ".test-build", "accounts.mjs");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `export * from "../lib/server/account-handler"; export * from "../lib/server/community-handler"; export { encodeDeck } from "../lib/shared/share";`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const { handleDecks, handleDeck, handleDeleteAccount, handleSavedKey, savedKeyFor, encodeDeck, handleProfile, handleLike, handleReport, handleAdminReports, loadPublicProfile, loadPublicDeck, resetLimits } = await import(pathToFileURL(out).href);
process.env.KEY_ENCRYPTION_SECRET ||= Buffer.alloc(32, 9).toString("base64");

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase status -o env`).");
  process.exit(1);
}
const config = { url, anonKey: anon };
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  // in GitHub Actions, a failed check is also an annotation on the run
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=Account check::${what}`);
  if (!ok) failures.push(what);
};

async function api(path, init = {}, key = anon, token = key) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body };
}

async function user(email) {
  const made = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery staple", email_confirm: true }) }, service);
  if (made.status >= 300) throw new Error(`create ${email}: ${made.status} ${JSON.stringify(made.body)}`);
  const s = await api("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery staple" }) });
  if (s.status >= 300) throw new Error(`sign in ${email}: ${s.status} ${JSON.stringify(s.body)}`);
  return { id: s.body.user.id, token: s.body.access_token };
}

const SITE = "http://localhost:3000";
const req = (path, token, init = {}) =>
  new Request(`${SITE}${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", cookie: `hf_at=${encodeURIComponent(token)}`, ...(init.method && init.method !== "GET" ? { origin: SITE } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

const deck = (name) => ({
  name, strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"], bracket: 3,
  commander: { name: "Meren of Clan Nel Toth", role: "wincon", why: "", qty: 1 },
  cards: [{ name: "Sol Ring", role: "ramp", why: "", qty: 1 }, { name: `Card for ${name}`, role: "synergy", why: "", qty: 1 }],
});

const stamp = Date.now();
const a = await user(`a${stamp}@example.com`);
const b = await user(`b${stamp}@example.com`);
const dA = await encodeDeck(deck("Deck of A"));

// save, and save again (one row)
let r = await handleDecks(req("/api/decks", a.token, { method: "POST", body: { d: dA, colors: ["B", "G"] } }), { config });
const savedA = (await r.json()).saved?.[0];
check(r.status === 201 && savedA?.name === "Deck of A", `A saves a deck (${r.status})`);
r = await handleDecks(req("/api/decks", a.token, { method: "POST", body: { d: dA } }), { config });
const again = await r.json();
check(r.status === 201 && again.duplicates === 1 && again.saved.length === 0, "saving the same deck again adds no row");
r = await handleDecks(req("/api/decks", a.token, { method: "POST", body: { decks: [{ d: dA }, { d: await encodeDeck(deck("Second of A")) }] } }), { config });
check((await r.json()).saved?.length === 1, "importing skips the deck already saved");

// the other user sees nothing of A's
const listA = await (await handleDecks(req("/api/decks", a.token), { config })).json();
const listB = await (await handleDecks(req("/api/decks", b.token), { config })).json();
check(listA.decks?.length === 2, `A lists 2 decks (${listA.decks?.length})`);
check(Array.isArray(listB.decks) && listB.decks.length === 0, "B lists none of A's decks");
r = await handleDeck(req(`/api/decks/${savedA.id}`, b.token), savedA.id, { config });
check(r.status === 404, `B can't open A's deck (${r.status})`);
r = await handleDeck(req(`/api/decks/${savedA.id}`, b.token, { method: "PATCH", body: { name: "stolen" } }), savedA.id, { config });
check(r.status === 404, `B can't rename A's deck (${r.status})`);
await handleDeck(req(`/api/decks/${savedA.id}`, b.token, { method: "DELETE" }), savedA.id, { config });
const stillThere = await (await handleDeck(req(`/api/decks/${savedA.id}`, a.token), savedA.id, { config })).json();
check(stillThere.deck?.d === dA, "B's delete doesn't touch A's deck; A opens it with its payload");

// straight to the database, around our server
const sneaky = await api("/rest/v1/decks", { method: "POST", body: JSON.stringify({ user_id: a.id, name: "planted", commander: "x", d: dA.slice(0, 50) + "x" }) }, anon, b.token);
check(sneaky.status >= 400, `B can't insert a deck into A's account (${sneaky.status})`);
const anonRead = await api("/rest/v1/decks?select=id");
check(anonRead.status >= 400 || (Array.isArray(anonRead.body) && anonRead.body.length === 0), `logged out, the table reads empty or refuses (${anonRead.status})`);
const col = await api(`/rest/v1/decks?id=eq.${savedA.id}`, { method: "PATCH", body: JSON.stringify({ commander: "Changed" }) }, anon, a.token);
check(col.status >= 400, `even the owner can only change the name (${col.status})`);
r = await handleDeck(req(`/api/decks/${savedA.id}`, a.token, { method: "PATCH", body: { name: "Renamed" } }), savedA.id, { config });
check((await r.json()).deck?.name === "Renamed", "A renames their deck");

// saved API keys: A saves one; B and logged-out visitors can't read it; only the server opens it
const KEY = "sk-ant-api03-" + "q".repeat(40) + "LAST";
const fakeModels = async () => [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }];
r = await handleSavedKey(req("/api/account/key", a.token, { method: "PUT", body: { key: KEY, model: "claude-sonnet-5-5" } }), { config, listModels: fakeModels });
check(r.status === 200, `A saves a key (${r.status})`);
const rowA = await api(`/rest/v1/api_keys?select=sealed,last4&user_id=eq.${a.id}`, {}, service);
check(rowA.body?.[0]?.last4 === "LAST" && !JSON.stringify(rowA.body).includes(KEY), "the key is stored sealed, with its last four");
check((await savedKeyFor(req("/api/generate", a.token), { config }))?.key === KEY, "a build of A opens A's key");
const bReads = await api("/rest/v1/api_keys?select=sealed", {}, anon, b.token);
check(Array.isArray(bReads.body) && bReads.body.length === 0, "B can't read A's saved key");
check((await savedKeyFor(req("/api/generate", b.token), { config })) === null, "a build of B gets no key");
const anonKeys = await api("/rest/v1/api_keys?select=sealed");
check(!Array.isArray(anonKeys.body) || anonKeys.body.length === 0, "logged out, no saved keys can be read");
const planted = await api("/rest/v1/api_keys", { method: "POST", body: JSON.stringify({ user_id: a.id, sealed: "x".repeat(60), last4: "EVIL" }) }, anon, b.token);
check(planted.status >= 400, `B can't write a key into A's account (${planted.status})`);
// a sealed key copied into B's row doesn't open for B
await api("/rest/v1/api_keys", { method: "POST", body: JSON.stringify({ user_id: b.id, sealed: rowA.body?.[0]?.sealed, last4: "LAST" }) }, anon, b.token);
check((await savedKeyFor(req("/api/generate", b.token), { config })) === null, "A's sealed key copied to B doesn't open for B");

// ---- profiles and public decks -------------------------------------------------------------
const second = listA.decks.find((d) => d.id !== savedA.id);
const handle = `gail${stamp}`.slice(0, 24);
r = await handleProfile(req("/api/profile", a.token, { method: "PUT", body: { handle, name: "Gail", bio: "Golgari forever.", avatarCard: null, hidden: [second.id] } }), { config });
check(r.status === 201, `A makes a profile, hiding one deck (${r.status})`);
const pub = await loadPublicProfile(handle, { config });
check(pub?.decks.length === 1 && pub.decks[0].id === savedA.id && pub.decks[0].name === "Renamed", `the profile shows the one shown deck, under its new name (${pub?.decks.length})`);
check(!JSON.stringify(pub).includes(a.id), "the public profile has no user id");
check((await loadPublicDeck(second.id, { config })) === null, "the hidden deck has no public page");
const pd = await loadPublicDeck(savedA.id, { config });
check(pd?.author.handle === handle && pd.d === dA, "the shown deck's public page has its player and the deck");
const profRows = await api("/rest/v1/profiles?select=handle", {}, anon, b.token);
check(Array.isArray(profRows.body) && profRows.body.length === 0, "B can't read A's profile row");
check((await api("/rest/v1/profiles?select=handle")).status >= 400, "logged out, the profiles table refuses");
r = await handleProfile(req("/api/profile", b.token, { method: "PUT", body: { handle, name: "Fake Gail" } }), { config });
check(r.status === 409, `B can't take A's handle (${r.status})`);
r = await handleProfile(req("/api/profile", b.token, { method: "PUT", body: { handle: `bee${stamp}`.slice(0, 24), name: "Bee" } }), { config });
check(r.status === 201, `B makes a profile (${r.status})`);
const sneakyProfile = await api(`/rest/v1/profiles?user_id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify({ removed: false }) }, anon, b.token);
check(sneakyProfile.status >= 400, `B can't set removed on their profile (${sneakyProfile.status})`);

// likes
r = await handleLike(req("/api/likes", b.token, { method: "POST", body: { deck: savedA.id, on: true } }), { config });
check(r.status === 200, `B likes A's deck (${r.status})`);
r = await handleLike(req("/api/likes", b.token, { method: "POST", body: { deck: savedA.id, on: true } }), { config });
check(r.status === 200 && (await loadPublicDeck(savedA.id, { config }))?.likes === 1, "liking twice still counts once");
check((await (await handleLike(req(`/api/likes?deck=${savedA.id}`, b.token), { config })).json()).liked === true, "B sees their like");
check((await (await handleLike(req(`/api/likes?deck=${savedA.id}`, a.token), { config })).json()).liked === false, "A doesn't see B's like as their own");
r = await handleLike(req("/api/likes", a.token, { method: "POST", body: { deck: savedA.id, on: true } }), { config });
check(r.status === 403, `A can't like their own deck (${r.status})`);
r = await handleLike(req("/api/likes", b.token, { method: "POST", body: { deck: second.id, on: true } }), { config });
check(r.status === 403, `B can't like A's hidden deck (${r.status})`);
const pump = await api(`/rest/v1/decks?id=eq.${savedA.id}`, { method: "PATCH", body: JSON.stringify({ likes: 1000 }) }, anon, a.token);
check(pump.status >= 400, `A can't set their deck's likes (${pump.status})`);
const likeRows = await api("/rest/v1/likes?select=user_id", {}, anon, a.token);
check(Array.isArray(likeRows.body) && likeRows.body.length === 0, "A can't see who liked their deck");

// reports: three accounts take a deck down until an admin looks
const c = await user(`c${stamp}@example.com`);
const d = await user(`d${stamp}@example.com`);
const boss = await user(`boss${stamp}@example.com`);
resetLimits();
for (const [who, n] of [
  [b, 1],
  [c, 2],
]) {
  r = await handleReport(req("/api/report", who.token, { method: "POST", body: { kind: "deck", deck: savedA.id, reason: "test report" } }), { config });
  check(r.status === 200 && (await loadPublicDeck(savedA.id, { config })) !== null, `report ${n}: still up (${r.status})`);
}
r = await handleReport(req("/api/report", d.token, { method: "POST", body: { kind: "deck", deck: savedA.id, reason: "test report" } }), { config });
check(r.status === 200 && (await loadPublicDeck(savedA.id, { config })) === null, "report 3: taken down");
r = await handleAdminReports(req("/api/admin/reports", b.token), { config });
check(r.status === 403, `B isn't an admin (${r.status})`);
const addAdmin = await api("/rest/v1/admins", { method: "POST", body: JSON.stringify({ email: `boss${stamp}@example.com` }) }, service);
check(addAdmin.status < 300, `the site's owner adds an admin (${addAdmin.status})`);
const queue = await (await handleAdminReports(req("/api/admin/reports", boss.token), { config })).json();
const item = queue.reports?.find((x) => x.target === savedA.id);
check(item?.count === 3 && item.removed === true && item.handle === handle, "the admin sees the deck, 3 reports, down");
r = await handleAdminReports(req("/api/admin/reports", boss.token, { method: "POST", body: { kind: "deck", target: savedA.id, remove: false } }), { config });
check(r.status === 200 && (await loadPublicDeck(savedA.id, { config })) !== null, "the admin puts it back up");

// the player hides it, shows it again with a description, then takes the profile down
r = await handleDeck(req(`/api/decks/${savedA.id}`, a.token, { method: "PATCH", body: { hidden: true, description: "Mine." } }), savedA.id, { config });
check(r.status === 200 && (await loadPublicDeck(savedA.id, { config })) === null, "A hides the deck: its page is gone");
await handleDeck(req(`/api/decks/${savedA.id}`, a.token, { method: "PATCH", body: { hidden: false } }), savedA.id, { config });
check((await loadPublicDeck(savedA.id, { config }))?.description === "Mine.", "shown again, with its description");
r = await handleProfile(req("/api/profile", a.token, { method: "DELETE" }), { config });
check(r.status === 200 && (await loadPublicProfile(handle, { config })) === null && (await loadPublicDeck(savedA.id, { config })) === null, "A takes the profile down: the page and its decks are gone");

// delete the account: the decks go with it
r = await handleDeleteAccount(req("/api/account/delete", a.token, { method: "POST", body: { confirm: "delete" } }), { config });
check(r.status === 200, `A deletes their account (${r.status})`);
const left = await api(`/rest/v1/decks?select=id&user_id=eq.${a.id}`, {}, service);
check(Array.isArray(left.body) && left.body.length === 0, `A's decks are gone (${left.body?.length})`);
const keysLeft = await api(`/rest/v1/api_keys?select=user_id&user_id=eq.${a.id}`, {}, service);
check(Array.isArray(keysLeft.body) && keysLeft.body.length === 0, "A's saved key is gone");
const gone = await api(`/auth/v1/admin/users/${a.id}`, {}, service);
check(gone.status === 404, `A's user is gone (${gone.status})`);
const bLikes = await api(`/rest/v1/likes?select=deck_id&user_id=eq.${b.id}`, {}, service);
check(Array.isArray(bLikes.body) && bLikes.body.length === 0, "B's like went with A's deck");
const bDelete = await api("/rest/v1/rpc/delete_own_account", { method: "POST", body: "{}" });
check(bDelete.status >= 400, `logged out, delete_own_account refuses (${bDelete.status})`);

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll account checks passed");
process.exit(failures.length ? 1 : 0);
