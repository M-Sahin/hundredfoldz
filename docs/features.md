# Features

Everything Hundredfoldz does, in detail. Back to the [README](../README.md).

## What you get

- **The setup:** a fanned hand of five seed cards with Scryfall autocomplete and a "Surprise me" button. You can crown a legendary creature as commander or let Claude choose. There's a bracket picker (1–4), budget options, a free-text wish list, and the page tints itself to your color identity.
- **Deck shape (optional):** minimum and maximum creatures, lands, ramp, card draw, removal and board wipes, and a cap on the average mana value. Claude gets them as targets; the server counts them from the card text (creatures from the type line) and sends the deck back when one is off, for the first three tries; after that a miss is a warning. The deck's sidebar shows each limit against the real count. They replace the template's own checks for the counts you set, and apply to completing and upgrading a deck too.
- **Start from your own deck:** paste or upload a decklist. If it has fewer than 100 cards, Hundredfoldz asks whether to complete it: every card you have stays and Claude fills the rest. If it's complete, it offers upgrades: Claude keeps the commander and the plan and suggests up to 10 swaps, each with a reason. The result lists the swaps above the deck and marks the new cards.
- **The live build:** Claude's notes stream in while it works, and every Scryfall search is shown with its exact query. "The Hundred", a 10×10 grid of sleeves, fills up card by card in each card's role color while Claude writes the list. The build keeps running if you switch apps or lose the connection; the page reconnects and picks up where it left off (see [Builds that survive leaving the page](self-hosting.md#builds-that-survive-leaving-the-page)).
- **The deck:**
  - a commander banner, strategy and win conditions, and the Bracket 3 checklist
  - cards grouped by role, with images and a click-through detail view that explains why each card is in the deck
  - a type list, a mana curve, counts against the Commander template, color demand and a price
  - opening hands: thousands of goldfished games show how often you keep your first 7, hit your third and fourth land on time, have each color by turn 3 and cast the commander on time (see [Opening-hand check](#opening-hand-check))
  - a sample-hand drawer
  - copy for Moxfield/Archidekt or Arena, and a .txt download
- **Own key:** visitors build with their own Claude API key and model, and see the tokens and estimated cost of each build. The key field works with password managers.
- **Your collection:** prefer cards you own, or build only from them.
- **Show and review your own deck:** paste or upload any Commander decklist under "From my decklist" and choose **Show my deck and its review**. It opens in the same deck view as a built deck (cards grouped by what they do, read from their text; the numbers; opening hands; price; share, save and export), on a **Review** tab: what's strong and what's weak from the numbers (role counts against the usual ranges, curve, colored sources, tapped lands, opening hands, how generic the cards are) and the combos Commander Spellbook finds. Free, no key. For a complete deck, **Review my deck with Claude** adds Claude's read (what works, what holds it back, which cards work together) and up to 10 suggested swaps; it uses one build. Every built deck has the Review tab too.
- **Euros or dollars:** visitors in Europe see Cardmarket prices in euros, everyone else TCGplayer prices in dollars (from the country the host reports: Vercel's `x-vercel-ip-country`, or Cloudflare's `cf-ipcountry`). A switch next to the budget and under the deck's price changes it, and the choice is kept in the browser. The budget options and Claude's budget follow the same currency (dollar budgets are a little higher, because TCGplayer prices run above Cardmarket's), and US shops come first in the buy links. Box EV stays in euros: its data is Cardmarket's.
- **Bracket checker:** paste or upload any decklist at `/bracket` to see which bracket it fits and why, with the opening-hand numbers.
- **Box EV:** what every booster box since 2020 is worth on average at `/ev`, after selling costs, with your chance to get your price back (see [Box EV](#box-ev)). The deck view adds "Singles or boxes?": which boxes could give you the deck's cards, and what those cards cost as singles.
- **Buy the cards:** every deck can open TCGplayer or Card Kingdom with the whole list in the cart, or copy it for a Cardmarket wants list. Clicking a card shows its price at Cardmarket, TCGplayer and Card Kingdom (cheapest printing), each with a buy link. Box EV pages link to each shop's search for the box. Affiliate tags are optional settings (see the environment variables); tagged links are marked `sponsored` and the page says so.
- **Navbar:** Build a deck, Bracket checker, Box EV and My decks on every page, with GitHub and Support links; a menu button on phones.
- **Saving:** "My decks" keeps your finished decks in the browser. With accounts switched on (see [Accounts](self-hosting.md#accounts-optional)), logging in with an email link, Discord or Google keeps them in your account instead, on every device, with rename and delete; decks already in the browser can be moved over.
- **Sharing:**
  - the "Share deck" sheet: native sharing on phones, WhatsApp, Reddit (as a link, or a ready-made Markdown post with the decklist), Telegram, X and email
  - "Open in Moxfield/Archidekt", which copies the list and opens their importer
  - shared links open a read-only deck page with fresh card data and the bracket check, and get a preview image (commander art, deck name) in WhatsApp, Reddit and Discord
  - with a store connected (see [Short share links](self-hosting.md#short-share-links)), links are short: `/d/x7Kp2QaZ1`. Without one, the whole deck is compressed into the link (`/deck?d=…`, about 1.8 KB), so sharing works with no database at all
  - links always point at your public domain, never at a deployment URL that sits behind Vercel's login

## Deck workshop

[/workshop](https://hundredfoldz.app/workshop): build a deck yourself, card by card. Free, no key needed.

- **Pick a commander** with Scryfall autocomplete, Surprise me or the popular commanders, and add a partner or Background when the commander allows one.
- **Find cards:** search by name, rules text or type line (plain words), or with Scryfall syntax. Results are limited to Commander-legal cards in the commander's colors, most played first, with filters for a slot (ramp, card draw, removal, board wipes, protection, recursion, lands, using Scryfall Tagger), card type and mana value.
- **Live checks** as you build, counted from the cards' own text: lands, ramp, card draw, removal, board wipes and protection against the usual Commander numbers. A short count links straight to a search for it. The coach lists problems first (color identity, legality, singleton, the bracket's Game Changers, mass land denial, extra turns) in the same words as the deck check a finished build gets.
- **The deck** grouped by role (each card's role is read from its text; change it in the card view), the mana curve, deck balance, opening-hand odds and price on the Numbers tab, and sample hands. **Add basic lands** fills up to 36 lands and splits all the basics by what the spells need.
- **Hand it to Claude:** *Finish it for me* sends an unfinished deck to the builder's complete mode (every card stays, Claude fills the rest); *Review my deck* sends a full one to upgrade mode (up to 10 swaps). Both use a free build or your Claude key.
- **Keep it:** the deck in progress stays in the browser between visits. Save it to My decks, share a link, or copy it for Moxfield, Archidekt or MTG Arena. Any saved or finished deck opens in the workshop with **Edit in the workshop**.

## Bracket checker

`/bracket` is a free tool: paste any Commander decklist (Moxfield, Archidekt, Arena, MTGO or plain "1 Card" lines) and it shows the lowest bracket the deck fits, the cards that decide it, and a legality check. It needs no Claude and no API key: Game Changer flags and card text come from Scryfall, combos from Commander Spellbook, and the rules are in `lib/server/bracket-check.ts` (checked against Wizards' brackets on 2026-10-25). Brackets 1 and 5 depend on intent, so the result says when a deck could also be one of those.

## Box EV

`/ev` lists every Play, Collector, Set and Draft Booster box released since 2020 with its average card value. A box's page (`/ev/dsk-play`) lets you enter what you'd pay and shows:

- **Average card value:** every card at its Cardmarket trend price, weighted by how often it's in a pack.
- **After selling:** a 5% marketplace fee, and cards under €1 count as €0 because they aren't worth listing one by one. Both, plus a sell-below-trend discount and the pack count, can be changed.
- **Your chance to get your price back:** from 4,000 simulated boxes (seeded, so the same box gives the same answer), with the spread and the middle box, because a few big pulls lift the average above what most boxes give.
- **The cards that carry the value:** price, copies per box and share of the EV.

The data is built once a day by `.github/workflows/ev-data.yml` (`scripts/build-ev.mjs`). It needs no secrets:

- pack layouts and slot odds come from [taw/magic-sealed-data](https://github.com/taw/magic-sealed-data), the source of MTGJSON's booster data;
- prices come from Scryfall (Cardmarket trend, EUR), looked up by set and collector number;
- the result goes to the `ev-data` branch as one commit (no history, so the repo stays small), and Vercel doesn't deploy that branch.

The site reads it from GitHub and keeps it in memory for 30 minutes. A self-hosted copy reads the same data, or set `EV_DATA_URL` to your own. Sealed box prices aren't in any free data source, which is why you enter your own price. Packs per box come from MTGJSON's sealed products (Final Fantasy Play boxes have 30, Commander Masters Collector boxes 4); box toppers aren't counted, so boxes with one are worth a little more than shown.

## Opening-hand check

`lib/shared/openers.ts` goldfishes a deck a few thousand times, with a seeded shuffle so a deck always gets the same numbers. It needs no API calls and runs in the browser for the deck view, and on the server for the bracket checker, the engine's review round and the eval. Each simulated game:

- takes Commander mulligans: the first is free, later ones put a card on the bottom. It keeps 3–5 lands, or 2 lands with cheap ramp or two cheap spells;
- draws every turn, turn 1 included, because nobody skips the first draw in multiplayer;
- plays a land each turn, an untapped one that adds a missing color first;
- casts the commander as soon as the mana and colors allow, and cheap ramp otherwise. Rocks work right away; mana creatures and land-search spells work from the next turn.

It reports the keep rate, lands in the first 7, the third land on turn 3 and the fourth on turn 4, flooding, each color by turn 3, and the commander on curve and one turn later. It's an estimate of the mana, not of how the deck plays. CI prints the numbers for the sample decks in `evals/sample-decks/` (`scripts/check-openers.mjs`).
