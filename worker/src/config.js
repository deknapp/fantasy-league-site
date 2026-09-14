import { SPORTS } from "../../site/lib/espn.js";

export const DEFAULT_CONFIG = { leagueName: "The Franchise", leagues: [], aliases: {}, weights: null };

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function cleanString(value, max, field) {
  if (typeof value !== "string") throw httpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw httpError(400, `${field} must be 1-${max} characters`);
  return trimmed;
}

// Validate and whitelist a settings object before it is stored in KV.
export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError(400, "Config must be a JSON object");

  const leagueName = cleanString(input.leagueName ?? DEFAULT_CONFIG.leagueName, 80, "leagueName");

  const rawLeagues = input.leagues ?? [];
  if (!Array.isArray(rawLeagues) || rawLeagues.length > 12) throw httpError(400, "leagues must be an array of at most 12 leagues");
  const leagues = rawLeagues.map((l, i) => {
    if (!l || !SPORTS[l.sport]) throw httpError(400, `leagues[${i}].sport must be one of ${Object.keys(SPORTS).join(", ")}`);
    const leagueId = String(l.leagueId ?? "");
    if (!/^\d{1,12}$/.test(leagueId)) throw httpError(400, `leagues[${i}].leagueId must be numeric`);
    const year = String(l.year ?? "");
    if (!/^\d{4}$/.test(year)) throw httpError(400, `leagues[${i}].year must be a 4-digit year`);
    return {
      id: cleanString(l.id || `${l.sport}-${leagueId}-${year}`, 80, `leagues[${i}].id`),
      sport: l.sport,
      leagueId,
      year,
      label: cleanString(l.label || SPORTS[l.sport].label, 60, `leagues[${i}].label`),
    };
  });

  const rawAliases = input.aliases ?? {};
  if (typeof rawAliases !== "object" || Array.isArray(rawAliases) || Object.keys(rawAliases).length > 50) {
    throw httpError(400, "aliases must be an object with at most 50 entries");
  }
  const aliases = {};
  for (const [from, to] of Object.entries(rawAliases)) {
    aliases[cleanString(from, 120, "alias key")] = cleanString(to, 120, "alias value");
  }

  let weights = null;
  if (input.weights != null) {
    if (typeof input.weights !== "object") throw httpError(400, "weights must be an object");
    weights = {};
    for (const sport of Object.keys(SPORTS)) {
      const w = input.weights[sport] ?? 0;
      if (typeof w !== "number" || !Number.isFinite(w) || w < 0) throw httpError(400, `weights.${sport} must be a non-negative number`);
      weights[sport] = w;
    }
  }

  return { leagueName, leagues, aliases, weights };
}
