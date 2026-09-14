// Cloudflare Worker: fetches ESPN fantasy data for the site (ESPN sends no CORS headers)
// and stores the league settings in KV.
//
// Routes
//   GET  /api/league?sport=nfl&year=2026&id=123   raw ESPN league JSON (standings, rosters, trades)
//   GET  /proxy?url=<ESPN fantasy API URL>        pass-through, restricted to ESPN's fantasy API
//   GET  /config                                  league settings
//   POST /config                                  save settings (Authorization: Bearer <ADMIN_TOKEN>)
//
// Bindings / secrets
//   LEAGUE_CONFIG  KV namespace
//   ADMIN_TOKEN    required to save settings
//   ESPN_S2, SWID  ESPN cookies, only needed for private leagues
//   ALLOWED_ORIGIN comma-separated origins allowed by CORS (default "*")
import { ESPN_API_HOST, ESPN_API_PATH, SPORTS, leagueApiUrl } from "../../site/lib/espn.js";
import { DEFAULT_CONFIG, httpError, validateConfig } from "./config.js";

const CACHE_SECONDS = 300;
const CONFIG_KEY = "config";
const MAX_CONFIG_BYTES = 20_000;
const PROXY_HOSTS = new Set([ESPN_API_HOST, "fantasy.espn.com"]);

export default {
  async fetch(request, env = {}, ctx = {}) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      response = await route(request, new URL(request.url), env, ctx);
    } catch (err) {
      response = json({ error: err.message || "Unexpected error" }, err.status || 500);
    }
    return withHeaders(response, cors);
  },
};

async function route(request, url, env, ctx) {
  const { pathname } = url;
  if (pathname === "/api/league" && request.method === "GET") {
    const sport = url.searchParams.get("sport");
    if (!SPORTS[sport]) throw httpError(400, `sport must be one of ${Object.keys(SPORTS).join(", ")}`);
    let target;
    try {
      target = leagueApiUrl(sport, url.searchParams.get("year"), url.searchParams.get("id"));
    } catch (err) {
      throw httpError(400, err.message);
    }
    return fetchEspn(target, env, ctx);
  }
  if (pathname === "/proxy" && request.method === "GET") {
    return fetchEspn(checkProxyTarget(url.searchParams.get("url")), env, ctx);
  }
  if (pathname === "/config" && request.method === "GET") return json(await readConfig(env));
  if (pathname === "/config" && request.method === "POST") return json(await writeConfig(request, env));
  if (pathname === "/" && request.method === "GET") {
    return json({ ok: true, routes: ["/api/league?sport=&year=&id=", "/proxy?url=", "/config"] });
  }
  throw httpError(404, "Not found");
}

function checkProxyTarget(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw httpError(400, "Missing or invalid url parameter");
  }
  if (target.protocol !== "https:" || !PROXY_HOSTS.has(target.hostname) || !target.pathname.startsWith(`${ESPN_API_PATH}/`)) {
    throw httpError(400, "Only ESPN fantasy API URLs can be proxied");
  }
  return target.toString();
}

async function fetchEspn(target, env, ctx) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(target);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; fantasy-league-site)",
    "x-fantasy-source": "kona",
    "x-fantasy-platform": "kona-PROD",
  };
  if (env.ESPN_S2 && env.SWID) headers.Cookie = `espn_s2=${env.ESPN_S2}; SWID=${env.SWID}`;

  const upstream = await fetch(target, { headers });
  const body = await upstream.text();
  if (!upstream.ok) {
    const error = upstream.status === 401 || upstream.status === 403
      ? "ESPN refused the request. If this league is private, set the ESPN_S2 and SWID secrets on the Worker."
      : `ESPN responded with HTTP ${upstream.status}.`;
    return json({ error, espnStatus: upstream.status }, 502);
  }

  const response = new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
  });
  if (cache && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function readConfig(env) {
  const stored = env.LEAGUE_CONFIG ? await env.LEAGUE_CONFIG.get(CONFIG_KEY, "json") : null;
  return { ...DEFAULT_CONFIG, ...(stored || {}) };
}

async function writeConfig(request, env) {
  if (!env.LEAGUE_CONFIG) throw httpError(501, "No LEAGUE_CONFIG KV namespace is bound to this Worker");
  if (!env.ADMIN_TOKEN) throw httpError(403, "Saving is disabled until the ADMIN_TOKEN secret is set on the Worker");
  if (!safeEqual(request.headers.get("Authorization") || "", `Bearer ${env.ADMIN_TOKEN}`)) {
    throw httpError(401, "Wrong or missing admin token");
  }
  const text = await request.text();
  if (text.length > MAX_CONFIG_BYTES) throw httpError(413, "Config is too large");
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw httpError(400, "Config must be valid JSON");
  }
  const config = validateConfig(input);
  await env.LEAGUE_CONFIG.put(CONFIG_KEY, JSON.stringify(config));
  return config;
}

// Constant-time string comparison, so response timing doesn't leak the token.
function safeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  const allowOrigin = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function withHeaders(response, extra) {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(extra)) out.headers.set(key, value);
  return out;
}
