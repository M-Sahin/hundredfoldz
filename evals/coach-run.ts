// Real Claude Haiku runs of the workshop coach (deal, plan, verdict) on live Scryfall, with tokens and cost.
// Not in CI. Run: npx esbuild evals/coach-run.ts --bundle --platform=node --format=esm --target=node22 --outfile=.test-build/coach-run.mjs
//   then: HF_ROOT=. OUT=.test-build/coach-run.json node --env-file=.env .test-build/coach-run.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicCaller } from "../lib/server/anthropic";
import { runCoach, runPlan, runVerdict } from "../lib/server/coach";
import { COACH_MODEL, type CoachEvent, type CoachSlot, type PlanTheme } from "../lib/shared/coach";
import { costUsd } from "../lib/shared/models";

const ROOT = process.env.HF_ROOT!;
const OUT = process.env.OUT!;
const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key) throw new Error("no ANTHROPIC_API_KEY");
const callModel = anthropicCaller(key);

function readList(file: string, take: number) {
  const lines = readFileSync(join(ROOT, "evals", "sample-decks", file), "utf8").split(/\r?\n/).map((l) => l.trim());
  const commander = lines[0].replace(/^\d+\s+/, "");
  const cards = lines.slice(1).filter(Boolean).map((l) => ({ name: l.replace(/^\d+\s+/, ""), qty: Number(l.match(/^(\d+)/)?.[1] ?? 1) }));
  return { commander, cards: cards.slice(0, take) };
}

// workshop states: half built, nearly empty, commander only
const decks = [
  { id: "judith-30", bracket: 3, ...readList("judith-aristocrats--v2--1.txt", 30), slots: ["draw", "removal"] as CoachSlot[], verdict: ["Blood Artist", "Commander's Sphere"] },
  { id: "krenko-10", bracket: 3, ...readList("krenko-goblins--v2--1.txt", 10), slots: ["ramp", "wincon"] as CoachSlot[], verdict: ["Abrade", "Goblin Bombardment"] },
  { id: "aminatou-0", bracket: 2, ...readList("esper-flicker--v2--1.txt", 0), slots: ["synergy", "protection"] as CoachSlot[], verdict: ["Ephemerate", "Anguished Unmaking"] },
  { id: "azusa-0", bracket: 3, commander: "Azusa, Lost but Seeking", cards: [] as { name: string; qty: number }[], slots: ["draw", "land"] as CoachSlot[], verdict: ["Exploration", "Scute Swarm"] },
];

type Row = { deck: string; kind: string; what: string; ms: number; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number | null; shown: number; result: unknown; errors: string[]; statuses: string[] };
const rows: Row[] = [];

async function one(deck: string, kind: string, what: string, fn: (opts: any) => Promise<unknown>) {
  const events: CoachEvent[] = [];
  const t = Date.now();
  let result: unknown;
  try {
    result = await fn({ model: COACH_MODEL, callModel, emit: (e: CoachEvent) => events.push(e) });
  } catch (e) {
    events.push({ type: "error", message: String((e as Error)?.message ?? e) });
  }
  const u = (events.findLast((e) => e.type === "usage") as any)?.usage ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const row: Row = {
    deck, kind, what, ms: Date.now() - t, calls: u.calls, input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite,
    usd: costUsd(COACH_MODEL, u), shown: Array.isArray(result) ? result.length : result ? 1 : 0, result,
    errors: events.filter((e) => e.type === "error").map((e: any) => e.message),
    statuses: events.filter((e) => e.type === "status").map((e: any) => e.text),
  };
  rows.push(row);
  const brief = Array.isArray(result)
    ? result.map((r: any) => (r.card ? `${r.card.name} — ${r.why}` : `${r.name} [${r.total}] ${r.query} — ${r.why}`)).join("\n      ")
    : result ? JSON.stringify({ fit: (result as any).fit, lines: (result as any).lines, better: (result as any).better && `${(result as any).better.card.name} — ${(result as any).better.why}` }) : "(nothing)";
  console.log(`\n[${deck}] ${kind} ${what}: ${row.ms} ms, ${row.calls} calls, in ${row.input} / out ${row.output} / cache r ${row.cacheRead} w ${row.cacheWrite}, $${row.usd?.toFixed(5)}`);
  console.log(`      ${brief}`);
  if (row.errors.length) console.log(`      errors: ${row.errors.join(" | ")}`);
  return result;
}

for (const d of decks) {
  const base = { commander: d.commander, partner: null, bracket: d.bracket, cards: d.cards };
  const themes = (await one(d.id, "plan", "", (o) => runPlan({ mode: "plan", ...base }, o))) as PlanTheme[];
  for (const s of d.slots) await one(d.id, "deal", s, (o) => runCoach({ ...base, slot: s, passed: [] }, o));
  if (themes?.[0]) await one(d.id, "deal", `theme:${themes[0].name}`, (o) => runCoach({ ...base, slot: "synergy", passed: [], theme: { name: themes[0].name, query: themes[0].query } }, o));
  for (const c of d.verdict) await one(d.id, "verdict", c, (o) => runVerdict({ mode: "verdict", ...base, card: c }, o));
}

writeFileSync(OUT, JSON.stringify(rows, null, 2));
const by = (k: string) => rows.filter((r) => r.kind === k);
for (const k of ["deal", "plan", "verdict"]) {
  const rs = by(k);
  const usd = rs.map((r) => r.usd ?? 0);
  const ms = rs.map((r) => r.ms);
  console.log(`\n${k}: n=${rs.length}, avg $${(usd.reduce((a, b) => a + b, 0) / rs.length).toFixed(5)}, max $${Math.max(...usd).toFixed(5)}, avg ${Math.round(ms.reduce((a, b) => a + b, 0) / rs.length)} ms, max ${Math.max(...ms)} ms, shown ${rs.map((r) => r.shown).join(",")}`);
}
console.log(`\ntotal $${rows.reduce((a, r) => a + (r.usd ?? 0), 0).toFixed(4)}`);
