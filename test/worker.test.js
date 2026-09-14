import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { validateConfig } from "../worker/src/config.js";

function memoryKv(initial) {
  const store = new Map(initial ? [["config", JSON.stringify(initial)]] : []);
  return {
    store,
    async get(key, type) {
      const value = store.get(key);
      if (value == null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// Replace global fetch (the Worker's upstream call) for the duration of fn.
async function withUpstream(handler, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const call = (path, init, env = {}) => worker.fetch(new Request(`https://worker.test${path}`, init), env, {});

const validConfig = { leagueName: "Test League", leagues: [{ sport: "nfl", leagueId: "123", year: "2026", label: "Football" }] };

test("/api/league fetches the matching ESPN URL", async () => {
  await withUpstream(() => new Response(JSON.stringify({ teams: [] }), { status: 200 }), async (calls) => {
    const res = await call("/api/league?sport=nhl&year=2027&id=42");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { teams: [] });
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.match(calls[0].url, /^https:\/\/lm-api-reads\.fantasy\.espn\.com\/apps\/fantasy\/v3\/games\/fhl\/seasons\/2027\/segments\/0\/leagues\/42\?view=/);
    assert.equal(calls[0].init.headers.Cookie, undefined);
  });
});

test("ESPN cookies are sent only when both secrets are set", async () => {
  await withUpstream(() => new Response("{}"), async (calls) => {
    await call("/api/league?sport=nfl&year=2026&id=1", {}, { ESPN_S2: "s2", SWID: "{swid}" });
    await call("/api/league?sport=nfl&year=2026&id=1", {}, { ESPN_S2: "s2" });
    assert.equal(calls[0].init.headers.Cookie, "espn_s2=s2; SWID={swid}");
    assert.equal(calls[1].init.headers.Cookie, undefined);
  });
});

test("an ESPN refusal becomes a 502 with a hint about private leagues", async () => {
  await withUpstream(() => new Response("<html>403</html>", { status: 403 }), async () => {
    const res = await call("/api/league?sport=mlb&year=2026&id=1");
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.espnStatus, 403);
    assert.match(body.error, /ESPN_S2/);
  });
});

test("/api/league rejects bad parameters without calling ESPN", async () => {
  await withUpstream(() => new Response("{}"), async (calls) => {
    assert.equal((await call("/api/league?sport=golf&year=2026&id=1")).status, 400);
    assert.equal((await call("/api/league?sport=nfl&year=2026&id=abc")).status, 400);
    assert.equal((await call("/api/league?sport=nfl&id=1")).status, 400);
    assert.equal(calls.length, 0);
  });
});

test("/proxy only forwards ESPN fantasy API URLs", async () => {
  await withUpstream(() => new Response("{}"), async (calls) => {
    const bad = [
      "https://example.com/apps/fantasy/v3/x",
      "http://lm-api-reads.fantasy.espn.com/apps/fantasy/v3/x",
      "https://lm-api-reads.fantasy.espn.com/other",
      "not-a-url",
    ];
    for (const url of bad) assert.equal((await call(`/proxy?url=${encodeURIComponent(url)}`)).status, 400, url);
    assert.equal(calls.length, 0);
    const ok = await call(`/proxy?url=${encodeURIComponent("https://lm-api-reads.fantasy.espn.com/apps/fantasy/v3/games/ffl/seasons/2026")}`);
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
  });
});

test("GET /config returns defaults when nothing is stored", async () => {
  const res = await call("/config", {}, { LEAGUE_CONFIG: memoryKv() });
  assert.deepEqual(await res.json(), { leagueName: "The Franchise", leagues: [], aliases: {}, weights: null });
});

test("POST /config requires the admin token", async () => {
  const post = (env, auth) => call("/config", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(validConfig) }, env);
  const kv = memoryKv();
  assert.equal((await post({ LEAGUE_CONFIG: kv })).status, 403);
  assert.equal((await post({ LEAGUE_CONFIG: kv, ADMIN_TOKEN: "secret" })).status, 401);
  assert.equal((await post({ LEAGUE_CONFIG: kv, ADMIN_TOKEN: "secret" }, "Bearer wrong")).status, 401);
  assert.equal(kv.store.size, 0);

  const res = await post({ LEAGUE_CONFIG: kv, ADMIN_TOKEN: "secret" }, "Bearer secret");
  assert.equal(res.status, 200);
  const saved = JSON.parse(kv.store.get("config"));
  assert.deepEqual(saved.leagues[0], { id: "nfl-123-2026", sport: "nfl", leagueId: "123", year: "2026", label: "Football" });
  const read = await (await call("/config", {}, { LEAGUE_CONFIG: kv })).json();
  assert.equal(read.leagueName, "Test League");
});

test("validateConfig rejects malformed settings and drops unknown fields", () => {
  assert.throws(() => validateConfig([]), /object/);
  assert.throws(() => validateConfig({ leagues: [{ sport: "golf", leagueId: "1", year: "2026" }] }), /sport/);
  assert.throws(() => validateConfig({ leagues: [{ sport: "nfl", leagueId: "x", year: "2026" }] }), /leagueId/);
  assert.throws(() => validateConfig({ weights: { nfl: -1 } }), /weights/);
  const clean = validateConfig({ ...validConfig, extra: "dropped", aliases: { a: "b" } });
  assert.deepEqual(Object.keys(clean).sort(), ["aliases", "leagueName", "leagues", "weights"]);
  assert.deepEqual(clean.aliases, { a: "b" });
});

test("CORS preflight and origin allow-list", async () => {
  const pre = await call("/config", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Authorization/);

  const env = { ALLOWED_ORIGIN: "https://a.example, https://b.example" };
  const res = await call("/", { headers: { Origin: "https://b.example" } }, env);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://b.example");
  const other = await call("/", { headers: { Origin: "https://evil.example" } }, env);
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), "https://a.example");
});

test("unknown routes are 404", async () => {
  assert.equal((await call("/nope")).status, 404);
});
