# Contributing

Thanks for helping out. Hundredfoldz is a Next.js / TypeScript app. The Claude Skill it builds decks with, MTG Master, lives in its own repository: [M-Sahin/mtg-master](https://github.com/M-Sahin/mtg-master).

## Run the app locally

```bash
npm install
cp .env.example .env.local   # everything in it is optional
npm run dev
```

Without any key, paste your own Claude API key in the page to build real decks, or load the demo seeds: the demo replays one scripted build against real Scryfall data and costs nothing.

Before you open a pull request:

```bash
npm test            # no network and no key needed
npm run typecheck
npm run build
```

## Changing the skill

The skill's text is Claude's system prompt here, but it's edited in the skill's own repository:

1. Make the change in [M-Sahin/mtg-master](https://github.com/M-Sahin/mtg-master) and release it there (a new tag, like `v1.0.4`).
2. In this repo, set `"ref"` under `"skill"` in `package.json` to the new tag, run `npm run sync-skill`, and commit `package.json` and `lib/skill/content.ts` together. CI fails when the two don't match.

To try a skill change in the app before releasing it, point the script at your local copy: `SKILL_DIR=../mtg-master/mtg-master npm run sync-skill`. Don't commit that result; sync from a release before you push.

## When Wizards changes the rules

- **The Game Changers list** is read live from Scryfall, so there's nothing to update.
- **Bracket rules:** update `lib/shared/bracket.ts` (the limit and the wording shown to Claude and users) and `lib/server/bracket-check.ts` (the free bracket checker's rules for every bracket), and `references/commander.md` in the skill. Link the official announcement in your pull request.
- **Model prices** for the cost estimate are in `lib/shared/models.ts`.
- **Ban lists** come from Scryfall's legality data.

## Ground rules

- Card facts must come from Scryfall or Wizards, not from memory. That's the skill's main rule, and it applies to the code too.
- No paywalls and no selling: card data and images fall under the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and [Scryfall's API rules](https://scryfall.com/docs/api). Keep the Fan Content notice and the artist credits.
- Plain words in the interface, no jargon the player doesn't need.
- Be kind in issues and reviews.
