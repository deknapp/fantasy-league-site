import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultSeason, leagueApiUrl, normalizeLeague, parseLeagueUrl, teamName } from "../site/lib/espn.js";

const demo = (sport) => JSON.parse(readFileSync(new URL(`../site/demo/${sport}.json`, import.meta.url), "utf8"));

const team = (id, overall, extra = {}) => ({ id, name: `Team ${id}`, owners: [`{M${id}}`], record: { overall }, ...extra });

test("parseLeagueUrl reads league, team, and standings pages for every sport", () => {
  const sept = new Date(2026, 8, 13);
  assert.deepEqual(parseLeagueUrl("https://fantasy.espn.com/baseball/league?leagueId=111", sept), { sport: "mlb", leagueId: "111", year: "2026" });
  assert.deepEqual(parseLeagueUrl("https://fantasy.espn.com/hockey/team?leagueId=222&teamId=5&seasonId=2027", sept), { sport: "nhl", leagueId: "222", year: "2027" });
  assert.deepEqual(parseLeagueUrl("https://fantasy.espn.com/basketball/team?leagueId=333&teamId=8", sept), { sport: "nba", leagueId: "333", year: "2027" });
  assert.deepEqual(parseLeagueUrl(" https://fantasy.espn.com/football/standings?leagueId=444 ", new Date(2027, 0, 5)), { sport: "nfl", leagueId: "444", year: "2026" });
});

test("parseLeagueUrl rejects non-ESPN and incomplete URLs", () => {
  assert.equal(parseLeagueUrl("https://example.com/football/league?leagueId=1"), null);
  assert.equal(parseLeagueUrl("https://notespn.com/football/league?leagueId=1"), null);
  assert.equal(parseLeagueUrl("https://fantasy.espn.com/football/league"), null);
  assert.equal(parseLeagueUrl("https://fantasy.espn.com/golf/league?leagueId=1"), null);
  assert.equal(parseLeagueUrl("not a url"), null);
});

test("defaultSeason follows ESPN's season naming", () => {
  assert.equal(defaultSeason("nhl", new Date(2026, 3, 1)), 2026);
  assert.equal(defaultSeason("nhl", new Date(2026, 9, 1)), 2027);
  assert.equal(defaultSeason("nfl", new Date(2026, 9, 1)), 2026);
  assert.equal(defaultSeason("mlb", new Date(2026, 9, 1)), 2026);
});

test("leagueApiUrl builds the v3 URL and validates input", () => {
  assert.equal(
    leagueApiUrl("mlb", "2026", "123", ["mTeam", "mStandings"]),
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues/123?view=mTeam&view=mStandings",
  );
  assert.throws(() => leagueApiUrl("golf", "2026", "1"), /Unknown sport/);
  assert.throws(() => leagueApiUrl("nfl", "26", "1"), /4-digit/);
  assert.throws(() => leagueApiUrl("nfl", "2026", "1; drop"), /numeric/);
});

test("teamName prefers name, then location + nickname, then abbrev", () => {
  assert.equal(teamName({ id: 1, name: "Sluggers", location: "X", nickname: "Y" }), "Sluggers");
  assert.equal(teamName({ id: 1, location: "Big", nickname: "Dogs" }), "Big Dogs");
  assert.equal(teamName({ id: 1, abbrev: "BD" }), "BD");
  assert.equal(teamName({ id: 7 }), "Team 7");
});

test("head-to-head standings sort by winning percentage with ties counted as half", () => {
  const league = normalizeLeague({
    settings: { scoringSettings: { scoringType: "H2H_POINTS" } },
    members: [{ id: "{M1}", firstName: "Ann", lastName: "Example" }, { id: "{M2}", displayName: "handle2" }],
    teams: [
      team(1, { wins: 2, losses: 1, ties: 1, pointsFor: 400 }),
      team(2, { wins: 3, losses: 1, ties: 0, pointsFor: 300 }),
      team(3, { wins: 0, losses: 4, ties: 0, pointsFor: 500 }),
    ],
  }, "nfl");
  assert.equal(league.started, true);
  assert.equal(league.isRoto, false);
  assert.deepEqual(league.teams.map((t) => t.teamId), [2, 1, 3]);
  assert.deepEqual(league.teams.map((t) => t.winPct), [0.75, 0.625, 0]);
  assert.deepEqual(league.teams.map((t) => t.rank), [1, 2, 3]);
  assert.equal(league.teams[1].ownerName, "Ann Example");
  assert.equal(league.teams[0].ownerName, "handle2");
});

test("roto leagues turn finish position into a percentage, sharing ties", () => {
  const league = normalizeLeague({
    settings: { scoringSettings: { scoringType: "ROTO" } },
    teams: [50, 40, 40, 10].map((points, i) => team(i + 1, {}, { points })),
  }, "nhl");
  assert.equal(league.isRoto, true);
  assert.equal(league.started, true);
  assert.deepEqual(league.teams.map((t) => t.winPct), [1, 0.5, 0.5, 0]);
});

test("a league with points but no games is treated as roto even without a scoring label", () => {
  const league = normalizeLeague({ teams: [team(1, {}, { points: 5 }), team(2, {}, { points: 9 })] }, "mlb");
  assert.equal(league.isRoto, true);
  assert.deepEqual(league.teams.map((t) => t.teamId), [2, 1]);
});

test("a league that hasn't started has no percentages", () => {
  for (const scoringType of ["H2H_POINTS", "ROTO"]) {
    const league = normalizeLeague({ settings: { scoringSettings: { scoringType } }, teams: [team(1, {}), team(2, {})] }, "nba");
    assert.equal(league.started, false);
    assert.deepEqual(league.teams.map((t) => t.winPct), [null, null]);
  }
});

test("primaryOwner wins over the owners list", () => {
  const league = normalizeLeague({ teams: [team(1, {}, { owners: ["{A}", "{B}"], primaryOwner: "{B}" })] }, "nfl");
  assert.equal(league.teams[0].ownerId, "{B}");
});

test("rosters list starters first and label slots and injuries", () => {
  const entry = (playerId, lineupSlotId, injuryStatus = "ACTIVE") => ({ playerId, lineupSlotId, playerPoolEntry: { player: { fullName: `P${playerId}`, injuryStatus } } });
  const league = normalizeLeague({ teams: [team(1, {}, { roster: { entries: [entry(1, 20), entry(2, 0, "OUT"), entry(3, 21), entry(4, 23), entry(5, 99)] } })] }, "nfl");
  const roster = league.teams[0].roster;
  assert.deepEqual(roster.map((p) => p.slot), ["QB", "FLEX", "Slot 99", "BE", "IR"]);
  assert.equal(roster[0].injuryStatus, "OUT");
  assert.equal(roster[1].injuryStatus, null);
});

test("trades keep only trade transactions, newest first, with names resolved", () => {
  const roster = { entries: [{ playerId: 9, lineupSlotId: 0, playerPoolEntry: { player: { fullName: "Nine" } } }] };
  const league = normalizeLeague({
    teams: [team(1, {}, { roster }), team(2, {})],
    transactions: [
      { id: "a", type: "WAIVER", items: [{ playerId: 9, fromTeamId: 0, toTeamId: 1 }] },
      { id: "b", type: "TRADE_ACCEPT", status: "EXECUTED", proposedDate: 100, items: [{ playerId: 9, fromTeamId: 2, toTeamId: 1 }] },
      { id: "c", type: "TRADE_PROPOSAL", proposedDate: 200, items: [{ playerId: 5, fromTeamId: 1, toTeamId: 7 }] },
    ],
  }, "nfl");
  assert.deepEqual(league.trades.map((t) => t.id), ["c", "b"]);
  assert.deepEqual(league.trades[1].items[0], { player: "Nine", from: "Team 2", to: "Team 1" });
  assert.deepEqual(league.trades[0].items[0], { player: "Player 5", from: "Team 1", to: "Free agency" });
  assert.equal(league.trades[0].status, "PENDING");
});

test("demo leagues cover record, roto, preseason, and trades", () => {
  const mlb = normalizeLeague(demo("mlb"), "mlb");
  const nhl = normalizeLeague(demo("nhl"), "nhl");
  const nba = normalizeLeague(demo("nba"), "nba");
  const nfl = normalizeLeague(demo("nfl"), "nfl");
  for (const league of [mlb, nhl, nba, nfl]) {
    assert.equal(league.teams.length, 10);
    assert.ok(league.teams.every((t) => t.ownerName && t.roster.length > 0));
  }
  assert.equal(mlb.started, true);
  assert.equal(nhl.isRoto, true);
  assert.equal(nba.started, false);
  assert.equal(nfl.trades.length, 1);
  assert.ok(nfl.trades[0].items.every((it) => it.player.startsWith("Demo Player")));
});
