# Self-hosting

How to run your own copy, every setting, accounts and abuse protection. Back to the [README](../README.md).

## Host your own

Hundredfoldz is free and open source, and a copy needs no API key of its own: visitors build with their own Claude API key (see [Own API keys](#own-api-keys)). You can also give your copy a server key behind an access code, for yourself and your friends.

### Option 1: Deploy to Vercel (easiest)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FM-Sahin%2Fhundredfoldz)

The button copies this repository to your GitHub account. No environment variables are required: the site starts with own-key builds and the demo. Vercel's free Hobby plan is enough.

Prefer to do it by hand? In Vercel, choose **Add New → Project**, import your copy of the repository, add the variables below, and deploy.

### Option 2: Docker (any server, a NAS or a Raspberry Pi)

```bash
git clone https://github.com/M-Sahin/hundredfoldz.git
cd hundredfoldz
cp .env.example .env.local      # optional: a server key (ANTHROPIC_API_KEY + ACCESS_CODE), Upstash, DONATION_URL
docker compose up -d            # http://localhost:3000
```

Or without compose (here with a server key; leave both variables out to run on visitors' own keys):

```bash
docker build -t hundredfoldz .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... -e ACCESS_CODE=choose-one hundredfoldz
```

Put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) if other people will use it. The proxy must not buffer responses, so the live build view keeps streaming; Caddy and Traefik don't buffer by default.

### Option 3: Node.js

```bash
npm ci && npm run build && npm start
```

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | no | A server key for builds without a visitor key, created at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Without it, builds run on visitors' own keys, and without a key at all the app replays one scripted demo deck. |
| `ACCESS_CODE` | yes, with a server key (unless `FREE_BUILDS` is set) | Visitors have to enter this code to build on the server key. Without it, anyone who has the URL spends your credits, so server-key builds are refused until you set it. Own-key builds don't need it. |
| `FREE_BUILDS` | no | With a server key: this many free builds per visitor (e.g. `3`), then visitors bring their own key. See [Free builds](#free-builds). |
| `FREE_MODEL`, `FREE_EFFORT` | no | The model and effort free builds use. Default `claude-haiku-5-5` at `high`. Visitors who want Sonnet or Opus use their own key. |
| `FREE_BUILDS_PER_IP_PER_DAY` | no | Free builds per IP address per day (default 10), so clearing cookies doesn't give anyone more. |
| `FREE_BUILDS_PER_DAY` | no | Free builds for the whole site per day (default 300). |
| `FREE_TOKENS_PER_DAY` | no | Tokens all free builds together may use per day (default 150,000,000, counting input, output and cache). With `FREE_BUILDS_PER_DAY` this caps what free builds can cost you. |
| `OWN_KEYS` | no | Visitors' own Claude API keys. Without a server key they're allowed unless you set `0`. With a server key they're off unless you set `1`, so a deployment behind an access code doesn't open up when it updates. |
| `OWN_KEY_BUILDS_PER_HOUR` | no | Builds per own key per hour (default 20), to protect Scryfall and the server. |
| `DONATION_URL` | no | An `https://` link (Ko-fi, GitHub Sponsors…) shown in the footer and under each finished deck, e.g. `https://ko-fi.com/yourname`. |
| `PUBLIC_ACCESS` | no | Set it to `1` only if you really want builds open to everyone without a code. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. `claude-opus-5-5` gives stronger decks but is slower and costs more. |
| `AFFILIATE_TCGPLAYER`, `AFFILIATE_CARDKINGDOM`, `AFFILIATE_CARDMARKET` | no | Affiliate tags for the "Buy the cards" and "Find this box" links: a link template with `{url}` where the shop link goes (what Impact gives you for TCGplayer, e.g. `https://tcgplayer.pxf.io/c/…?u={url}`), or parameters to add to the shop link (`partner=yourname`). Without them the links work, untagged. When any is set, the page says some links are affiliate links. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no | Accounts and decks saved to them (see [Accounts](#accounts-optional)). `SUPABASE_PUBLISHABLE_KEY` and the `NEXT_PUBLIC_` names the Supabase Vercel integration sets work too. |
| `KEY_ENCRYPTION_SECRET` | no | Lets logged-in visitors save their own Claude API key to their account. 32 random bytes, base64 (`openssl rand -base64 32`). Keys are sealed with it (AES-256-GCM, bound to the user's id), so the database alone can't reveal them. Changing it makes saved keys unreadable (people add theirs again). Needs [accounts](#accounts-optional) and the `api_keys` migration. |
| `DEFAULT_CURRENCY` | no | `EUR` or `USD`: the prices to show when the host doesn't say which country a visitor is in (Docker, plain Node). Default `EUR`. On Vercel and behind Cloudflare it's picked per visitor: euros in Europe, dollars elsewhere. |
| `ADMIN_EMAILS` | no | Email addresses (comma-separated) that may open `/stats`, the site's usage numbers. Needs [accounts](#accounts-optional): an admin logs in like anyone else. See [Stats](#stats). |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | no | Cloudflare Turnstile, the mostly invisible check that a visitor isn't a bot (see [Abuse protection](#abuse-protection)). |
| `EV_DATA_URL` | no | Where the Box EV data is read from. Defaults to the `ev-data` branch of [M-Sahin/hundredfoldz](https://github.com/M-Sahin/hundredfoldz/tree/ev-data). |
| `BUILDS_PER_HOUR_PER_IP` | no | A best-effort limit per IP, kept per server instance (default 6). |
| `DEMO_MODE` | no | Set it to `1` to force demo mode even when a key is set. Only the value `1` switches it on. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | no | Turn on short share links. Set automatically when you connect Upstash for Redis on Vercel (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too). |
| `SITE_URL` | no | The public address used in share links, e.g. `https://decks.example.com`. On Vercel the default is your production domain. |
| `ENGINE` | no | The deckbuilding engine: `v1` (default) or `v2`. See [Engine quality and evals](development.md#engine-quality-and-evals). |

On Vercel, store `ANTHROPIC_API_KEY` and `ACCESS_CODE` as the **Secret** type. Redeploy after changing a variable, because changes only apply to new deployments.

### Free builds

With `ANTHROPIC_API_KEY` and `FREE_BUILDS=3`, every visitor gets three builds on your key with Claude Haiku 5.5 at high effort (about 2 cents a deck), no key needed. The line under the Build button counts them down. After that, Build opens the key sheet: visitors add their own key and build on any model. Sonnet and Opus always need the visitor's own key.

- **Counted three ways.** Per browser (a random id in an httpOnly cookie, kept a year), per account when logged in (so a new device doesn't reset it) and per IP address per day (`FREE_BUILDS_PER_IP_PER_DAY`). Every count has to be under its limit. On top, `FREE_BUILDS_PER_DAY` caps the whole site, so a bad day can't cost more than that many Haiku builds.
- **In the shared store.** With Upstash configured, the counts are shared by every server instance. Keys are hashed, so the store never holds ids, user ids or addresses.
- **Bot check.** With Turnstile on, each free build needs a fresh token.
- **Fair, but not refundable on purpose.** A build that ends without a deck gives the visitor's free build back. It still counts toward the address's and the site's daily limits and the token budget, so failing builds on purpose can't run up the bill. A build the visitor stops isn't given back.
- **Smaller collections.** Free builds take a collection of up to 1,000 different cards (a collection goes into the prompt). Own-key builds take 5,000.
- **Owner builds.** The access code isn't used in this mode. Use your own key in the key sheet like everyone else.

Set a monthly spend limit on the key's workspace in the Claude Console as a last line of defense.

### Own API keys

On the setup screen, visitors can add their own Claude API key in the key sheet (it opens from the line under the Build button, or by itself when a build needs a key). The sheet walks them through making one: a Claude Console workspace with a monthly spend limit, a little credit, and a key from that workspace.

- **The key stays in the browser.** It's kept in this device's storage, or for the tab only if the visitor prefers. It's sent with each build in a header, used only for that build, and never written to logs, the job store or share links. A strict Content Security Policy (`proxy.ts`, a fresh nonce per request) stops injected scripts from reading it.
- **Password managers.** The key field is a login-style form (a hidden "Claude API key" username and a password field), so Chrome, Safari, 1Password and Bitwarden offer to save the key and fill it in later, also after clearing the cache and on other devices. The setup steps tell people to save it right away, because the Console shows a key only once, and how to replace a lost one.
- **The key is checked first** with Anthropic's model list (`/api/key/check`), which also fills the model picker. The result is cached per tab, so reloading doesn't re-check.
- **Model choice.** The picker offers Sonnet 5.5 (default), Opus 5.5 and Haiku 5.5, plus every other model the key can use under "Show all".
- **Cost.** The live build and the finished deck show the tokens used and an estimated cost (prices in `lib/shared/models.ts`).
- **Clear errors.** "Out of credit", "spend limit reached", "key not accepted", "model not available" and "rate limited" each say what to do.
- **Limits.** Builds are limited per key (`OWN_KEY_BUILDS_PER_HOUR`, default 20) and key checks per IP and key, so people behind one shared address don't block each other.

### Build from your collection

Visitors can load their collection: a CSV export (Moxfield, Archidekt, ManaBox, Deckbox, Dragon Shield and others with a Name column) or a plain list, up to 5,000 different cards. "Prefer my cards" marks owned cards in Claude's search results and asks it to use them. "Only my cards" also has the server reject unowned cards (seeds and basic lands are always allowed). The collection stays in the browser and is sent with the build.

### My decks

Finished decks are kept in the browser (up to 30) as compact share payloads, and reopen with fresh card data.

### Short share links

Shared decks are stored for a year (renewed whenever someone opens the link) in Upstash Redis, which has a free tier. On Vercel: **Storage → Create Database → Upstash for Redis** (or the Marketplace), connect it to this project, and redeploy. The integration adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. Elsewhere, create a free database at upstash.com and set those two variables yourself. The same deck always gets the same link, and links fall back to the long form if the store is unreachable.

### Builds that survive leaving the page

Phones pause or drop connections when you switch apps, so a build doesn't depend on the browser's connection:

- `POST /api/generate` starts the build as a job (kept running with Next's `after()`) and streams its events, each with an index. A heartbeat every 5 seconds lets the page tell a quiet connection from a dead one.
- When the stream drops, or the page comes back after more than a moment in the background, the page reconnects with `GET /api/generate?job=<id>&from=<n>` and continues from the last event it saw. A reload mid-build picks the build up again from `sessionStorage`.
- "Stop building" calls `POST /api/generate/stop`; closing the connection no longer stops a build.
- Events are kept in memory, which is enough for Docker and Node. On Vercel a reconnect can reach a different server instance, so with Upstash connected the events are also batched into Redis (about 150–200 commands per build) and any instance can serve the reconnect.

**Why did a shared link ask for a Vercel login?** Vercel's default Deployment Protection puts a login in front of deployment URLs (`yourproject-abc123-you.vercel.app`, the "Visit" button in the dashboard). Only the production domain is public. Share links now always use the production domain (or `SITE_URL`), so this can't happen anymore.

**Cost:** each build is one Claude conversation of about 4–8 turns, paid from your own API account. The skill prompt and the growing conversation are prompt-cached. Set a monthly spend limit in the Claude Console (Billing → Spend limits) as an extra guard.

**Function duration:** a build usually takes 1–3 minutes. On Vercel, `app/api/generate/route.ts` sets `maxDuration = 300`, which is the Hobby maximum on Fluid compute. The agent submits by about 3½ minutes and stops at about 4½ minutes with the best deck it has (it keeps 25 seconds after each Claude call to check the deck), so it finishes inside the limit. On Pro you can raise `maxDuration` (the maximum is 800). Docker and Node.js have no such limit.

**Keeping your copy up to date:** use **Sync fork** on GitHub (or `git pull` for Docker). Vercel redeploys automatically when your copy changes.

## Stats

`/stats` shows what happens on the site, for the people who run it: builds started, finished, failed and stopped (by who pays for them: free, own key, saved key), why builds failed, how long finished builds took, the key wall (free builds used up, key sheet shown, keys added, own-key builds), what happens after a deck (saved, shared, copied, shop links), accounts, and errors in the server and in browsers, with the most common browser error messages.

- **Only counts.** Each event adds one to a count for the day (`lib/shared/stats-events.ts` lists them all). Nothing says who did it: no ids, no IP addresses, no cookies. Error messages are cleaned of numbers, links, email addresses and keys before they're counted. That's why the funnels are rough ratios: someone who opens the key sheet twice counts twice.
- **Where.** In the Upstash store, one hash per day, kept 400 days. Without a store, each server instance counts in its own memory (the page says so).
- **Who can see it.** Set `ADMIN_EMAILS` and log in with one of those addresses. The server checks the session with Supabase before showing anything; everyone else gets "not found".
- **What the browser sends.** `POST /api/stats` accepts only the browser events in that list (key sheet, browser saves, exports, shop links, the share sheet, page errors), rate limited per address. Builds, keys, account saves and share links are counted on the server.

Vercel Web Analytics still counts page views. Its custom events need a paid plan, which is why these counts are the site's own.

## Accounts (optional)

Logging in is optional: everything works without an account. An account keeps your decks on every device. Accounts use [Supabase](https://supabase.com) (Auth and Postgres) through its REST APIs, with no SDK.

- **Sessions** are httpOnly cookies set by the app's own routes (`/api/auth/*`, `/auth/callback`). Page scripts never see a token, so the security policy stays `connect-src 'self'`.
- **Logins** are PKCE: email magic links, and Discord or Google if you switch them on. A magic link must be opened in the browser that asked for it.
- **Row-level security** in the database decides who sees what: each user reads, saves and deletes only their own decks, and only a deck's name can change after saving. `supabase/migrations/` has the schema; `.github/workflows/accounts.yml` runs it on a local Supabase and checks this with two real users (`scripts/check-supabase.mjs`).
- **Deleting the account** on the account page removes the user and every deck in it, right away (a database function that can only delete the caller).
- A saved deck is the same compressed payload as a share link. The server decodes it to fill in the name and commander, so the browser can't save something that isn't a deck. The same deck saved twice is one row, and an account keeps up to 1,000.

To switch it on for your copy:

1. Create a Supabase project, in an EU region if your users are in Europe.
2. Run `supabase/migrations/20261026000000_accounts.sql` once: paste it into the SQL editor, or `supabase link` and `supabase db push`.
3. In **Authentication → URL configuration**, set the Site URL to your domain and add `https://your-domain/auth/callback` (and `http://localhost:3000/auth/callback` for local development) to the redirect URLs.
4. **Email:** Supabase's built-in email is meant for testing and sends only a few emails an hour. Before you launch, add your own SMTP server under **Authentication → Emails → SMTP Settings**. With [Resend](https://resend.com): verify your domain there (it gives you DNS records to add), create an API key, then use host `smtp.resend.com`, port `465`, username `resend`, the API key as the password, and a sender like `login@your-domain`. Then raise **Authentication → Rate Limits → emails** to what you expect.
5. **Email templates:** `supabase/templates/` has the login emails in the site's look (the images come from `public/email/`, made by `node scripts/render-email.mjs`, which also renders previews with `--preview <dir>`). In **Authentication → Emails → Templates**, paste `magic-link.html` into **Magic Link** (subject: *Your Hundredfoldz login link*) and `confirm-signup.html` into **Confirm signup** (subject: *Confirm your email for Hundredfoldz*). A new account gets the confirm email first; after that, logins use the magic link. The images load from `hundredfoldz.app`; a copy on another domain should change those two URLs.
6. **Discord or Google (optional):** create an OAuth app with the provider, using `https://<project>.supabase.co/auth/v1/callback` as its redirect URL, and enter its client id and secret under **Authentication → Providers**. The login dialog shows the providers that are switched on.
7. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or the newer publishable key as `SUPABASE_PUBLISHABLE_KEY`) in Vercel. No secret or service-role key is needed.
8. Outside Vercel, also set `SITE_URL` (for example `https://decks.example.com`). Login links are built from it, never from request headers, so a forged `Host` header can't send someone's login link to another site. Without it, logins only work on `localhost`. On Vercel the production domain is used, and a preview deployment uses its own URL: add `https://*-your-team.vercel.app/auth/callback` to the redirect URLs if you want to log in on previews. Keep the list exact otherwise, without broad wildcards.

9. **Saved API keys (optional):** run `supabase/migrations/20261027000000_api_keys.sql` the same way and set `KEY_ENCRYPTION_SECRET` (`openssl rand -base64 32`, type Secret on Vercel). Logged-in visitors then get "Save it to my account" in the key sheet.

Without these settings the app works as before: no login button, decks in the browser.

- **My decks** (`/decks`) lists the account's decks (or this browser's), with the commander's art, when each was made and the model. Each deck can be opened, shared, improved by Claude (up to 10 swaps), built again from its five seeds, renamed and deleted. Building needs a key or a free build, like any build.
- **Saving is a choice.** A finished deck isn't saved until the visitor presses **Save deck**: into the account when logged in, otherwise into this browser, with "Save to my account" to move it into an account (the login dialog opens, and after logging in the deck moves over by itself). A build is still kept on the server for an hour, so closing the browser mid-build doesn't lose it.
- **Saved API keys** are sealed by the server with AES-256-GCM (`lib/server/key-vault.ts`), with the user's id as additional data, and stored with their last four characters only. The browser never gets a saved key back: a build asks the server to use it (`x-use-saved-key`), and the server opens it for that build. Row-level security keeps each row to its owner, and deleting the account deletes the key.

## Abuse protection

- **Shared rate limits** (`lib/server/ratelimit.ts`) on every route that costs something: builds, key checks, the bracket checker, login emails, deck saves, share links and share images, card lookups and prices. With the Upstash store set up, every server instance counts together, so a script can't get around a limit by landing on fresh instances; without it each instance counts on its own. Counts are kept under hashed keys (no IPs or emails in the store), IPv6 addresses count per /64, and a limited request gets a 429 with `Retry-After`. The numbers are in `LIMITS` in that file.
- **Turnstile** (optional): with `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` set, the bracket checker and "Read my deck" need a token that the server checks with Cloudflare, and the login form sends one to Supabase. In Cloudflare, create a Turnstile widget for your domain (managed mode). In Supabase, switch on **Authentication → Bot and abuse protection → CAPTCHA**, pick Turnstile and paste the same secret: then Supabase refuses login emails without a valid token, also from scripts that call Supabase directly. Each token works once, so the login token goes only to Supabase. If Cloudflare can't be reached, requests go through and the rate limits still apply.
- **Headers:** a strict Content Security Policy with a nonce per request (Turnstile's script and frame are the only outside ones), HSTS, no framing, `nosniff`.
- **Supply chain:** Dependabot (`.github/dependabot.yml`), `npm audit` in CI (critical issues in shipped dependencies fail the build), and GitHub Actions pinned to commits.
