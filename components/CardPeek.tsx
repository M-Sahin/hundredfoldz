"use client";

import { useCallback, useState, type FocusEvent, type PointerEvent } from "react";
import type { CardInfo } from "../lib/shared/types";

const W = 244; // the picture's width; a card is 63 × 88
const H = Math.round((W * 88) / 63);
const GAP = 24;

interface Peek {
  src: string;
  alt: string;
  x: number;
  y: number;
}

/** A card's picture next to the pointer while you hover its name in a list, as deckbuilding sites do.
 *  Mouse only (a tap opens the card view as before); keyboard focus shows it beside the row. */
export function useCardPeek() {
  const [peek, setPeek] = useState<Peek | null>(null);

  const place = (x: number, y: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = x + GAP + W > vw ? Math.max(8, x - GAP - W) : x + GAP;
    const top = Math.min(Math.max(8, y - H / 2), vh - H - 8);
    return { x: left, y: top };
  };

  const bind = useCallback((info: CardInfo | undefined | null) => {
    const src = info?.image;
    if (!src) return {};
    const alt = info.name;
    return {
      onPointerEnter: (e: PointerEvent) => e.pointerType === "mouse" && setPeek({ src, alt, ...place(e.clientX, e.clientY) }),
      onPointerMove: (e: PointerEvent) => e.pointerType === "mouse" && setPeek((p) => (p && p.src === src ? { ...p, ...place(e.clientX, e.clientY) } : p)),
      onPointerLeave: () => setPeek(null),
      onFocus: (e: FocusEvent) => {
        if (!e.currentTarget.matches(":focus-visible")) return;
        const r = e.currentTarget.getBoundingClientRect();
        setPeek({ src, alt, ...place(r.right, r.top + r.height / 2) });
      },
      onBlur: () => setPeek(null),
    };
  }, []);

  const el = peek ? (
    <div className="card-peek" aria-hidden style={{ transform: `translate(${peek.x}px, ${peek.y}px)` }}>
      <img src={peek.src} alt="" width={W} height={H} />
    </div>
  ) : null;

  return { bind, el };
}
