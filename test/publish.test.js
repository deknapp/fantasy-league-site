import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLeague } from "../site/lib/espn.js";
import { combineStandings } from "../site/lib/combine.js";
import { countLeaks, publicLeague, pseudonym, sensitiveValues } from "../site/lib/publish.js";

const RAW = {
  id: 987654321,
  settings: { name: "Private League Name", scoringSettings: { scoringType: "H2H_POINTS" } },
  members: [
    { id: "{AAAA-1111}", firstName: "Pat", lastName: "Example", displayName: "patexample99" },
    { id: "{BBBB-2222}", firstName: "Sam", lastName: "Sample", displayName: "sammy" },
  ],
  teams: [
    { id: 1, name: "Rally Caps", owners: ["{AAAA-1111}"], primaryOwner: "{AAAA-1111}", record: { overall: { wins: 3, losses: 1 } },
      roster: { entries: [{ playerId: 5, lineupSlotId: 0, playerPoolEntry: { player: { fullName: "Real Athlete" } } }] } },
    { id: 2, name: "Walk-Off Wonders", owners: ["{BBBB-2222}"], record: { overall: { wins: 1, losses: 3 } } },
  ],
  transactions: [{ id: "tx-uuid", type: "TRADE_ACCEPT", status: "EXECUTED", proposedDate: 1, items: [{ playerId: 5, fromTeamId: 2, toTeamId: 1 }] }],
};

test("pseudonym is stable and short", () => {
  assert.equal(pseudonym("{AAAA-1111}"), pseudonym("{AAAA-1111}"));
  assert.notEqual(pseudonym("{AAAA-1111}"), pseudonym("{BBBB-2222}"));
  assert.match(pseudonym("x"), /^m[0-9a-f]{8}$/);
});

test("publicLeague keeps team names, records, and athletes but drops managers and IDs", () => {
  const pub = publicLeague(normalizeLeague(RAW, "nfl"), { key: "nfl-2026" });
  const text = JSON.stringify(pub);
  assert.ok(text.includes("Rally Caps") && text.includes("Real Athlete"));
  assert.equal(countLeaks(text, sensitiveValues(RAW)), 0);
  assert.ok(!text.includes("Private League Name"));
  assert.ok(!text.includes("tx-uuid"));
  assert.ok(pub.teams.every((t) => t.ownerName === null && /^m[0-9a-f]{8}$/.test(t.ownerId)));
  assert.deepEqual(pub.teams.map((t) => [t.wins, t.losses, t.rank]), [[3, 1, 1], [1, 3, 2]]);
});

test("the same ESPN account gets the same key in every league, and aliases merge accounts", () => {
  const a = publicLeague(normalizeLeague(RAW, "nfl"), { key: "nfl-2026" });
  const b = publicLeague(normalizeLeague(RAW, "mlb"), { key: "mlb-2026" });
  assert.equal(a.teams[0].ownerId, b.teams[0].ownerId);

  const merged = publicLeague(normalizeLeague(RAW, "nba"), { key: "nba-2027", aliases: { "{BBBB-2222}": "{AAAA-1111}" } });
  assert.equal(merged.teams[0].ownerId, merged.teams[1].ownerId);
});

test("combined standings label managers by team name when names are hidden", () => {
  const inputs = [
    { key: "mlb-2026", sport: "mlb", league: publicLeague(normalizeLeague(RAW, "mlb"), { key: "mlb-2026" }) },
    { key: "nfl-2026", sport: "nfl", league: publicLeague(normalizeLeague(RAW, "nfl"), { key: "nfl-2026" }) },
  ];
  const { rows } = combineStandings(inputs);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.label, r.labelFrom]), [["Rally Caps", "mlb-2026"], ["Walk-Off Wonders", "mlb-2026"]]);
});

test("sensitiveValues collects league, account IDs, and names", () => {
  const values = sensitiveValues(RAW);
  for (const v of ["987654321", "{AAAA-1111}", "Pat Example", "patexample99", "sammy"]) assert.ok(values.includes(v), v);
});

test("countLeaks matches numbers only as whole numbers and text case-insensitively", () => {
  assert.equal(countLeaks('{"t":19876543210}', ["987654321"]), 0);
  assert.equal(countLeaks('{"id":987654321}', ["987654321"]), 1);
  assert.equal(countLeaks("team of PAT EXAMPLE", ["Pat Example", "nobody"]), 1);
});
