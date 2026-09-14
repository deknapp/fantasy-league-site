// Save one league's raw ESPN JSON to data/ (gitignored) and print its shape, to check the parser against real data.
//
//   node scripts/snapshot-league.mjs "<fantasy.espn.com league URL>"                       # straight to ESPN
//   node scripts/snapshot-league.mjs "<league URL>" --worker https://your-worker.workers.dev  # through the Worker
//
// Private leagues in direct mode: set ESPN_S2 and SWID environment variables.
// Output is counts and field names only, so it's safe to paste into an issue.
import { mkdirSync, writeFileSync } from "node:fs";
import { leagueApiUrl, normalizeLeague, parseLeagueUrl } from "../site/lib/espn.js";

const [input, ...rest] = process.argv.slice(2);
const workerFlag = rest.indexOf("--worker");
const worker = workerFlag >= 0 ? rest[workerFlag + 1]?.replace(/\/+$/, "") : null;
const parsed = input && parseLeagueUrl(input);
if (!parsed) {
  console.error('Usage: node scripts/snapshot-league.mjs "<fantasy.espn.com league URL>" [--worker <url>]');
  process.exit(2);
}

const { sport, leagueId, year } = parsed;
const url = worker ? `${worker}/api/league?sport=${sport}&year=${year}&id=${leagueId}` : leagueApiUrl(sport, year, leagueId);
const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; fantasy-league-site)" };
if (!worker && process.env.ESPN_S2 && process.env.SWID) headers.Cookie = `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.SWID}`;

const res = await fetch(url, { headers });
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  process.exit(1);
}

const raw = JSON.parse(text);
mkdirSync("data", { recursive: true });
const file = `data/${sport}-${leagueId}-${year}.json`;
writeFileSync(file, JSON.stringify(raw, null, 2));

const league = normalizeLeague(raw, sport);
console.log(`Saved ${file}`);
console.log({
  sport,
  year,
  scoringType: league.scoringType,
  isRoto: league.isRoto,
  started: league.started,
  teams: league.teams.length,
  teamsWithOwnerName: league.teams.filter((t) => t.ownerName).length,
  distinctOwners: new Set(league.teams.map((t) => t.ownerId)).size,
  gamesPlayed: league.teams.map((t) => t.games),
  rosterSizes: league.teams.map((t) => t.roster.length),
  unknownSlots: [...new Set(league.teams.flatMap((t) => t.roster.filter((p) => p.slot.startsWith("Slot")).map((p) => p.slotId)))],
  trades: league.trades.length,
});
console.log("Top-level keys:", Object.keys(raw).join(", "));
console.log("Team keys:", Object.keys(raw.teams?.[0] || {}).join(", "));
console.log("record.overall keys:", Object.keys(raw.teams?.[0]?.record?.overall || {}).join(", "));
