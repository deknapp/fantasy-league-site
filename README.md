# fantasy-league-site

A league office site for a group of friends with four ESPN fantasy leagues (baseball, hockey, basketball, football) and the same ten managers in each. It shows:

- **Combined standings**: every manager's winning percentage in each league, averaged at 25% per league.
- **Standings**, **rosters**, and **trades** for each league.

Everything runs on GitHub, for free: GitHub Actions fetches the leagues from ESPN every 30 minutes and publishes the site to GitHub Pages. There is no server.

To try it locally with made-up data: `npm run serve`, then open <http://localhost:8787/>.

## How it works

```
GitHub Actions (every 30 min, on push, or by hand)
  └─ scripts/build-data.mjs ── ESPN fantasy API (lm-api-reads.fantasy.espn.com/apis/v3)
        └─ site/data/leagues.json ─┐
  site/ (static page) ─────────────┴─► GitHub Pages
```

`scripts/build-data.mjs` reads the league list from the `LEAGUES_CONFIG` secret. It fetches each league and keeps only what the page shows: team names, records, rosters, and trades. It then writes one JSON file next to the page. If a league fails to load, the site keeps that league's last good data and marks it as stale.

| Path | What it is |
| --- | --- |
| `site/index.html`, `site/app.js` | The single-page app |
| `site/lib/espn.js` | Turns ESPN league JSON into standings, rosters, and trades (pure functions) |
| `site/lib/publish.js` | Removes manager names and ESPN IDs before anything is published |
| `site/lib/combine.js` | Combined-standings math |
| `site/lib/views.js` | HTML rendering (pure functions) |
| `site/demo/` | Synthetic ESPN-shaped data, used when no published data exists (`npm run demo-data` regenerates it) |
| `scripts/build-data.mjs` | Fetches the leagues and writes `site/data/leagues.json` |
| `.github/workflows/deploy.yml` | Tests, fetches data, and deploys to Pages |

### Combined standings math

- **Head-to-head leagues:** pct = (W + ½T) / (W + L + T), from ESPN's overall record.
- **Roto leagues:** finish position becomes a percentage. 1st place is 1.000, last is .000, and tied teams share the average.
- **Combined:** Σ wᵢ·pctᵢ / Σ wᵢ over the leagues that have started. With all four seasons running, each league counts exactly 25%. A league that hasn't started yet is left out instead of counting as .000, until it begins. The weights can be changed with `weights` in the config.
- **Matching managers:** managers are matched across leagues by ESPN account, so no names need to be entered. On the site, each manager is listed by their team name in the first league. If someone uses a different ESPN account in one league, add `"aliases": { "<other account id>": "<main account id>" }` to the config.

## Setup

1. **Add the league config as a secret.** Copy `config.example.json`, put in the real league IDs and seasons (a league's ID is the `leagueId` in its fantasy.espn.com URL), then:
   ```sh
   gh secret set LEAGUES_CONFIG < my-leagues.local.json   # *.local.json is gitignored
   ```
2. **Private leagues only:** add the ESPN cookies of an account that's in the league. While logged in on fantasy.espn.com, find them under Chrome DevTools → Application → Cookies:
   ```sh
   gh secret set ESPN_S2
   gh secret set SWID
   ```
   Instead of adding cookies, the league manager can make the league viewable to the public in ESPN's league settings.
3. **Turn on Pages:** Settings → Pages → Source: **GitHub Actions**.
4. **Deploy:** push to `main`, or run it by hand with `gh workflow run deploy.yml`. The site appears at `https://<user>.github.io/fantasy-league-site/`.

## Maintenance

- **League changes:** a new season or a new league ID means updating the `LEAGUES_CONFIG` secret. Nothing in the code changes.
- **Failures:** a failed run shows up in the Actions tab, and GitHub emails the repo owner. Private-league and missing-league errors also appear on the site itself.
- **Inactive repos:** GitHub pauses scheduled workflows after 60 days without repository activity. Each scheduled run re-enables its own workflow to prevent that. If the site ever stops updating, check the Actions tab and re-enable the workflow there.

## Development

```sh
npm test               # node --test: parsing, publishing, combined math, rendering
npm run build-data     # fetch real data into site/data/ using config.local.json (gitignored)
npm run serve          # http://localhost:8787 (add ?demo=1 to force demo data)
node scripts/snapshot-league.mjs "https://fantasy.espn.com/football/league?leagueId=…"   # inspect one league's JSON structure
```

No dependencies to install. Requires Node 20 or newer.

## Keeping personal data out of this repo

This repository is public, and so is the site.

- **In the repo:** no manager names, league IDs, ESPN cookies, or ESPN responses. League IDs and cookies are GitHub secrets. Demo and test data are made up.
- **On the site:** team names, records, rosters, and trades only. `site/lib/publish.js` removes manager names, ESPN account IDs, and league IDs. The build also refuses to publish if any of those values still shows up anywhere in the output, including inside a team name.
- **Ignored files:** `data/`, `site/data/`, `*.local.json`, and `.private-patterns` are gitignored.
- **Pre-commit check:** `git config core.hooksPath .githooks` turns on a pre-commit hook. It blocks any commit where a staged file matches a regex in your local `.private-patterns` file, one pattern per line. `npm run check-private` scans every tracked file the same way.

## Notes

- **ESPN's API address:** `lm-api-reads.fantasy.espn.com/apis/v3/`. The older `/apps/fantasy/v3/` path returns 403 to every request.
- **Private leagues:** they return 401 (`AUTH_LEAGUE_NOT_VISIBLE`) until the `ESPN_S2` and `SWID` secrets are set.
- **Verified:** parsing has been checked against real leagues (September 2026).
