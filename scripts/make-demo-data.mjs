// Generates synthetic ESPN-shaped league JSON for demo mode and tests: node scripts/make-demo-data.mjs
// Everything is invented: managers are "Manager A".."Manager J" and players are numbered placeholders.
import { mkdirSync, writeFileSync } from "node:fs";

// Small seeded PRNG (mulberry32) so the output is stable between runs.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = "ABCDEFGHIJ".split("");
const MANAGERS = LETTERS.map((letter, i) => ({
  id: `{DEMO-MANAGER-${String(i + 1).padStart(2, "0")}}`,
  displayName: `manager_${letter.toLowerCase()}`,
  firstName: "Manager",
  lastName: letter,
}));

const TEAM_NAMES = {
  mlb: ["Rally Caps", "Bullpen Brawlers", "Walk-Off Wonders", "Seventh Inning Stretch", "Can of Corn", "Chin Music", "Sac Fly Guys", "Dugout Dynasty", "Frozen Ropes", "Golden Sombreros"],
  nhl: ["Top Shelf", "Five Hole Heroes", "Zamboni Drivers", "Biscuit Basket", "Sin Bin", "Power Play Pals", "Hat Trick Club", "Cross Checkers", "Blue Line Bandits", "Empty Netters"],
  nba: ["Alley Oops", "Pick and Rollers", "Buzzer Beaters", "Sixth Men", "Glass Cleaners", "Bench Mob", "Fast Breakers", "Triple Doubles", "Rim Protectors", "Pump Fakes"],
  nfl: ["Hail Marys", "Red Zone Regulars", "Pick Six", "Two-Point Tries", "Fourth and Long", "Taking a Knee", "Waiver Wire Warriors", "Bye Week Blues", "Fumble Recovery", "Goal Line Stand"],
};

// lineupSlotIds for a plausible roster in each sport (see SLOT_LABELS in site/lib/espn.js).
const SLOTS = {
  mlb: [0, 1, 2, 3, 4, 5, 5, 5, 12, 14, 14, 14, 15, 15, 16, 16, 17],
  nhl: [0, 0, 1, 1, 2, 2, 4, 4, 4, 4, 5, 5, 7, 7, 8],
  nba: [0, 1, 2, 3, 4, 5, 6, 11, 11, 11, 12, 12, 12, 13],
  nfl: [0, 2, 2, 4, 4, 6, 23, 16, 17, 20, 20, 20, 20, 20, 21],
};

const LABELS = { mlb: "Baseball", nhl: "Hockey", nba: "Basketball", nfl: "Football" };

function makeLeague({ sport, seasonId, scoringType, seed, fill, altAccountFor = null }) {
  const rand = rng(seed);
  let nextPlayer = seed * 1000;
  const members = MANAGERS.map((m) => ({ ...m }));

  const teams = MANAGERS.map((m, i) => {
    let owner = m.id;
    if (altAccountFor === i) {
      owner = `${m.id.slice(0, -1)}-ALT}`;
      members[i] = { id: owner, displayName: `${m.displayName}_alt`, firstName: "Manager", lastName: `${LETTERS[i]} (second account)` };
    }
    const name = TEAM_NAMES[sport][i];
    return {
      id: i + 1,
      abbrev: name.split(/[\s-]+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase(),
      name,
      owners: [owner],
      primaryOwner: owner,
      playoffSeed: 0,
      points: 0,
      record: { overall: { wins: 0, losses: 0, ties: 0, percentage: 0, pointsFor: 0, pointsAgainst: 0 } },
      roster: {
        entries: SLOTS[sport].map((lineupSlotId) => {
          const id = ++nextPlayer;
          const injuryStatus = rand() < 0.08 ? "OUT" : rand() < 0.08 ? "DAY_TO_DAY" : "ACTIVE";
          return { playerId: id, lineupSlotId, playerPoolEntry: { player: { id, fullName: `Demo Player ${id}`, injuryStatus } } };
        }),
      },
    };
  });

  const transactions = fill(teams, rand) || [];

  for (const t of teams) {
    const r = t.record.overall;
    const games = r.wins + r.losses + r.ties;
    r.percentage = games ? (r.wins + r.ties / 2) / games : 0;
  }
  [...teams]
    .sort((a, b) => b.record.overall.percentage - a.record.overall.percentage || b.points - a.points)
    .forEach((t, i) => { t.playoffSeed = i + 1; });

  return {
    id: seed,
    seasonId,
    scoringPeriodId: 1,
    settings: { name: `Demo ${LABELS[sport]} League`, scoringSettings: { scoringType } },
    members,
    teams,
    transactions,
  };
}

const leagues = {
  // Late-season head-to-head categories: records count category wins.
  mlb: makeLeague({
    sport: "mlb", seasonId: 2026, scoringType: "H2H_CATEGORY", seed: 11,
    fill(teams, rand) {
      for (const t of teams) {
        const r = t.record.overall;
        r.wins = 70 + Math.floor(rand() * 70);
        r.ties = Math.floor(rand() * 15);
        r.losses = 220 - r.wins - r.ties;
      }
    },
  }),
  // Rotisserie: no record, ranked by points (with one tie).
  nhl: makeLeague({
    sport: "nhl", seasonId: 2027, scoringType: "ROTO", seed: 22,
    fill(teams, rand) {
      for (const t of teams) t.points = Math.round((30 + rand() * 60) * 2) / 2;
      teams[6].points = teams[3].points;
    },
  }),
  // Preseason, and one manager uses a second ESPN account here.
  nba: makeLeague({ sport: "nba", seasonId: 2027, scoringType: "H2H_POINTS", seed: 33, altAccountFor: 9, fill() {} }),
  // Week 1 of head-to-head points, plus one trade.
  nfl: makeLeague({
    sport: "nfl", seasonId: 2026, scoringType: "H2H_POINTS", seed: 44,
    fill(teams, rand) {
      for (let i = 0; i < teams.length; i += 2) {
        const [a, b] = [teams[i], teams[i + 1]];
        const pa = Math.round((80 + rand() * 70) * 10) / 10;
        const pb = Math.round((80 + rand() * 70) * 10) / 10;
        Object.assign(a.record.overall, { pointsFor: pa, pointsAgainst: pb, wins: pa > pb ? 1 : 0, losses: pa > pb ? 0 : 1 });
        Object.assign(b.record.overall, { pointsFor: pb, pointsAgainst: pa, wins: pb > pa ? 1 : 0, losses: pb > pa ? 0 : 1 });
      }
      return [{
        id: "demo-trade-1",
        type: "TRADE_ACCEPT",
        status: "EXECUTED",
        proposedDate: Date.UTC(2026, 8, 10),
        items: [
          { playerId: teams[0].roster.entries[1].playerId, fromTeamId: 1, toTeamId: 2 },
          { playerId: teams[1].roster.entries[3].playerId, fromTeamId: 2, toTeamId: 1 },
        ],
      }];
    },
  }),
};

const outDir = new URL("../site/demo/", import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [sport, league] of Object.entries(leagues)) {
  writeFileSync(new URL(`${sport}.json`, outDir), `${JSON.stringify(league, null, 1)}\n`);
  console.log(`wrote site/demo/${sport}.json`);
}
