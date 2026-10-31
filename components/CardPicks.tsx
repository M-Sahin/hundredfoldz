"use client";
// "Deal me 3": Claude deals three cards for one slot of the workshop deck, each with a line on why
// it fits. They arrive one by one as the server checks them; keep any, or deal three more (the ones
// passed on aren't offered again). An optional "Steer it" line says what to look for. Runs on the
// visitor's own key, or on one of the site's free deals (a bot-check token per deal).
import { useEffect, useRef, useState } from "react";
import { CardFace, ManaCost } from "./CardFace";
import { ApiError, coachDeal } from "../lib/client/api";
import { COACH_SLOTS, PICKS, type CoachSlot } from "../lib/shared/coach";
import { costUsd, formatCost } from "../lib/shared/models";
import type { CardInfo } from "../lib/shared/types";
import { canAdd, colorWords, workshopIdentity, type WorkshopDeck } from "../lib/shared/workshop";

interface Pick {
  card: CardInfo;
  why: string;
}

export function CardPicks({
  ws,
  slot,
  note,
  auth,
  getTurnstile,
  freeLeft,
  onDealt,
  passed,
  onPass,
  onKeep,
  onNeedKey,
  onClose,
}: {
  ws: WorkshopDeck;
  slot: CoachSlot;
  /** e.g. "Card draw: 2 of 9–12" */
  note?: string;
  /** the visitor's own key, or `free`: one of the site's free deals */
  auth: { apiKey?: string; savedKey?: boolean; free?: boolean };
  /** a fresh bot-check token, for a free deal */
  getTurnstile?: () => Promise<string | undefined>;
  /** free deals left today, when dealing on the site's key */
  freeLeft?: number;
  /** after every deal (the page refreshes the free deals left) */
  onDealt?: () => void;
  /** cards passed on for this slot earlier (not offered again) */
  passed: string[];
  onPass: (names: string[]) => void;
  onKeep: (c: CardInfo) => void;
  onNeedKey: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steer, setSteer] = useState("");
  const [cost, setCost] = useState(0);
  const [outOfFree, setOutOfFree] = useState(false);
  const run = useRef<AbortController | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const cmd = ws.commander?.name.split(",")[0].split(" // ")[0] ?? "your commander";

  const deal = async (skip: string[]) => {
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setPicks([]);
    setError(null);
    setBusy(true);
    setStatus("Claude is reading your deck");
    const w = wsRef.current;
    try {
      const req = {
        commander: w.commander?.name ?? "",
        partner: w.partner?.name ?? null,
        bracket: w.bracket,
        cards: w.cards.map((c) => ({ name: c.name, qty: c.qty })),
        slot,
        passed: skip,
        ...(steer.trim() ? { steer: steer.trim() } : {}),
      };
      const turnstile = auth.free ? await getTurnstile?.() : undefined;
      for await (const ev of coachDeal(req, { ...auth, turnstile }, ctl.signal)) {
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "pick") setPicks((p) => [...p, { card: ev.card, why: ev.why }]);
        else if (ev.type === "usage") {
          const usd = costUsd(ev.model, ev.usage);
          if (usd != null) setCost((c) => c + usd);
        } else if (ev.type === "error") setError(ev.message);
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
      if (e instanceof ApiError && e.code === "needs_key") return onNeedKey();
      if (e instanceof ApiError && e.code === "free_deals_used") setOutOfFree(true);
      setError((e as Error).message);
    } finally {
      if (run.current === ctl) {
        setBusy(false);
        setStatus("");
      }
      onDealt?.();
    }
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    void deal(passed);
    return () => run.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the cards on the table that weren't kept are passed on when the player deals again
  const inDeck = (c: CardInfo) => wsRef.current.cards.some((x) => x.name.toLowerCase() === c.name.toLowerCase());
  const again = () => {
    const skip = picks.filter((p) => !inDeck(p.card)).map((p) => p.card.name);
    const all = [...new Set([...passed, ...skip, ...picks.map((p) => p.card.name)])];
    onPass(skip);
    void deal(all);
  };

  const label = COACH_SLOTS[slot].label;
  return (
    <dialog ref={ref} className="modal picks" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="picks-h" data-testid="card-picks">
      <div className="picks-inner">
        <header className="picks-head">
          <div>
            <p className="picks-kicker">{note ?? label}</p>
            <h2 id="picks-h">Three for {cmd}. Keep any you like.</h2>
          </div>
          <button type="button" className="picks-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="picks-row">
          {Array.from({ length: PICKS }, (_, i) => {
            const p = picks[i];
            if (!p)
              return (
                <div key={`wait-${i}`} className={`pick pick--empty ${busy ? "is-busy" : ""}`} aria-hidden>
                  <span className="pick-back" />
                </div>
              );
            const kept = inDeck(p.card);
            const why = kept ? null : canAdd(ws, p.card);
            return (
              <article key={p.card.name} className={`pick ${kept ? "is-kept" : ""}`} data-testid="pick">
                <CardFace card={p.card} className="pick-card" />
                <div className="pick-title">
                  <h3>{p.card.name}</h3>
                  <ManaCost cost={p.card.manaCost} />
                </div>
                <p className="pick-type">{p.card.typeLine}</p>
                <p className="pick-why">{p.why}</p>
                <button type="button" className={`btn ${kept ? "" : "btn--brass"}`} onClick={() => onKeep(p.card)} disabled={kept || !!why} title={why ?? undefined} aria-pressed={kept} data-testid="pick-keep">
                  {kept ? "In your deck ✓" : "Keep this one"}
                </button>
              </article>
            );
          })}
        </div>

        <p className="picks-status" role="status">
          {error ? <span className="error">{error}</span> : busy ? status ? `${status}…` : "" : picks.length < PICKS && picks.length ? "That's all that fit. Deal again, or steer it." : ""}
        </p>

        <div className="picks-foot">
          {outOfFree || (auth.free && freeLeft === 0 && !busy) ? (
            <button type="button" className="btn btn--brass" onClick={onNeedKey} data-testid="pick-add-key">
              Add your Claude key
            </button>
          ) : (
            <button type="button" className="btn" onClick={again} disabled={busy} data-testid="pick-again">
              Deal 3 more
            </button>
          )}
          <label className="picks-steer">
            <span>Steer it</span>
            <input
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && again()}
              placeholder="optional: cheaper, no creatures, under 3 mana…"
              maxLength={160}
              data-testid="pick-steer"
            />
          </label>
        </div>
        <p className="note picks-note">
          Every pick is checked on Scryfall: Commander-legal, {colorWords(workshopIdentity(ws))}, not in your deck yet.{" "}
          {auth.free
            ? `A free deal on Claude Haiku${freeLeft != null ? `: ${freeLeft} left today` : ""}. Add your own Claude key for as many as you like.`
            : `Uses your Claude key (Claude Haiku)${cost ? `: ${formatCost(cost)} so far` : ""}.`}
        </p>
      </div>
    </dialog>
  );
}

/** The slots to offer, the deck's biggest gaps first. */
export function pickSlots(checks: { key: string; label: string; have: number; want: readonly [number, number]; status: string }[]): { slot: CoachSlot; note?: string }[] {
  const toSlot: Record<string, CoachSlot> = { lands: "land", ramp: "ramp", draw: "draw", removal: "removal", wipe: "wipe", protection: "protection" };
  const short = checks
    .filter((c) => c.status === "short")
    .sort((a, b) => (b.want[0] - b.have) / b.want[0] - (a.want[0] - a.have) / a.want[0])
    .map((c) => ({ slot: toSlot[c.key], note: `${c.label}: ${c.have} of ${c.want[0]}–${c.want[1]}` }));
  const rest: { slot: CoachSlot; note?: string }[] = [{ slot: "synergy" }, { slot: "wincon" }];
  return [...short.filter((s) => s.slot !== "land"), ...rest];
}

