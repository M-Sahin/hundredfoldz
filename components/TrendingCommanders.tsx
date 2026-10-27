"use client";
// Under "Surprise me": commanders to start from, the most-built new ones and the all-time
// favorites (Scryfall's EDHREC rank). Tapping one puts it in the first slot as the commander.
import { useEffect, useState } from "react";
import { IdentityPips } from "./CardFace";
import type { TrendingCommander } from "../lib/server/trending";

type Tab = "fresh" | "allTime";

export function TrendingCommanders({ onPick }: { onPick: (name: string) => void }) {
  const [data, setData] = useState<{ fresh: TrendingCommander[]; allTime: TrendingCommander[] } | null>(null);
  const [tab, setTab] = useState<Tab>("fresh");
  useEffect(() => {
    let live = true;
    fetch("/api/trending")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        setData(j);
        if (!j.fresh?.length) setTab("allTime");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!data || (!data.fresh.length && !data.allTime.length)) return null;
  const list = data[tab];
  return (
    <div className="trending" data-testid="trending">
      <div className="trending-head">
        <span className="examples-label">Popular commanders</span>
        <span className="trending-tabs" role="tablist" aria-label="Which commanders">
          {(
            [
              ["fresh", "New"],
              ["allTime", "All time"],
            ] as [Tab, string][]
          )
            .filter(([k]) => data[k].length)
            .map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`trending-tab ${tab === k ? "is-on" : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
        </span>
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
      <p className="trending-note">{tab === "fresh" ? "New commanders from the last few months, " : "The commanders "}most played on EDHREC. Tap one to build around it.</p>
    </div>
  );
}
