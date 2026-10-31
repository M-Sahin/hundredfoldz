// The site's public address and what search engines may index, for metadata, robots.txt,
// sitemap.xml and llms.txt. SITE_URL wins; on Vercel, the production domain; otherwise the
// address of the request (a self-hosted copy without SITE_URL).
import { requestOrigin } from "./deck-meta";
import { serverConfig } from "./config";

export const SITE_NAME = "Hundredfoldz";
export const SITE_TAGLINE = "Open-source AI Commander deckbuilder";
export const HOME_TITLE = "Hundredfoldz: open-source AI Commander (EDH) deckbuilder for MTG";
export const SITE_DESCRIPTION =
  "Open-source AI Commander (EDH) deckbuilder for Magic: The Gathering. Pick five cards and Claude builds a legal 100-card deck around them in the bracket you choose, checked card by card on Scryfall. Free bracket checker and booster box EV calculator.";

export function configuredOrigin(): string | null {
  const site = process.env.SITE_URL?.trim();
  if (site && /^https?:\/\/[^\s/"'<>]+\/?$/.test(site)) return site.replace(/\/+$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}

/** The public origin, e.g. https://hundredfoldz.app (for absolute links in metadata and files). */
export async function publicOrigin(): Promise<string> {
  return configuredOrigin() ?? (await requestOrigin());
}

/** schema.org breadcrumbs from the home page down: [["Box EV", "/ev"], …]. */
export function breadcrumbs(origin: string, trail: [string, string][]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [["Hundredfoldz", "/"] as [string, string], ...trail].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${origin}${path}` })),
  };
}

/** Preview and development deployments shouldn't end up in search results; production should. */
export function indexable(): boolean {
  if (process.env.NO_INDEX === "1") return false;
  if (process.env.VERCEL) return process.env.VERCEL_ENV === "production";
  return true;
}

/** Pages that are only useful to the person using them, or to the site's admins. */
export const PRIVATE_PATHS = ["/api/", "/auth/", "/account", "/decks", "/stats", "/deck?"];

/** The questions people ask, answered on the home page (and in its FAQ structured data). */
export function faq(): { q: string; a: string }[] {
  const free = serverConfig().free;
  return FAQ.map((f) =>
    f.q === "Is it free?" && !free
      ? { ...f, a: "Yes. Builds run on your own Claude API key, and you pay Anthropic directly: about 25 cents a deck on Claude Sonnet. The bracket checker and booster box EV pages are always free." }
      : f,
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Hundredfoldz?",
    a: "A free, open-source Commander deck builder for Magic: The Gathering. You pick five cards, and Claude, Anthropic's AI, builds a complete, legal 100-card Commander (EDH) deck around them in the power bracket you choose.",
  },
  {
    q: "Is it free?",
    a: "Yes. Every visitor gets a few free builds, no account needed. After that you can add your own Claude API key and pay Anthropic directly, about 25 cents a deck on Claude Sonnet. The bracket checker and booster box EV pages are always free.",
  },
  {
    q: "Are the decks legal?",
    a: "Every card is looked up on Scryfall, and the server checks each deck before you see it: exactly 100 cards, singleton, color identity, commander and partner rules, the bracket's Game Changers, mass land denial, extra turns and early two-card combos from Commander Spellbook. A deck that fails goes back to Claude to fix.",
  },
  {
    q: "Which brackets does it build for?",
    a: "Brackets 1 to 4 (Exhibition, Core, Upgraded and Optimized) from Wizards of the Coast's Commander Brackets. The free bracket checker tells you which bracket any existing decklist fits.",
  },
  {
    q: "Can I build a deck myself?",
    a: "Yes, in the deck workshop. Pick a commander and add cards one by one: search finds Commander-legal cards in its colors, and the workshop counts lands, ramp, card draw, removal and board wipes from the cards' text as you go, and checks legality and the bracket. It's free and needs no key. When you want help, hand the deck to Claude to finish or review it.",
  },
  {
    q: "Can it finish or improve a deck I already have?",
    a: "Yes. Paste or upload a decklist: if it has fewer than 100 cards, Claude completes it and keeps every card you have. If it's complete, Claude suggests up to 10 upgrades, each with a reason.",
  },
  {
    q: "Can I build only from cards I own?",
    a: "Yes. Load your collection (a CSV from Moxfield, Archidekt, ManaBox, Deckbox or a plain list) and choose to prefer your cards or use only them.",
  },
  {
    q: "Can I export the deck?",
    a: "Copy it for Moxfield or Archidekt, copy it for MTG Arena, download it as text, share a link, or open the whole list in a TCGplayer or Card Kingdom cart.",
  },
  {
    q: "Who makes it?",
    a: "Murat Sahin, as an open-source project on GitHub. Decks are built with MTG Master, an open-source Claude Skill for Magic. Hundredfoldz is unofficial Fan Content and not approved or endorsed by Wizards of the Coast.",
  },
];
