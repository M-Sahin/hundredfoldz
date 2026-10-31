"use client";

import { useEffect } from "react";

/** A soft light that follows the mouse over the felt (.playmat, .mat). Only with a mouse, and not when the
 *  visitor asks for less motion. One listener for the whole page; at most one update per frame. */
export function MatLight() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lit: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const off = () => {
      lit?.classList.remove("is-lit");
      lit = null;
    };
    const paint = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const mat = e.target instanceof Element ? (e.target.closest(".playmat, .mat") as HTMLElement | null) : null;
      if (mat !== lit) {
        off();
        lit = mat;
        mat?.classList.add("is-lit");
      }
      if (!mat) return;
      const r = mat.getBoundingClientRect();
      mat.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
      mat.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !fine.matches || calm.matches) return;
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", off);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", off);
      if (frame) cancelAnimationFrame(frame);
      off();
    };
  }, []);
  return null;
}
