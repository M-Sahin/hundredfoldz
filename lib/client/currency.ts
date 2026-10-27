"use client";
// The visitor's currency: their own choice (kept in this browser), or what the server picked from
// their country (euros in Europe, dollars elsewhere). Shared by every component on the page.
import { useSyncExternalStore } from "react";
import { useSiteConfig } from "./site-config";
import { isCurrency, type Currency } from "../shared/currency";

const KEY = "hundredfold:currency";
const listeners = new Set<() => void>();

function read(): Currency | null {
  try {
    const v = localStorage.getItem(KEY);
    return isCurrency(v) ? v : null;
  } catch {
    return null;
  }
}

let chosen: Currency | null | undefined;
const snapshot = () => (chosen === undefined ? (chosen = read()) : chosen);

export function setCurrency(c: Currency) {
  chosen = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {}
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      chosen = read();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCurrency(): Currency {
  const site = useSiteConfig();
  const mine = useSyncExternalStore(subscribe, snapshot, () => null);
  return mine ?? site?.currency ?? "EUR";
}
