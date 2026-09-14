// Pure helpers for ESPN Fantasy API (v3) league JSON.
// No DOM and no network: shared by the site, the Worker, and the tests.

export const SPORTS = {
  mlb: { code: "flb", path: "baseball", label: "Baseball" },
  nhl: { code: "fhl", path: "hockey", label: "Hockey" },
  nba: { code: "fba", path: "basketball", label: "Basketball" },
  nfl: { code: "ffl", path: "football", label: "Football" },
};

export const ESPN_API_HOST = "lm-api-reads.fantasy.espn.com";
export const LEAGUE_VIEWS = ["mSettings", "mTeam", "mStandings", "mRoster", "mTransactions2"];

// lineupSlotId -> label, per sport.
export const SLOT_LABELS = {
  nfl: { 0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP", 16: "D/ST", 17: "K", 20: "BE", 21: "IR", 23: "FLEX" },
  nba: { 0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 7: "SG/SF", 8: "G/F", 9: "PF/C", 10: "F/C", 11: "UTIL", 12: "BE", 13: "IR" },
  mlb: { 0: "C", 1: "1B", 2: "2B", 3: "3B", 4: "SS", 5: "OF", 6: "2B/SS", 7: "1B/3B", 8: "LF", 9: "CF", 10: "RF", 11: "DH", 12: "UTIL", 13: "P", 14: "SP", 15: "RP", 16: "BE", 17: "IL", 19: "IF" },
  nhl: { 0: "C", 1: "LW", 2: "RW", 3: "F", 4: "D", 5: "G", 6: "UTIL", 7: "BE", 8: "IR" },
};
// Bench and injured-list slots, so rosters can list starters first.
export const BENCH_SLOTS = { nfl: [20, 21], nba: [12, 13], mlb: [16, 17], nhl: [7, 8] };

// Roto-style leagues have no weekly W-L record; they are ranked by accumulated points.
const ROTO_SCORING = new Set(["ROTO", "TOTAL_POINTS"]);

export function slotLabel(sport, slotId) {
  return SLOT_LABELS[sport]?.[slotId] ?? `Slot ${slotId}`;
}

export function leagueApiUrl(sport, year, leagueId, views = LEAGUE_VIEWS) {
  const s = SPORTS[sport];
  if (!s) throw new Error(`Unknown sport "${sport}"`);
  if (!/^\d{1,12}$/.test(String(leagueId))) throw new Error("League ID must be numeric");
  if (!/^\d{4}$/.test(String(year))) throw new Error("Season must be a 4-digit year");
  const query = views.map((v) => `view=${v}`).join("&");
  return `https://${ESPN_API_HOST}/apps/fantasy/v3/games/${s.code}/seasons/${year}/segments/0/leagues/${leagueId}?${query}`;
}

const PATH_TO_SPORT = Object.fromEntries(Object.entries(SPORTS).map(([key, s]) => [s.path, key]));

// Turn a URL copied from fantasy.espn.com (league, team, or standings page) into {sport, leagueId, year}.
export function parseLeagueUrl(input, now = new Date()) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/(^|\.)espn\.com$/.test(url.hostname)) return null;
  const sport = PATH_TO_SPORT[url.pathname.split("/").filter(Boolean)[0]];
  const leagueId = url.searchParams.get("leagueId");
  if (!sport || !leagueId || !/^\d{1,12}$/.test(leagueId)) return null;
  const seasonId = url.searchParams.get("seasonId");
  const year = seasonId && /^\d{4}$/.test(seasonId) ? seasonId : String(defaultSeason(sport, now));
  return { sport, leagueId, year };
}

// ESPN names NBA/NHL seasons by the year they end (2026-27 is "2027") and NFL seasons by the year they start.
export function defaultSeason(sport, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0 = January
  if (sport === "nba" || sport === "nhl") return month >= 8 ? year + 1 : year;
  if (sport === "nfl") return month <= 1 ? year - 1 : year;
  return year;
}

export function teamName(t) {
  if (t.name) return t.name;
  const joined = `${t.location || ""} ${t.nickname || ""}`.trim();
  return joined || t.abbrev || `Team ${t.id}`;
}

export function memberName(m) {
  if (!m) return null;
  const full = `${m.firstName || ""} ${m.lastName || ""}`.trim();
  return full || m.displayName || null;
}

const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Reduce a raw ESPN league response to what the site shows.
export function normalizeLeague(raw, sport) {
  const members = new Map((raw.members || []).map((m) => [m.id, memberName(m)]));
  const scoringType = raw.settings?.scoringSettings?.scoringType || "UNKNOWN";
  const benchSlots = new Set(BENCH_SLOTS[sport] || []);

  const teams = (raw.teams || []).map((t) => {
    const r = t.record?.overall || {};
    const wins = r.wins || 0;
    const losses = r.losses || 0;
    const ties = r.ties || 0;
    const games = wins + losses + ties;
    const ownerId = t.primaryOwner || t.owners?.[0] || null;
    return {
      teamId: t.id,
      name: teamName(t),
      abbrev: t.abbrev || "",
      ownerId,
      ownerName: members.get(ownerId) || null,
      wins,
      losses,
      ties,
      games,
      winPct: games ? (wins + ties / 2) / games : null,
      pointsFor: numOrNull(r.pointsFor),
      pointsAgainst: numOrNull(r.pointsAgainst),
      totalPoints: numOrNull(t.points),
      playoffSeed: numOrNull(t.playoffSeed),
      roster: normalizeRoster(t.roster, sport, benchSlots),
    };
  });

  const anyGames = teams.some((t) => t.games > 0);
  const anyPoints = teams.some((t) => (t.totalPoints || 0) > 0);
  const isRoto = ROTO_SCORING.has(scoringType) || (!anyGames && anyPoints);
  if (isRoto) {
    if (anyPoints) applyRotoPct(teams);
    else teams.forEach((t) => { t.winPct = null; });
  }
  teams.sort(isRoto ? byTotalPoints : byRecord);
  teams.forEach((t, i) => { t.rank = i + 1; });

  return {
    sport,
    leagueId: raw.id ?? null,
    seasonId: raw.seasonId ?? null,
    name: raw.settings?.name || null,
    scoringType,
    isRoto,
    started: isRoto ? anyPoints : anyGames,
    teams,
    trades: normalizeTrades(raw, teams),
  };
}

// Roto has no W-L, so express finish position as a percentage: 1st of N = 1.000, last = .000, ties share the average.
function applyRotoPct(teams) {
  const n = teams.length;
  for (const t of teams) {
    if (n < 2 || t.totalPoints == null) {
      t.winPct = null;
      continue;
    }
    const above = teams.filter((o) => (o.totalPoints ?? -Infinity) > t.totalPoints).length;
    const tied = teams.filter((o) => o.totalPoints === t.totalPoints).length;
    const avgRank = above + (tied + 1) / 2;
    t.winPct = (n - avgRank) / (n - 1);
  }
}

function byRecord(a, b) {
  return (b.winPct ?? -1) - (a.winPct ?? -1)
    || (a.playoffSeed || 99) - (b.playoffSeed || 99)
    || (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
    || a.name.localeCompare(b.name);
}

function byTotalPoints(a, b) {
  return (b.totalPoints ?? -1) - (a.totalPoints ?? -1) || a.name.localeCompare(b.name);
}

function normalizeRoster(roster, sport, benchSlots) {
  const players = (roster?.entries || []).map((e) => {
    const p = e.playerPoolEntry?.player || {};
    return {
      playerId: e.playerId,
      name: p.fullName || `Player ${e.playerId}`,
      slotId: e.lineupSlotId,
      slot: slotLabel(sport, e.lineupSlotId),
      bench: benchSlots.has(e.lineupSlotId),
      injuryStatus: p.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : null,
    };
  });
  // Stable sort: keep ESPN's starter order, move bench/IR to the end.
  return players.sort((a, b) => Number(a.bench) - Number(b.bench));
}

function normalizeTrades(raw, teams) {
  const playerNames = new Map();
  teams.forEach((t) => t.roster.forEach((p) => playerNames.set(p.playerId, p.name)));
  const teamNames = new Map(teams.map((t) => [t.teamId, t.name]));
  return (raw.transactions || [])
    .filter((tx) => String(tx.type || "").toUpperCase().includes("TRADE"))
    .map((tx) => ({
      id: tx.id,
      type: tx.type,
      status: tx.status || "PENDING",
      date: tx.proposedDate || tx.processDate || null,
      items: (tx.items || []).map((item) => ({
        player: playerNames.get(item.playerId) || `Player ${item.playerId}`,
        from: teamNames.get(item.fromTeamId) || "Free agency",
        to: teamNames.get(item.toTeamId) || "Free agency",
      })),
    }))
    .sort((a, b) => (b.date || 0) - (a.date || 0));
}
