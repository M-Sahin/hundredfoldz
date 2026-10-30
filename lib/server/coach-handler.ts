// POST /api/coach: one "Deal me 3" in the workshop, streamed as NDJSON lines (CoachEvent). Card
// picks run on the visitor's own Claude API key (typed in, or saved to their account), or, when
// the site sets FREE_DEALS, on the site's key for a few free deals a visitor a day (counted like
// free builds, with the bot check; see free-builds.ts). GET /api/coach: today's free deals left.
// Framework-independent, like generate-handler.ts.
import { anthropicCaller, friendlyModelError, type ModelCaller } from "./anthropic";
import { keyTag, ownKey } from "./build-access";
import { serverConfig } from "./config";
import { runCoach } from "./coach";
import { LIMITS, clientIp, rateLimitAll, tooMany, type LimitRule } from "./ratelimit";
import { count } from "./stats";
import { claimFreeBuild, dealRefusal, freeDealsConfig, freeStatus, spendFreeTokens, visitor } from "./free-builds";
import { turnstileError, verifyTurnstile } from "./turnstile";
import { COACH_MODEL, parseCoachRequest, type CoachEvent } from "../shared/coach";

const MAX_BODY = 60_000;
const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };

export async function handleCoach(request: Request, override?: { callModel?: ModelCaller; timeBudgetMs?: number }): Promise<Response> {
  const cfg = serverConfig();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Request too large." }, { status: 413 });
  const own = await ownKey(request, cfg.ownKeys);
  if (own instanceof Response) return own;
  // no key of their own: a free deal, if the site gives them out
  const deals = own ? null : freeDealsConfig();
  if (!own && !deals && !override?.callModel) return Response.json({ error: "Card picks use your own Claude API key. Add it to get picks; everything else in the workshop is free.", code: "needs_key" }, { status: 402 });
  const ip = clientIp(request);
  const limits: [LimitRule, string][] = [[LIMITS.coachIp, ip]];
  if (own) limits.push([LIMITS.coachKey, await keyTag(own.key)]);
  const r = await rateLimitAll(limits);
  if (!r.ok) return tooMany("You've asked for a lot of card picks in the last hour. Try again in a bit.", r);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const req = parseCoachRequest(body);
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });

  // a free deal: the bot check, then one of today's free deals (given back if it shows no cards)
  const headers = new Headers(NDJSON_HEADERS);
  let refund: (() => Promise<void>) | null = null;
  if (deals) {
    const human = await verifyTurnstile((body as any)?.turnstile, ip, "deal");
    if (!human.ok) return turnstileError(human);
    const v = visitor(request);
    if (v.setCookie) headers.append("set-cookie", v.setCookie);
    const claim = await claimFreeBuild(deals, v);
    if (!claim.ok) {
      await count(`coach_free_refused|${claim.reason}`);
      return Response.json({ error: dealRefusal(claim.reason, deals), code: "free_deals_used" }, { status: 402, headers: v.setCookie ? { "set-cookie": v.setCookie } : undefined });
    }
    refund = claim.refund;
  }

  const callModel = override?.callModel ?? anthropicCaller(own ? own.key : cfg.apiKey);
  let tokens = 0;
  const encoder = new TextEncoder();
  const ctl = new AbortController();
  const started = Date.now();
  const stream = new ReadableStream({
    cancel() {
      ctl.abort(); // the player closed the picks: stop asking Claude
    },
    async start(controller) {
      const send = (e: CoachEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          ctl.abort();
        }
      };
      let picks = 0;
      try {
        await count(`coach_deal|${own ? (own.fromSaved ? "saved" : "own") : "free"}`);
        const emit = (e: CoachEvent) => {
          if (e.type === "usage") tokens = e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite;
          send(e);
        };
        picks = (await runCoach(req, { model: COACH_MODEL, callModel, emit, signal: ctl.signal, timeBudgetMs: override?.timeBudgetMs })).length;
      } catch (e) {
        if (!ctl.signal.aborted) send({ type: "error", message: friendlyModelError(e, !!own) || "Something went wrong." });
      } finally {
        if (deals) {
          // a free deal that showed nothing (and wasn't closed by the player) doesn't count; its tokens do
          if (!picks && !ctl.signal.aborted) await refund?.();
          if (tokens) await spendFreeTokens(tokens).catch(() => {});
        }
        send({ type: "done", ms: Date.now() - started, picks });
        try {
          controller.close();
        } catch {}
      }
    },
  });
  for (const c of own?.setCookies ?? []) headers.append("set-cookie", c);
  return new Response(stream, { headers });
}

/** GET /api/coach: whether this site gives free deals, and how many this visitor has left today. */
export async function handleCoachStatus(request: Request): Promise<Response> {
  const deals = freeDealsConfig();
  if (!deals) return Response.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
  const v = visitor(request);
  const status = await freeStatus(deals, v);
  const headers = new Headers({ "cache-control": "no-store" });
  if (v.setCookie) headers.append("set-cookie", v.setCookie);
  return Response.json({ enabled: true, ...status }, { headers });
}
