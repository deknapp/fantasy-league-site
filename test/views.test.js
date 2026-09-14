import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLeague } from "../site/lib/espn.js";
import { combineStandings } from "../site/lib/combine.js";
import { combinedView, escapeHtml, rostersView, settingsView, standingsView, tradesView } from "../site/lib/views.js";

const load = (sport) => normalizeLeague(JSON.parse(readFileSync(new URL(`../site/demo/${sport}.json`, import.meta.url), "utf8")), sport);
const SPORTS = ["mlb", "nhl", "nba", "nfl"];

function demoCombined() {
  const leagues = Object.fromEntries(SPORTS.map((s) => [s, load(s)]));
  const result = combineStandings(SPORTS.map((s) => ({ key: s, sport: s, league: leagues[s] })));
  const columns = SPORTS.map((s) => ({ key: s, label: s.toUpperCase(), sport: s, status: "ok", started: leagues[s].started, weightShare: 0.25 }));
  return { leagues, result, columns };
}

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});

test("team and manager names from ESPN are escaped", () => {
  const league = normalizeLeague({
    members: [{ id: "{X}", displayName: "<b>boss</b>" }],
    teams: [{ id: 1, name: "<script>alert(1)</script>", owners: ["{X}"], record: { overall: { wins: 1 } } }],
  }, "nfl");
  const html = standingsView(league) + rostersView(league);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<b>boss"));
});

test("combined view lists every manager, notes the unstarted league, and highlights me", () => {
  const { result, columns } = demoCombined();
  const meKey = result.rows[2].key;
  const html = combinedView({ result, columns, meKey });
  for (const row of result.rows) assert.ok(html.includes(escapeHtml(row.label)), row.label);
  assert.match(html, /NBA hasn't started yet/);
  assert.equal((html.match(/<tr class="me">/g) || []).length, 1);
});

test("standings view switches columns for roto and category leagues", () => {
  const { leagues } = demoCombined();
  assert.match(standingsView(leagues.nhl), /<th class="num">Points<\/th>/);
  assert.doesNotMatch(standingsView(leagues.mlb), />PF</);
  assert.match(standingsView(leagues.nfl), />PF</);
  assert.match(standingsView(leagues.nba), /season hasn&#39;t started/);
});

test("rosters view shows the selected team and trades view renders the demo trade", () => {
  const { leagues } = demoCombined();
  const second = leagues.nfl.teams[1];
  const html = rostersView(leagues.nfl, second.teamId);
  assert.match(html, new RegExp(`class="chip active" data-action="team" data-team="${second.teamId}"`));
  assert.match(tradesView(leagues.nfl), /EXECUTED/);
});

test("settings view offers links for managers missing from a league", () => {
  const { result } = demoCombined();
  const managers = result.rows.map((r) => ({ key: r.key, label: r.label, present: Object.keys(r.byLeague).length }));
  const html = settingsView({
    config: { leagueName: "X", leagues: [], aliases: {} },
    demo: true, workerUrl: "", hasToken: false, message: null, managers, loadedLeagues: 4, labels: {},
  });
  assert.equal((html.match(/data-change="link"/g) || []).length, 2);
  assert.doesNotMatch(html, /token-input/);
});
