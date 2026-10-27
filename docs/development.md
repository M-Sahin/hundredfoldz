# Development

Next.js (App Router), React 19, plain CSS. No SDK dependencies beyond Next and React, and no database required: an optional Upstash Redis store adds short share links and lets builds survive switching servers. Back to the [README](../README.md).

## Develop

```bash
npm install
cp .env.example .env.local   # optional: leave it empty and paste your own key in the page, or watch the demo
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests (Node's test runner, bundled with esbuild): validation and partner rules, the SSE parser, the agent loop with scripted "Claude" turns, engine variants and the review pass, complete and upgrade modes, accounts and saved decks against a fake Supabase, the deck analysis on real Oracle text, the opening-hand simulator, combos, own keys, collections, jobs and reconnects, share links, the bracket checker and the eval harness |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `node scripts/e2e-demo.mjs` | End-to-end check against a running server in demo mode (uses real Scryfall) |
| `node scripts/screenshots.mjs` | Screenshots of every screen (needs `playwright`) |
| `node scripts/check-scryfall-live.mjs` | Checks double-faced, split and accented card names, and partner pairings, against the live Scryfall API |
| `node scripts/calibrate-analysis.mjs` | Compares the role detector with Scryfall Tagger on the most-played cards per role (needs Scryfall access) |
| `node scripts/eval.mjs check` / `run` | The engine eval (see [Running an eval](#running-an-eval)) |
| `node scripts/build-ev.mjs --out ev-out [--only dsk-play]` | Builds the Box EV data (needs GitHub and Scryfall) |
| `node scripts/check-openers.mjs [list.txt …]` | Opening-hand numbers for real decklists, before and after the basic-land rebalance (needs Scryfall) |

CI (`.github/workflows/ci.yml`) runs all of these on every push except the eval run, and also builds and tests the Docker image. The browser pass checks the share flow, link previews, a cut-off build stream, switching apps, the key form, the security policy, the bracket checker, the Opening hands panel, completing and upgrading a deck, and the phone header. A step also prints the opening-hand numbers for the sample decks. CI publishes the screenshots, logs and the lockfile it resolved to the `ci-output` branch. The eval has its own manual workflow (`.github/workflows/eval.yml`).

### Layout

```
app/                    pages: / (builder), /bracket, /deck?d= and /d/<id> (shared decks); layout, CSS
app/api/                generate (+ reconnect, stop), key/check, bracket, share, deck/resolve, og, config, cards/*
proxy.ts                Content Security Policy with a per-request nonce
instrumentation.ts      counts uncaught server errors for /stats
components/             App (flow and state), SeedHand, CardSearch, ForgeView (live build), DeckView, CardFace,
                        KeyPanel, CollectionPanel, MyDecks, ShareSheet, SharedDeck, BracketChecker
lib/server/             agent loop, engine variants, Claude client, Scryfall client, validation, combo check,
                        prompt, jobs (reconnectable builds), store (Upstash), share links, bracket check, demo
lib/shared/             types, bracket rules, deck analysis, models and prices, collection and decklist parsers,
                        share payloads, deck statistics and export
lib/client/             browser API: builds with reconnect, key storage, My decks
lib/skill/content.ts    generated from the pinned mtg-master skill release
evals/                  eval hands, runner, scorecard, blind judge, report
scripts/                sync-skill, test runner, e2e, screenshots, live Scryfall checks, calibration, eval
tests/                  unit tests and Scryfall fixtures
```

## How it uses the skill

Claude's system prompt comes from [MTG Master](https://github.com/M-Sahin/mtg-master), a Claude Skill for Magic that lives in its own repository. `package.json` pins the release this app uses:

```json
"skill": { "repo": "https://github.com/M-Sahin/mtg-master", "ref": "v1.0.3" }
```

`scripts/sync-skill.mjs` fetches that release and copies `SKILL.md` and the references the builder needs (`commander.md`, the Karsten table in `constructed.md`, the search syntax in `lookup.md`, and the Commander rules in `rules.md`) into `lib/skill/content.ts`. That becomes Claude's system prompt, plus a short adapter (`lib/server/prompt.ts`). The file is committed, so building and deploying never need the skill repository.

The adapter maps the skill's scripts to tools the server implements, because Claude has no shell here:

| Skill script ([mtg-master/scripts](https://github.com/M-Sahin/mtg-master/tree/main/mtg-master/scripts)) | App tool | Implemented in |
|---|---|---|
| `scripts/scryfall.py search` | `search_cards` | `lib/server/scryfall.ts` |
| `scripts/scryfall.py cards` | `get_cards` | `lib/server/scryfall.ts` |
| `scripts/deckcheck.py --format commander` | `submit_deck`, validated server-side | `lib/server/validate.ts` |

`submit_deck` checks that the deck has exactly 100 cards, that it's singleton (with exceptions such as Relentless Rats and basic lands), Commander legality, color identity, the commander and any partner/Background pairing, that all five seeds are in the deck, and that there are at most 3 Game Changers. It also warns about mass land denial and extra turns. Errors go back to Claude until the deck passes (at most 4 attempts). The Game Changers list is read live from Scryfall, so it stays current.

To move to a new skill release, change `ref`, run `npm run sync-skill` and commit both files. CI (`npm run check-skill`) fails when `content.ts` doesn't match the pinned release. While you're editing the skill itself, point the script at your local copy instead:

```bash
SKILL_DIR=../mtg-master/mtg-master npm run sync-skill
```

## Engine quality and evals

The engine has two versions. Every change in `v2` is behind its own switch, so it can be measured against `v1` before it becomes the default.

| Switch | What it does | Why it should give better decks |
|---|---|---|
| `prompt2` | Claude plans the 99 slots before searching, spends its searches on the seeds' theme and on recent cards, and skips searches for staples it already knows | Its memory is weakest on synergy pieces and new cards, which is where the deck's identity comes from |
| `fullText` | Search results carry the full Oracle text instead of a 140-character excerpt | Less guessing from memory, fewer misread cards |
| `strict` | The server counts lands, ramp, draw, removal and colored sources from the card text itself (`lib/shared/analysis.ts`). Big gaps are errors on the first two submits | Claude no longer grades its own role tags |
| `review` | After the first legal deck, Claude gets the server's analysis and opening-hand numbers and makes up to 10 swaps with a cheap `revise_deck` tool | Critiquing a concrete list with hard numbers is easier than getting 99 cards right in one pass |
| `manabase` | The server re-splits the basic lands across colors by colored-source targets and mana symbols | Counting pips over 99 cards is arithmetic, which code does better |
| `combos` | [Commander Spellbook](https://commanderspellbook.com) checks the deck; two-card combos it rates Ruthless are errors (unless both pieces are the user's own picks); Spicy ones are flagged | A cheap two-card combo makes it the wrong deck for a Bracket 3 table |
| `effort` | `ENGINE=v2,effort=xhigh` sets the API's effort level (default: the model's own) | More thinking per turn, at the cost of time |

Thinking is already on: the 5.5 models use adaptive thinking by default.

Specs combine a preset with switches: `v2`, `v2-review`, `v1+strict+fullText`, `v2,effort=xhigh`.

### Running an eval

`evals/hands.json` has 20 seed hands: every color count, tribal and non-tribal, chosen and open commanders, a partner pair, double-faced seeds and all three budgets. The harness builds each hand with each variant and scores every deck:

- whether it's legal, time, token cost, and searches and submits per build;
- objective numbers from the analysis: template roles in range, missing template cards, colored sources short of the Karsten targets, share of generic top-300 EDHREC staples, price against the budget, and too-strong combos;
- opening hands: the fourth land on turn 4, the commander on time, and the worst color by turn 3;
- a blind A/B judgement: Opus compares each variant's deck with the baseline's on the same hand, twice with the order swapped, and a win only counts when both orders agree.

```bash
node scripts/eval.mjs check                          # hands resolve on Scryfall, combo service works (no key)
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval.mjs run --variants v1,v2 --hands 6 --judge claude-opus-5-5
```

A variant can name its own builder model with `@`: `--variants v2,v2@haiku` compares Sonnet with Haiku on the same engine. `--max-usd` caps the estimated spend (the GitHub workflow defaults to $3.50 and three hands).

Results so far (three hands each, so treat them as hints):

| Run | Result |
|---|---|
| v1 against v2, Sonnet | v2 won 2, lost 0, tied 1. Fewer generic staples (32% against 39%), and the review cut too-strong combos. About $0.23 a deck against $0.19. Its Esper mana was skewed (12 Island, 4 Plains), which led to the fix in the basic-land split. |
| v2 on Sonnet against v2 on Haiku | Every deck legal. Haiku costs about $0.017 a deck against $0.25, but lost 1 and tied 2, with weaker synergy and mana scores. Sonnet stays the default; Haiku is the budget option. |

The output folder (`evals/out/<time>/`) holds `report.md`, `results.json` and every decklist with its analysis, so you can read the decks yourself too.

In GitHub, add the repository secret `ANTHROPIC_API_KEY` (preferably from a Console workspace with a spend limit), then run **Actions → eval → Run workflow**. The report appears in the run summary and on the `ci-output` branch under `evals/`.

## Notes

- Bracket 3 rules for the builder were checked on 2026-10-24 against Wizards' Commander format page and the Commander Brackets updates of October 2025 and February 2026. They're in `lib/shared/bracket.ts`. The bracket checker's rules for all brackets were checked on 2026-10-25 and are in `lib/server/bracket-check.ts`. Update both when Wizards changes the brackets.
- Model prices for the cost estimate were checked on 2026-10-25 and are in `lib/shared/models.ts`.
- Prices are Scryfall's Cardmarket (EUR) trend prices and change daily.
- Hundredfoldz is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images come from [Scryfall](https://scryfall.com) and follow its [API rules](https://scryfall.com/docs/api): it's free to use, with no paywall, and artists are credited.
