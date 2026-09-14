// Combined standings across leagues that share the same managers.
// Managers are matched by ESPN member id (one account owns a team in every league);
// `aliases` maps one id onto another for someone who uses different accounts in different leagues.

export const DEFAULT_WEIGHTS = { mlb: 0.25, nhl: 0.25, nba: 0.25, nfl: 0.25 };

export function managerKey(team, leagueKey, aliases = {}) {
  let key = team.ownerId || `${leagueKey}:team:${team.teamId}`;
  const seen = new Set();
  while (aliases[key] && !seen.has(key)) {
    seen.add(key);
    key = aliases[key];
  }
  return key;
}

// inputs: [{ key, sport, league }] where league is a normalizeLeague() result (or null while loading).
export function combineStandings(inputs, { weights = DEFAULT_WEIGHTS, aliases = {} } = {}) {
  const managers = new Map();
  for (const { key: leagueKey, sport, league } of inputs) {
    if (!league) continue;
    for (const team of league.teams) {
      const key = managerKey(team, leagueKey, aliases);
      let m = managers.get(key);
      if (!m) {
        m = { key, label: null, labelFrom: null, byLeague: {}, wins: 0, losses: 0, ties: 0 };
        managers.set(key, m);
      }
      // Prefer the name on the account the others are linked to.
      if (team.ownerName && (!m.label || team.ownerId === key)) {
        m.label = team.ownerName;
        m.labelFrom = null;
      }
      // Without manager names, a manager is listed by their team name in the first league.
      if (!m.label) {
        m.label = team.name;
        m.labelFrom = leagueKey;
      }
      m.byLeague[leagueKey] = {
        sport,
        teamName: team.name,
        rank: team.rank,
        winPct: team.winPct,
        counted: league.started && team.winPct != null,
      };
      m.wins += team.wins;
      m.losses += team.losses;
      m.ties += team.ties;
    }
  }

  const rows = [...managers.values()].map((m) => {
    let weightSum = 0;
    let total = 0;
    let leaguesCounted = 0;
    for (const s of Object.values(m.byLeague)) {
      const w = weights[s.sport] ?? 0;
      if (!s.counted || w <= 0) continue;
      weightSum += w;
      total += w * s.winPct;
      leaguesCounted += 1;
    }
    return {
      ...m,
      label: m.label || "Unknown manager",
      combinedPct: weightSum ? total / weightSum : null,
      leaguesCounted,
    };
  });

  rows.sort((a, b) => (b.combinedPct ?? -1) - (a.combinedPct ?? -1) || b.wins - a.wins || a.label.localeCompare(b.label));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows };
}

export function formatPct(p) {
  if (p == null || !Number.isFinite(p)) return "–";
  return p.toFixed(3).replace(/^0(?=\.)/, "");
}

export function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}
