// POST /api/stats {e, m?}: the browser counts an action (only events from a fixed list).
// GET /api/stats?days=30: the counts, for the site's admins (ADMIN_EMAILS, checked with Supabase).
import { LIMITS, guard } from "./ratelimit";
import { count, countError, readStats } from "./stats";
import { cleanErrorMessage, isClientEvent } from "../shared/stats-events";
import { getUser, requestAuth, supabaseConfig, type Fetch } from "./supabase";

const NO_STORE = { "cache-control": "no-store" };

export async function handleStatsEvent(request: Request, deps: { fetch?: Fetch } = {}): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > 2000) return new Response(null, { status: 413 });
  const limited = await guard(request, LIMITS.stats);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const e = body?.e;
  if (!isClientEvent(e)) return Response.json({ error: "Unknown event." }, { status: 400 });
  await count(e, deps);
  if (e === "client_error") await countError(cleanErrorMessage(body?.m) || "(no message)", deps);
  return new Response(null, { status: 204 });
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** The logged-in admin, verified with Supabase (a session cookie alone isn't proof), or null. */
async function admin(request: Request, f?: Fetch): Promise<{ email: string; setCookies: string[] } | null> {
  const cfg = supabaseConfig();
  const allowed = adminEmails();
  if (!cfg || !allowed.length) return null;
  const auth = await requestAuth(request, cfg, f).catch(() => null);
  if (!auth?.user || !("token" in auth)) return null;
  const user = await getUser(cfg, auth.token, f).catch(() => null);
  const email = (user?.email ?? "").toLowerCase();
  return email && allowed.includes(email) ? { email, setCookies: auth.setCookies } : null;
}

export async function handleStatsRead(request: Request, deps: { fetch?: Fetch; now?: number } = {}): Promise<Response> {
  const who = await admin(request, deps.fetch);
  // not an admin: the same answer as a page that doesn't exist
  if (!who) return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  const days = Math.min(90, Math.max(1, Math.floor(Number(new URL(request.url).searchParams.get("days")) || 30)));
  const stats = await readStats(days, deps);
  const headers = new Headers(NO_STORE);
  for (const c of who.setCookies) headers.append("set-cookie", c);
  return Response.json(stats, { headers });
}
