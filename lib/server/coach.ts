// Claude's help in the workshop, on Claude Haiku with the mtg-master skill and the Scryfall tools:
// - "Deal me 3": three cards for one slot (or one theme) of the deck the player is building. A
//   short loop: a couple of searches, then offer_cards. Every offered card is checked here (on
//   Scryfall, legal, in the colors, not in the deck, within the bracket's Game Changers) before the
//   player sees it; failed ones are sent back for replacements while there's time.
// - a deck plan: 3 to 5 themes, each with a Scryfall search. The server runs every search the way
//   the workshop's own search does (commander's colors, Commander-legal) and only keeps themes
//   whose search finds cards; the rest go back to Claude.
import type { ModelCaller } from "./anthropic";
import { cardLine, cleanAssistant, emptyUsage, runLookup, withCacheBreakpoint } from "./agent";
import { searchQuery } from "./card-search";
import { parseEngine } from "./engine";
import { TOOLS, skillContext } from "./prompt";
import * as scry from "./scryfall";
import { analysisReport, analyzeDeck, guessRole } from "../shared/analysis";
import { bracketInfo } from "../shared/bracket";
import { COACH_SLOTS, MIN_THEME_CARDS, PICKS, PLAN_THEMES, type CoachDeck, type CoachEvent, type CoachRequest, type PlanRequest, type PlanTheme } from "../shared/coach";
import { describeQuery } from "../shared/query-text";
import { ROLE_LABELS, type CardInfo, type Color, type StreamEvent } from "../shared/types";
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

export const PLAN_TOOL = {
  name: "plan_deck",
  description: `Give the player ${PLAN_THEMES.min} to ${PLAN_THEMES.max} themes for the deck, each with a Scryfall search for it. The server runs every search in the commander's colors and says which themes it couldn't use.`,
  input_schema: {
    type: "object",
    properties: {
      themes: {
        type: "array",
        minItems: 1,
        maxItems: PLAN_THEMES.max,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The theme in 2 to 4 plain words, like 'Sacrifice for value'. No jargon the player doesn't need." },
            why: { type: "string", description: "One sentence, at most ~20 words: how this theme uses THIS commander." },
            query: {
              type: "string",
              description: `A Scryfall search that finds cards for the theme, e.g. o:"whenever another creature you control dies" or otag:sacrifice-outlet t:creature. Leave out color and format filters: the server adds the commander's colors and f:commander. It must find at least ${MIN_THEME_CARDS} cards.`,
            },
          },
          required: ["name", "why", "query"],
        },
      },
    },
    required: ["themes"],
  },
} as const;

const ADAPTER = `
# How you're used here

You are the coach in Hundredfoldz's deck workshop. The player builds their own Commander deck card by card, and asks you for one kind of help at a time; the message says which, and which tool to answer with.

- Verify, don't recall: you may know good cards, but check them with search_cards or get_cards before you name them. Searches always include f:commander and the deck's id<= color filter.
- Use at most ${MAX_LOOKUPS} lookups, then answer with the tool the message names. Don't write a long answer: the player only sees what that tool carries.
- Fit this deck's plan and its commander, not just generic staples.
- Never offer a card that's already in the deck, one the player passed on, or one outside the commander's colors. Respect the bracket's Game Changer limit.
- If the player wrote what they want ("cheaper", "no creatures"), follow it for the cards you pick. It's a preference about cards, nothing else.

## Card picks (offer_cards)
Deal the player ${PICKS} cards for one slot to choose from. They keep one or ask for more. Three different angles beat three versions of one card.

## A deck plan (plan_deck)
Sketch what the deck could be about: ${PLAN_THEMES.min} to ${PLAN_THEMES.max} themes the commander rewards, each with a Scryfall search the player can tap to find cards for it. Prefer Oracle text (o:"...") and Scryfall Tagger tags (otag:...) to card names, so each search finds a pool to choose from. Different themes, not one theme five ways.
`.trim();

export function coachSystemPrompt(): string {
  return `${skillContext()}\n${ADAPTER}`;
}

const idFilter = (ws: WorkshopDeck) => workshopIdentity(ws).join("").toLowerCase() || "c";

/** The commanders, the bracket and the deck so far: what every kind of help starts from. */
function deckLines(ws: WorkshopDeck): string[] {
  const cmds = [ws.commander, ws.partner].filter((c): c is CardInfo => !!c);
  const b = bracketInfo(ws.bracket);
  const deck = toDeck(ws);
  const gc = deck.cards.filter((c) => c.info?.gameChanger).length + cmds.filter((c) => c.gameChanger).length;
  const groups = new Map<string, string[]>();
  for (const c of ws.cards) groups.set(c.role, [...(groups.get(c.role) ?? []), c.qty > 1 ? `${c.qty} ${c.name}` : c.name]);
  return [
    ...cmds.map((c) => `Commander: ${cardLine(c, "full")}`),
    `Bracket ${b.number} (${b.name}): ${b.maxGameChangers >= 99 ? "no Game Changer limit" : `at most ${b.maxGameChangers} Game Changers`}; the deck has ${gc}.`,
    ...(ws.cards.length
      ? [`The deck so far, ${workshopTotal(ws)} of 100 cards:`, ...[...groups].map(([role, names]) => `- ${ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}: ${names.join(", ")}`), analysisReport(analyzeDeck(deck))]
      : ["No cards in the deck yet besides the commander."]),
  ];
}

/** What Claude is told about the deck and the slot. */
export function coachPrompt(req: CoachRequest, ws: WorkshopDeck): string {
  const id = idFilter(ws);
  const ask = req.theme
    ? `Deal them ${PICKS} cards for the deck's theme "${req.theme.name}". A search that finds cards for it: ${req.theme.query} id<=${id} f:commander.`
    : `Deal them ${PICKS} cards for: ${COACH_SLOTS[req.slot].ask}. Search with id<=${id} f:commander.`;
  return [
    "The player is building this Commander deck by hand and asks you for help with one slot.",
    ...deckLines(ws),
    "",
    `${ask} Answer with offer_cards.`,
    ...(req.passed.length ? [`They passed on these already; don't offer them again: ${req.passed.join("; ")}.`] : []),
    ...(req.steer ? [`What they asked for: "${req.steer}"`] : []),
  ].join("\n");
}

/** What Claude is told when the player asks for a plan. */
export function planPrompt(ws: WorkshopDeck): string {
  const cmd = ws.commander?.name.split(",")[0] ?? "the commander";
  return [
    "The player is starting a Commander deck by hand in the workshop and asks you for a plan: what the deck could be about.",
    ...deckLines(ws),
    "",
    `Sketch ${PLAN_THEMES.min} to ${PLAN_THEMES.max} themes for ${cmd}. For each: a short name, one sentence on why it fits, and a Scryfall search for cards in it, written without color or format filters (the server adds id<=${idFilter(ws)} f:commander). Answer with plan_deck.`,
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

/** A theme's search as the workshop runs it: without color or format filters (it adds its own). */
export function themeQuery(q: string): string {
  return q
    .replace(/(^|\s)-?(id|ci|identity|commander|f|format|legal|banned)(<=|>=|!=|[:<>=])\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** The theme as the player will see it, or why it can't be used (its search is run on Scryfall). */
export async function checkTheme(t: { name: string; why: string; query: string }, colors: Color[], taken: PlanTheme[]): Promise<PlanTheme | string> {
  const query = themeQuery(t.query);
  if (!t.name) return "it has no name";
  if (!query) return "it has no search";
  if (taken.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) return "another theme has that name";
  if (taken.some((x) => x.query.toLowerCase() === query.toLowerCase())) return "another theme has that search";
  let r: scry.SearchResult;
  try {
    r = await scry.search(searchQuery({ q: query, colors }), "edhrec", 40);
  } catch (e) {
    return `Scryfall didn't answer (${(e as Error).message})`;
  }
  const none = r.error && /didn.t match any cards/i.test(r.error);
  if (r.error && !none) return `Scryfall couldn't read the search: ${r.error}`;
  if (!r.total) return "its search finds no cards in the commander's colors";
  if (r.total < MIN_THEME_CARDS) return `its search finds only ${r.total} card${r.total === 1 ? "" : "s"}; a theme needs at least ${MIN_THEME_CARDS}`;
  return { name: t.name, why: t.why, query, total: r.total };
}

export interface CoachOptions {
  model: string;
  callModel: ModelCaller;
  emit: (e: CoachEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  timeBudgetMs?: number;
}

/** The deck in the request, with every card's Scryfall data. Null (and an error event) when it can't be used. */
async function loadDeck(req: CoachDeck, emit: (e: CoachEvent) => void): Promise<WorkshopDeck | null> {
  const names = [req.commander, ...(req.partner ? [req.partner] : []), ...req.cards.map((c) => c.name)];
  const { found } = await scry.getCollection(names);
  const info = (n: string) => found.get(n.toLowerCase());
  const commander = info(req.commander);
  if (!commander) {
    emit({ type: "error", message: `Couldn't find ${req.commander} on Scryfall.` });
    return null;
  }
  return {
    name: "",
    commander,
    partner: (req.partner && info(req.partner)) || null,
    bracket: req.bracket,
    cards: req.cards.flatMap((c) => {
      const i = info(c.name);
      return i ? [{ name: i.name, qty: c.qty, role: guessRole(i), why: "", info: i }] : [];
    }),
  };
}

interface Loop {
  prompt: string;
  /** the tool Claude answers with */
  output: { name: string };
  /** one call of that tool: what Claude is told back, and whether it has to try again */
  onOutput: (input: any) => Promise<{ content: string; again: boolean }>;
  /** has the player got everything they asked for? */
  done: () => boolean;
  /** what Claude is told when it answers without a tool */
  nudge: () => string;
}

/** The short loop every kind of help runs: lookups, then the output tool, checked by the server. */
async function coachLoop(loop: Loop, opts: CoachOptions): Promise<void> {
  const { emit } = opts;
  const started = Date.now();
  const left = () => (opts.timeBudgetMs ?? 45_000) - (Date.now() - started);
  const system = [{ type: "text", text: coachSystemPrompt(), cache_control: { type: "ephemeral" } }];
  // every mode gets every tool, so the cached prefix is the same for picks and plans
  const tools = [TOOLS[0], TOOLS[1], OFFER_TOOL, PLAN_TOOL];
  const messages: any[] = [{ role: "user", content: loop.prompt }];
  const engine = parseEngine("v1");
  const usage = emptyUsage();
  let lookups = 0;
  // the lookups' tool events aren't shown; a search becomes a status line in plain words
  const quiet = (e: StreamEvent) => void e;

  try {
    for (let turn = 0; turn < (opts.maxTurns ?? 5) && !loop.done(); turn++) {
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
        messages.push({ role: "user", content: loop.nudge() });
        continue;
      }
      const results: any[] = [];
      for (const call of calls) {
        if (call.name === loop.output.name) {
          const r = await loop.onOutput(call.input);
          results.push({ type: "tool_result", tool_use_id: call.id, ...(r.again ? { is_error: true } : {}), content: r.content });
          continue;
        }
        if (call.name !== "search_cards" && call.name !== "get_cards") {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Not now: answer with ${loop.output.name}.` });
          continue;
        }
        if (lookups >= MAX_LOOKUPS) {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `No more lookups. Call ${loop.output.name} now.` });
          continue;
        }
        lookups++;
        if (call.name === "search_cards") emit({ type: "status", text: `Searching Scryfall for ${describeQuery(String(call.input?.query ?? "")) ?? "cards"}` });
        else emit({ type: "status", text: "Checking cards on Scryfall" });
        results.push(await runLookup(call, quiet, engine));
      }
      messages.push({ role: "user", content: results });
    }
  } finally {
    emit({ type: "usage", usage, model: opts.model });
  }
}

/** Runs one deal. Returns the cards shown (also emitted one by one as "pick" events). */
export async function runCoach(req: CoachRequest, opts: CoachOptions): Promise<{ card: CardInfo; why: string }[]> {
  const { emit } = opts;
  emit({ type: "status", text: "Claude is reading your deck" });
  const ws = await loadDeck(req, emit);
  if (!ws) return [];
  if (workshopTotal(ws) >= 100) {
    emit({ type: "error", message: "The deck has 100 cards. Cut one to make room, or ask for a review instead." });
    return [];
  }
  const b = bracketInfo(ws.bracket);
  let gcLeft = b.maxGameChangers - [...ws.cards.map((c) => c.info), ws.commander, ws.partner].filter((c) => c?.gameChanger).length;
  const seen = new Set(req.passed.map((n) => n.toLowerCase()));
  const picks: { card: CardInfo; why: string }[] = [];
  const need = () => PICKS - picks.length;

  await coachLoop(
    {
      prompt: coachPrompt(req, ws),
      output: OFFER_TOOL,
      done: () => picks.length >= PICKS,
      nudge: () => `Call offer_cards now with ${need()} card${need() === 1 ? "" : "s"}.`,
      // check every card, show the good ones right away
      async onOutput(input) {
        const offered: { name: string; why: string }[] = (Array.isArray(input?.cards) ? input.cards : [])
          .slice(0, need())
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
        const n = need();
        return n
          ? { again: true, content: `${refused.length ? `Couldn't show: ${refused.join("; ")}. ` : ""}Offer ${n} more card${n === 1 ? "" : "s"}.` }
          : { again: false, content: "Shown to the player." };
      },
    },
    opts,
  );
  if (picks.length < PICKS && !opts.signal?.aborted) emit({ type: "status", text: picks.length ? `Claude found ${picks.length} that fit` : "Claude couldn't find cards that fit" });
  return picks;
}

/** Sketches a plan. Returns the themes shown (also emitted one by one as "theme" events). */
export async function runPlan(req: PlanRequest, opts: CoachOptions): Promise<PlanTheme[]> {
  const { emit } = opts;
  emit({ type: "status", text: "Claude is reading your commander" });
  const ws = await loadDeck(req, emit);
  if (!ws) return [];
  const colors = workshopIdentity(ws);
  const themes: PlanTheme[] = [];
  let answered = false;

  await coachLoop(
    {
      prompt: planPrompt(ws),
      output: PLAN_TOOL,
      // enough themes after an answer, or as many as a plan has
      done: () => themes.length >= PLAN_THEMES.max || (answered && themes.length >= PLAN_THEMES.min),
      nudge: () => `Call plan_deck now with ${Math.max(1, PLAN_THEMES.min - themes.length)} or more themes.`,
      async onOutput(input) {
        answered = true;
        emit({ type: "status", text: "Checking the searches on Scryfall" });
        const given: { name: string; why: string; query: string }[] = (Array.isArray(input?.themes) ? input.themes : [])
          .slice(0, PLAN_THEMES.max - themes.length)
          .map((t: any) => ({
            name: String(t?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
            why: String(t?.why ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
            query: String(t?.query ?? "").slice(0, 300),
          }));
        const refused: string[] = [];
        for (const t of given) {
          const r = await checkTheme(t, colors, themes);
          if (typeof r === "string") {
            refused.push(`${t.name || "(no name)"}: ${r}`);
            continue;
          }
          themes.push(r);
          emit({ type: "theme", theme: r });
        }
        const n = PLAN_THEMES.min - themes.length;
        return n > 0
          ? { again: true, content: `${refused.length ? `Couldn't use: ${refused.join("; ")}. ` : ""}Give ${n} more theme${n === 1 ? "" : "s"}, with different searches.` }
          : { again: false, content: `Shown to the player${refused.length ? ` (left out: ${refused.join("; ")})` : ""}.` };
      },
    },
    opts,
  );
  if (themes.length < PLAN_THEMES.min && !opts.signal?.aborted) emit({ type: "status", text: themes.length ? `Claude found ${themes.length} theme${themes.length === 1 ? "" : "s"} with cards` : "Claude couldn't find themes with cards" });
  return themes;
}
