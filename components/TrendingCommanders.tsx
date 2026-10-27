"use client";
// Under "Surprise me": the most-played new commanders (Scryfall's EDHREC rank among commanders
// first printed in the last few months). Tapping one puts it in the first slot as the commander.
import { useEffect, useState } from "react";
import { IdentityPips } from "./CardFace";
import type { TrendingCommander } from "../lib/server/trending";

export function TrendingCommanders({ onPick }: { onPick: (name: string) => void }) {
  const [list, setList] = useState<TrendingCommander[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/trending")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setList(j?.fresh ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!list?.length) return null;
  return (
    <div className="trending" data-testid="trending">
      <div className="trending-head">
        <span className="examples-label">Popular new commanders</span>
      </div>
      <ul className="trending-list">
        {list.map((c) => (
          <li key={c.name}>
            <button type="button" className="trending-card" onClick={() => onPick(c.name)} title={`Build around ${c.name}`}>
              <span className="trending-art" style={c.artCrop ? { backgroundImage: `url("${c.artCrop}")` } : undefined}>
                <span className="trending-pips">
                  <IdentityPips colors={c.colorIdentity} size={11} />
                </span>
              </span>
              <span className="trending-name">{c.name.split(" // ")[0]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="trending-note">From the last few months, most played on EDHREC. Tap one to build around it.</p>
    </div>
  );
}
