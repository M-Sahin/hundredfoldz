"use client";
// The deck workshop (/workshop): the player builds a Commander deck card by card. Search on one
// side, the deck in the middle, and the checks beside it: lands, ramp, draw, removal, legality and
// the bracket, counted in the browser as the deck grows (lib/shared/workshop.ts). On a phone the
// three are tabs. Claude comes in only when asked: to finish the deck or review it, through the
// build page's complete and upgrade modes.
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "./SiteHeader";
import { CardSearch } from "./CardSearch";
import { CardFace, IdentityPips, ManaCost } from "./CardFace";
import { CardModal, HandTab, NumbersTab } from "./DeckView";
import { TrendingCommanders } from "./TrendingCommanders";
import { ShareButton } from "./ShareSheet";
import { Menu } from "./Menu";
import { CardPicks, pickSlots } from "./CardPicks";
import { KeySheet } from "./BuildAccess";
import type { KeyState } from "./KeyPanel";
import { COACH_SLOTS, type CoachSlot } from "../lib/shared/coach";
import { analyzeDeck, guessRole } from "../lib/shared/analysis";
import { validateDeck } from "../lib/shared/validate";
import { simulateOpeners } from "../lib/shared/openers";
import { ROLE_COLORS, byRole, exportText, price } from "../lib/shared/deck-utils";
import { money } from "../lib/shared/currency";
import { encodeDeck } from "../lib/shared/share";
import { ROLES, ROLE_LABELS, isBasicLand, type CardInfo, type DeckCard, type Role } from "../lib/shared/types";
import {
  EMPTY_WORKSHOP,
  addCard,
  canAdd,
  canPair,
  claudeStep,
  coachNotes,
  commanderProblem,
  deckChecks,
  fillBasics,
  fromDeck,
  partnerProblem,
  removeOne,
  sameCards,
  setCommander,
  setPartner,
  setRole,
  toDeck,
  withInfo,
  workshopIdentity,
  workshopTotal,
  type Check,
  type WorkshopDeck,
} from "../lib/shared/workshop";
import { cardByName, freeDeals, handoff, randomCard, resolveDeck, searchCards, type FreeDeals } from "../lib/client/api";
import { useHumanCheck } from "./useHumanCheck";
import { saveToMyDecks, workshopDraft } from "../lib/client/workshop";
import { useCurrency } from "../lib/client/currency";
import { useSiteConfig } from "../lib/client/site-config";
import { useAccount } from "../lib/client/account";
import { track } from "../lib/client/track";
import { TableArt } from "./TableArt";
import { useCardPeek } from "./CardPeek";

type Pane = "search" | "deck" | "checks";
type DeckTab = "list" | "numbers" | "hand";

/** The search filter for each check, so "Card draw: 4" can lead straight to card draw. */
const CHECK_SLOT: Record<Check["key"], string> = { lands: "land", ramp: "ramp", draw: "draw", removal: "removal", wipe: "wipe", protection: "protection" };
const SLOTS: [string, string][] = [
  ["ramp", "Ramp"],
  ["draw", "Card draw"],
  ["removal", "Removal"],
  ["wipe", "Board wipes"],
  ["protection", "Protection"],
  ["recursion", "Recursion"],
  ["land", "Lands"],
];
const TYPES: [string, string][] = [
  ["", "Any type"],
  ["creature", "Creatures"],
  ["instant", "Instants"],
  ["sorcery", "Sorceries"],
  ["artifact", "Artifacts"],
  ["enchantment", "Enchantments"],
  ["planeswalker", "Planeswalkers"],
  ["land", "Lands"],
];
const MVS: [string, string][] = [
  ["", "Any"],
  ["0-2", "2 or less"],
  ["3", "3"],
  ["4", "4"],
  ["5+", "5+"],
];

interface Toast {
  text: string;
  tone: "good" | "bad";
  undo?: WorkshopDeck;
}

export default function Workshop() {
  const [ws, setWs] = useState<WorkshopDeck>(EMPTY_WORKSHOP);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null); // "Opening <deck>…"
  const [pane, setPane] = useState<Pane>("deck");
  const [slot, setSlot] = useState("");
  const [picking, setPicking] = useState<"commander" | "partner" | null>(null);
  const [open, setOpen] = useState<DeckCard | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"account" | "browser" | "saving" | null>(null);
  // card picks: the visitor's own key (the key sheet loads a remembered one), the slot being dealt,
  // and the cards passed on per slot this visit
  const [key, setKey] = useState<KeyState>({ key: "", model: "" });
  const [keySheet, setKeySheet] = useState(false);
  const [dealing, setDealing] = useState<{ slot: CoachSlot; note?: string } | null>(null);
  const [passed, setPassed] = useState<Partial<Record<CoachSlot, string[]>>>({});
  const site = useSiteConfig();
  const acct = useAccount();
  // without a key: the site's free deals, if it gives them out (a bot check per deal)
  const [deals, setDeals] = useState<FreeDeals | null>(null);
  const human = useHumanCheck("deal");
  const refreshDeals = () => void freeDeals().then(setDeals);
  useEffect(refreshDeals, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cur = useCurrency();

  // a deck handed over from My decks or a finished build, else the deck from last time
  useEffect(() => {
    const h = handoff.take(["edit"]);
    if (!h) {
      setWs(workshopDraft.get());
      setLoaded(true);
      return;
    }
    setLoading(h.name ?? "your deck");
    const before = workshopDraft.get();
    resolveDeck(h.d)
      .then((r) => {
        const next = fromDeck(h.name ? { ...r.deck, name: h.name } : r.deck);
        setWs(next);
        // the deck from last time is replaced: say so, and offer it back
        if (before.commander && before.cards.length && !sameCards(before, next)) say({ text: `Opened ${h.name ?? "your deck"}. Your earlier workshop deck was put aside.`, tone: "good", undo: before });
      })
      .catch((e) => {
        setWs(before);
        setError(`Couldn't open the deck: ${(e as Error).message}`);
      })
      .finally(() => {
        setLoading(null);
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (loaded) workshopDraft.set(ws);
  }, [ws, loaded]);

  const deck = useMemo(() => toDeck(ws), [ws]);
  const analysis = useMemo(() => (ws.commander ? analyzeDeck(deck, { currency: cur }) : null), [deck, ws.commander, cur]);
  const validation = useMemo(() => validateDeck(deck, [], [], { bracket: ws.bracket }), [deck, ws.bracket]);
  const checks = useMemo(() => (analysis ? deckChecks(analysis) : []), [analysis]);
  const notes = useMemo(() => coachNotes(ws, validation, checks), [ws, validation, checks]);
  const total = workshopTotal(ws);
  const problems = validation.errors.filter((e) => !/^Deck has \d+ cards/.test(e));

  const say = (t: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.undo ? 6000 : 3500);
  };
  const change = (next: WorkshopDeck, text?: string) => {
    const prev = ws;
    setWs(next);
    setSaved(null);
    if (text) say({ text, tone: "good", undo: prev });
  };

  const add = (c: CardInfo) => {
    const why = canAdd(ws, c);
    if (why) return say({ text: why, tone: "bad" });
    const next = addCard(ws, c);
    const role = next.cards.find((x) => x.name === c.name)?.role;
    const check = checks.find((k) => CHECK_SLOT[k.key] === role);
    change(next, check ? `Added ${c.name}. ${check.label}: ${check.have + 1} of ${check.want[0]}–${check.want[1]}.` : `Added ${c.name}.`);
  };
  const remove = (name: string) => change(removeOne(ws, name), `Removed ${name}.`);

  const pickCommander = async (name: string) => {
    setError(null);
    try {
      const c = await cardByName(name);
      const why = commanderProblem(c);
      if (why) return setError(why);
      if (!ws.commander) track("workshop|opened");
      change(setCommander(ws, c));
      setPicking(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pickPartner = async (name: string) => {
    setError(null);
    try {
      const c = await cardByName(name);
      const why = partnerProblem(ws, c);
      if (why) return setError(why);
      change(setPartner(ws, c));
      setPicking(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const surprise = async () => {
    setError(null);
    try {
      await pickCommander((await randomCard("commander")).name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addBasics = async () => {
    const r = fillBasics(ws);
    if (!r.added) return say({ text: "The deck has enough lands for now.", tone: "good" });
    let next = r.ws;
    try {
      if (r.missing.length) next = withInfo(next, await Promise.all(r.missing.map((n) => cardByName(n))));
    } catch {
      /* the checks still count them as lands by name */
    }
    change(next, `Added ${r.added} basic land${r.added === 1 ? "" : "s"}, split by what your spells need.`);
  };

  const save = async () => {
    setSaved("saving");
    try {
      const where = await saveToMyDecks(deck);
      setSaved(where);
      track("workshop|saved");
    } catch (e) {
      setSaved(null);
      setError(`Couldn't save the deck: ${(e as Error).message}`);
    }
  };

  const handOver = async () => {
    const step = claudeStep(ws);
    if (step.problem) return say({ text: step.problem, tone: "bad" });
    handoff.set({ kind: step.kind, d: await encodeDeck(deck), name: deck.name });
    track(step.kind === "complete" ? "workshop|finish" : "workshop|review");
    window.location.href = `/?opening=${step.kind}&name=${encodeURIComponent(deck.name)}`;
  };

  const findFor = (key: Check["key"]) => {
    setSlot(CHECK_SLOT[key]);
    setPane("search");
  };

  const startOver = () => change(EMPTY_WORKSHOP, "Started over.");

  const toastEl = toast ? (
    <div className={`ws-toast is-${toast.tone}`} role="status">
      <span>{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          className="link"
          onClick={() => {
            setWs(toast.undo!);
            setToast(null);
          }}
        >
          Undo
        </button>
      ) : null}
    </div>
  ) : null;

  if (loading || !loaded) {
    return (
      <div className="app">
        <SiteHeader active="workshop" />
        <main className="ws-loading" aria-busy="true">
          <span className="spinner" aria-hidden /> {loading ? `Opening ${loading}…` : "Opening the workshop…"}
        </main>
      </div>
    );
  }

  if (!ws.commander || picking === "commander") {
    return (
      <div className="app">
        <SiteHeader active="workshop" />
        <main className="ws-start">
          <section className="hero">
            <p className="hero-kicker">Deck workshop</p>
            <h1>Build it yourself.</h1>
            <p className="hero-sub">Pick a commander and add every card yourself. The workshop counts lands, ramp, card draw and removal as you go, and checks that every card is legal. Free, no key needed.</p>
          </section>
          <section className="mat ws-pick" aria-label="Pick your commander">
            <h2>{ws.commander ? "Pick a new commander" : "Who leads the deck?"}</h2>
            <CardSearch exclude={[]} onClose={() => {}} onPick={(n) => void pickCommander(n)} placeholder="Type a commander's name" />
            <div className="ws-pick-actions">
              <button type="button" className="btn" onClick={() => void surprise()} data-testid="ws-surprise">
                Surprise me
              </button>
              {ws.commander ? (
                <button type="button" className="btn btn--quiet" onClick={() => setPicking(null)}>
                  Keep {ws.commander.name}
                </button>
              ) : null}
            </div>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <TrendingCommanders onPick={(n) => void pickCommander(n)} />
          </section>
          {ws.commander ? <p className="note">Cards already in the deck stay. The checks show any that don&apos;t fit the new commander&apos;s colors.</p> : null}
          {toastEl}
        </main>
      </div>
    );
  }

  const identity = workshopIdentity(ws);
  const step = claudeStep(ws);
  const ownKey = !!key.key || !!key.saved;
  const freeLeft = deals?.enabled ? (deals.remaining ?? 0) : 0;
  const cost = price(deck, cur);

  return (
    <div className="app">
      <TableArt src={ws.commander?.artCrop} />
      <SiteHeader active="workshop" />
      <main className="ws playmat" data-pane={pane}>
        <section className="ws-bar" aria-label="Commander and deck">
          <div className="ws-cmd">
            <CardFace card={ws.commander} className="ws-cmd-card" onClick={() => setOpen({ name: ws.commander!.name, role: "wincon", why: "Commander", qty: 1, info: ws.commander! })} />
            {ws.partner ? <CardFace card={ws.partner} className="ws-cmd-card" onClick={() => setOpen({ name: ws.partner!.name, role: "wincon", why: "Commander", qty: 1, info: ws.partner! })} /> : null}
            <div className="ws-cmd-text">
              <label className="ws-name">
                <span className="visually-hidden">Deck name</span>
                <input value={ws.name} placeholder={deck.name} maxLength={120} onChange={(e) => change({ ...ws, name: e.target.value })} data-testid="ws-name" />
              </label>
              <p className="ws-cmd-line">
                <IdentityPips colors={identity} /> {ws.commander.name}
                {ws.partner ? ` and ${ws.partner.name}` : ""}
              </p>
              <p className="ws-cmd-actions">
                <button type="button" className="link" onClick={() => setPicking("commander")}>
                  Change commander
                </button>
                {ws.partner ? (
                  <button type="button" className="link" onClick={() => change(setPartner(ws, null))}>
                    Remove partner
                  </button>
                ) : canPair(ws.commander) ? (
                  <button type="button" className="link" onClick={() => setPicking(picking === "partner" ? null : "partner")} aria-expanded={picking === "partner"}>
                    Add a partner
                  </button>
                ) : null}
              </p>
              {picking === "partner" ? (
                <div className="ws-partner">
                  <CardSearch exclude={[ws.commander.name]} onClose={() => setPicking(null)} onPick={(n) => void pickPartner(n)} placeholder="Type the second commander" />
                </div>
              ) : null}
            </div>
          </div>

          <div className="ws-progress">
            <p className="ws-count">
              <strong data-testid="ws-total">{total}</strong> / 100
              <span>{total < 100 ? `${100 - total} to go` : total === 100 ? "Complete" : `${total - 100} too many`}</span>
            </p>
            <div className="ws-meter" aria-hidden>
              <span style={{ width: `${Math.min(100, total)}%` }} />
            </div>
            <p className="ws-chips">
              <label className="ws-bracket">
                <span className="visually-hidden">Bracket</span>
                <select value={ws.bracket} onChange={(e) => change({ ...ws, bracket: Number(e.target.value) })} data-testid="ws-bracket">
                  {[1, 2, 3, 4].map((b) => (
                    <option key={b} value={b}>
                      Bracket {b}
                    </option>
                  ))}
                </select>
              </label>
              <span className={`ws-chip ${problems.length ? "is-bad" : "is-ok"}`} data-testid="ws-legal">
                {problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "Legal so far"}
              </span>
              {cost.total ? <span className="ws-chip">{money(cost.total, cur)}</span> : null}
            </p>
          </div>

          <div className="ws-actions">
            <button type="button" className="btn" onClick={() => void handOver()} disabled={!!step.problem} title={step.problem ?? undefined} data-testid="ws-claude">
              {step.kind === "complete" ? "Finish it for me" : "Review my deck"}
            </button>
            <ShareButton deck={deck} primary={false} />
            <Menu
              label="Export"
              items={[
                { label: "Copy list (Moxfield, Archidekt)", onClick: () => void navigator.clipboard?.writeText(exportText(deck, "moxfield")).then(() => say({ text: "Copied. Paste it into your deckbuilder.", tone: "good" })) },
                { label: "Copy for MTG Arena", onClick: () => void navigator.clipboard?.writeText(exportText(deck, "arena")).then(() => say({ text: "Copied for MTG Arena.", tone: "good" })) },
              ]}
            />
            <button type="button" className="btn btn--brass" onClick={() => void save()} disabled={saved === "saving"} data-testid="ws-save">
              {saved === "saving" ? "Saving…" : saved ? "Saved ✓" : "Save deck"}
            </button>
          </div>
          {saved === "account" || saved === "browser" ? (
            <p className="note ws-saved" role="status">
              {saved === "account" ? "Saved to My decks." : "Saved in this browser."} <a href="/decks">Open My decks</a>
            </p>
          ) : null}
          {error ? (
            <p className="error ws-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <div className="ws-panes">
          <SearchPane ws={ws} slot={slot} setSlot={setSlot} onAdd={add} onOpen={(c) => setOpen({ name: c.name, role: guessRole(c), why: "", qty: 0, info: c })} />
          <DeckPane ws={ws} onRemove={remove} onOpen={setOpen} onBasics={() => void addBasics()} onStartOver={startOver} />
          <aside className="ws-pane ws-checks" data-pane="checks" aria-labelledby="ws-checks-h">
            <section className="panel">
              <h2 id="ws-checks-h">How the deck is doing</h2>
              <p className="panel-sub">Counted from the cards&apos; own text as you build.</p>
              <ul className="ws-checklist">
                {checks.map((k) => (
                  <li key={k.key} className={`is-${k.status}`} data-testid={`ws-check-${k.key}`}>
                    <div className="ws-check-row">
                      <span>
                        <strong>{k.label}</strong> {k.have} <small>of {k.want[0]}–{k.want[1]}</small>
                      </span>
                      {k.status === "ok" ? (
                        <span className="ws-check-status">In range</span>
                      ) : (
                        <button type="button" className="link ws-check-status" onClick={() => findFor(k.key)}>
                          {k.status === "short" ? `${k.want[0] - k.have} short · find` : `${k.have - k.want[1]} over`}
                        </button>
                      )}
                    </div>
                    <div className="ws-bar-track" aria-hidden>
                      <span style={{ width: `${Math.min(100, (k.have / k.want[1]) * 100)}%` }} />
                      <i style={{ left: `${(k.want[0] / k.want[1]) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel ws-coach" aria-label="Coach">
              <h3>Coach</h3>
              <ul>
                {notes.map((n) => (
                  <li key={n.text} className={`is-${n.tone}`}>
                    {n.text}
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel ws-deal" aria-labelledby="ws-deal-h" data-testid="ws-deal">
              <h3 id="ws-deal-h">Stuck? Claude deals you 3</h3>
              <p className="panel-sub">Three cards that fit {ws.commander.name.split(",")[0]}&apos;s plan, each checked on Scryfall. Keep one, or deal again.</p>
              {!ownKey && !freeLeft ? (
                <>
                  <p className="note">
                    {deals?.enabled
                      ? deals.blocked
                        ? "Today's free deals are used up here. Add your own Claude API key for more, or come back tomorrow."
                        : `You've used today's ${deals.limit} free deals. Add your own Claude API key for more, or come back tomorrow.`
                      : "Card picks use your own Claude API key, on Claude Haiku. Everything else in the workshop is free."}
                  </p>
                  <button type="button" className="btn" onClick={() => setKeySheet(true)} data-testid="ws-add-key">
                    Add your Claude key
                  </button>
                </>
              ) : total >= 100 ? (
                <p className="note">The deck has 100 cards. Cut one to get picks, or ask for a review.</p>
              ) : (
                <div className="ws-deal-slots" role="group" aria-label="Deal me 3 for">
                  {pickSlots(checks).map((s, i) => (
                    <button key={s.slot} type="button" className={`btn btn--small ${i === 0 ? "btn--ink" : ""}`} onClick={() => setDealing(s)} data-testid={`ws-deal-${s.slot}`}>
                      {i === 0 ? `Deal me 3: ${COACH_SLOTS[s.slot].label.toLowerCase()}` : COACH_SLOTS[s.slot].label}
                    </button>
                  ))}
                </div>
              )}
              {!ownKey && freeLeft && total < 100 ? (
                <p className="note" data-testid="ws-free-deals">
                  {freeLeft} free deal{freeLeft === 1 ? "" : "s"} left today.{" "}
                  <button type="button" className="link" onClick={() => setKeySheet(true)}>
                    Add your Claude key
                  </button>{" "}
                  for as many as you like.
                </p>
              ) : null}
            </section>
            <section className="panel ws-handover">
              <h3>{step.kind === "complete" ? "Want Claude to finish it?" : "Want a second opinion?"}</h3>
              <p className="panel-sub">
                {step.kind === "complete"
                  ? "Claude keeps every card you picked and fills the rest, checked card by card on Scryfall."
                  : "Claude reads the deck, says what works and what doesn't, and suggests up to 10 swaps."}{" "}
                Uses a free build or your Claude key.
              </p>
              <button type="button" className="btn" onClick={() => void handOver()} disabled={!!step.problem}>
                {step.kind === "complete" ? "Finish it for me" : "Review my deck"}
              </button>
              {step.problem ? <p className="note">{step.problem}</p> : null}
            </section>
          </aside>
        </div>

        <nav className="ws-tabs" aria-label="Workshop">
          {(
            [
              ["search", "Search"],
              ["deck", `Deck ${total}`],
              ["checks", problems.length ? `Checks (${problems.length})` : "Checks"],
            ] as [Pane, string][]
          ).map(([p, label]) => (
            <button key={p} type="button" className={pane === p ? "is-on" : ""} aria-pressed={pane === p} onClick={() => setPane(p)} data-testid={`ws-tab-${p}`}>
              {label}
            </button>
          ))}
        </nav>

        {toastEl}
        {/* the bot check for free deals: outside the panes, which phones hide */}
        {!ownKey && freeLeft ? human.widget : null}
      </main>
      {dealing ? (
        <CardPicks
          ws={ws}
          slot={dealing.slot}
          note={pickSlots(checks).find((s) => s.slot === dealing.slot)?.note}
          auth={ownKey ? { apiKey: key.key || undefined, savedKey: !key.key && !!key.saved } : { free: true }}
          getTurnstile={human.take}
          freeLeft={ownKey ? undefined : (deals?.remaining ?? 0)}
          onDealt={refreshDeals}
          passed={passed[dealing.slot] ?? []}
          onPass={(names) => setPassed((p) => ({ ...p, [dealing.slot]: [...new Set([...(p[dealing.slot] ?? []), ...names])] }))}
          onKeep={add}
          onNeedKey={() => {
            setDealing(null);
            setKeySheet(true);
          }}
          onClose={() => setDealing(null)}
        />
      ) : null}
      <KeySheet
        open={keySheet}
        lead="Card picks use your own Claude API key. You pay Anthropic directly; picks run on Claude Haiku."
        value={key}
        onChange={setKey}
        onClose={() => setKeySheet(false)}
        onDone={() => setKeySheet(false)}
        canSave={!!site?.keyVault && !!acct.user}
      />
      {open ? (
        <CardModal
          card={open}
          onClose={() => setOpen(null)}
          actions={<CardActions ws={ws} card={open} onAdd={(c) => (add(c), setOpen(null))} onRemove={(n) => (remove(n), setOpen(null))} onRole={(r) => (change(setRole(ws, open.name, r)), setOpen({ ...open, role: r }))} />}
        />
      ) : null}
    </div>
  );
}

/** Add, remove and role buttons in the card view. */
function CardActions({ ws, card, onAdd, onRemove, onRole }: { ws: WorkshopDeck; card: DeckCard; onAdd: (c: CardInfo) => void; onRemove: (name: string) => void; onRole: (r: Role) => void }) {
  if (card.why === "Commander" || !card.info) return null;
  const inDeck = ws.cards.find((c) => c.name.toLowerCase() === card.name.toLowerCase());
  const why = canAdd(ws, card.info);
  return (
    <>
      {inDeck ? (
        <>
          <label className="ws-role">
            <span>Counts as</span>
            <select value={inDeck.role} onChange={(e) => onRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => onRemove(card.name)}>
            {inDeck.qty > 1 ? "Remove one" : "Remove from deck"}
          </button>
        </>
      ) : null}
      {!why ? (
        <button type="button" className="btn btn--brass" onClick={() => onAdd(card.info!)}>
          {inDeck ? "Add another" : "Add to deck"}
        </button>
      ) : !inDeck ? (
        <p className="note">{why}</p>
      ) : null}
    </>
  );
}

function SearchPane({ ws, slot, setSlot, onAdd, onOpen }: { ws: WorkshopDeck; slot: string; setSlot: (s: string) => void; onAdd: (c: CardInfo) => void; onOpen: (c: CardInfo) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [mv, setMv] = useState("");
  const [res, setRes] = useState<{ total: number; cards: CardInfo[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const colors = workshopIdentity(ws);
  const key = colors.join("");
  const text = q.trim();
  const has = useMemo(() => new Map(ws.cards.map((c) => [c.name.toLowerCase(), c.qty])), [ws.cards]);

  useEffect(() => {
    if (text.length < 2 && !slot && !type && !mv) {
      setRes(null);
      setErr(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        setRes(await searchCards({ q: text.length >= 2 ? text : "", colors, slot, type, mv }, ctl.signal));
      } catch (e) {
        if (!ctl.signal.aborted) setErr((e as Error).message);
      } finally {
        if (!ctl.signal.aborted) setBusy(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, slot, type, mv, key]);

  return (
    <section className="ws-pane ws-search panel" data-pane="search" aria-labelledby="ws-search-h">
      <h2 id="ws-search-h">Find cards</h2>
      <label className="ws-q">
        <span className="visually-hidden">Search cards</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, type or rules text" data-testid="ws-q" />
      </label>
      <div className="ws-filter" role="group" aria-label="For a slot">
        {SLOTS.map(([v, label]) => (
          <button key={v} type="button" className={`chip ${slot === v ? "is-on" : ""}`} aria-pressed={slot === v} onClick={() => setSlot(slot === v ? "" : v)} data-testid={`ws-slot-${v}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="ws-selects">
        <label>
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Mana value</span>
          <select value={mv} onChange={(e) => setMv(e.target.value)}>
            {MVS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="panel-sub">
        Commander-legal cards in <IdentityPips colors={colors} size={13} /> {ws.commander?.name.split(",")[0]}&apos;s colors, most played first.
      </p>
      {busy && !res ? <p className="note">Searching Scryfall…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {res?.error ? <p className="error">Scryfall couldn&apos;t read that search: {res.error}</p> : null}
      {res && !res.cards.length && !res.error ? <p className="note">No cards match. Try fewer words or another filter.</p> : null}
      {!res && !busy ? <p className="note">Type a card name or rules text, like &ldquo;whenever a creature dies&rdquo;, or pick a slot to fill.</p> : null}
      {res?.cards.length ? (
        <ul className={`ws-results ${busy ? "is-busy" : ""}`} data-testid="ws-results">
          {res.cards.map((c) => {
            const n = has.get(c.name.toLowerCase()) ?? 0;
            const why = canAdd(ws, c);
            const role = guessRole(c);
            return (
              <li key={c.name}>
                <button type="button" className="ws-result-card" onClick={() => onOpen(c)} aria-label={`Open ${c.name}`}>
                  {c.image ? <img src={c.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <span />}
                </button>
                <div className="ws-result-text">
                  <button type="button" className="ws-result-name" onClick={() => onOpen(c)}>
                    {c.name}
                  </button>{" "}
                  <ManaCost cost={c.manaCost} />
                  <small>
                    {c.typeLine} · <span style={{ color: ROLE_COLORS[role] }}>{ROLE_LABELS[role]}</span>
                    {c.gameChanger ? " · Game Changer" : ""}
                  </small>
                </div>
                {n && why ? (
                  <span className="ws-in">In deck</span>
                ) : (
                  <button type="button" className="ws-add" onClick={() => onAdd(c)} aria-label={`Add ${c.name}`} title={why ?? undefined} disabled={!!why} data-testid="ws-add">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {res && res.total > res.cards.length ? <p className="note">The {res.cards.length} most played of {res.total.toLocaleString("en")}. Add words or filters to narrow it down.</p> : null}
    </section>
  );
}

function DeckPane({ ws, onRemove, onOpen, onBasics, onStartOver }: { ws: WorkshopDeck; onRemove: (name: string) => void; onOpen: (c: DeckCard) => void; onBasics: () => void; onStartOver: () => void }) {
  const peek = useCardPeek();
  const [tab, setTab] = useState<DeckTab>("list");
  const [sure, setSure] = useState(false);
  const deck = useMemo(() => toDeck(ws), [ws]);
  const groups = byRole(deck);
  const cards = workshopTotal(ws);
  // goldfished opening hands: only while the Numbers tab is open (4,000 games per change)
  const openers = useMemo(() => (tab === "numbers" && cards >= 20 ? simulateOpeners(deck) : null), [tab, deck, cards]);
  return (
    <section className="ws-pane ws-deck panel" data-pane="deck" aria-label="Your deck">
      {peek.el}
      <div className="tabs" role="tablist" aria-label="Deck views">
        {(
          [
            ["list", "Deck"],
            ["numbers", "Numbers"],
            ["hand", "Draw a hand"],
          ] as [DeckTab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} className={`tab ${tab === t ? "is-on" : ""}`} onClick={() => setTab(t)} data-testid={`ws-deck-${t}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "list" ? (
        <>
          <div className="ws-deck-tools">
            <button type="button" className="btn btn--small" onClick={onBasics} data-testid="ws-basics">
              Add basic lands
            </button>
            {ws.cards.length ? (
              sure ? (
                <span className="ws-sure">
                  Remove every card?{" "}
                  <button type="button" className="link" onClick={() => (onStartOver(), setSure(false))}>
                    Yes, start over
                  </button>{" "}
                  <button type="button" className="link" onClick={() => setSure(false)}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setSure(true)}>
                  Start over
                </button>
              )
            ) : null}
          </div>
          {groups.length ? (
            <div className="ws-groups">
              {groups.map((g) => (
                <div key={g.role} className="ws-group">
                  <h3>
                    <span className="ws-dot" style={{ background: ROLE_COLORS[g.role] }} aria-hidden />
                    {ROLE_LABELS[g.role]} <small>{g.count}</small>
                  </h3>
                  <ul>
                    {g.cards.map((c) => (
                      <li key={c.name}>
                        <button type="button" className="ws-card-name" onClick={() => onOpen(c)} {...peek.bind(c.info)}>
                          {c.name}
                          {c.qty > 1 ? <small> ×{c.qty}</small> : null}
                        </button>
                        <ManaCost cost={c.info?.manaCost ?? ""} />
                        <button type="button" className="ws-remove" onClick={() => onRemove(c.name)} aria-label={c.qty > 1 ? `Remove one ${c.name}` : `Remove ${c.name}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="note">No cards yet. Search for cards to add, or start with your lands.</p>
          )}
        </>
      ) : null}
      {tab === "numbers" ? cards >= 20 ? <NumbersTab deck={deck} openers={openers} /> : <p className="note">The numbers start to mean something at about 20 cards.</p> : null}
      {tab === "hand" ? cards >= 8 ? <HandTab deck={deck} onOpen={onOpen} /> : <p className="note">Add a few more cards to draw a hand.</p> : null}
    </section>
  );
}
