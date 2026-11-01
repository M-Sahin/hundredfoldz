# Features

Everything Hundredfoldz does, in detail. Back to the [README](../README.md).

## What you get

- **The setup:** a fanned hand of five seed cards with Scryfall autocomplete and a "Surprise me" button. You can crown a legendary creature as commander or let Claude choose. There's a bracket picker (1–4), budget options, a free-text wish list, and the page tints itself to your color identity.
- **Deck shape (optional):** minimum and maximum creatures, lands, ramp, card draw, removal and board wipes, and a cap on the average mana value. Claude gets them as targets; the server counts them from the card text (creatures from the type line) and sends the deck back when one is off, for the first three tries; after that a miss is a warning. The deck's sidebar shows each limit against the real count. They replace the template's own checks for the counts you set, and apply to completing and upgrading a deck too.
- **Start from your own deck:** paste or upload a decklist. If it has fewer than 100 cards, Hundredfoldz asks whether to complete it: every card you have stays and Claude fills the rest. If it's complete, it offers upgrades: Claude keeps the commander and the plan and suggests up to 10 swaps, each with a reason. The result lists the swaps above the deck and marks the new cards.
- **The live build:** Claude's notes stream in while it works, and every Scryfall search is shown in plain words (or with its exact query). The line Claude writes just before its first search, what the deck wants, goes on a paper note as Claude's plan. "The Hundred", a 10×10 grid of sleeves, fills up card by card in each card's role color while Claude writes the list. The build keeps running if you switch apps or lose the connection; the page reconnects and picks up where it left off (see [Builds that survive leaving the page](self-hosting.md#builds-that-survive-leaving-the-page)).
- **The deck:**
  - a commander banner, strategy and win conditions, and the Bracket 3 checklist
  - cards grouped by role, with images and a click-through detail view that explains why each card is in the deck
  - a compact list (the List tab): the whole deck in a few columns, by card type or by role, with mana costs and the Seed, New and Game Changer marks; hover a name to see the card. The page remembers whether you last used List or Cards, and the grouping
  - a mana curve, counts against the Commander template, color demand and a price
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

- **Pick a commander** by name, Surprise me or the popular commanders, and add a partner or Background when the commander allows one. The commander picker suggests only cards that can lead a deck (Scryfall's `is:commander`, then the workshop's own commander check), and the partner picker only cards that can pair with the chosen commander: its Partner, Partner with, Partner—[name], Friends forever, Choose a Background or Doctor's companion ability decides, checked by the same pairing rules as the deck check. The partner picker lists them as soon as it opens; typing narrows the list.
- **Start from a decklist:** paste a list (Moxfield, Archidekt, MTG Arena, MTGO or plain "1 Card" lines) or upload a .txt on the commander screen, and the deck opens in the workshop with every card's data, at Bracket 3 unless its cards need more. Cards Scryfall doesn't know are named and left out. It replaces the deck in progress, which Undo can bring back.
- **Find cards:** search by name, rules text or type line (plain words), or with Scryfall syntax. Results are limited to Commander-legal cards in the commander's colors, most played first, with filters for a slot (ramp, card draw, removal, board wipes, protection, recursion, lands, using Scryfall Tagger), card type and mana value. Results come 40 at a time; **Show more** adds the next 40 under them, with the same filters and no card twice.
- **Live checks** as you build, counted from the cards' own text: lands, ramp, card draw, removal, board wipes and protection against the usual Commander numbers. A short count links straight to a search for it. The coach lists problems first (color identity, legality, singleton, the bracket's Game Changers, mass land denial, extra turns) in the same words as the deck check a finished build gets.
- **The deck** grouped by role (each card's role is read from its text; change it in the card view), the mana curve, deck balance, opening-hand odds and price on the Numbers tab, and sample hands. **Add basic lands** fills up to 36 lands and splits all the basics by what the spells need.
- **Deck plan (optional):** once there's a commander, a paper note in Find cards offers a plan. One short Claude call names 3 to 5 themes for the commander ("Sacrifice for value", "Death triggers"), each with a line on why it fits and a Scryfall search. The server runs every search the way the workshop's own search does (the commander's colors, Commander-legal) and only keeps themes whose search finds at least 5 cards; the rest go back to Claude. The themes become chips in Find cards (tapping one runs its search) and targets for Deal me 3, in place of plain synergy. The plan is kept with the deck in progress, so a reload keeps it; a new commander or partner clears it. Same key and free deals as card picks; a plan costs one deal.
- **Deal me 3 (card picks):** stuck on a slot? Claude deals three cards for it (the deck's biggest gaps first, plus synergy and win conditions), each with one line on why it fits this deck. The server checks every card before it's shown: on Scryfall, Commander-legal, in the commander's colors, not in the deck yet, and within the bracket's Game Changers; a card that fails is sent back for a replacement. Keep any, or deal three more: cards you passed on aren't offered again. With a deck plan, it can deal for each of the plan's themes. An optional *Steer it* line ("cheaper", "no creatures") says what to look for. Runs on Claude Haiku with the visitor's own Claude API key (typed in or saved to the account), and the dialog shows what the deals cost. A site can also give a few free deals a day on its own key (`FREE_DEALS`, see [Free card picks](self-hosting.md#free-card-picks)); the workshop counts them down.
- **Is this card good here?** In the workshop's card view (not on finished decks), one short Claude call judges that card in this deck: "Great here", "Fine here" or "Weak here", in two lines on a paper note. When there's clearly a better card for the same job, it names one. The server checks it like a pick (on Scryfall, Commander-legal, in the commander's colors, not in the deck, within the bracket's Game Changers, as if it took the judged card's place); a card that fails goes back once for another. **Swap it in** replaces the card (or **Add it instead** for a card that isn't in the deck yet), checked again in the browser first. Verdicts are remembered for the visit. Same key and free deals as card picks; a verdict costs one deal.
- **Undo:** the Undo button at the top (or Ctrl/Cmd+Z, when you're not typing in a box) takes back the last change, and again for the one before, up to 20: cards added or removed, basic lands, the commander, partner, bracket, a card's role, the deck name (typing it counts as one change), Start over and an opened list or deck. The steps last for the visit; after a reload the deck is still there, but Undo starts fresh.
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
