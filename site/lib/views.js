// HTML string builders. Pure functions of their arguments so they can be tested without a browser.
import { formatPct, ordinal } from "./combine.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function emptyState(title, body) {
  return `<div class="empty-state"><div class="empty-title">${escapeHtml(title)}</div><div class="muted">${escapeHtml(body)}</div></div>`;
}

const record = (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
const fmtNum = (v, digits = 1) => (v == null ? "–" : Number(v).toFixed(digits));
const labelList = (cols) => cols.map((c) => escapeHtml(c.label)).join(", ");

const SCORING_LABELS = {
  H2H_POINTS: "Head-to-head points",
  H2H_CATEGORY: "Head-to-head categories",
  H2H_MOST_CATEGORIES: "Head-to-head most categories",
  ROTO: "Rotisserie",
  TOTAL_POINTS: "Season points",
};

const INJURY_LABELS = {
  OUT: "Out",
  DAY_TO_DAY: "Day-to-day",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  INJURY_RESERVE: "IR",
  SUSPENSION: "Suspended",
};
const injuryLabel = (s) => (s ? INJURY_LABELS[s] || s.replace(/_/g, " ").toLowerCase() : "");

// columns: [{ key, label, sport, status, started, weightShare }]
export function combinedView({ result, columns, meKey }) {
  const labelColumn = columns.find((c) => c.key === result.rows.find((r) => r.labelFrom)?.labelFrom);
  if (!result.rows.length) {
    return columns.some((c) => c.status === "loading")
      ? emptyState("Loading leagues…", "Pulling standings from ESPN.")
      : emptyState("No standings yet", "Once at least one league loads, the combined table appears here.");
  }
  const head = columns.map((c) => `<th class="num">${escapeHtml(c.label)}</th>`).join("");
  const body = result.rows.map((r) => {
    const cells = columns.map((c) => {
      const s = r.byLeague[c.key];
      if (!s) return `<td class="num muted">–</td>`;
      const title = `${s.teamName}${s.rank ? ` · ${ordinal(s.rank)}` : ""}`;
      const place = s.rank && s.counted ? `<span class="place">${ordinal(s.rank)}</span>` : "";
      return `<td class="num${s.counted ? "" : " muted"}" title="${escapeHtml(title)}">${formatPct(s.winPct)}${place}</td>`;
    }).join("");
    return `<tr class="${r.key === meKey ? "me" : ""}">
        <td class="rank">${r.rank}</td>
        <td><button class="link-btn" data-action="me" data-key="${escapeHtml(r.key)}" title="Highlight this manager">${escapeHtml(r.label)}</button></td>
        ${cells}
        <td class="num strong">${formatPct(r.combinedPct)}</td>
        <td class="num muted">${record(r)}</td>
      </tr>`;
  }).join("");
  const labelNote = labelColumn ? `<p class="note">Managers are listed by their ${escapeHtml(labelColumn.label)} team name.</p>` : "";
  return `${combinedNote(columns)}${labelNote}
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Manager</th>${head}<th class="num">Combined</th><th class="num">W-L-T</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function combinedNote(columns) {
  const weights = columns.map((c) => `${escapeHtml(c.label)} ${Math.round(c.weightShare * 100)}%`).join(" · ");
  const notes = [`Combined is the weighted average of each league's winning percentage (${weights}).`];
  const unstarted = columns.filter((c) => c.status === "ok" && !c.started);
  const failed = columns.filter((c) => c.status === "error");
  const stale = columns.filter((c) => c.status === "stale");
  const loading = columns.filter((c) => c.status === "loading");
  if (unstarted.length) {
    notes.push(`${labelList(unstarted)} ${unstarted.length > 1 ? "haven't" : "hasn't"} started yet, so for now the other leagues share the weight.`);
  }
  if (failed.length) notes.push(`${labelList(failed)} failed to load and ${failed.length > 1 ? "are" : "is"} left out.`);
  if (stale.length) notes.push(`${labelList(stale)} couldn't be refreshed from ESPN, so older numbers are shown.`);
  if (loading.length) notes.push(`Still loading: ${labelList(loading)}.`);
  notes.push("Roto leagues count finish position (1st = 1.000, last = .000). Click a name to highlight yourself.");
  return `<p class="note">${notes.join(" ")}</p>`;
}

export function standingsView(league, isMe = () => false) {
  if (!league.teams.length) return emptyState("No standings yet", "ESPN didn't return any teams for this league.");
  const roto = league.isRoto;
  const showPoints = !roto && league.teams.some((t) => t.pointsFor);
  const head = roto
    ? `<th class="num">Points</th><th class="num">Pct</th>`
    : `<th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Pct</th>${showPoints ? `<th class="num">PF</th><th class="num">PA</th>` : ""}`;
  const rows = league.teams.map((t) => {
    const stats = roto
      ? `<td class="num">${fmtNum(t.totalPoints)}</td><td class="num strong">${formatPct(t.winPct)}</td>`
      : `<td class="num">${t.wins}</td><td class="num">${t.losses}</td><td class="num">${t.ties}</td><td class="num strong">${formatPct(t.winPct)}</td>`
        + (showPoints ? `<td class="num">${fmtNum(t.pointsFor)}</td><td class="num">${fmtNum(t.pointsAgainst)}</td>` : "");
    return `<tr class="${isMe(t) ? "me" : ""}">
        <td class="rank${t.rank === 1 && league.started ? " gold" : ""}">${t.rank}</td>
        <td><div class="strong">${escapeHtml(t.name)}</div><div class="muted small">${escapeHtml(t.ownerName || "")}</div></td>
        ${stats}
      </tr>`;
  }).join("");
  const meta = [league.name, SCORING_LABELS[league.scoringType] || league.scoringType, league.started ? null : "season hasn't started"]
    .filter(Boolean).map(escapeHtml).join(" · ");
  return `<p class="note">${meta}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Team</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

export function rostersView(league, selectedTeamId) {
  const teams = league.teams;
  if (!teams.length) return emptyState("No roster data", "ESPN didn't return any teams for this league.");
  const active = teams.find((t) => t.teamId === selectedTeamId) || teams[0];
  const chips = teams
    .map((t) => `<button class="chip${t === active ? " active" : ""}" data-action="team" data-team="${escapeHtml(t.teamId)}">${escapeHtml(t.name)}</button>`)
    .join("");
  const rows = active.roster.map((p) => `
      <tr class="${p.bench ? "bench" : ""}">
        <td class="muted">${escapeHtml(p.slot)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="muted small">${escapeHtml(injuryLabel(p.injuryStatus))}</td>
      </tr>`).join("");
  return `<div class="chips">${chips}</div>
    <p class="note">${escapeHtml(active.name)}${active.ownerName ? ` · ${escapeHtml(active.ownerName)}` : ""}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Slot</th><th>Player</th><th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No roster entries.</td></tr>`}</tbody>
    </table></div>`;
}

export function tradesView(league) {
  if (!league.trades.length) return emptyState("No trades found", "ESPN hasn't recorded any trades in this league yet.");
  return league.trades.map((tx) => `
    <div class="trade-card">
      <div class="trade-header">
        <span class="muted">${tx.date ? new Date(tx.date).toLocaleDateString() : "Date unknown"}</span>
        <span class="status-tag${tx.status === "EXECUTED" ? " live" : ""}">${escapeHtml(tx.status)}</span>
      </div>
      <div class="trade-items">
        ${tx.items.map((it) => `<div><strong>${escapeHtml(it.player)}</strong>: ${escapeHtml(it.from)} → ${escapeHtml(it.to)}</div>`).join("")}
      </div>
    </div>`).join("");
}

export function timeAgo(iso, now = new Date()) {
  if (!iso) return "";
  const minutes = Math.round((now - new Date(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
