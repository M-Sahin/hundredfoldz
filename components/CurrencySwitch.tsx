"use client";
// € or $: which prices to show (and to build budgets in). Remembered in this browser.
import { setCurrency, useCurrency } from "../lib/client/currency";
import { CURRENCIES, symbol } from "../lib/shared/currency";

export function CurrencySwitch({ label = "Prices in" }: { label?: string }) {
  const cur = useCurrency();
  return (
    <span className="cur-switch" role="group" aria-label={label} data-testid="currency-switch">
      <span className="cur-switch-label">{label}</span>
      {CURRENCIES.map((c) => (
        <button key={c} type="button" className={`cur-switch-btn ${cur === c ? "is-on" : ""}`} aria-pressed={cur === c} onClick={() => setCurrency(c)} data-testid={`currency-${c}`}>
          {symbol(c)} {c === "EUR" ? "Euro" : "Dollar"}
        </button>
      ))}
    </span>
  );
}
