# fantasy-league-site

A league office site for a group of friends with four ESPN fantasy leagues (baseball, hockey, basketball, football) and the same ten managers in each. It shows:

- **Combined standings**: every manager's winning percentage in each league, averaged at 25% per league.
- **Standings**, **rosters**, and **trades** for each league.

To try it without any ESPN setup, run `npm run serve` and open <http://localhost:8787/>. With no Worker configured, the site uses built-in demo data with made-up managers.

## How it works

```
browser (site/)  ──►  Cloudflare Worker (worker/)  ──►  ESPN fantasy API (lm-api-reads.fantasy.espn.com)
                           │
                           └── KV: league list, manager links
```

ESPN's API doesn't send CORS headers, so a web page can't call it directly. The Worker makes the request instead. It adds ESPN cookies for private leagues, caches responses for five minutes, and stores league settings in KV. The site is plain static files with no build step.

| Path | What it is |
| --- | --- |
| `site/index.html`, `site/app.js` | The single-page app |
| `site/lib/espn.js` | Turns ESPN league JSON into standings, rosters, and trades (pure functions) |
| `site/lib/combine.js` | Combined-standings math |
| `site/lib/views.js` | HTML rendering (pure functions) |
| `site/config.js` | `WORKER_URL`, the only setting the site needs |
| `site/demo/` | Synthetic ESPN-shaped data (`npm run demo-data` regenerates it) |
| `worker/` | Cloudflare Worker: `/api/league`, `/proxy`, `/config` |
| `scripts/snapshot-league.mjs` | Saves one real league's JSON to `data/` (gitignored) and prints its structure |

### Combined standings math

- **Head-to-head leagues:** pct = (W + ½T) / (W + L + T), from ESPN's overall record. In category leagues, the record counts category wins, the same as ESPN's standings.
- **Roto leagues:** finish position becomes a percentage. 1st place is 1.000, last is .000, and tied teams share the average.
- **Combined:** Σ wᵢ·pctᵢ / Σ wᵢ over the leagues that have started. With all four seasons running, each league counts exactly 25%. A league that hasn't started yet (hockey in September, say) is left out instead of counting as .000, and the other leagues share its weight until it begins. Weights can be changed via `weights` in the config.
- **Matching managers:** a manager is matched across leagues by ESPN account id, so no names need to be entered. If someone uses a different ESPN account in one league, link the two accounts under **Settings → Manager links**.

## Setup

### 1. Deploy the Worker

```sh
cd worker
npx wrangler login
npx wrangler kv namespace create LEAGUE_CONFIG   # paste the printed id into wrangler.toml
npx wrangler secret put ADMIN_TOKEN              # any long random string; required to save settings
# Private leagues only. Copy the espn_s2 and SWID cookies from a browser logged in to ESPN:
npx wrangler secret put ESPN_S2
npx wrangler secret put SWID
npx wrangler deploy
```

Once the site has a permanent address, set `ALLOWED_ORIGIN` in `wrangler.toml` to that origin.

### 2. Point the site at the Worker

Set `WORKER_URL` in `site/config.js`, or open the site once with `?worker=https://your-worker.workers.dev` (the browser remembers it).

### 3. Host the site

`site/` is a static folder. Cloudflare Pages (output directory `site`), Netlify, or any static host works.

### 4. Add the leagues

In **Settings**, save the admin token, then paste each league's URL from fantasy.espn.com. Or write a whole config at once, starting from `config.example.json`:

```sh
cp config.example.json my-leagues.local.json   # *.local.json is gitignored
# edit the league IDs, then:
cd worker && npx wrangler kv key put config --path ../my-leagues.local.json --binding LEAGUE_CONFIG --remote
```

## Development

```sh
npm test                      # node --test: parsing, combined math, Worker routes, rendering
npm run serve                 # http://localhost:8787 (add ?demo=1 to force demo data)
node scripts/snapshot-league.mjs "https://fantasy.espn.com/football/league?leagueId=…" --worker https://your-worker.workers.dev
```

No dependencies to install. Requires Node 20 or newer.

## Keeping personal data out of this repo

This repository is public. It must never contain manager names, league IDs, ESPN cookies, or raw ESPN responses.

- League settings live in the Worker's KV store, secrets are Worker secrets, and all demo and test data is synthetic.
- `data/`, `*.local.json`, `.dev.vars`, and `.private-patterns` are gitignored.
- `git config core.hooksPath .githooks` turns on a pre-commit hook. It blocks any commit where a staged file matches a regex from your local `.private-patterns` file (one pattern per line; names, league IDs, and so on). `npm run check-private` scans every tracked file the same way.

## Status

- The parsing has been checked against three of the real leagues (September 2026): team counts, owner names, records, roster slots, and cross-league manager matching all come through.
- ESPN's API lives at `lm-api-reads.fantasy.espn.com/apis/v3/`. The older `/apps/fantasy/v3/` path returns 403 to every request.
- Public leagues need no cookies. A private league returns 401 (`AUTH_LEAGUE_NOT_VISIBLE`) until the Worker has `ESPN_S2` and `SWID` from an account in that league.
- The original prototype's honor-system sign-in was replaced. Viewing is open to anyone, and changing settings requires the admin token. Before, any visitor could rewrite the league list.
