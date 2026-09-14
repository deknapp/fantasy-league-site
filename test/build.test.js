import test from "node:test";
import assert from "node:assert/strict";
import { buildSiteData } from "../scripts/build-data.mjs";
import { validateConfig } from "../scripts/config.mjs";

const config = validateConfig({
  leagueName: "Test League",
  leagues: [
    { sport: "mlb", leagueId: "111111111", year: "2026", label: "Baseball" },
    { sport: "nhl", leagueId: "222222222", year: "2027", label: "Hockey" },
    { sport: "nfl", leagueId: "333333333", year: "2026", label: "Football" },
  ],
});

const rawFor = (l, teamName = "Bullpen Brawlers") => ({
  id: Number(l.leagueId),
  members: [{ id: "{OWNER-1}", firstName: "Jordan", lastName: "Placeholder", displayName: "jplaceholder" }],
  teams: [{ id: 1, name: teamName, owners: ["{OWNER-1}"], record: { overall: { wins: 2, losses: 1 } } }],
});

const now = new Date("2026-09-14T12:00:00Z");

test("builds published data with ok, stale, and error leagues", async () => {
  const previous = {
    leagues: [{ key: "nhl-2027", data: { teams: [], trades: [], started: false }, fetchedAt: "2026-09-13T12:00:00Z" }],
  };
  const fetchRaw = async (l) => {
    if (l.sport === "mlb") return rawFor(l);
    throw new Error(l.sport === "nhl" ? "private" : "down");
  };
  const site = await buildSiteData({ config, fetchRaw, previous, now });
  assert.equal(site.leagueName, "Test League");
  assert.equal(site.updatedAt, now.toISOString());
  assert.deepEqual(site.leagues.map((l) => [l.key, l.status]), [["mlb-2026", "ok"], ["nhl-2027", "stale"], ["nfl-2026", "error"]]);
  assert.equal(site.leagues[1].fetchedAt, "2026-09-13T12:00:00Z");
  assert.equal(site.leagues[0].data.teams[0].name, "Bullpen Brawlers");

  const text = JSON.stringify(site);
  for (const secret of ["111111111", "222222222", "333333333", "{OWNER-1}", "Jordan Placeholder", "jplaceholder"]) {
    assert.ok(!text.includes(secret), secret);
  }
});

test("refuses to publish when a team name contains a manager's name", async () => {
  const fetchRaw = async (l) => rawFor(l, "Jordan Placeholder's Team");
  await assert.rejects(buildSiteData({ config, fetchRaw, now }), /Refusing to publish/);
});

test("duplicate sport and season get distinct keys", async () => {
  const twoFootball = validateConfig({
    leagues: [
      { sport: "nfl", leagueId: "444444441", year: "2026" },
      { sport: "nfl", leagueId: "444444442", year: "2026" },
    ],
  });
  const site = await buildSiteData({ config: twoFootball, fetchRaw: async (l) => rawFor(l), now });
  assert.deepEqual(site.leagues.map((l) => l.key), ["nfl-2026", "nfl-2026-2"]);
});

test("validateConfig rejects malformed settings and drops unknown fields", () => {
  assert.throws(() => validateConfig([]), /object/);
  assert.throws(() => validateConfig({ leagues: [] }), /1-12/);
  assert.throws(() => validateConfig({ leagues: [{ sport: "golf", leagueId: "1", year: "2026" }] }), /sport/);
  assert.throws(() => validateConfig({ leagues: [{ sport: "nfl", leagueId: "x", year: "2026" }] }), /leagueId/);
  assert.throws(() => validateConfig({ leagues: [{ sport: "nfl", leagueId: "1", year: "2026" }], weights: { nfl: -1 } }), /weights/);
  const clean = validateConfig({ leagues: [{ id: "dropped", sport: "nfl", leagueId: "1", year: "2026" }], extra: 1, aliases: { a: "b" } });
  assert.deepEqual(Object.keys(clean).sort(), ["aliases", "leagueName", "leagues", "weights"]);
  assert.deepEqual(clean.leagues[0], { sport: "nfl", leagueId: "1", year: "2026", label: "Football" });
});
