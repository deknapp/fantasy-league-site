// Fetches every configured ESPN league and writes site/data/leagues.json for the static site.
// Runs on a schedule in GitHub Actions (see .github/workflows/deploy.yml), or locally:
//
//   node scripts/build-data.mjs            # reads config.local.json
//
// Environment
//   LEAGUES_CONFIG     league config JSON (same shape as config.example.json); overrides config.local.json
//   ESPN_S2, SWID      ESPN cookies, only needed for private leagues
//   PREVIOUS_DATA_URL  the live site's data/leagues.json; a league that fails to load keeps its last good data
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { leagueApiUrl, normalizeLeague } from "../site/lib/espn.js";
import { countLeaks, publicLeague, sensitiveValues } from "../site/lib/publish.js";
import { validateConfig } from "./config.mjs";

const OUT_FILE = "site/data/leagues.json";

function failureMessage(status) {
  if (status === 401) {
    return "ESPN says this league is private. Make it viewable to the public in ESPN's league settings, or add the ESPN_S2 and SWID repository secrets.";
  }
  if (status === 404) return "ESPN couldn't find this league for that season.";
  return `ESPN responded with HTTP ${status}.`;
}

export async function fetchEspnLeague(league, env = process.env) {
  const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; fantasy-league-site)" };
  if (env.ESPN_S2 && env.SWID) headers.Cookie = `espn_s2=${env.ESPN_S2}; SWID=${env.SWID}`;
  let res;
  try {
    res = await fetch(leagueApiUrl(league.sport, league.year, league.leagueId), { headers });
  } catch {
    throw new Error("Couldn't reach ESPN.");
  }
  if (!res.ok) throw new Error(failureMessage(res.status));
  return res.json();
}

// fetchRaw(league) -> raw ESPN JSON. previous: the last published site data, if any.
export async function buildSiteData({ config, fetchRaw, previous = null, now = new Date() }) {
  const sensitive = [];
  const usedKeys = new Set();
  const leagues = [];

  for (const l of config.leagues) {
    // The published key must not contain the league ID.
    let key = `${l.sport}-${l.year}`;
    for (let n = 2; usedKeys.has(key); n++) key = `${l.sport}-${l.year}-${n}`;
    usedKeys.add(key);
    sensitive.push(l.leagueId);

    const entry = { key, label: l.label, sport: l.sport, year: l.year };
    try {
      const raw = await fetchRaw(l);
      sensitive.push(...sensitiveValues(raw));
      const data = publicLeague(normalizeLeague(raw, l.sport), { key, aliases: config.aliases });
      leagues.push({ ...entry, status: "ok", fetchedAt: now.toISOString(), data });
    } catch (err) {
      const last = previous?.leagues?.find((p) => p.key === key && p.data);
      leagues.push(last
        ? { ...entry, status: "stale", error: err.message, fetchedAt: last.fetchedAt, data: last.data }
        : { ...entry, status: "error", error: err.message, fetchedAt: null, data: null });
    }
  }

  sensitive.push(...Object.keys(config.aliases), ...Object.values(config.aliases));
  const site = { leagueName: config.leagueName, updatedAt: now.toISOString(), weights: config.weights, leagues };
  const leaks = countLeaks(JSON.stringify(site), sensitive);
  if (leaks) {
    throw new Error(`Refusing to publish: the output contains ${leaks} private value(s) (league IDs, ESPN account IDs, or manager names).`);
  }
  return site;
}

function loadConfig() {
  if (process.env.LEAGUES_CONFIG) return validateConfig(JSON.parse(process.env.LEAGUES_CONFIG));
  if (existsSync("config.local.json")) return validateConfig(JSON.parse(readFileSync("config.local.json", "utf8")));
  throw new Error("No league config. Set LEAGUES_CONFIG or create config.local.json (see config.example.json).");
}

async function loadPrevious(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  const config = loadConfig();
  const previous = await loadPrevious(process.env.PREVIOUS_DATA_URL);
  const site = await buildSiteData({ config, previous, fetchRaw: (l) => fetchEspnLeague(l) });

  for (const l of site.leagues) {
    console.log(`${l.label}: ${l.status}${l.data ? ` (${l.data.teams.length} teams)` : ""}${l.error ? ` - ${l.error}` : ""}`);
  }
  if (site.leagues.every((l) => !l.data)) {
    console.error("No league could be loaded; leaving the published data as it is.");
    process.exit(1);
  }
  mkdirSync("site/data", { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(site)}\n`);
  console.log(`Wrote ${OUT_FILE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
