// Turns normalized leagues into what is safe to publish on the public site:
// team names, records, and rosters, but no manager names, ESPN account IDs, or league IDs.
import { managerKey } from "./combine.js";

// Short, stable stand-in for an ESPN account ID (FNV-1a). Lets the site match
// managers across leagues without publishing the ID itself.
export function pseudonym(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `m${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// league: a normalizeLeague() result. key: the league's published key. aliases: real account ID -> real account ID.
export function publicLeague(league, { key = league.sport, aliases = {} } = {}) {
  return {
    sport: league.sport,
    seasonId: league.seasonId,
    scoringType: league.scoringType,
    isRoto: league.isRoto,
    started: league.started,
    teams: league.teams.map((t) => ({
      teamId: t.teamId,
      name: t.name,
      abbrev: t.abbrev,
      ownerId: pseudonym(managerKey(t, key, aliases)),
      ownerName: null,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      games: t.games,
      winPct: t.winPct,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      totalPoints: t.totalPoints,
      playoffSeed: t.playoffSeed,
      rank: t.rank,
      roster: t.roster,
    })),
    trades: league.trades.map(({ id, ...trade }) => trade),
  };
}

// Values from a raw ESPN response that must never appear in published output.
export function sensitiveValues(raw) {
  const values = new Set();
  if (raw.id != null) values.add(String(raw.id));
  for (const m of raw.members || []) {
    if (m.id) values.add(m.id);
    const full = `${m.firstName || ""} ${m.lastName || ""}`.trim();
    if (full.includes(" ")) values.add(full);
    if (m.displayName && m.displayName.length >= 5) values.add(m.displayName);
  }
  for (const t of raw.teams || []) {
    for (const owner of t.owners || []) values.add(owner);
    if (t.primaryOwner) values.add(t.primaryOwner);
  }
  return [...values];
}

// Number of distinct sensitive values found in text. Numbers only match as whole numbers; text matches case-insensitively.
export function countLeaks(text, values) {
  const lower = text.toLowerCase();
  let found = 0;
  for (const value of new Set(values.map(String).filter(Boolean))) {
    const hit = /^\d+$/.test(value)
      ? new RegExp(`(?<!\\d)${value}(?!\\d)`).test(text)
      : lower.includes(value.toLowerCase());
    if (hit) found += 1;
  }
  return found;
}
