"use client";
// The workshop's "Start from a decklist": paste a list or upload a .txt, and the deck opens in the
// workshop with every card's Scryfall data. The bracket checker's reader, without its extras.
import { useState } from "react";
import type { BracketReport } from "../lib/server/bracket-check";
import type { Deck, Validation } from "../lib/shared/types";
import { useHumanCheck } from "./useHumanCheck";

type Read = BracketReport & { view?: { deck: Deck; validation: Validation }; error?: string };

export function DecklistImport({ onOpen, onCancel }: { onOpen: (deck: Deck, notFound: string[]) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const human = useHumanCheck("bracket");

  const read = async (list: string) => {
    setBusy(true);
    setError(null);
    try {
      const turnstile = await human.take();
      const r = await fetch("/api/bracket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ list, turnstile, withDeck: true, quick: true }) });
      const j = (await r.json()) as Read;
      if (!r.ok) throw new Error(j.error ?? "Couldn't read that list.");
      if (!j.view) throw new Error("We couldn't find the commander. Put it under a “Commander” heading (or first, followed by an empty line) and try again.");
      onOpen(j.view.deck, j.notFound);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const file = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) return setError("That file is too big for a decklist.");
    const t = await f.text();
    setText(t);
    void read(t);
  };

  return (
    <div className="ws-import" data-testid="ws-import">
      <p className="panel-sub">Paste a list from Moxfield, Archidekt, MTG Arena or any &ldquo;1 Card name&rdquo; list, or upload a .txt. The deck opens here, card by card, so you can keep building it.</p>
      <textarea
        className="field"
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n1 Viscera Seer\n…"}
        aria-label="Your decklist"
        data-testid="ws-import-list"
        spellCheck={false}
      />
      {human.widget}
      <div className="ws-import-actions">
        <button type="button" className="btn btn--brass" disabled={!text.trim() || busy} onClick={() => void read(text)} data-testid="ws-import-go">
          {busy ? "Reading…" : "Open my deck"}
        </button>
        <label className="btn">
          Upload a .txt file
          <input type="file" accept=".txt,text/plain" hidden onChange={(e) => void file(e.target.files?.[0])} />
        </label>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
