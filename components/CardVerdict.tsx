"use client";
// "Is this card good here?": in the workshop's card view, one short Claude call on this card in
// this deck. Two lines on a paper note, and a better card for the same job when there is one
// (checked on Scryfall and against the deck by the server, and again here with canAdd before it
// can be swapped in). Same key and free deals as card picks; a verdict costs one deal.
import { useEffect, useRef, useState } from "react";
import { CardFace, ManaCost } from "./CardFace";
import type { CoachAccess } from "./DeckPlan";
import { ApiError, coachDeal } from "../lib/client/api";
import { FITS, type CardVerdict } from "../lib/shared/coach";
import type { CardInfo } from "../lib/shared/types";
import { canAdd, removeOne, type WorkshopDeck } from "../lib/shared/workshop";

export function CardVerdictNote({
  ws,
  card,
  access,
  cached,
  onVerdict,
  onSwap,
  onOpen,
}: {
  ws: WorkshopDeck;
  card: CardInfo;
  access: CoachAccess;
  /** the verdict from earlier this visit, if Claude was asked about this card already */
  cached?: CardVerdict;
  onVerdict: (v: CardVerdict) => void;
  /** take the better card: in place of this one when it's in the deck, else instead of adding it */
  onSwap: (better: CardInfo) => void;
  /** open the better card in the card view */
  onOpen: (c: CardInfo) => void;
}) {
  const [verdict, setVerdict] = useState<CardVerdict | null>(cached ?? null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outOfFree, setOutOfFree] = useState(false);
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);
  // another card opened in the same view
  useEffect(() => {
    run.current?.abort();
    setVerdict(cached ?? null);
    setBusy(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.name]);

  const inDeck = ws.cards.some((c) => c.name.toLowerCase() === card.name.toLowerCase());
  const needKey = !access.auth || (access.auth.free && (outOfFree || access.freeLeft === 0));

  const ask = async () => {
    const { auth } = access;
    if (!auth || needKey) return access.onNeedKey();
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setVerdict(null);
    setError(null);
    setBusy(true);
    setStatus("Claude is reading your deck");
    let got: CardVerdict | null = null;
    try {
      const req = {
        mode: "verdict" as const,
        commander: ws.commander?.name ?? "",
        partner: ws.partner?.name ?? null,
        bracket: ws.bracket,
        cards: ws.cards.map((c) => ({ name: c.name, qty: c.qty })),
        card: card.name,
      };
      const turnstile = auth.free ? await access.getTurnstile?.() : undefined;
      for await (const ev of coachDeal(req, { ...auth, turnstile }, ctl.signal)) {
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "verdict") {
          got = ev.verdict;
          setVerdict(ev.verdict);
        } else if (ev.type === "error") setError(ev.message);
      }
      if (got) onVerdict(got);
      else if (!ctl.signal.aborted) setError((e) => e ?? "Claude couldn't judge the card this time. Try again in a bit.");
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

  const cost = !access.auth
    ? "Uses your own Claude API key, on Claude Haiku."
    : access.auth.free
      ? needKey
        ? "Today's free deals are used up. Add your own Claude API key for more."
        : `Claude Haiku, one of today's free deals${access.freeLeft != null ? ` (${access.freeLeft} left)` : ""}.`
      : "Claude Haiku, on your key: a fraction of a cent.";

  if (!verdict && !busy) {
    return (
      <div className="verdict-ask" data-testid="verdict">
        <button type="button" className="btn btn--small" onClick={() => void ask()} data-testid="verdict-ask">
          {needKey ? "Add your Claude key to ask Claude" : "Is this card good here?"}
        </button>
        <span className="note">{cost}</span>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const better = verdict?.better;
  // check the swap here too: the deck may have changed since Claude answered
  const swapWhy = better ? canAdd(inDeck ? removeOne(ws, card.name) : ws, better.card) : null;
  return (
    <div className="paper-note verdict-note" data-testid="verdict" aria-live="polite">
      {busy ? (
        <p className="verdict-status" role="status">
          {status ? `${status}…` : "Asking Claude…"}
        </p>
      ) : verdict ? (
        <>
          <p className="paper-note-text verdict-fit" data-testid="verdict-fit">
            {FITS[verdict.fit]}.
          </p>
          {verdict.lines.map((l) => (
            <p key={l} className="verdict-line">
              {l}
            </p>
          ))}
          {better ? (
            <div className="verdict-better" data-testid="verdict-better">
              <CardFace card={better.card} className="verdict-better-card" onClick={() => onOpen(better.card)} />
              <div>
                <p className="verdict-better-name">
                  <span>Better here:</span>{" "}
                  <button type="button" className="link" onClick={() => onOpen(better.card)}>
                    {better.card.name}
                  </button>{" "}
                  <ManaCost cost={better.card.manaCost} />
                </p>
                <p className="verdict-better-why">{better.why}</p>
                <button type="button" className="btn btn--small btn--ink" onClick={() => onSwap(better.card)} disabled={!!swapWhy} title={swapWhy ?? undefined} data-testid="verdict-swap">
                  {inDeck ? `Swap it in` : `Add it instead`}
                </button>
                {swapWhy ? <p className="verdict-better-why">{swapWhy}</p> : null}
              </div>
            </div>
          ) : null}
          <p className="paper-note-by">
            Claude&apos;s verdict ·{" "}
            <button type="button" className="link" onClick={() => void ask()} data-testid="verdict-again">
              Ask again
            </button>
          </p>
        </>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
