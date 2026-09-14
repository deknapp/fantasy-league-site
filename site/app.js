import { SPORTS, normalizeLeague } from "./lib/espn.js";
import { combineStandings, DEFAULT_WEIGHTS } from "./lib/combine.js";
import { publicLeague } from "./lib/publish.js";
import * as views from "./lib/views.js";

const esc = views.escapeHtml;
const TABS = [["combined", "Combined"], ["standings", "Standings"], ["rosters", "Rosters"], ["trades", "Trades"]];
const LEAGUE_TABS = new Set(["standings", "rosters", "trades"]);
const DEMO_SPORTS = ["mlb", "nhl", "nba", "nfl"];

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

const forceDemo = new URLSearchParams(location.search).has("demo");
const savedTab = storage.get("fl-tab");
const state = {
  site: null,
  demo: false,
  loading: true,
  loadError: null,
  tab: TABS.some(([key]) => key === savedTab) ? savedTab : "combined",
  activeLeague: storage.get("fl-league"),
  selectedTeam: {},
  me: storage.get("fl-me"),
};

const root = document.getElementById("app");

async function load() {
  state.loading = true;
  render();
  try {
    state.site = forceDemo ? await loadDemo() : await loadPublished();
    state.loadError = null;
  } catch (err) {
    state.loadError = err.message;
  }
  state.loading = false;
  const leagues = state.site?.leagues || [];
  if (!leagues.some((l) => l.key === state.activeLeague)) state.activeLeague = leagues[0]?.key || null;
  render();
}

// data/leagues.json is written by scripts/build-data.mjs. Without it (local development), fall back to demo data.
async function loadPublished() {
  const res = await fetch(`data/leagues.json?t=${Date.now()}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return loadDemo();
  if (!res.ok) throw new Error(`Couldn't load the league data (HTTP ${res.status}).`);
  state.demo = false;
  return res.json();
}

async function loadDemo() {
  state.demo = true;
  const leagues = await Promise.all(DEMO_SPORTS.map(async (sport) => {
    const raw = await (await fetch(`demo/${sport}.json`)).json();
    const key = `demo-${sport}`;
    return { key, label: SPORTS[sport].label, sport, status: "ok", data: publicLeague(normalizeLeague(raw, sport), { key }) };
  }));
  return { leagueName: "The Franchise", updatedAt: null, weights: null, leagues };
}

function leagues() {
  return state.site?.leagues || [];
}

function combined() {
  const inputs = leagues().map((l) => ({ key: l.key, sport: l.sport, league: l.data }));
  return combineStandings(inputs, { weights: state.site.weights || DEFAULT_WEIGHTS });
}

function columns() {
  const w = state.site.weights || DEFAULT_WEIGHTS;
  const total = leagues().reduce((sum, l) => sum + (w[l.sport] ?? 0), 0) || 1;
  return leagues().map((l) => ({
    key: l.key,
    label: l.label,
    sport: l.sport,
    status: l.status,
    started: !!l.data?.started,
    weightShare: (w[l.sport] ?? 0) / total,
  }));
}

function render() {
  if (!state.site) {
    root.innerHTML = state.loadError
      ? `<div class="center-screen"><div class="message error">${esc(state.loadError)}</div></div>`
      : `<div class="center-screen"><span class="muted">Loading the franchise…</span></div>`;
    return;
  }
  const { site } = state;
  const subtitle = state.demo
    ? `<span class="demo-tag">demo data</span>`
    : site.updatedAt ? `Updated ${esc(views.timeAgo(site.updatedAt))}` : "";
  const tabs = TABS.map(([key, label]) => `<button class="tab${state.tab === key ? " active" : ""}" data-action="tab" data-tab="${key}">${label}</button>`).join("");
  const pills = LEAGUE_TABS.has(state.tab) && leagues().length
    ? `<div class="league-pills">${leagues().map(pill).join("")}</div>`
    : "";
  root.innerHTML = `
    <header class="app-header">
      <div>
        <div class="header-kicker">${esc(site.leagueName)}</div>
        <div class="muted">Multi-sport league office${subtitle ? ` · ${subtitle}` : ""}</div>
      </div>
      <button class="btn-ghost" data-action="refresh">${state.loading ? "Refreshing…" : "Refresh"}</button>
    </header>
    <nav class="tabs">${tabs}</nav>
    ${pills}
    <main class="app-main">
      ${state.loadError ? `<div class="message error">${esc(state.loadError)}</div>` : ""}
      ${body()}
    </main>`;
}

function pill(l) {
  const dot = l.status === "error" || l.status === "stale" ? `<span class="dot error"></span>` : "";
  return `<button class="pill${l.key === state.activeLeague ? " active" : ""}" data-action="league" data-key="${esc(l.key)}">${esc(l.label)}${dot}</button>`;
}

function body() {
  if (!leagues().length) return views.emptyState("No leagues yet", "No league data has been published.");
  if (state.tab === "combined") return views.combinedView({ result: combined(), columns: columns(), meKey: state.me });

  const l = leagues().find((x) => x.key === state.activeLeague) || leagues()[0];
  if (!l.data) return `<div class="message error">${esc(l.label)}: ${esc(l.error || "No data.")}</div>`;
  const staleNote = l.status === "stale"
    ? `<div class="message info">Couldn't refresh ${esc(l.label)} (${esc(l.error)}). Showing data from ${esc(views.timeAgo(l.fetchedAt))}.</div>`
    : "";
  if (state.tab === "standings") return staleNote + views.standingsView(l.data, (t) => !!state.me && t.ownerId === state.me);
  if (state.tab === "rosters") return staleNote + views.rostersView(l.data, state.selectedTeam[l.key]);
  return staleNote + views.tradesView(l.data);
}

const actions = {
  tab(el) {
    state.tab = el.dataset.tab;
    storage.set("fl-tab", state.tab);
    render();
  },
  league(el) {
    state.activeLeague = el.dataset.key;
    storage.set("fl-league", state.activeLeague);
    render();
  },
  team(el) {
    state.selectedTeam[state.activeLeague] = Number(el.dataset.team);
    render();
  },
  me(el) {
    state.me = state.me === el.dataset.key ? null : el.dataset.key;
    storage.set("fl-me", state.me);
    render();
  },
  refresh() {
    load();
  },
};

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) actions[el.dataset.action]?.(el);
});

load();
