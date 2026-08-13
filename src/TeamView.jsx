import React, { useMemo, useState } from "react";
import { C, FONT_DISPLAY, FONT_BODY } from "./palette";
import { LEAGUE } from "./league.js";
import { LEADER_MIN_GAME_SHARE, qualifyByMinutes, qualifyNote } from "./qualify.js";
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import OnOffChart from "./OnOffChart.jsx";
import CourtChart, { ZoneTable } from "./CourtChart.jsx";
import StaleNote from "./StaleNote.jsx";
import SourceNote from "./SourceNote.jsx";
import { sourceFor } from "./sources.js";

const sum = (arr, k) => arr.reduce((a, b) => a + b[k], 0);
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (m, a) => (a > 0 ? r1((m / a) * 100) : 0);

function ordinal(num) {
  if (!num) return "—";
  const s = ["th", "st", "nd", "rd"], v = num % 100;
  return num + (s[(v - 20) % 10] || s[v] || s[0]);
}

function lastName(name) {
  const parts = String(name).trim().split(" ");
  return parts[parts.length - 1];
}

// Sum the per-game logs across the whole roster into one team line.
function teamShooting(roster) {
  let fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0, pts = 0;
  for (const p of roster) {
    for (const l of p.logs) {
      fgm += l.fgm; fga += l.fga; tpm += l.tpm; tpa += l.tpa;
      ftm += l.ftm; fta += l.fta; pts += l.pts;
    }
  }
  const tsDen = 2 * (fga + 0.44 * fta);
  return {
    fgm, fga, tpm, tpa, ftm, fta, pts,
    fgPct: pct(fgm, fga), tpPct: pct(tpm, tpa), ftPct: pct(ftm, fta),
    efg: fga > 0 ? r1(((fgm + 0.5 * tpm) / fga) * 100) : 0,
    ts: tsDen > 0 ? r1((pts / tsDen) * 100) : 0,
  };
}

// Per-player season averages, used for the leaders strip + scoring share.
function perPlayer(roster) {
  return roster
    .map((p) => {
      const gp = p.logs.length;
      const reb = sum(p.logs, "orb") + sum(p.logs, "drb");
      const totalPts = sum(p.logs, "pts");
      return {
        name: p.name,
        gp,
        totalPts,
        ppg: r1(totalPts / gp),
        rpg: r1(reb / gp),
        apg: r1(sum(p.logs, "ast") / gp),
        spg: r1(sum(p.logs, "stl") / gp),
        bpg: r1(sum(p.logs, "blk") / gp),
      };
    })
    .filter((p) => p.gp > 0);
}

// A per-game leader has to have actually played: without a floor, one game and
// nine assists outranks the starting point guard all season. See src/qualify.js
// for the threshold and why it's a share of the team's games.
function leaderOf(players, key, teamGames = 0) {
  if (!players.length) return null;
  const best = (list) => list.reduce((a, p) => (p[key] > a[key] ? p : a), list[0]);
  const qualified = players.filter((p) => p.gp >= Math.ceil(teamGames * LEADER_MIN_GAME_SHARE));
  return best(qualified.length ? qualified : players);
}

function BigTile({ label, value, sub, accent }) {
  // Mono digits are wide, so a long value ("W L W L W") would wrap onto a second
  // line and make one tile taller than its neighbours. Step the display size
  // down instead so every tile in the row stays the same height.
  const size = String(value).length > 6 ? 22 : 32;
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: C.MUTE, fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: size, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", color: accent || C.TXT }}>{value}</span>
      {sub != null && <span style={{ fontSize: 12, color: C.MUTE }}>{sub}</span>}
    </div>
  );
}

function SplitBar({ label, value, max = 100, color }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: C.MUTE, fontWeight: 600, letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 13, color: C.TXT, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{value}%</span>
      </div>
      <div style={{ height: 7, background: C.PANEL, borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${Math.min((value / max) * 100, 100)}%`, height: "100%", background: color, borderRadius: 6, transition: "width .6s ease" }} />
      </div>
    </div>
  );
}

function LeaderCard({ label, leader, statKey, unit }) {
  // leaderOf returns null only for an empty roster, which App.jsx already keeps
  // off this view — but a card that renders nothing beats one that throws.
  if (!leader) return null;
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.BRAND, fontWeight: 700 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leader.name}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.TXT, lineHeight: 1.1, marginTop: 2 }}>
        {leader[statKey]}<span style={{ fontSize: 12, color: C.MUTE, fontWeight: 600, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
}

// A player's name as a link to their own page. Falls back to plain text when no
// href is available (the advanced feed occasionally lists a name that isn't on
// the roster snapshot, and a dead link is worse than no link).
function PlayerLink({ name, href, onGo }) {
  if (!href) return name;
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onGo && onGo(name);
      }}
      style={{ color: C.TXT, borderBottom: `1px solid ${C.LINE}` }}
    >
      {name}
    </a>
  );
}

function Section({ title, hint, stale, source, children, style }) {
  return (
    <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>{title}</h2>
        {hint && <span style={{ fontSize: 11, color: C.MUTE }}>{hint}</span>}
      </div>
      <StaleNote stale={stale} />
      {children}
      <SourceNote source={source} />
    </section>
  );
}

function Unavailable({ what, detail }) {
  return (
    <div>
      <p style={{ color: C.MUTE, fontSize: 13, margin: 0 }}>
        {what} weren't returned (the advanced endpoint may be unavailable from this host).
      </p>
      {detail && (
        <p style={{ color: C.LOSS_FG, fontSize: 12, margin: "8px 0 0", fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-word" }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function ScoreTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 180 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{d.label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: C.MUTE }}>Result</span>
        <span style={{ color: d.w ? C.GOOD : C.BAD, fontWeight: 700 }}>{d.w ? "W" : "L"} {d.for}-{d.against}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: C.MUTE }}>Margin</span>
        <span style={{ color: d.margin >= 0 ? C.GOOD : C.BAD, fontWeight: 700 }}>{d.margin > 0 ? "+" : ""}{d.margin}</span>
      </div>
    </div>
  );
}

function RankTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const row = (label, val, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: C.MUTE }}>{label}</span>
      <span style={{ color: color || C.TXT, fontWeight: 700 }}>{val}</span>
    </div>
  );
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 200 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: d.isSelected ? C.BRAND : C.TXT, marginBottom: 6 }}>{d.name}</div>
      {row("Net rating", `${d.net > 0 ? "+" : ""}${d.net}`, d.net >= 0 ? C.GOOD : C.BAD)}
      {row("Offense", d.off)}
      {row("Defense", d.def)}
      {row("Pace", d.pace)}
    </div>
  );
}

function FactorTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 180 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: p.dataKey === "team" ? C.BRAND : C.ACCENT }}>{p.dataKey === "team" ? "Team" : "Opponents"}</span>
          <span style={{ color: C.TXT, fontWeight: 700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function AdvTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const row = (label, val) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: C.MUTE }}>{label}</span>
      <span style={{ color: C.TXT, fontWeight: 700 }}>{val}</span>
    </div>
  );
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 190 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{d.name}</div>
      {row("Usage", `${d.usg}%`)}
      {row("True shooting", `${d.ts}%`)}
      {row("Net rating", `${d.net > 0 ? "+" : ""}${d.net}`)}
      {row("Minutes", d.min)}
    </div>
  );
}

const PROFILE_METRICS = [
  { key: "fg3m", label: "3PM", full: "3-pt makes" },
  { key: "fg3a", label: "3PA", full: "3-pt attempts" },
  { key: "fg2m", label: "2PM", full: "2-pt makes" },
  { key: "fg2a", label: "2PA", full: "2-pt attempts" },
  { key: "ftm", label: "FTM", full: "free throws made" },
  { key: "fta", label: "FTA", full: "free throw attempts" },
  { key: "oreb", label: "OREB", full: "offensive rebounds" },
  { key: "tov", label: "TOV", full: "turnovers" },
  { key: "efg", label: "eFG%", full: "effective FG%", pct: true },
];

// Zones for the "shooting profile vs winning" scatter. "Three" combines both
// corners and above-the-break; the other three map to single court zones.
const WIN_ZONES = [
  { key: "ra", label: "Restricted area", parts: ["ra"] },
  { key: "paint", label: "Paint", parts: ["paint"] },
  { key: "mid", label: "Mid-range", parts: ["mid"] },
  { key: "three", label: "Three", parts: ["lc3", "rc3", "atb3"] },
];
const BASE_ZONE_KEYS = ["ra", "paint", "mid", "lc3", "rc3", "atb3"];

// A team's metric for a zone: FG% (efficiency) or that zone's share of all the
// team's shot attempts (volume), as a percentage. Null when there are no shots.
function zoneMetric(zones, parts, mode) {
  const map = new Map((zones || []).map((z) => [z.z, z]));
  let m = 0, a = 0;
  for (const k of parts) { const z = map.get(k); if (z) { m += z.m; a += z.a; } }
  if (mode === "eff") return a > 0 ? r1((m / a) * 100) : null;
  let tot = 0;
  for (const k of BASE_ZONE_KEYS) { const z = map.get(k); if (z) tot += z.a; }
  return tot > 0 ? r1((a / tot) * 100) : null;
}

function MetricButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="pill-toggle"
      style={{
        appearance: "none",
        cursor: "pointer",
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.5,
        padding: "6px 12px",
        borderRadius: 999, // capsule, like every other button in the brand
        color: active ? C.ON_BRAND : C.TXT,
        background: active ? C.BRAND : "transparent",
        border: `1px solid ${active ? C.BRAND : C.LINE}`,
        transition: "background .15s ease, color .15s ease",
      }}
    >
      {children}
    </button>
  );
}

function ProfileTooltip({ active, payload, metric }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const unit = metric && metric.pct ? "%" : "";
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 160 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: d.isSelected ? C.BRAND : C.TXT, marginBottom: 4 }}>{d.name}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: C.MUTE }}>{metric ? metric.full : ""}</span>
        <span style={{ color: C.TXT, fontWeight: 700 }}>{d.value}{unit}</span>
      </div>
    </div>
  );
}

export default function TeamView({ games, roster, onOff, fourFactors, teamRanks, playerAdv, lineups, errors = {}, stale = {}, season, teamId, teamName = "Team", teamProfiles = [], upcoming = [], shotZones = null, leagueShotZones = [], teamZoneWins = [], playerHref, onPlayer }) {
  // Footnote links back to the nba.com page each section was built from, so
  // any number here can be checked against the source it came from.
  const src = useMemo(
    () => (key) => sourceFor(key, { season, teamId }),
    [season, teamId]
  );

  const team = useMemo(() => {
    const gp = games.length;
    const wins = games.filter((g) => g.w).length;
    const scored = games.reduce((a, g) => a + (g.tm || 0), 0);
    const allowed = games.reduce((a, g) => a + (g.op || 0), 0);
    const home = games.filter((g) => g.home);
    const away = games.filter((g) => !g.home);
    const rec = (arr) => `${arr.filter((g) => g.w).length}–${arr.filter((g) => !g.w).length}`;
    const last5 = games.slice(-5);
    return {
      gp,
      wins,
      losses: gp - wins,
      winPct: gp > 0 ? Math.round((wins / gp) * 1000) / 10 : 0,
      ppg: gp > 0 ? r1(scored / gp) : 0,
      oppg: gp > 0 ? r1(allowed / gp) : 0,
      margin: gp > 0 ? r1((scored - allowed) / gp) : 0,
      homeRec: rec(home),
      awayRec: rec(away),
      last5: rec(last5),
      last5seq: last5.map((g) => (g.w ? "W" : "L")),
    };
  }, [games]);

  const shooting = useMemo(() => teamShooting(roster), [roster]);
  const players = useMemo(() => perPlayer(roster), [roster]);

  const leaders = useMemo(() => ({
    ppg: leaderOf(players, "ppg", games.length),
    rpg: leaderOf(players, "rpg", games.length),
    apg: leaderOf(players, "apg", games.length),
    spg: leaderOf(players, "spg", games.length),
    bpg: leaderOf(players, "bpg", games.length),
  }), [players, games.length]);

  const gameData = useMemo(
    () => games.map((g) => ({
      name: g.opp,
      label: `${g.date} ${g.home ? "vs" : "@"} ${g.opp}`,
      for: g.tm,
      against: g.op,
      margin: (g.tm || 0) - (g.op || 0),
      w: g.w,
    })),
    [games]
  );

  const share = useMemo(() => {
    const total = players.reduce((a, p) => a + p.totalPts, 0) || 1;
    return [...players]
      .sort((a, b) => b.totalPts - a.totalPts)
      .map((p) => ({ ...p, share: Math.round((p.totalPts / total) * 1000) / 10 }));
  }, [players]);
  const maxShare = share.length ? share[0].share : 1;

  // League-wide ranking context (selected team vs all 30 teams).
  const ranking = useMemo(() => {
    const src = teamRanks && teamRanks.teams ? teamRanks.teams : [];
    if (!src.length) return null;
    const teams = src.map((t) => ({ ...t, isSelected: t.teamId === teamId }));
    const byNet = [...teams].sort((a, b) => b.net - a.net);
    const byOff = [...teams].sort((a, b) => b.off - a.off);
    const byDef = [...teams].sort((a, b) => a.def - b.def); // lower def rating = better
    const byPace = [...teams].sort((a, b) => b.pace - a.pace); // higher = faster (1st = fastest)
    const rankIn = (arr) => arr.findIndex((t) => t.isSelected) + 1 || null;
    return {
      total: teams.length,
      chart: byNet,
      netRank: rankIn(byNet),
      offRank: rankIn(byOff),
      defRank: rankIn(byDef),
      paceRank: rankIn(byPace),
      selected: teams.find((t) => t.isSelected) || null,
    };
  }, [teamRanks, teamId]);

  // Shooting profile vs winning (league-wide scatter).
  const [winZone, setWinZone] = useState("three");
  const [winMode, setWinMode] = useState("eff");
  const winScatter = useMemo(() => {
    const zoneDef = WIN_ZONES.find((z) => z.key === winZone) || WIN_ZONES[0];
    const pts = (teamZoneWins || [])
      .map((t) => ({
        abbr: t.abbr,
        teamId: t.teamId,
        y: t.winPct,
        x: zoneMetric(t.zones, zoneDef.parts, winMode),
        isSelected: t.teamId === teamId,
      }))
      .filter((p) => p.x != null);
    // Least-squares trend line + Pearson correlation, to show how strongly the
    // chosen shooting metric tracks with winning across the league.
    let r = null, seg = null;
    const n = pts.length;
    if (n >= 2) {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const xb = xs.reduce((a, b) => a + b, 0) / n, yb = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { const dx = xs[i] - xb, dy = ys[i] - yb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      if (sxx > 0 && syy > 0) {
        r = sxy / Math.sqrt(sxx * syy);
        const slope = sxy / sxx, int = yb - slope * xb;
        const xmin = Math.min(...xs), xmax = Math.max(...xs);
        seg = [{ x: xmin, y: r1(slope * xmin + int) }, { x: xmax, y: r1(slope * xmax + int) }];
      }
    }
    return { pts, zoneDef, r, seg, unit: winMode === "eff" ? "FG%" : "shot share" };
  }, [teamZoneWins, winZone, winMode, teamId]);

  // Shooting & possession profile vs the league.
  const [metric, setMetric] = useState("efg");
  const activeMetric = PROFILE_METRICS.find((m) => m.key === metric) || PROFILE_METRICS[0];
  const profile = useMemo(() => {
    const src = teamProfiles || [];
    if (!src.length) return null;
    const rows = src
      .map((t) => ({ abbr: t.abbr, name: t.abbr, value: t[metric] ?? 0, teamId: t.teamId, isSelected: t.teamId === teamId }))
      .sort((a, b) => b.value - a.value);
    const vals = rows.map((r) => r.value);
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    const idx = rows.findIndex((r) => r.isSelected);
    return {
      chart: rows,
      avg,
      total: rows.length,
      rank: idx >= 0 ? idx + 1 : null,
      selVal: idx >= 0 ? rows[idx].value : null,
    };
  }, [teamProfiles, metric, teamId]);


  // Four factors, team vs opponents.
  const ffData = useMemo(() => {
    if (!fourFactors) return null;
    const { team: t, opp: o } = fourFactors;
    return [
      { factor: "eFG%", team: t.efg, opp: o.efg },
      { factor: "Turnover %", team: t.tov, opp: o.tov },
      { factor: "Off. reb %", team: t.oreb, opp: o.oreb },
      { factor: "FT rate", team: t.ftRate, opp: o.ftRate },
    ];
  }, [fourFactors]);

  // Advanced player scatter (usage vs efficiency, sized by minutes). Both axes
  // are rate stats, so players below the minutes floor are left off — see
  // src/qualify.js. `min` is minutes per game here, so the season total is
  // gp × min.
  const advQualified = useMemo(
    () => qualifyByMinutes(
      (playerAdv || []).filter((p) => p.gp > 0),
      (p) => p.gp * p.min,
      games.length
    ),
    [playerAdv, games.length]
  );
  const advScatter = useMemo(
    () => advQualified.rows.map((p) => ({ ...p, x: p.usg, y: p.ts, z: p.min })),
    [advQualified]
  );
  // Recharts anchors a numeric axis at 0 unless told otherwise, which put a
  // rotation's true shooting (50-68%) in the top third of the plot and its
  // usage (11-27%) in the left half — so tightening the data by filtering
  // bought nothing on screen. Fit both axes to the players actually plotted.
  // Neither stat goes anywhere near 0 for a qualified player, so there is no
  // zero to preserve here (unlike the on/off chart, where 0 is the whole point).
  const advDomains = useMemo(() => {
    const pad = (vals) => {
      if (!vals.length) return ["auto", "auto"];
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const p = Math.max(1, (hi - lo) * 0.12);
      return [Math.floor(lo - p), Math.ceil(hi + p)];
    };
    return { x: pad(advScatter.map((p) => p.x)), y: pad(advScatter.map((p) => p.y)) };
  }, [advScatter]);
  // The table underneath keeps everyone. It is the team page's link out to each
  // player's own page, and a fringe player's page still wants linking to — the
  // floor is about not letting four minutes distort a scatter, not about hiding
  // anyone.
  const advTable = useMemo(
    () => [...(playerAdv || [])].filter((p) => p.gp > 0).sort((a, b) => b.min - a.min),
    [playerAdv]
  );

  const maxAbsNet = useMemo(
    () => Math.max(1, ...(lineups || []).map((l) => Math.abs(l.net))),
    [lineups]
  );

  const renderAdvDot = (props) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const r = 5 + Math.min(9, Math.sqrt(payload.min) / 2.2);
    const fill = payload.net >= 0 ? C.GOOD : C.BAD;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.6} stroke={fill} strokeWidth={1} />
        <text x={cx + r + 4} y={cy + 4} fill={C.TXT} fontSize={11} fontFamily={FONT_BODY}>
          {lastName(payload.name)}
        </text>
      </g>
    );
  };

  // One dot per team in the shooting-profile-vs-winning scatter; the selected
  // team is larger and plum, the rest muted blue, each labelled by abbr.
  const renderWinDot = (props) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const sel = payload.isSelected;
    const fill = sel ? C.BRAND : C.ACCENT;
    return (
      <g>
        <circle cx={cx} cy={cy} r={sel ? 7 : 5} fill={fill} fillOpacity={sel ? 1 : 0.55} stroke={fill} strokeWidth={sel ? 2 : 1} />
        <text x={cx + (sel ? 10 : 8)} y={cy + 4} fill={sel ? C.BRAND : C.MUTE} fontSize={11} fontWeight={sel ? 700 : 600} fontFamily={FONT_DISPLAY}>
          {payload.abbr}
        </text>
      </g>
    );
  };

  return (
    <main className="hf-container" style={{ paddingTop: 24, paddingBottom: 40 }}>
      {/* Headline tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
        <BigTile label="Record" value={`${team.wins}–${team.losses}`} sub={`${team.winPct}% win rate`} accent={C.BRAND} />
        <BigTile label="Points / game" value={team.ppg} sub={`${team.oppg} allowed`} />
        <BigTile label="Avg margin" value={`${team.margin > 0 ? "+" : ""}${team.margin}`} sub="per game" accent={team.margin >= 0 ? C.GOOD : C.BAD} />
        <BigTile label="Home" value={team.homeRec} />
        <BigTile label="Away" value={team.awayRec} />
        <BigTile label="Last 5" value={team.last5seq.join(" ")} sub={team.last5} />
      </div>

      {/* Margin by game */}
      <Section title="Margin by game" hint="green = win · red = loss" source={src("games")}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={gameData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
            <YAxis tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
            <Tooltip content={<ScoreTooltip />} cursor={{ fill: C.HOVER_FILL }} />
            <ReferenceLine y={0} stroke={C.MUTE} strokeOpacity={0.5} />
            <Bar dataKey="margin" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {gameData.map((d, i) => (
                <Cell key={i} fill={d.w ? C.GOOD : C.BAD} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Section>

      {/* Points for vs against */}
      <Section
        title="Points scored vs allowed"
        hint={<span><span style={{ color: C.BRAND }}>● scored</span>{"  "}<span style={{ color: C.ACCENT }}>● allowed</span></span>}
        source={src("games")}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={gameData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
            <YAxis tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
            <Tooltip
              contentStyle={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, color: C.TXT }}
              labelStyle={{ color: C.BRAND }}
              labelFormatter={(l, pl) => (pl && pl[0] ? pl[0].payload.label : l)}
              formatter={(v, key) => [v, key === "for" ? "Scored" : "Allowed"]}
            />
            <ReferenceLine y={team.ppg} stroke={C.BRAND} strokeDasharray="5 4" strokeOpacity={0.5} />
            <Line type="monotone" dataKey="for" stroke={C.BRAND} strokeWidth={2.5} dot={{ r: 3, fill: C.BRAND }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="against" stroke={C.ACCENT} strokeWidth={2.5} dot={{ r: 3, fill: C.ACCENT }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </Section>

      {/* Leaders */}
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>Team leaders</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
        <LeaderCard label="Scoring" leader={leaders.ppg} statKey="ppg" unit="ppg" />
        <LeaderCard label="Rebounding" leader={leaders.rpg} statKey="rpg" unit="rpg" />
        <LeaderCard label="Assists" leader={leaders.apg} statKey="apg" unit="apg" />
        <LeaderCard label="Steals" leader={leaders.spg} statKey="spg" unit="spg" />
        <LeaderCard label="Blocks" leader={leaders.bpg} statKey="bpg" unit="bpg" />
      </div>

      <div className="split-2" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 360px) 1fr", gap: 18, marginBottom: 22 }}>
        {/* Team shooting splits */}
        <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px" }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: "0 0 16px" }}>Team shooting</h2>
          <SplitBar label="Field goal %" value={shooting.fgPct} color={C.ACCENT} />
          <SplitBar label="3-point %" value={shooting.tpPct} color={C.BRAND} />
          <SplitBar label="Free throw %" value={shooting.ftPct} color={C.ACCENT} />
          <SplitBar label="Effective FG %" value={shooting.efg} max={120} color={C.BRAND} />
          <SplitBar label="True shooting %" value={shooting.ts} max={120} color={C.ACCENT} />
          <div style={{ display: "flex", gap: 10, marginTop: 14, fontSize: 11, color: C.MUTE, flexWrap: "wrap" }}>
            <span>FG {shooting.fgm}/{shooting.fga}</span><span>·</span>
            <span>3P {shooting.tpm}/{shooting.tpa}</span><span>·</span>
            <span>FT {shooting.ftm}/{shooting.fta}</span>
          </div>
          <SourceNote source={src("teamShooting")} />
        </section>

        {/* Scoring share */}
        <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>Scoring share</h2>
            <span style={{ fontSize: 11, color: C.MUTE }}>% of team points</span>
          </div>
          {share.map((p) => (
            <div key={p.name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: C.TXT, fontWeight: 600 }}>{lastName(p.name)}</span>
                <span style={{ fontSize: 12, color: C.MUTE, fontFamily: FONT_DISPLAY }}>
                  {p.share}% <span style={{ opacity: 0.6 }}>· {p.totalPts} pts</span>
                </span>
              </div>
              <div style={{ height: 8, background: C.PANEL_2, borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: `${(p.share / maxShare) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${C.ACCENT}, ${C.BRAND})`, borderRadius: 6, transition: "width .6s ease" }} />
              </div>
            </div>
          ))}
          <SourceNote source={src("scoringShare")} />
        </section>
      </div>

      {/* Shooting by zone — court map + numbers */}
      <Section title={`${teamName} shooting by zone`} hint={`court shaded vs ${LEAGUE.name} average · toggle volume`} stale={stale.shotZones} source={src("teamShotZones")}>
        {shotZones ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, alignItems: "start" }}>
            <CourtChart zones={shotZones} league={leagueShotZones} />
            <div className="scroll-x" style={{ overflowX: "auto" }}>
              <ZoneTable zones={shotZones} league={leagueShotZones} />
              <p style={{ fontSize: 12, color: C.MUTE, margin: "10px 2px 0", lineHeight: 1.5 }}>
                Season FG% by court zone. <strong style={{ color: C.TXT }}>FG% vs lg</strong> is the efficiency gap from the
                league average for that zone; <strong style={{ color: C.TXT }}>Vol vs lg</strong> is how much more (or less)
                of this team's shots come from there vs the league, in percentage points of shot share.
              </p>
            </div>
          </div>
        ) : (
          <Unavailable what="Zone shooting" detail={errors.shotZones} />
        )}
      </Section>

      {/* League ranking — selected team vs the rest of the league */}
      <Section title={`${teamName} vs the ${LEAGUE.name} · net rating`} hint={`points per 100 possessions · plum = ${teamName}`} stale={stale.teamRanks} source={src("teamRanks")}>
        {ranking ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 16 }}>
              <BigTile label="Net rating" value={ranking.selected ? `${ranking.selected.net > 0 ? "+" : ""}${ranking.selected.net}` : "—"} sub={`${ordinal(ranking.netRank)} of ${ranking.total}`} accent={ranking.selected && ranking.selected.net >= 0 ? C.GOOD : C.BAD} />
              <BigTile label="Offense" value={ranking.selected ? ranking.selected.off : "—"} sub={`${ordinal(ranking.offRank)} of ${ranking.total}`} accent={C.BRAND} />
              <BigTile label="Defense" value={ranking.selected ? ranking.selected.def : "—"} sub={`${ordinal(ranking.defRank)} of ${ranking.total}`} accent={C.ACCENT} />
              <BigTile label="Pace" value={ranking.selected ? ranking.selected.pace : "—"} sub={`${ordinal(ranking.paceRank)}-fastest of ${ranking.total}`} />
            </div>
            <ResponsiveContainer width="100%" height={ranking.chart.length * 28 + 40}>
              <BarChart layout="vertical" data={ranking.chart} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                <YAxis type="category" dataKey="abbr" width={46} tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} interval={0} />
                <Tooltip content={<RankTooltip />} cursor={{ fill: C.HOVER_FILL }} />
                <ReferenceLine x={0} stroke={C.MUTE} strokeOpacity={0.6} />
                <Bar dataKey="net" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {ranking.chart.map((t, i) => (
                    <Cell key={i} fill={t.isSelected ? C.BRAND : C.ACCENT} fillOpacity={t.isSelected ? 1 : 0.5} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <Unavailable what="League-wide team ratings" detail={errors.teamRanks} />
        )}
      </Section>

      {/* Shooting & possession profile vs the league */}
      <Section
        title={`${teamName} profile · vs the ${LEAGUE.name}`}
        hint={`per 100 possessions · plum = ${teamName}`}
        stale={stale.teamProfiles}
        source={src("teamProfiles")}
      >
        {profile ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {PROFILE_METRICS.map((m) => (
                <MetricButton key={m.key} active={metric === m.key} onClick={() => setMetric(m.key)}>
                  {m.label}
                </MetricButton>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: C.BRAND }}>
                  {profile.selVal != null ? profile.selVal : "—"}{activeMetric.pct ? "%" : ""}
                </span>
                <span style={{ color: C.MUTE, fontSize: 13, marginLeft: 8 }}>
                  {activeMetric.full}{profile.rank ? ` · ${ordinal(profile.rank)} of ${profile.total}` : ""}
                </span>
              </div>
              <span style={{ fontSize: 11, color: C.MUTE }}>league avg {profile.avg}{activeMetric.pct ? "%" : ""}</span>
            </div>
            <ResponsiveContainer width="100%" height={profile.chart.length * 26 + 40}>
              <BarChart layout="vertical" data={profile.chart} margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                <YAxis type="category" dataKey="abbr" width={46} tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} interval={0} />
                <Tooltip content={<ProfileTooltip metric={activeMetric} />} cursor={{ fill: C.HOVER_FILL }} />
                <ReferenceLine x={profile.avg} stroke={C.BRAND} strokeDasharray="5 4" strokeOpacity={0.5} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {profile.chart.map((t, i) => (
                    <Cell key={i} fill={t.isSelected ? C.BRAND : C.ACCENT} fillOpacity={t.isSelected ? 1 : 0.5} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
              Per 100 possessions, sorted high → low, with the dashed line at the league average. Higher is generally better for
              makes, attempts and eFG%; fewer turnovers is better.
            </p>
          </>
        ) : (
          <Unavailable what="Team shooting profiles" detail={errors.teamProfiles} />
        )}
      </Section>

      {/* Four factors */}
      <Section
        title={`Four factors · ${teamName} vs opponents`}
        hint={<span><span style={{ color: C.BRAND }}>● {teamName}</span>{"  "}<span style={{ color: C.ACCENT }}>● opponents</span></span>}
        stale={stale.fourFactors}
        source={src("fourFactors")}
      >
        {ffData ? (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ffData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barGap={4}>
                <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="factor" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                <YAxis tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                <Tooltip content={<FactorTooltip />} cursor={{ fill: C.HOVER_FILL }} />
                <Bar dataKey="team" fill={C.BRAND} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="opp" fill={C.ACCENT} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
              The four factors that drive wins. For this team, higher eFG%, offensive rebound % and FT rate are
              better, while a lower turnover % is better — and the reverse for what they allow opponents.
            </p>
          </>
        ) : (
          <Unavailable what="Four-factor splits" detail={errors.fourFactors} />
        )}
      </Section>

      {/* On/off impact (moved from the player view) */}
      <OnOffChart onOff={onOff} teamGames={games.length} stale={stale.onOff} source={src("onOff")} />

      {/* Advanced player stats */}
      <Section title="Advanced player profile · usage vs efficiency" hint="dot size = minutes · color = net rating" stale={stale.playerAdv} source={src("playerAdv")}>
        {advScatter.length ? (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 6 }}>
                <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" />
                <XAxis type="number" dataKey="x" domain={advDomains.x} tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                  label={{ value: "Usage %  (share of possessions used →)", position: "bottom", fill: C.MUTE, fontSize: 12 }} />
                <YAxis type="number" dataKey="y" domain={advDomains.y} tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                  label={{ value: "True shooting %  (↑ efficiency)", angle: -90, position: "insideLeft", fill: C.MUTE, fontSize: 12, style: { textAnchor: "middle" } }} />
                <ZAxis type="number" dataKey="z" range={[60, 60]} />
                <Tooltip content={<AdvTooltip />} cursor={{ strokeDasharray: "3 3", stroke: C.LINE }} />
                <Scatter data={advScatter} shape={renderAdvDot} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
            {qualifyNote(advQualified) && (
              <p style={{ fontSize: 11, color: C.MUTE, margin: "6px 2px 0", lineHeight: 1.5 }}>
                {qualifyNote(advQualified)} They're still in the table below.
              </p>
            )}
            <div className="scroll-x" style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
                <thead>
                  <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
                    {["Player", "GP", "MIN", "USG%", "TS%", "AST%", "REB%", "NET", "PIE"].map((h, k) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: k === 0 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {advTable.map((p) => (
                    <tr key={p.playerId} style={{ borderBottom: `1px solid ${C.LINE}55` }}>
                      {/* This table lists the whole roster, so it doubles as
                          the team page's link out to each player's page. */}
                      <td style={{ padding: "9px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>
                        <PlayerLink name={p.name} href={playerHref && playerHref(p.name)} onGo={onPlayer} />
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", color: C.MUTE }}>{p.gp}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", color: C.MUTE }}>{p.min}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>{p.usg}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>{p.ts}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>{p.astPct}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>{p.rebPct}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: p.net >= 0 ? C.GOOD : C.LOSS_FG }}>{p.net > 0 ? "+" : ""}{p.net}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND }}>{p.pie}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Unavailable what="Advanced player stats" detail={errors.playerAdv} />
        )}
      </Section>

      {/* Lineups */}
      <Section title="Most-used lineups" hint="top 8 by minutes · net = points per 100 possessions" stale={stale.lineups} source={src("lineups")}>
        {lineups && lineups.length ? (
          lineups.map((l, i) => {
            const w = Math.min(50, (Math.abs(l.net) / maxAbsNet) * 50);
            return (
              <div key={l.id} className="lineup-row" style={{ display: "grid", gridTemplateColumns: "26px 1fr 70px 130px", gap: 12, alignItems: "center", padding: "11px 0", borderBottom: i < lineups.length - 1 ? `1px solid ${C.LINE}55` : "none" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.MUTE, fontSize: 13 }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                  <div style={{ fontSize: 11, color: C.MUTE }}>{l.min} min · {l.gp} GP · OFF {l.off} / DEF {l.def}</div>
                </div>
                <div style={{ textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: l.net >= 0 ? C.GOOD : C.BAD }}>
                  {l.net > 0 ? "+" : ""}{l.net}
                </div>
                <div style={{ position: "relative", height: 8, background: C.PANEL_2, borderRadius: 6 }}>
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.MUTE, opacity: 0.5 }} />
                  <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 6, background: l.net >= 0 ? C.GOOD : C.BAD, left: l.net >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }} />
                </div>
              </div>
            );
          })
        ) : (
          <Unavailable what="Lineup combinations" detail={errors.lineups} />
        )}
      </Section>

      {/* Upcoming games */}
      {(upcoming.length > 0 || errors.schedule) && (
        <Section title="Upcoming games" stale={stale.upcoming} source={src("upcoming")}>
          {upcoming.length > 0 ? (
            <div className="scroll-x" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 }}>
                <thead>
                  <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
                    {["Date", "Matchup", "Opp. record", "Opp. net"].map((h, k) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: k < 2 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((g, idx) => (
                    <tr key={idx} style={{ borderBottom: `1px solid ${C.LINE}55` }}>
                      <td style={{ padding: "9px 10px", whiteSpace: "nowrap", color: C.MUTE }}>{g.date}</td>
                      <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ color: C.MUTE }}>{g.home ? "vs" : "@"}</span>{" "}
                        <span style={{ marginRight: 5 }}>{g.oppEmoji}</span>
                        <span style={{ fontWeight: 700 }}>{g.opp}</span>
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{g.oppW}-{g.oppL}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: g.oppNet == null ? C.MUTE : g.oppNet >= 0 ? C.GOOD : C.LOSS_FG }}>
                        {g.oppNet == null ? "—" : `${g.oppNet > 0 ? "+" : ""}${g.oppNet.toFixed(1)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Unavailable what="The schedule" detail={errors.schedule} />
          )}
        </Section>
      )}

      {/* Results table */}
      <Section title="Results" source={src("games")}>
        <div className="scroll-x" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 420 }}>
            <thead>
              <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
                {["Date", "Matchup", "Result", "Score", "Margin"].map((h, k) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: k < 2 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...games].reverse().map((g) => {
                const margin = (g.tm || 0) - (g.op || 0);
                return (
                  <tr key={g.id} style={{ borderBottom: `1px solid ${C.LINE}55` }}>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap", color: C.MUTE }}>{g.date}</td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                      <span style={{ color: C.MUTE }}>{g.home ? "vs" : "@"}</span> <span style={{ fontWeight: 700 }}>{g.opp}</span>
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>
                      <span style={{ fontWeight: 700, fontSize: 12, padding: "2px 8px", borderRadius: 6,
                        background: g.w ? C.WIN_BG : C.LOSS_BG, color: g.w ? C.GOOD : C.LOSS_FG }}>{g.w ? "W" : "L"}</span>
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{g.tm}-{g.op}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: margin >= 0 ? C.GOOD : C.LOSS_FG }}>{margin > 0 ? "+" : ""}{margin}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Shooting profile vs winning — league-wide scatter */}
      <Section
        title="Shooting profile vs winning"
        hint={`each dot = a team · plum = ${teamName}`}
        stale={stale.teamZoneWins}
        source={src("teamZoneWins")}
      >
        {winScatter.pts.length ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              {WIN_ZONES.map((z) => (
                <MetricButton key={z.key} active={winZone === z.key} onClick={() => setWinZone(z.key)}>
                  {z.label}
                </MetricButton>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <MetricButton active={winMode === "eff"} onClick={() => setWinMode("eff")}>Efficiency</MetricButton>
              <MetricButton active={winMode === "vol"} onClick={() => setWinMode("vol")}>Volume</MetricButton>
            </div>
            <div style={{ marginBottom: 6, fontSize: 13, color: C.MUTE }}>
              {winScatter.zoneDef.label} {winScatter.unit === "FG%" ? "FG%" : "shot share"} vs win %
              {winScatter.r != null && (
                <>
                  {" · "}
                  <span style={{ color: Math.abs(winScatter.r) >= 0.3 ? C.TXT : C.MUTE, fontWeight: 700 }}>
                    correlation r = {winScatter.r > 0 ? "+" : ""}{winScatter.r.toFixed(2)}
                  </span>
                </>
              )}
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart margin={{ top: 16, right: 28, bottom: 28, left: 6 }}>
                <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" />
                <XAxis
                  type="number" dataKey="x"
                  domain={[(min) => Math.floor(min - 1), (max) => Math.ceil(max + 1)]}
                  tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                  label={{ value: `${winScatter.zoneDef.label} ${winScatter.unit === "FG%" ? "FG%" : "shot share %"}  →`, position: "bottom", fill: C.MUTE, fontSize: 12 }}
                />
                <YAxis
                  type="number" dataKey="y"
                  domain={[(min) => Math.max(0, Math.floor(min - 5)), (max) => Math.min(100, Math.ceil(max + 5))]}
                  tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                  label={{ value: "Win %  ↑", angle: -90, position: "insideLeft", fill: C.MUTE, fontSize: 12, style: { textAnchor: "middle" } }}
                />
                <ZAxis range={[60, 60]} />
                {winScatter.seg && (
                  <ReferenceLine segment={winScatter.seg} stroke={C.BRAND} strokeDasharray="6 4" strokeOpacity={0.65} ifOverflow="extendDomain" />
                )}
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: C.LINE }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 160 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: d.isSelected ? C.BRAND : C.TXT, marginBottom: 6 }}>{d.abbr}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                          <span style={{ color: C.MUTE }}>Win %</span><span style={{ color: C.TXT, fontWeight: 700 }}>{d.y}%</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                          <span style={{ color: C.MUTE }}>{winScatter.zoneDef.label} {winScatter.unit === "FG%" ? "FG%" : "share"}</span>
                          <span style={{ color: C.TXT, fontWeight: 700 }}>{d.x}%</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter data={winScatter.pts} shape={renderWinDot} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
              Every {LEAGUE.name} team plotted by its {winScatter.zoneDef.label.toLowerCase()} {winScatter.unit === "FG%" ? "shooting accuracy" : "share of shot attempts"} against
              win %. The dashed line is the league trend; a steeper line and a larger correlation (r) mean shot profile in
              this zone tracks more strongly with winning. Toggle efficiency vs volume to compare “shoot it well” against “shoot it often.”
            </p>
          </>
        ) : (
          <Unavailable what="Team shooting profiles" detail={errors.shotZones} />
        )}
      </Section>
    </main>
  );
}
