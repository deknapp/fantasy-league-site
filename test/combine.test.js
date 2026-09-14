import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLeague } from "../site/lib/espn.js";
import { combineStandings, formatPct, managerKey, ordinal } from "../site/lib/combine.js";

// A normalized league where each owner's winning percentage is given directly.
function league(pcts, { started = true, ownerPrefix = "M" } = {}) {
  return {
    started,
    teams: Object.entries(pcts).map(([owner, winPct], i) => ({
      teamId: i + 1,
      name: `${owner} team`,
      ownerId: `${ownerPrefix}${owner}`,
      ownerName: `Manager ${owner}`,
      winPct: started ? winPct : null,
      rank: i + 1,
      wins: 1,
      losses: 1,
      ties: 0,
    })),
  };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("with all four leagues running, each counts 25%", () => {
  const { rows } = combineStandings([
    { key: "b", sport: "mlb", league: league({ A: 0.8, B: 0.2 }) },
    { key: "h", sport: "nhl", league: league({ A: 0.6, B: 0.4 }) },
    { key: "k", sport: "nba", league: league({ A: 0.4, B: 0.9 }) },
    { key: "f", sport: "nfl", league: league({ A: 0.2, B: 0.9 }) },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["Manager B", "Manager A"]);
  close(rows[0].combinedPct, 0.6);
  close(rows[1].combinedPct, 0.5);
  assert.equal(rows[0].leaguesCounted, 4);
  assert.deepEqual([rows[0].wins, rows[0].losses], [4, 4]);
});

test("leagues that haven't started are left out and the rest re-weighted", () => {
  const { rows } = combineStandings([
    { key: "b", sport: "mlb", league: league({ A: 0.7 }) },
    { key: "h", sport: "nhl", league: league({ A: 0.0 }, { started: false }) },
    { key: "f", sport: "nfl", league: league({ A: 0.3 }) },
    { key: "k", sport: "nba", league: null },
  ]);
  close(rows[0].combinedPct, 0.5);
  assert.equal(rows[0].leaguesCounted, 2);
  assert.equal(rows[0].byLeague.h.counted, false);
});

test("custom weights are applied", () => {
  const { rows } = combineStandings(
    [
      { key: "b", sport: "mlb", league: league({ A: 1 }) },
      { key: "f", sport: "nfl", league: league({ A: 0 }) },
    ],
    { weights: { mlb: 3, nfl: 1 } },
  );
  close(rows[0].combinedPct, 0.75);
});

test("aliases merge a manager's second account, keeping the main account's name", () => {
  const alt = league({ A: 0.2 }, { ownerPrefix: "ALT" });
  alt.teams[0].ownerName = "Manager A (other login)";
  const inputs = [
    { key: "k", sport: "nba", league: alt },
    { key: "b", sport: "mlb", league: league({ A: 0.8 }) },
  ];
  assert.equal(combineStandings(inputs).rows.length, 2);
  const { rows } = combineStandings(inputs, { aliases: { ALTA: "MA" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Manager A");
  close(rows[0].combinedPct, 0.5);
});

test("managerKey follows alias chains and survives cycles", () => {
  const t = { ownerId: "x", teamId: 1 };
  assert.equal(managerKey(t, "L", { x: "y", y: "z" }), "z");
  assert.equal(typeof managerKey(t, "L", { x: "y", y: "x" }), "string");
  assert.equal(managerKey({ ownerId: null, teamId: 4 }, "L"), "L:team:4");
});

test("demo data combines into ten managers plus one unlinked second account", () => {
  const load = (sport) => normalizeLeague(JSON.parse(readFileSync(new URL(`../site/demo/${sport}.json`, import.meta.url), "utf8")), sport);
  const inputs = ["mlb", "nhl", "nba", "nfl"].map((sport) => ({ key: sport, sport, league: load(sport) }));
  assert.equal(combineStandings(inputs).rows.length, 11);
  const { rows } = combineStandings(inputs, { aliases: { "{DEMO-MANAGER-10-ALT}": "{DEMO-MANAGER-10}" } });
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.leaguesCounted === 3 && r.combinedPct != null));
});

test("formatPct and ordinal", () => {
  assert.equal(formatPct(0.625), ".625");
  assert.equal(formatPct(1), "1.000");
  assert.equal(formatPct(null), "–");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
});
