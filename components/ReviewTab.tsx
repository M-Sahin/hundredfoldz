"use client";
// The deck's Review tab: Claude's review when there is one (what works, what doesn't, which cards
// work together), then what the numbers say (free, for every deck), then combos Commander
// Spellbook knows. Card names are buttons that open the card.
import { useMemo } from "react";
import { analyzeDeck } from "../lib/shared/analysis";
import { deckFindings, type ComboFinding, type Finding } from "../lib/shared/findings";
import type { OpenerReport } from "../lib/shared/openers";
import type { Deck, DeckCard, Validation } from "../lib/shared/types";

/** The deck card with this name (or a bare one, so the card view can still open). */
export function findCard(deck: Deck, name: string): DeckCard {
  const key = name.toLowerCase();
  const all = [deck.commander, ...(deck.partner ? [deck.partner] : []), ...deck.cards];
  return all.find((c) => c.name.toLowerCase() === key || c.name.toLowerCase().split(" // ")[0] === key) ?? { name, qty: 1, role: "utility", why: "" };
}

function Cards({ names, onOpen }: { names: string[]; onOpen: (n: string) => void }) {
  return (
    <span className="review-cards">
      {names.map((n) => (
        <button key={n} type="button" className="review-card" onClick={() => onOpen(n)}>
          {n}
        </button>
      ))}
    </span>
  );
}

function List({ items, tone, onOpen }: { items: Finding[]; tone: "good" | "bad"; onOpen: (n: string) => void }) {
  if (!items.length) return <p className="fine">Nothing stands out here.</p>;
  return (
    <ul className={`review-list review-list--${tone}`}>
      {items.map((f, i) => (
        <li key={i}>
          <strong>{f.topic}:</strong> {f.text} {f.cards?.length ? <Cards names={f.cards} onOpen={onOpen} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function ReviewTab({
  deck,
  validation,
  openers,
  combos = [],
  onAskReview,
  onOpen,
}: {
  deck: Deck;
  validation: Validation;
  openers: OpenerReport | null;
  combos?: ComboFinding[];
  onAskReview?: () => void;
  onOpen: (name: string) => void;
}) {
  const f = useMemo(() => deckFindings(analyzeDeck(deck), openers, validation, combos), [deck, openers, validation, combos]);
  const r = deck.review;
  return (
    <div className="review" data-testid="review-tab">
      {r ? (
        <section className="panel review-claude" data-testid="claude-review">
          <h3>Claude&apos;s review</h3>
          <div className="review-cols">
            <div>
              <h4>What works</h4>
              <ul className="review-list review-list--good">
                {r.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>What holds it back</h4>
              <ul className="review-list review-list--bad">
                {r.weaknesses.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          {r.synergies.length ? (
            <>
              <h4>Cards that work together</h4>
              <ul className="review-synergies">
                {r.synergies.map((s, i) => (
                  <li key={i}>
                    <Cards names={s.cards} onOpen={onOpen} />
                    <span>{s.why}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : onAskReview ? (
        <section className="panel review-ask">
          <h3>Ask Claude for a review</h3>
          <p className="panel-sub">Claude reads the whole deck and tells you what works, what holds it back and which cards work together, then suggests up to 10 swaps for the bracket and budget you choose. It uses one build: a free one, or your own Claude API key.</p>
          <button type="button" className="btn btn--brass" onClick={onAskReview} data-testid="ask-review">
            Review my deck with Claude
          </button>
        </section>
      ) : null}

      <section className="panel">
        <h3>What the numbers say</h3>
        <p className="fine">Counted from the cards&apos; text and thousands of simulated opening hands, against what most Commander decks run in brackets 2 and 3.</p>
        <div className="review-cols">
          <div>
            <h4>Strong</h4>
            <List items={f.strong} tone="good" onOpen={onOpen} />
          </div>
          <div>
            <h4>Weak</h4>
            <List items={f.weak} tone="bad" onOpen={onOpen} />
          </div>
        </div>
      </section>

      {f.combos.length ? (
        <section className="panel">
          <h3>Combos in the deck</h3>
          <ul className="review-synergies">
            {f.combos.map((c, i) => (
              <li key={i}>
                <Cards names={c.cards} onOpen={onOpen} />
                <span>
                  {c.results.slice(0, 2).join(", ") || "Combo"}
                  {c.url ? (
                    <>
                      {" "}
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        on Commander Spellbook
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
