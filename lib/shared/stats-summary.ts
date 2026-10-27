// Turns the daily counts into what the /stats page shows: totals, rates and funnels.
export interface Day {
  date: string;
  counts: Record<string, number>;
  errors: Record<string, number>;
}

export type Totals = Record<string, number>;

export function totals(days: Day[]): Totals {
  const t: Totals = {};
  for (const d of days) for (const [k, v] of Object.entries(d.counts)) t[k] = (t[k] ?? 0) + v;
  return t;
}

/** The sum of `name|*` (or exactly `name`). */
export function sum(t: Totals, name: string): number {
  return Object.entries(t).reduce((n, [k, v]) => (k === name || k.startsWith(`${name}|`) ? n + v : n), 0);
}

/** `name|detail` → count, biggest first, without zeros. */
export function breakdown(t: Totals, name: string): [string, number][] {
  return Object.entries(t)
    .filter(([k, v]) => k.startsWith(`${name}|`) && v > 0)
    .map(([k, v]) => [k.slice(name.length + 1), v] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

/** a / b as a whole percentage, or null when there's nothing to divide by. */
export function pct(a: number, b: number): number | null {
  return b > 0 ? Math.round((a / b) * 100) : null;
}

export function topErrors(days: Day[], n = 10): [string, number][] {
  const t: Totals = {};
  for (const d of days) for (const [k, v] of Object.entries(d.errors)) t[k] = (t[k] ?? 0) + v;
  return Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/** Builds that ended on their own (finished or failed), per day, for the chart. */
export function buildsPerDay(days: Day[]): { date: string; ok: number; fail: number; stop: number }[] {
  return days.map((d) => ({ date: d.date, ok: sum(d.counts, "build_ok"), fail: sum(d.counts, "build_fail"), stop: sum(d.counts, "build_stop") }));
}

export const ACCESS_LABEL: Record<string, string> = { free: "Free builds", own: "Own key", saved: "Saved key", server: "Site key (access code)", demo: "Demo" };

export const FAIL_LABEL: Record<string, string> = {
  bad_seeds: "Seed cards not found",
  not_commander: "Commander can't be a commander",
  unreadable_deck: "Couldn't read the deck",
  refused: "Claude declined",
  no_deck: "No legal deck in time",
  credit: "Out of credit",
  spend_limit: "Spend limit reached",
  bad_key: "Key not accepted",
  no_access: "Model not available to the key",
  rate_limit: "Claude rate limit",
  overloaded: "Claude overloaded",
  error: "Other error",
};

export const TIME_ORDER = ["under_1m", "1_2m", "2_3m", "3_4m", "over_4m"];
export const TIME_LABEL: Record<string, string> = { under_1m: "Under 1 min", "1_2m": "1–2 min", "2_3m": "2–3 min", "3_4m": "3–4 min", over_4m: "Over 4 min" };
