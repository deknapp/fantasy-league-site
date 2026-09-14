import { SPORTS, normalizeLeague, parseLeagueUrl } from "./lib/espn.js";
import { combineStandings, managerKey, DEFAULT_WEIGHTS } from "./lib/combine.js";
import * as views from "./lib/views.js";
import { WORKER_URL } from "./config.js";

const esc = views.escapeHtml;
const TABS = [["combined", "Combined"], ["standings", "Standings"], ["rosters", "Rosters"], ["trades", "Trades"], ["settings", "Settings"]];
const LEAGUE_TABS = new Set(["standings", "rosters", "trades"]);

const DEMO_CONFIG = {
  leagueName: "The Franchise",
  aliases: {},
  weights: null,
  leagues: ["mlb", "nhl", "nba", "nfl"].map((sport) => ({ id: `demo-${sport}`, sport, leagueId: "0", year: "2026", label: SPORTS[sport].label })),
};

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value == null || value === "") localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* storage unavailable (private window, sandbox) */ }
  },
};

const params = new URLSearchParams(location.search);
if (params.has("worker")) storage.set("fl-worker", params.get("worker"));
const workerUrl = (storage.get("fl-worker") || WORKER_URL || "").replace(/\/+$/, "");
const demo = params.has("demo") || !workerUrl;

const savedTab = storage.get("fl-tab");
const state = {
  config: null,
  configError: null,
  leagues: {},
  tab: TABS.some(([key]) => key === savedTab) ? savedTab : "combined",
  activeLeagueId: storage.get("fl-league"),
  selectedTeam: {},
  me: storage.get("fl-me"),
  token: storage.get("fl-admin-token") || "",
  message: null,
  pendingRender: false,
};

const root = document.getElementById("app");

async function init() {
  render();
  state.config = demo ? structuredClone(DEMO_CONFIG) : await fetchConfig();
  if (!state.config.leagues.some((l) => l.id === state.activeLeagueId)) state.activeLeagueId = state.config.leagues[0]?.id || null;
  render();
  state.config.leagues.forEach(loadLeague);
}

function normalizeConfig(c = {}) {
  return {
    leagueName: c.leagueName || "The Franchise",
    leagues: Array.isArray(c.leagues) ? c.leagues : [],
    aliases: c.aliases || {},
    weights: c.weights || null,
  };
}

async function fetchConfig() {
  try {
    const res = await fetch(`${workerUrl}/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeConfig(await res.json());
  } catch (err) {
    state.configError = `Couldn't load league settings from the Worker (${err.message}).`;
    return normalizeConfig();
  }
}

async function loadLeague(l) {
  state.leagues[l.id] = { ...state.leagues[l.id], status: "loading", error: null };
  scheduleRender();
  try {
    const src = demo
      ? `demo/${l.sport}.json`
      : `${workerUrl}/api/league?${new URLSearchParams({ sport: l.sport, year: l.year, id: l.leagueId })}`;
    const res = await fetch(src, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(body?.error || `Request failed (HTTP ${res.status}).`);
    state.leagues[l.id] = { status: "ok", data: normalizeLeague(body, l.sport) };
  } catch (err) {
    state.leagues[l.id] = { status: "error", error: err.message, data: null };
  }
  scheduleRender();
}

// Rendering replaces the DOM, so hold off while someone is typing in a field.
function scheduleRender() {
  if (document.activeElement?.matches?.("input, select")) {
    state.pendingRender = true;
    return;
  }
  render();
}
root.addEventListener("focusout", () => {
  if (state.pendingRender) setTimeout(() => { if (state.pendingRender) scheduleRender(); }, 200);
});

function weights() {
  return state.config.weights || DEFAULT_WEIGHTS;
}

function combined() {
  const inputs = state.config.leagues.map((l) => ({ key: l.id, sport: l.sport, league: state.leagues[l.id]?.data || null }));
  return combineStandings(inputs, { weights: weights(), aliases: state.config.aliases });
}

function columns() {
  const w = weights();
  const total = state.config.leagues.reduce((sum, l) => sum + (w[l.sport] ?? 0), 0) || 1;
  return state.config.leagues.map((l) => {
    const ls = state.leagues[l.id];
    return { key: l.id, label: l.label, sport: l.sport, status: ls?.status || "loading", started: !!ls?.data?.started, weightShare: (w[l.sport] ?? 0) / total };
  });
}

function render() {
  state.pendingRender = false;
  if (!state.config) {
    root.innerHTML = `<div class="center-screen"><span class="muted">Loading the franchise…</span></div>`;
    return;
  }
  const { config } = state;
  const anyLoading = config.leagues.some((l) => state.leagues[l.id]?.status === "loading");
  const tabs = TABS.map(([key, label]) => `<button class="tab${state.tab === key ? " active" : ""}" data-action="tab" data-tab="${key}">${label}</button>`).join("");
  const pills = LEAGUE_TABS.has(state.tab) && config.leagues.length
    ? `<div class="league-pills">${config.leagues.map(pill).join("")}</div>`
    : "";
  root.innerHTML = `
    <header class="app-header">
      <div>
        <div class="header-kicker">${esc(config.leagueName)}</div>
        <div class="muted">Multi-sport league office${demo ? ` · <span class="demo-tag">demo data</span>` : ""}</div>
      </div>
      <button class="btn-ghost" data-action="refresh">${anyLoading ? "Refreshing…" : "Refresh"}</button>
    </header>
    <nav class="tabs">${tabs}</nav>
    ${pills}
    <main class="app-main">
      ${state.configError ? `<div class="message error">${esc(state.configError)}</div>` : ""}
      ${body()}
    </main>`;
}

function pill(l) {
  const status = state.leagues[l.id]?.status;
  const dot = status === "loading" ? `<span class="dot loading"></span>` : status === "error" ? `<span class="dot error"></span>` : "";
  return `<button class="pill${l.id === state.activeLeagueId ? " active" : ""}" data-action="league" data-id="${esc(l.id)}">${esc(l.label)}${dot}</button>`;
}

function body() {
  const { config } = state;
  if (state.tab === "settings") return settingsBody();
  if (!config.leagues.length) return views.emptyState("No leagues configured yet", "Head to Settings and paste your ESPN league URLs.");
  if (state.tab === "combined") return views.combinedView({ result: combined(), columns: columns(), meKey: state.me });

  const l = config.leagues.find((x) => x.id === state.activeLeagueId) || config.leagues[0];
  const ls = state.leagues[l.id];
  if (ls?.status === "error") return `<div class="message error">${esc(l.label)}: ${esc(ls.error)}</div>`;
  if (!ls?.data) return views.emptyState("Loading…", `Pulling ${l.label} from ESPN.`);
  if (state.tab === "standings") {
    return views.standingsView(ls.data, (t) => !!state.me && managerKey(t, l.id, config.aliases) === state.me);
  }
  if (state.tab === "rosters") return views.rostersView(ls.data, state.selectedTeam[l.id]);
  return views.tradesView(ls.data);
}

function settingsBody() {
  const { config } = state;
  const managers = combined().rows.map((r) => ({ key: r.key, label: r.label, present: Object.keys(r.byLeague).length }));
  const loadedLeagues = config.leagues.filter((l) => state.leagues[l.id]?.data?.teams.length).length;
  const labels = {};
  for (const l of config.leagues) {
    for (const t of state.leagues[l.id]?.data?.teams || []) labels[managerKey(t, l.id)] ||= t.ownerName || t.name;
  }
  return views.settingsView({ config, demo, workerUrl, hasToken: !!state.token, message: state.message, managers, loadedLeagues, labels });
}

function flash(kind, text) {
  state.message = { kind, text };
  render();
}

async function updateConfig(patch) {
  state.config = { ...state.config, ...patch };
  if (!state.config.leagues.some((l) => l.id === state.activeLeagueId)) state.activeLeagueId = state.config.leagues[0]?.id || null;
  if (demo) {
    flash("info", "Demo mode: changes last until you reload the page.");
    return true;
  }
  render();
  try {
    const res = await fetch(`${workerUrl}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
      body: JSON.stringify(state.config),
    });
    const saved = await res.json().catch(() => null);
    if (!res.ok || !saved) throw new Error(saved?.error || `HTTP ${res.status}`);
    state.config = normalizeConfig(saved);
    flash("ok", "Saved.");
    return true;
  } catch (err) {
    flash("error", `Not saved: ${err.message}. The change only applies in this tab.`);
    return false;
  }
}

const actions = {
  tab(el) {
    state.tab = el.dataset.tab;
    state.message = null;
    storage.set("fl-tab", state.tab);
    render();
  },
  league(el) {
    state.activeLeagueId = el.dataset.id;
    storage.set("fl-league", state.activeLeagueId);
    render();
  },
  team(el) {
    state.selectedTeam[state.activeLeagueId] = Number(el.dataset.team);
    render();
  },
  me(el) {
    state.me = state.me === el.dataset.key ? null : el.dataset.key;
    storage.set("fl-me", state.me);
    render();
  },
  refresh() {
    state.config.leagues.forEach(loadLeague);
  },
  "save-name"() {
    const value = document.getElementById("league-name-input").value.trim();
    if (value) updateConfig({ leagueName: value });
  },
  async "add-league"() {
    if (demo) {
      flash("error", "Demo mode can't load real leagues. Configure a Worker URL first.");
      return;
    }
    const parsed = parseLeagueUrl(document.getElementById("new-league-url").value);
    if (!parsed) {
      flash("error", "That doesn't look like an ESPN fantasy league URL (it needs a leagueId).");
      return;
    }
    const label = document.getElementById("new-league-label").value.trim() || SPORTS[parsed.sport].label;
    const entry = { id: `${parsed.sport}-${parsed.leagueId}-${parsed.year}`, label, ...parsed };
    if (state.config.leagues.some((l) => l.id === entry.id)) {
      flash("error", "That league is already on the list.");
      return;
    }
    await updateConfig({ leagues: [...state.config.leagues, entry] });
    loadLeague(entry);
  },
  "remove-league"(el) {
    updateConfig({ leagues: state.config.leagues.filter((l) => l.id !== el.dataset.id) });
  },
  link(el) {
    if (el.value) updateConfig({ aliases: { ...state.config.aliases, [el.dataset.from]: el.value } });
  },
  unlink(el) {
    const aliases = { ...state.config.aliases };
    delete aliases[el.dataset.from];
    updateConfig({ aliases });
  },
  "save-token"() {
    const value = document.getElementById("token-input").value.trim();
    state.token = value;
    storage.set("fl-admin-token", value);
    flash("ok", value ? "Admin token saved in this browser." : "Admin token cleared.");
  },
};

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) actions[el.dataset.action]?.(el);
});
root.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (el) actions[el.dataset.change]?.(el);
});
root.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset?.enter) actions[e.target.dataset.enter]?.(e.target);
});

init();
