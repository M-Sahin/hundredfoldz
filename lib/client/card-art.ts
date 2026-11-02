"use client";
import { cardByName } from "./api";

// commander art for the cards: looked up once per name and kept for this tab
const art = new Map<string, Promise<string | null>>();
export function commanderArt(name: string): Promise<string | null> {
  const key = `hundredfold:art:${name}`;
  if (!art.has(name)) {
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(key);
    } catch {}
    art.set(
      name,
      cached
        ? Promise.resolve(cached || null)
        : cardByName(name)
            .then((c) => {
              const url = c.artCrop ?? null;
              try {
                sessionStorage.setItem(key, url ?? "");
              } catch {}
              return url;
            })
            .catch(() => null),
    );
  }
  return art.get(name)!;
}
