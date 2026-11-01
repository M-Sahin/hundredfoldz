"use client";
// Claude's plan for a workshop deck, on a paper note in the Find cards pane. Before there is one:
// an offer to sketch it (one Claude call, optional). Then 3 to 5 themes as chips; each is a search
// the server already ran in the commander's colors, and tapping one runs it. The themes are also
// targets for Deal me 3. The plan is kept with the deck in progress; a new commander clears it.
import { useEffect, useRef, useState } from "react";
import { ApiError, coachDeal } from "../lib/client/api";
import { PLAN_THEMES, type DeckPlan, type PlanTheme } from "../lib/shared/coach";
import type { WorkshopDeck } from "../lib/shared/workshop";

/** How the workshop's Claude help is paid for (plans, verdicts). */
export interface CoachAccess {
  /** the visitor's own key, or `free`: one of the site's free deals; null: neither (ask for a key) */
  auth: { apiKey?: string; savedKey?: boolean; free?: boolean } | null;
  /** a fresh bot-check token, for a free deal */
  getTurnstile?: () => Promise<string | undefined>;
  /** free deals left today, when on the site's key */
  freeLeft?: number;
  /** after every call (the page refreshes the free deals left) */
  onDealt?: () => void;
  onNeedKey: () => void;
}

export function PlanNote({ ws, plan, access, active, onTheme, onPlan }: { ws: WorkshopDeck; plan: DeckPlan | null; access: CoachAccess; active?: string; onTheme: (t: PlanTheme) => void; onPlan: (p: DeckPlan) => void }) {
  const [themes, setThemes] = useState<PlanTheme[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outOfFree, setOutOfFree] = useState(false);
  const [later, setLater] = useState(false); // "Not now": hidden for this visit
  const run = useRef<AbortController | null>(null);
  const cmd = ws.commander?.name.split(",")[0].split(" // ")[0] ?? "your commander";
  useEffect(() => () => run.current?.abort(), []);
  // a new commander: start fresh
  const who = `${ws.commander?.name}|${ws.partner?.name ?? ""}`;
  useEffect(() => {
    run.current?.abort();
    setThemes([]);
    setBusy(false);
    setError(null);
    setStatus("");
  }, [who]);

  const sketch = async () => {
    const { auth } = access;
    if (!auth || (auth.free && (outOfFree || access.freeLeft === 0))) return access.onNeedKey();
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setThemes([]);
    setError(null);
    setBusy(true);
    setStatus("Claude is reading your commander");
    const got: PlanTheme[] = [];
    try {
      const req = {
        mode: "plan" as const,
        commander: ws.commander?.name ?? "",
        partner: ws.partner?.name ?? null,
        bracket: ws.bracket,
        cards: ws.cards.map((c) => ({ name: c.name, qty: c.qty })),
      };
      const turnstile = auth.free ? await access.getTurnstile?.() : undefined;
      for await (const ev of coachDeal(req, { ...auth, turnstile }, ctl.signal)) {
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "theme") {
          got.push(ev.theme);
          setThemes([...got]);
        } else if (ev.type === "error") setError(ev.message);
      }
      if (got.length && !ctl.signal.aborted) onPlan({ commander: req.commander, partner: req.partner, themes: got });
      else if (!ctl.signal.aborted) setError((e) => e ?? "Claude couldn't find themes with enough cards. Try again in a bit.");
    } catch (e) {
      if (ctl.signal.aborted) return;
      if (e instanceof ApiError && e.code === "needs_key") return access.onNeedKey();
      if (e instanceof ApiError && e.code === "free_deals_used") setOutOfFree(true);
      setError((e as Error).message);
    } finally {
      if (run.current === ctl) {
        setBusy(false);
        setStatus("");
      }
      access.onDealt?.();
    }
  };
  const stop = () => {
    run.current?.abort();
    setBusy(false);
    setStatus("");
    setThemes([]);
  };

  const shown = busy ? themes : (plan?.themes ?? []);
  const on = shown.find((t) => t.query === active);
  const needKey = !access.auth || (access.auth.free && (outOfFree || access.freeLeft === 0));
  const cost = !access.auth
    ? "Uses your own Claude API key, on Claude Haiku."
    : access.auth.free
      ? `Uses one of today's free deals${access.freeLeft != null ? ` (${access.freeLeft} left)` : ""}.`
      : "Uses your Claude key, on Claude Haiku: a fraction of a cent.";

  if (!plan && !busy && later) return null;
  return (
    <section className="ws-plan" aria-labelledby="ws-plan-h" data-testid={plan && !busy ? "ws-plan" : "ws-plan-offer"}>
      <h3 id="ws-plan-h">{plan || busy ? `Claude's plan for ${cmd}` : "Not sure where to start?"}</h3>
      {shown.length ? (
        <div className="ws-plan-themes" role="group" aria-label="Themes: tap one to search for it">
          {shown.map((t) => (
            <button key={t.name} type="button" className={`chip ${on === t ? "is-on" : ""}`} aria-pressed={on === t} onClick={() => onTheme(t)} disabled={busy} title={t.why} data-testid="ws-plan-theme">
              {t.name}
            </button>
          ))}
        </div>
      ) : null}
      {busy ? (
        <p className="ws-plan-status" role="status">
          {status ? `${status}…` : ""}{" "}
          <button type="button" className="link" onClick={stop}>
            Stop
          </button>
        </p>
      ) : plan ? (
        <>
          <p className="ws-plan-why">{on ? on.why : "Tap a theme to search for its cards. Deal me 3 can deal for each one too."}</p>
          <p className="ws-plan-foot">
            {on ? `${on.total.toLocaleString("en")} cards in ${cmd}'s colors. ` : ""}
            <button type="button" className="link" onClick={() => void sketch()} data-testid="ws-plan-again">
              Sketch a new plan
            </button>
          </p>
        </>
      ) : (
        <>
          <p>
            Claude can sketch a plan for {cmd}: {PLAN_THEMES.min} to {PLAN_THEMES.max} themes, each a search you can tap. Optional, and every search is checked on Scryfall first.
          </p>
          <p className="ws-plan-actions">
            <button type="button" className="btn btn--small btn--ink" onClick={() => void sketch()} data-testid="ws-plan-go">
              {needKey ? "Add your Claude key" : "Sketch a plan"}
            </button>
            <button type="button" className="link" onClick={() => setLater(true)}>
              Not now
            </button>
          </p>
          <p className="ws-plan-foot">{needKey && access.auth?.free ? "Today's free deals are used up. Add your own Claude API key for more." : cost}</p>
        </>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
