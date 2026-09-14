import { SPORTS } from "../site/lib/espn.js";

function cleanString(value, max, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new Error(`${field} must be 1-${max} characters`);
  return trimmed;
}

// Validate the league config (the LEAGUES_CONFIG secret or config.local.json) and drop unknown fields.
export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Config must be a JSON object");

  const leagueName = cleanString(input.leagueName ?? "The Franchise", 80, "leagueName");

  const rawLeagues = input.leagues ?? [];
  if (!Array.isArray(rawLeagues) || rawLeagues.length === 0 || rawLeagues.length > 12) {
    throw new Error("leagues must be an array of 1-12 leagues");
  }
  const leagues = rawLeagues.map((l, i) => {
    if (!l || !SPORTS[l.sport]) throw new Error(`leagues[${i}].sport must be one of ${Object.keys(SPORTS).join(", ")}`);
    const leagueId = String(l.leagueId ?? "");
    if (!/^\d{1,12}$/.test(leagueId)) throw new Error(`leagues[${i}].leagueId must be numeric`);
    const year = String(l.year ?? "");
    if (!/^\d{4}$/.test(year)) throw new Error(`leagues[${i}].year must be a 4-digit year`);
    return { sport: l.sport, leagueId, year, label: cleanString(l.label || SPORTS[l.sport].label, 60, `leagues[${i}].label`) };
  });

  const rawAliases = input.aliases ?? {};
  if (typeof rawAliases !== "object" || Array.isArray(rawAliases)) throw new Error("aliases must be an object");
  const aliases = {};
  for (const [from, to] of Object.entries(rawAliases)) {
    aliases[cleanString(from, 120, "alias key")] = cleanString(to, 120, "alias value");
  }

  let weights = null;
  if (input.weights != null) {
    if (typeof input.weights !== "object") throw new Error("weights must be an object");
    weights = {};
    for (const sport of Object.keys(SPORTS)) {
      const w = input.weights[sport] ?? 0;
      if (typeof w !== "number" || !Number.isFinite(w) || w < 0) throw new Error(`weights.${sport} must be a non-negative number`);
      weights[sport] = w;
    }
  }

  return { leagueName, leagues, aliases, weights };
}
