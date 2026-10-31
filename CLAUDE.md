# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

At the start of a session, read `session.md` (what was done last time) and `backlog.md` (what's next) if they exist; they're local notes, kept out of git. At the end, add the session to `session.md` and update `backlog.md`.

Hundredfoldz: five seed Magic cards in, a legal 100-card Commander deck out. Claude builds the deck with the mtg-master skill as its system prompt and Scryfall lookups as tools; the server validates every submission. Next.js 16 (App Router), React 19, plain CSS, TypeScript. **No SDKs**: Anthropic, Scryfall, Upstash, Supabase and Turnstile are all called with plain `fetch`. Keep it that way.

## Commands

```bash
npm run dev            # http://localhost:3000 (no key needed: paste one in the page, or use the demo)
npm test               # all unit tests; no network, no key
npm run typecheck      # tsc over app, tests and scripts (next build only checks the app)
npm run build
npm run check-skill    # fails if lib/skill/content.ts doesn't match the pinned skill release
```

Before a PR: `npm test`, `npm run typecheck`, `npm run build`.

`npm test` (`scripts/run-tests.mjs`) bundles every `tests/*.test.ts` with esbuild into `.test-build/` and runs them with `node --test`. There is no filter argument; to run one file:

```bash
npx esbuild tests/shape.test.ts --bundle --platform=node --format=esm --target=node20 --outfile=.test-build/one.mjs && node --test .test-build/one.mjs
```

Add `--test-name-pattern="..."` to the `node --test` call to run one test. Delete `.test-build/` afterwards.

Network scripts (CI runs them; see `docs/development.md` for the full table): `node scripts/e2e-demo.mjs` (needs a running server, real Scryfall), `node scripts/check-scryfall-live.mjs`, `node scripts/screenshots.mjs` (needs `playwright`), `node scripts/eval.mjs check|run`.

## Architecture

**Code split.** `lib/server/` is server-only, `lib/client/` is browser-only (`"use client"`), `lib/shared/` is pure logic used by both (types, bracket rules, deck analysis, opening-hand simulator, parsers, prices). Most `app/api/**/route.ts` files are thin wrappers that call a framework-independent handler in `lib/server/*-handler.ts` taking a `Request` and returning a `Response`. Put logic in the handler so tests can call it directly.

**A build, end to end:**
1. `components/App.tsx` (flow and state) calls `generate()` in `lib/client/api.ts`, which POSTs to `/api/generate` and reads an SSE stream of `StreamEvent`s (`lib/shared/types.ts`).
2. `lib/server/generate-handler.ts` parses the request and picks how the build is paid for: a server key with an access code, the visitor's own key, a key saved in their account (`key-vault.ts`), free builds (`free-builds.ts`), or the scripted demo (`demo.ts`). It also applies rate limits and the Turnstile check, then starts a job.
3. `lib/server/jobs.ts` runs the build separately from the HTTP connection (the route uses Next's `after()`). Events are buffered in memory and, if Upstash is configured, in Redis too. A dropped client reconnects with `GET /api/generate?job=<id>&from=<n>`. `/api/generate/stop` cancels a build.
4. `lib/server/agent.ts` (`runAgent`) is the agent loop. The model is called through a `ModelCaller` (`anthropic.ts`, a small streaming Messages client). Tools are `search_cards` and `get_cards` (`scryfall.ts`), `submit_deck` (checked by `lib/shared/validate.ts`, re-exported from `lib/server/validate.ts`: 100 cards, singleton, legality, color identity, partners, seeds included, Game Changers, mass land denial, extra turns) and, in review mode, `revise_deck`. A failed submit goes back to Claude with the errors, up to 4 attempts. `draft-scanner.ts` reads card names out of the partial tool input as it streams, so the 10×10 grid fills live.
5. Prompts live in `lib/server/prompt.ts`: an adapter over `lib/skill/content.ts`.

**The deck workshop** (`/workshop`, `components/Workshop.tsx`) is the build-it-yourself mode, with no Claude calls of its own. Its deck logic is pure functions in `lib/shared/workshop.ts` (what can be added, roles via `guessRole`, the checklist from `analyzeDeck`, coach notes from `validateDeck`, basic-land fill via `rebalanceBasics`), and the deck in progress lives in localStorage (`lib/client/workshop.ts`). Card search is `/api/cards/search` (`lib/server/card-search.ts`: the commander's identity, `f:commander`, Scryfall Tagger slots). Claude comes in through handoffs (`handoff` in `lib/client/api.ts`, kept in sessionStorage): the workshop hands the build page `complete` or `upgrade`, and My decks or a finished deck hands the workshop `edit`. Its card picks ("Deal me 3", `components/CardPicks.tsx`) are the one Claude feature inside it: `/api/coach` (`lib/server/coach-handler.ts`, `coach.ts`) runs a short loop on Claude Haiku with the skill prompt, `search_cards`/`get_cards` and an `offer_cards` tool, checks every offered card with the workshop's `canAdd()` before streaming it, and runs on the visitor's own key (`lib/server/build-access.ts`, shared with builds) or, with `FREE_DEALS`, a few free deals a day on the site's key, counted by `free-builds.ts` under the `deal` scope (per day, separate from free builds, same token budget).

**Engine variants** (`lib/server/engine.ts`). Every quality change is a flag (`prompt2`, `fullText`, `strict`, `review`, `manabase`, `combos`, `effort`) so the eval harness (`evals/`, `scripts/eval.mjs`) can compare variants on the same hands. Presets are `v1` (the default) and `v2` (everything on). The `ENGINE` env var takes specs like `v2-review` or `v1+strict,effort=xhigh`. A new engine behavior should get its own flag and stay off in `v1`.

**Skill content is generated.** `lib/skill/content.ts` comes from the mtg-master release pinned in `package.json` (`"skill": {"ref": ...}`) via `npm run sync-skill`. Don't hand-edit it. Skill text changes are made in the M-Sahin/mtg-master repo; then bump `ref`, re-sync, and commit both files together.

**Optional services, all off by default.** Upstash Redis (`store.ts`) gives short share links (`/d/<id>`) and reconnects across instances; without it, links carry the whole deck in `/deck?d=`. Supabase (`supabase.ts`, `account-handler.ts`, `supabase/migrations/`) provides accounts, decks saved on the server and saved keys. Turnstile is the bot check. Without `ANTHROPIC_API_KEY` the site runs in demo mode or on visitors' own keys. All env vars are in `.env.example`; `serverConfig()` and `publicConfig()` in `lib/server/config.ts` read them. `proxy.ts` sets a CSP with a per-request nonce, so inline scripts and structured data need that nonce.

**Tests.** They use Node's `node:test` and `assert/strict`. Scryfall is faked by swapping `globalThis.fetch` (`installFakeScryfall()` in `tests/fixtures.ts`; that data is synthetic and not a source of truth). Claude is faked with scripted `ModelCaller`s (see `demoCaller` in `demo.ts`). The account handlers accept an injected `{ config, fetch }`, which is how `tests/accounts.test.ts` fakes Supabase.

## Rules for changes

- Card facts (text, legality, Game Changers, bans, prices) come from Scryfall or Wizards at runtime, never from memory or hardcoded guesses.
- When Wizards changes the brackets, update both `lib/shared/bracket.ts` (the builder) and `lib/server/bracket-check.ts` (the free checker), and link the official source in the PR. Model prices for cost estimates are in `lib/shared/models.ts`. Each of these files records the date it was last checked.
- UI text uses plain words, without jargon the player doesn't need. Check UI changes on a phone-width screen too; CI's browser pass flags anything that overflows 360px.
- Keep the Wizards Fan Content notice and artist credits. No paywalls (Scryfall API rules).
- Commit messages are short, sentence-style summaries of the user-visible change, sometimes with an area prefix (`Review: …`, `Share image: …`, `fixes #N`).
