"use client";
// Shop buttons for a deck's cards or a sealed box, with an affiliate disclosure when tagged.
import { useState } from "react";
import { AFFILIATE_NOTE, type BuyLink } from "../lib/shared/buy";
import { track } from "../lib/client/track";

const shopEvent = (shop: string) => (["tcgplayer", "cardkingdom", "cardmarket"].includes(shop) ? `buy|${shop}` : "buy|other") as "buy|other";

export function BuyLinks({ links, copyText, note }: { links: BuyLink[]; copyText?: string; note?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const tagged = links.some((l) => l.tagged);
  return (
    <div className="buy" data-testid="buy-links">
      <div className="buy-shops">
        {links.map((l) =>
          l.copyFirst && copyText ? (
            <button
              key={l.shop}
              type="button"
              className="btn buy-shop"
              onClick={async () => {
                track(shopEvent(l.shop));
                let ok = true;
                try {
                  await navigator.clipboard.writeText(copyText);
                } catch {
                  ok = false;
                }
                window.open(l.href, "_blank", "noopener,noreferrer");
                setMsg(ok ? `List copied. On ${l.label}: ${l.copyFirst}.` : "Your browser blocked the clipboard. Use Copy list, then paste it there.");
              }}
            >
              {l.label} <small>{l.region}</small>
            </button>
          ) : (
            <a key={l.shop} className="btn buy-shop" onClick={() => track(shopEvent(l.shop))} href={l.href} target="_blank" rel={`noopener noreferrer${l.tagged ? " sponsored" : ""}`}>
              {l.label} <small>{l.region}</small>
            </a>
          ),
        )}
      </div>
      {msg ? <p className="note">{msg}</p> : null}
      {note ? <p className="opt-hint">{note}</p> : null}
      {tagged ? <p className="opt-hint buy-disclosure">{AFFILIATE_NOTE}</p> : null}
    </div>
  );
}
