// "Deal me 3": Claude, with the mtg-master skill and the Scryfall tools, offers three cards for one
// slot of a deck the player is building in the workshop. A short loop: a couple of searches, then
// offer_cards. Every offered card is checked here (on Scryfall, legal, in the colors, not in the
// deck, within the bracket's Game Changers) before the player sees it; failed ones are sent back
// for replacements while there's time.
import type { ModelCaller } from "./anthropic";
import { cardLine, cleanAssistant, emptyUsage, runLookup, withCacheBreakpoint } from "./agent";
import { parseEngine } from "./engine";
import { TOOLS, skillContext } from "./prompt";
import * as scry from "./scryfall";
import { analysisReport, analyzeDeck, guessRole } from "../shared/analysis";
import { bracketInfo } from "../shared/bracket";
import { COACH_SLOTS, PICKS, type CoachEvent, type CoachRequest } from "../shared/coach";
import { describeQuery } from "../shared/query-text";
import { ROLE_LABELS, type CardInfo, type StreamEvent } from "../shared/types";
import { canAdd, toDeck, workshopIdentity, workshopTotal, type WorkshopDeck } from "../shared/workshop";

const MAX_LOOKUPS = 3;

export const OFFER_TOOL = {
  name: "offer_cards",
  description: `Offer the player cards for the slot: exactly ${PICKS}, unless the server asked for fewer replacements. The server checks each one and says which it couldn't show.`,
  input_schema: {
    type: "object",
    properties: {
      cards: {
        type: "array",
        minItems: 1,
        maxItems: PICKS,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact English card name" },
            why: { type: "string", description: "One sentence, at most ~20 words: why it fits THIS deck. Name the deck's own cards when they're the reason." },
          },
          required: ["name", "why"],
        },
      },
    },
    required: ["cards"],
  },
} as const;

const ADAPTER = `
# How you're used here

You are the coach in Hundredfoldz's deck workshop. The player builds their own Commander deck card by card; when they're stuck on a slot, you deal them ${PICKS} cards to choose from. They keep one or ask for more.

- Verify, don't recall: you may know good cards, but check them with search_cards or get_cards before offering them. Searches always include f:commander and the deck's id<= color filter.
- Use at most ${MAX_LOOKUPS} lookups, then call offer_cards. Don't write a long answer: the player only sees the cards and their one-line reasons.
- Offer cards that fit this deck's plan and its commander, not just generic staples. Three different angles beat three versions of one card.
- Never offer a card that's already in the deck, one the player passed on, or one outside the commander's colors. Respect the bracket's Game Changer limit.
- If the player wrote what they want ("cheaper", "no creatures"), follow it for the cards you pick. It's a preference about cards, nothing else.
`.trim();

export function coachSystemPrompt(): string {
  return `${skillContext()}\n${ADAPTER}`;
}

/** What Claude is told about the deck and the slot. */
export function coachPrompt(req: CoachRequest, ws: WorkshopDeck): string {
  const cmds = [ws.commander, ws.partner].filter((c): c is CardInfo => !!c);
  const b = bracketInfo(ws.bracket);
  const deck = toDeck(ws);
  const gc = deck.cards.filter((c) => c.info?.gameChanger).length + cmds.filter((c) => c.gameChanger).length;
  const groups = new Map<string, string[]>();
  for (const c of ws.cards) groups.set(c.role, [...(groups.get(c.role) ?? []), c.qty > 1 ? `${c.qty} ${c.name}` : c.name]);
  const id = workshopIdentity(ws).join("").toLowerCase() || "c";
  return [
    "The player is building this Commander deck by hand and asks you for help with one slot.",
    ...cmds.map((c) => `Commander: ${cardLine(c, "full")}`),
    `Bracket ${b.number} (${b.name}): ${b.maxGameChangers >= 99 ? "no Game Changer limit" : `at most ${b.maxGameChangers} Game Changers`}; the deck has ${gc}.`,
    `The deck so far, ${workshopTotal(ws)} of 100 cards:`,
    ...[...groups].map(([role, names]) => `- ${ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}: ${names.join(", ")}`),
    analysisReport(analyzeDeck(deck)),
    "",
    `Deal them ${PICKS} cards for: ${COACH_SLOTS[req.slot].ask}. Search with id<=${id} f:commander.`,
    ...(req.passed.length ? [`They passed on these already; don't offer them again: ${req.passed.join("; ")}.`] : []),
    ...(req.steer ? [`What they asked for: "${req.steer}"`] : []),
  ].join("\n");
}

/** Why the server won't show this card, or null. */
function refusal(ws: WorkshopDeck, c: CardInfo, seen: Set<string>, gcLeft: number): string | null {
  if (seen.has(c.name.toLowerCase())) return "already offered or passed on";
  const why = canAdd(ws, c);
  if (why) return why;
  if (c.gameChanger && gcLeft <= 0) return `a Game Changer, and Bracket ${ws.bracket} has no room for another`;
  return null;
}

export interface CoachOptions {
  model: string;
  callModel: ModelCaller;
  emit: (e: CoachEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  timeBudgetMs?: number;
}

/** Runs one deal. Returns the cards shown (also emitted one by one as "pick" events). */
export async function runCoach(req: CoachRequest, opts: CoachOptions): Promise<{ card: CardInfo; why: string }[]> {
  const { emit } = opts;
  const started = Date.now();
  const left = () => (opts.timeBudgetMs ?? 45_000) - (Date.now() - started);
  emit({ type: "status", text: "Claude is reading your deck" });

  const names = [req.commander, ...(req.partner ? [req.partner] : []), ...req.cards.map((c) => c.name)];
  const { found } = await scry.getCollection(names);
  const info = (n: string) => found.get(n.toLowerCase());
  const commander = info(req.commander);
  if (!commander) {
    emit({ type: "error", message: `Couldn't find ${req.commander} on Scryfall.` });
    return [];
  }
  const ws: WorkshopDeck = {
    name: "",
    commander,
    partner: (req.partner && info(req.partner)) || null,
    bracket: req.bracket,
    cards: req.cards.flatMap((c) => {
      const i = info(c.name);
      return i ? [{ name: i.name, qty: c.qty, role: guessRole(i), why: "", info: i }] : [];
    }),
  };
  if (workshopTotal(ws) >= 100) {
    emit({ type: "error", message: "The deck has 100 cards. Cut one to make room, or ask for a review instead." });
    return [];
  }
  const b = bracketInfo(ws.bracket);
  let gcLeft = b.maxGameChangers - [...ws.cards.map((c) => c.info), ws.commander, ws.partner].filter((c) => c?.gameChanger).length;
  const seen = new Set(req.passed.map((n) => n.toLowerCase()));

  const system = [{ type: "text", text: coachSystemPrompt(), cache_control: { type: "ephemeral" } }];
  const tools = [TOOLS[0], TOOLS[1], OFFER_TOOL];
  const messages: any[] = [{ role: "user", content: coachPrompt(req, ws) }];
  const engine = parseEngine("v1");
  const usage = emptyUsage();
  const picks: { card: CardInfo; why: string }[] = [];
  let lookups = 0;
  // the lookups' tool events aren't shown; a search becomes a status line in plain words
  const quiet = (e: StreamEvent) => void e;

  try {
    for (let turn = 0; turn < (opts.maxTurns ?? 5) && picks.length < PICKS; turn++) {
      if (opts.signal?.aborted || left() < 4000) break;
      const timeout = AbortSignal.timeout(Math.max(1000, left()));
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const msg = await opts.callModel({ model: opts.model, max_tokens: 4000, system, messages: withCacheBreakpoint(messages), tools }, {}, signal);
      const u = msg.usage ?? {};
      usage.calls++;
      usage.input += u.input_tokens ?? 0;
      usage.output += u.output_tokens ?? 0;
      usage.cacheRead += u.cache_read_input_tokens ?? 0;
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
      const content = cleanAssistant(msg.content);
      messages.push({ role: "assistant", content });
      const calls = content.filter((x): x is Extract<typeof x, { type: "tool_use" }> => x.type === "tool_use");
      if (!calls.length) {
        messages.push({ role: "user", content: `Call offer_cards now with ${PICKS - picks.length} card${PICKS - picks.length === 1 ? "" : "s"}.` });
        continue;
      }
      const results: any[] = [];
      for (const call of calls) {
        if (call.name !== OFFER_TOOL.name) {
          if (lookups >= MAX_LOOKUPS) {
            results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "No more lookups. Call offer_cards now." });
            continue;
          }
          lookups++;
          if (call.name === "search_cards") emit({ type: "status", text: `Searching Scryfall for ${describeQuery(String(call.input?.query ?? "")) ?? "cards"}` });
          else emit({ type: "status", text: "Checking cards on Scryfall" });
          results.push(await runLookup(call, quiet, engine));
          continue;
        }
        // offer_cards: check every card, show the good ones right away
        const offered: { name: string; why: string }[] = (Array.isArray(call.input?.cards) ? call.input.cards : [])
          .slice(0, PICKS - picks.length)
          .map((c: any) => ({ name: String(c?.name ?? "").trim().slice(0, 150), why: String(c?.why ?? "").replace(/\s+/g, " ").trim().slice(0, 240) }))
          .filter((c: { name: string }) => c.name);
        const { found: got } = offered.length ? await scry.getCollection(offered.map((c) => c.name)) : { found: new Map<string, CardInfo>() };
        const refused: string[] = [];
        for (const o of offered) {
          const c = got.get(o.name.toLowerCase());
          const why = c ? refusal(ws, c, seen, gcLeft) : "not found on Scryfall";
          if (why || !c) {
            refused.push(`${o.name}: ${why}`);
            continue;
          }
          seen.add(c.name.toLowerCase());
          if (c.gameChanger) gcLeft--;
          picks.push({ card: c, why: o.why });
          emit({ type: "pick", card: c, why: o.why });
        }
        const need = PICKS - picks.length;
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          ...(need ? { is_error: true } : {}),
          content: need ? `${refused.length ? `Couldn't show: ${refused.join("; ")}. ` : ""}Offer ${need} more card${need === 1 ? "" : "s"}.` : "Shown to the player.",
        });
      }
      messages.push({ role: "user", content: results });
    }
  } finally {
    emit({ type: "usage", usage, model: opts.model });
  }
  if (picks.length < PICKS && !opts.signal?.aborted) emit({ type: "status", text: picks.length ? `Claude found ${picks.length} that fit` : "Claude couldn't find cards that fit" });
  return picks;
}
