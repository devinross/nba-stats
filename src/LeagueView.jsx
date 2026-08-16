import React, { useMemo, useState } from "react";
import { C, FONT_DISPLAY } from "./palette";
import { LEAGUE, conferenceOf } from "./league.js";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import TeamBadge from "./TeamBadge.jsx";
import ShootingWinChart from "./ShootingWinChart.jsx";
import StaleNote from "./StaleNote.jsx";
import SourceNote from "./SourceNote.jsx";
import { sourceFor } from "./sources.js";

// ---------------------------------------------------------------------------
// The league page: the season as a whole rather than one team. It's what "/"
// (and "/2023-24", for a finished season) render — today's slate, the
// conference standings, the league leaders, where every team sits on offense
// and defense, and links into all thirty team pages.
//
// Everything here comes out of league.json, which the app already downloads on
// every page. No team file is fetched to draw this page.
// ---------------------------------------------------------------------------

const r1 = (n) => Math.round(n * 10) / 10;
const signed = (v, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

/**
 * "Brandon Sanders" -> "B. Sanders". The leader cards sit five-across at desktop
 * width, which leaves ~150px for a name, a team abbreviation and a number on one
 * line — not enough for "Shai Gilgeous-Alexander". Everything after the first
 * word is kept, so "Jaren Jackson Jr." stays "J. Jackson Jr." rather than losing
 * the suffix that distinguishes him.
 */
function shortName(full) {
  const parts = String(full).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(" ")}`;
}

// The NBA schedules against Eastern time, so "what's on today" has to be asked
// in the league's timezone — otherwise a visitor in London sees tomorrow's slate
// all evening, and one in Honolulu sees yesterday's. en-CA formats as
// YYYY-MM-DD, which is exactly the key the scoreboard rows are stored under.
const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const todayET = () => ET_DAY.format(new Date());

/** "2026-01-13" -> a Date at local noon, safe to format without a day slipping. */
const dayDate = (iso) => new Date(`${iso}T12:00:00`);

/** "Today", "Tomorrow", "Yesterday", or "Thursday, Jan 13". */
function dayLabel(iso) {
  const today = todayET();
  if (iso === today) return "Today";
  const delta = Math.round((dayDate(iso) - dayDate(today)) / 86400000);
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return dayDate(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const dayDetail = (iso) =>
  dayDate(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/** A tip-off in the visitor's own timezone: "7:00 PM". */
function tipTime(tip) {
  if (!tip) return "";
  const d = new Date(tip);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

// A team, as a link to its page. Ordinary <a> with a real href so a crawler can
// follow it and cmd-click opens a tab; a plain left click is taken over by the
// app so navigation stays instant.
function TeamLink({ team, href, onGo, children, style }) {
  if (!team) return null;
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onGo(team.id);
      }}
      style={{ color: C.TXT, display: "inline-flex", alignItems: "center", gap: 8, ...style }}
    >
      {children}
    </a>
  );
}

// ----- today's games --------------------------------------------------------

// One matchup: away over home, the way a scoreboard reads. Scheduled games show
// the tip-off in the visitor's local time; finished ones show the score with the
// winner carrying the weight.
function GameCard({ game, byId, recordOf, teamHref, onGo }) {
  const away = byId.get(game.away);
  const home = byId.get(game.home);
  if (!away || !home) return null;

  const played = game.status !== 1 && game.homeScore != null && game.awayScore != null;
  const live = game.status === 2;
  const winner = !played ? null : game.homeScore > game.awayScore ? game.home : game.away;

  const side = (team, score) => {
    const rec = recordOf(team.id);
    const won = winner === team.id;
    const lost = played && !won;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamLink team={team} href={teamHref(team)} onGo={onGo} style={{ flex: 1, minWidth: 0 }}>
          <TeamBadge team={team} size={30} />
          <span style={{ minWidth: 0 }}>
            <span style={{ fontWeight: won ? 700 : 600, fontSize: 14, color: lost ? C.MUTE : C.TXT, whiteSpace: "nowrap" }}>
              {team.teamName}
            </span>
            {rec && (
              <span style={{ fontSize: 11, color: C.MUTE, marginLeft: 6, whiteSpace: "nowrap" }}>
                {rec.w}-{rec.l}
              </span>
            )}
          </span>
        </TeamLink>
        {played && (
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: lost ? C.MUTE : C.TXT }}>
            {score}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        background: C.PANEL_2,
        border: `1px solid ${C.LINE}`,
        borderRadius: 14,
        padding: "12px 14px",
        display: "grid",
        gap: 10,
        minWidth: 250,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11, letterSpacing: 1,
            textTransform: "uppercase", color: live ? C.LOSS_FG : played ? C.MUTE : C.BRAND,
          }}
        >
          {live ? "Live" : played ? "Final" : tipTime(game.tip) || "TBD"}
        </span>
        {game.tv && <span style={{ fontSize: 11, color: C.MUTE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{game.tv}</span>}
      </div>
      {side(away, game.awayScore)}
      {side(home, game.homeScore)}
      <div style={{ fontSize: 11, color: C.MUTE, borderTop: `1px solid ${C.LINE}`, paddingTop: 7 }}>
        at {home.city || home.teamName}
      </div>
    </div>
  );
}

// The slate, with a day stepper. Opens on today when the league is playing
// today, and on the next day with games when it isn't — the schedule has dark
// days, and an empty "Today" panel is a worse answer than "next up, Thursday".
function Scoreboard({ scoreboard, byId, recordOf, teamHref, onGo, stale, source }) {
  const dates = useMemo(() => [...new Set(scoreboard.map((g) => g.date))].sort(), [scoreboard]);
  const openAt = useMemo(() => {
    if (!dates.length) return 0;
    const today = todayET();
    const next = dates.findIndex((d) => d >= today);
    return next >= 0 ? next : dates.length - 1;
  }, [dates]);
  const [i, setI] = useState(openAt);

  if (!dates.length) return null;
  const day = dates[Math.min(i, dates.length - 1)];
  const games = scoreboard.filter((g) => g.date === day);
  const isToday = day === todayET();

  const step = (delta) => setI((v) => Math.min(dates.length - 1, Math.max(0, v + delta)));
  const arrow = (delta, label) => {
    const at = i + delta;
    const disabled = at < 0 || at > dates.length - 1;
    return (
      <button
        type="button"
        onClick={() => step(delta)}
        disabled={disabled}
        aria-label={label}
        className="pill-toggle"
        style={{
          appearance: "none", cursor: disabled ? "default" : "pointer",
          width: 30, height: 30, borderRadius: 999, lineHeight: 1,
          border: `1px solid ${C.LINE}`, background: "transparent",
          color: disabled ? C.LINE : C.TXT, fontSize: 13,
        }}
      >
        {delta < 0 ? "‹" : "›"}
      </button>
    );
  };

  return (
    <Section
      title={
        <>
          {dayLabel(day)}
          {!isToday && <span style={{ color: C.MUTE, fontWeight: 400 }}> · {dayDetail(day)}</span>}
        </>
      }
      hint={`${games.length} game${games.length === 1 ? "" : "s"} · times in your timezone`}
      stale={stale}
      source={source}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {arrow(-1, "Previous day")}
        {arrow(1, "Next day")}
        <span style={{ fontSize: 12, color: C.MUTE }}>
          {dayDate(day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>
      {games.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
            gap: 12,
          }}
        >
          {games.map((g) => (
            <GameCard key={g.id} game={g} byId={byId} recordOf={recordOf} teamHref={teamHref} onGo={onGo} />
          ))}
        </div>
      ) : (
        <p style={{ color: C.MUTE, fontSize: 13, margin: 0 }}>No games scheduled.</p>
      )}
    </Section>
  );
}

// ----- standings ------------------------------------------------------------

const STREAK = (n) => (!n ? "—" : `${n > 0 ? "W" : "L"}${Math.abs(n)}`);

const dash = <span style={{ color: C.MUTE }}>—</span>;
const one = (v) => (v == null ? dash : v.toFixed(1));

// The standings columns, in order. `best` is which end of the column is the
// good end — it decides which way a first click sorts, so clicking DEF puts the
// best defense on top rather than the worst. `sort` is the value sorted on when
// it isn't the displayed number (a win-loss pair sorts on its win percentage).
const COLUMNS = [
  { key: "w", label: "W", best: "high", value: (t) => t.w, cell: (t) => t.w },
  { key: "l", label: "L", best: "low", value: (t) => t.l, cell: (t) => t.l },
  {
    key: "pct", label: "PCT", best: "high", value: (t) => t.pct,
    cell: (t) => t.pct.toFixed(3).replace(/^0/, ""),
  },
  {
    key: "gb", label: "GB", best: "low", value: (t) => t.gb,
    cell: (t) => (t.gb ? t.gb : dash),
  },
  { key: "off", label: "OFF", best: "high", value: (t) => t.off, cell: (t) => one(t.off) },
  { key: "def", label: "DEF", best: "low", value: (t) => t.def, cell: (t) => one(t.def) },
  {
    key: "net", label: "NET", best: "high", value: (t) => t.net,
    cell: (t) => (t.net == null ? dash : signed(t.net)),
    color: (t) => (t.net == null ? C.MUTE : t.net >= 0 ? C.GOOD : C.LOSS_FG),
  },
  { key: "pace", label: "PACE", best: "high", value: (t) => t.pace, cell: (t) => one(t.pace) },
  {
    key: "diff", label: "DIFF", best: "high", value: (t) => t.diff,
    cell: (t) => (t.diff == null ? dash : signed(t.diff)),
    color: (t) => (t.diff == null ? C.MUTE : t.diff >= 0 ? C.GOOD : C.LOSS_FG),
  },
  {
    key: "l10", label: "L10", best: "high",
    // Ties on last-10 record break on point differential rather than staying in
    // whatever order they happened to be in.
    value: (t) => (t.l10w + t.l10l ? t.l10w / (t.l10w + t.l10l) : null),
    cell: (t) => `${t.l10w}-${t.l10l}`,
    weight: 600,
  },
  {
    key: "streak", label: "STRK", best: "high", value: (t) => t.streak,
    cell: (t) => STREAK(t.streak),
    color: (t) => (t.streak > 0 ? C.GOOD : t.streak < 0 ? C.LOSS_FG : C.MUTE),
  },
];

// Which of those a season can actually fill: a season fetched before standings
// were part of the data has its ratings but no W-L.
const RECORD_KEYS = new Set(["w", "l", "pct", "gb", "diff", "l10", "streak"]);

// Seeds 1-6 are in the bracket outright and 7-10 go to the play-in, so a
// conference table has two lines in it rather than one.
const GUARANTEED_SEEDS = 6;

/**
 * The standings, sortable by any column. It opens in standings order — win
 * percentage, the way the league seeds — and clicking a header re-sorts on that
 * column, best-first. Sorting by anything else drops the playoff cutlines, since
 * a table ordered by pace isn't a bracket.
 */
function StandingsTable({ rows, byId, teamHref, onGo, hasRecords, seeded }) {
  const columns = useMemo(
    () => COLUMNS.filter((c) => (hasRecords ? true : !RECORD_KEYS.has(c.key))),
    [hasRecords]
  );
  const defaultKey = hasRecords ? "pct" : "net";
  const [sort, setSort] = useState({ key: defaultKey, dir: -1 }); // -1 = best first

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0];
    if (!col) return rows;
    // "Best first" means descending for most columns and ascending for the ones
    // where low is good (losses, games behind, defensive rating).
    const flip = col.best === "low" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = col.value(a), bv = col.value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // teams without the number sort to the bottom
      if (bv == null) return -1;
      if (av !== bv) return (av - bv) * sort.dir * flip;
      // Same value: keep the standings order underneath, so the table never
      // shuffles arbitrarily between renders.
      return rows.indexOf(a) - rows.indexOf(b);
    });
  }, [rows, columns, sort]);

  const isDefault = sort.key === defaultKey && sort.dir === -1;
  // Cutlines only mean anything on a conference table in seeding order: the
  // league-wide fallback isn't a bracket, and neither is a table sorted by pace.
  const showCutlines = seeded && hasRecords && isDefault;

  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: -1 }));

  const cell = { padding: "9px 10px", borderBottom: `1px solid ${C.LINE}55` };
  const num = { ...cell, textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 };
  const th = { padding: "8px 10px", fontWeight: 600, borderBottom: `1px solid ${C.LINE}`, whiteSpace: "nowrap" };

  return (
    <div className="scroll-x">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: hasRecords ? 840 : 480 }}>
        <thead>
          <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
            <th style={{ ...th, textAlign: "left", width: 34 }}>#</th>
            <th style={{ ...th, textAlign: "left" }}>Team</th>
            {columns.map((c) => {
              const active = sort.key === c.key;
              return (
                <th key={c.key} style={{ ...th, textAlign: "right", padding: 0 }} aria-sort={active ? (sort.dir === -1 ? "descending" : "ascending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    title={`Sort by ${c.label}`}
                    style={{
                      appearance: "none", background: "transparent", border: "none", cursor: "pointer",
                      font: "inherit", letterSpacing: "inherit", textTransform: "inherit",
                      color: active ? C.BRAND : C.MUTE, fontWeight: active ? 700 : 600,
                      padding: "8px 10px", width: "100%", textAlign: "right", whiteSpace: "nowrap",
                    }}
                  >
                    {c.label}
                    <span aria-hidden="true" style={{ marginLeft: 3, opacity: active ? 1 : 0.25 }}>
                      {active && sort.dir === 1 ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, idx) => {
            const team = byId.get(t.teamId);
            if (!team) return null;
            // Six seeds are in the bracket outright and 7-10 play in, so a
            // conference in seeding order gets a faint line under the sixth and
            // a solid one under the tenth.
            const seed = idx + 1;
            const bracket = showCutlines && seed === GUARANTEED_SEEDS && sorted.length > GUARANTEED_SEEDS;
            const playin = showCutlines && seed === LEAGUE.playoffSpots && sorted.length > LEAGUE.playoffSpots;
            const rule = playin ? C.SEPARATOR : bracket ? `${C.SEPARATOR}66` : null;
            return (
              <tr key={t.teamId} style={rule ? { boxShadow: `inset 0 -2px 0 0 ${rule}` } : null}>
                <td style={{ ...cell, color: C.MUTE, fontFamily: FONT_DISPLAY, width: 34 }}>{seed}</td>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>
                  <TeamLink team={team} href={teamHref(team)} onGo={onGo}>
                    <TeamBadge team={team} size={24} />
                    <span style={{ fontWeight: 600 }}>{team.name}</span>
                  </TeamLink>
                </td>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      ...num,
                      fontWeight: c.weight || 700,
                      color: c.color ? c.color(t) : C.TXT,
                      background: sort.key === c.key ? C.PANEL_2 : undefined,
                    }}
                  >
                    {c.cell(t)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The heading over one conference's table. */
function ConferenceHeading({ children, first }) {
  return (
    <h3
      style={{
        fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em",
        textTransform: "uppercase", color: C.MUTE, margin: first ? "0 0 8px" : "26px 0 8px",
      }}
    >
      {children}
    </h3>
  );
}

// ----- league leaders -------------------------------------------------------

const LEADER_CATS = [
  { key: "pts", label: "Points", unit: "ppg" },
  { key: "reb", label: "Rebounds", unit: "rpg" },
  { key: "ast", label: "Assists", unit: "apg" },
  { key: "stl", label: "Steals", unit: "spg" },
  { key: "blk", label: "Blocks", unit: "bpg" },
];

function LeaderCard({ cat, rows, byId, playerHref, onPlayer }) {
  if (!rows || !rows.length) return null;
  const [top, ...rest] = rows;
  const teamOf = (id) => byId.get(id);

  const name = (row, text = row.name) => {
    const href = playerHref(row.teamId, row.name);
    const label = <span title={row.name}>{text}</span>;
    if (!href) return label;
    return (
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onPlayer(row.teamId, row.name);
        }}
        style={{ color: C.TXT }}
      >
        {label}
      </a>
    );
  };

  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.BRAND, fontWeight: 700 }}>
        {cat.label}
      </div>
      {/* The leader's name gets the card's full width — five of these sit side
          by side at desktop width, and a name beside the number truncates. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        {teamOf(top.teamId) && <TeamBadge team={teamOf(top.teamId)} size={26} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name(top)}
          </div>
          <div style={{ fontSize: 11, color: C.MUTE, lineHeight: 1.2 }}>{(teamOf(top.teamId) || {}).abbr}</div>
        </div>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, lineHeight: 1, marginTop: 8 }}>
        {top.v.toFixed(1)}
        <span style={{ fontSize: 10, color: C.MUTE, fontWeight: 600, marginLeft: 3 }}>{cat.unit}</span>
      </div>
      {/* minmax(0, 1fr): a grid column defaults to max-content, so without this
          the widest name sets the column width and the row overflows the card —
          the number ends up painted outside its right edge. */}
      <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 5 }}>
        {rest.map((row, i) => (
          <li key={row.name} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
            <span style={{ color: C.MUTE, fontFamily: FONT_DISPLAY, width: 12 }}>{i + 2}</span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {name(row, shortName(row.name))}
              <span style={{ color: C.MUTE, marginLeft: 6 }}>{(teamOf(row.teamId) || {}).abbr}</span>
            </span>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{row.v.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ----- offense / defense landscape -----------------------------------------

// A team is its badge on this chart: a plotted emoji reads as the team at a
// glance where a colored dot needs a legend.
const renderTeamDot = ({ cx, cy, payload }) => {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={13} fill={C.PANEL} stroke={C.LINE} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={13}>
        {payload.emoji}
      </text>
      <text x={cx} y={cy + 24} textAnchor="middle" fontSize={10} fill={C.MUTE} fontFamily={FONT_DISPLAY} fontWeight={700}>
        {payload.abbr}
      </text>
    </g>
  );
};

function LandscapeTooltip({ active, payload }) {
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
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, marginBottom: 6 }}>{d.name}</div>
      {row("Offense", d.x)}
      {row("Defense", d.y)}
      {row("Net rating", signed(d.net), d.net >= 0 ? C.GOOD : C.LOSS_FG)}
      {row("Pace", d.pace)}
    </div>
  );
}

// ----- the page -------------------------------------------------------------

export default function LeagueView({
  teams = [],
  standings = [],
  scoreboard = [],
  leaders = null,
  teamRanks = null,
  teamZoneWins = [],
  teamHref,
  playerHref,
  onPickTeam,
  onPickPlayer,
  stale = {},
  season,
  seasonName,
  final = false,
}) {
  const src = useMemo(() => (key) => sourceFor(key, { season }), [season]);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const netById = useMemo(
    () => new Map(((teamRanks && teamRanks.teams) || []).map((t) => [t.teamId, t])),
    [teamRanks]
  );

  // Standings rows carry their ratings too, so the table can be read as one
  // thing — who's winning, and whether the underlying numbers agree — and can
  // be re-sorted by any of them.
  const rows = useMemo(() => {
    if (standings.length) {
      return standings.map((t) => {
        const rank = netById.get(t.teamId) || {};
        return {
          ...t,
          off: rank.off ?? null,
          def: rank.def ?? null,
          net: rank.net ?? null,
          pace: rank.pace ?? null,
        };
      });
    }
    // A season fetched before standings existed still has its ratings, so the
    // table falls back to those rather than disappearing.
    return [...((teamRanks && teamRanks.teams) || [])].sort((a, b) => b.net - a.net);
  }, [standings, teamRanks, netById]);
  const hasRecords = standings.length > 0;

  // The NBA seeds by conference, so that's how the table is cut. `conf` rides
  // along on the standings rows; a row without one (a team the conference map
  // doesn't know) would silently vanish from both halves, so the split is only
  // used when it accounts for every row.
  const conferences = useMemo(() => {
    if (!hasRecords) return null;
    const east = rows.filter((t) => (t.conf || conferenceOf(t.teamId)) === "East");
    const west = rows.filter((t) => (t.conf || conferenceOf(t.teamId)) === "West");
    return east.length + west.length === rows.length && east.length && west.length
      ? [["Eastern Conference", east], ["Western Conference", west]]
      : null;
  }, [rows, hasRecords]);

  const recordOf = useMemo(() => {
    const map = new Map(standings.map((t) => [t.teamId, t]));
    return (id) => map.get(id) || null;
  }, [standings]);

  const landscape = useMemo(
    () =>
      ((teamRanks && teamRanks.teams) || []).map((t) => {
        const team = byId.get(t.teamId);
        return {
          name: t.name, abbr: t.abbr, emoji: team ? team.emoji : "🏀",
          x: t.off, y: t.def, net: t.net, pace: t.pace,
        };
      }),
    [teamRanks, byId]
  );
  const avg = useMemo(() => {
    if (!landscape.length) return null;
    return {
      off: r1(landscape.reduce((a, t) => a + t.x, 0) / landscape.length),
      def: r1(landscape.reduce((a, t) => a + t.y, 0) / landscape.length),
    };
  }, [landscape]);

  return (
    <main className="hf-container" style={{ paddingTop: 22, paddingBottom: 10 }}>
      {scoreboard.length > 0 && (
        <Scoreboard
          scoreboard={scoreboard}
          byId={byId}
          recordOf={recordOf}
          teamHref={teamHref}
          onGo={onPickTeam}
          stale={stale.scoreboard}
          source={src("scoreboard")}
        />
      )}

      {rows.length > 0 && (
        <Section
          title={hasRecords ? "Standings" : "League ratings"}
          hint={
            hasRecords
              ? conferences
                ? "net = points per 100 possessions · lines mark the bracket and the play-in"
                : "net = points per 100 possessions"
              : "points per 100 possessions"
          }
          stale={hasRecords ? stale.standings : stale.teamRanks}
          source={src(hasRecords ? "standings" : "teamRanks")}
        >
          {conferences ? (
            conferences.map(([label, confRows], i) => (
              <div key={label}>
                <ConferenceHeading first={i === 0}>{label}</ConferenceHeading>
                <StandingsTable rows={confRows} byId={byId} teamHref={teamHref} onGo={onPickTeam} hasRecords seeded />
              </div>
            ))
          ) : (
            <StandingsTable rows={rows} byId={byId} teamHref={teamHref} onGo={onPickTeam} hasRecords={hasRecords} seeded={false} />
          )}
        </Section>
      )}

      {leaders && LEADER_CATS.some((c) => (leaders[c.key] || []).length > 0) && (
        <Section
          title={`${seasonName} league leaders`}
          hint="per game · qualified players only"
          stale={stale.leaders}
          source={src("leaders")}
        >
          {/* 190px is what lets all five categories sit on one row at full
              width; they wrap to two and then one as the page narrows. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            {LEADER_CATS.map((cat) => (
              <LeaderCard
                key={cat.key}
                cat={cat}
                rows={leaders[cat.key]}
                byId={byId}
                playerHref={playerHref}
                onPlayer={onPickPlayer}
              />
            ))}
          </div>
        </Section>
      )}

      {landscape.length > 0 && (
        <Section
          title="Offense vs defense"
          hint="each team by its two ratings · up and to the right is better"
          stale={stale.teamRanks}
          source={src("teamRanks")}
        >
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 16, right: 28, bottom: 30, left: 6 }}>
              <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" />
              <XAxis
                type="number" dataKey="x"
                domain={[(min) => Math.floor(min - 2), (max) => Math.ceil(max + 2)]}
                tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                label={{ value: "Offensive rating  →", position: "bottom", fill: C.MUTE, fontSize: 12 }}
              />
              <YAxis
                type="number" dataKey="y"
                // Reversed: a low defensive rating is a good defense, and on a
                // plain axis the best teams would sit at the bottom.
                reversed
                domain={[(min) => Math.floor(min - 2), (max) => Math.ceil(max + 2)]}
                tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                label={{ value: "←  Defensive rating", angle: -90, position: "insideLeft", fill: C.MUTE, fontSize: 12, style: { textAnchor: "middle" } }}
              />
              <ZAxis range={[80, 80]} />
              {avg && <ReferenceLine x={avg.off} stroke={C.SEPARATOR} strokeDasharray="5 4" />}
              {avg && <ReferenceLine y={avg.def} stroke={C.SEPARATOR} strokeDasharray="5 4" />}
              <Tooltip cursor={{ strokeDasharray: "3 3", stroke: C.LINE }} content={<LandscapeTooltip />} />
              <Scatter data={landscape} shape={renderTeamDot} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
            Every team's points scored and allowed per 100 possessions. The dashed lines are the league average, so the
            top-right quadrant is teams above it at both ends{avg ? ` (${avg.off} scored, ${avg.def} allowed)` : ""}.
            Distance from the corner is roughly net rating — the same number the standings column carries.
          </p>
        </Section>
      )}

      {teamZoneWins.length > 0 && (
        <Section
          title="Shooting profile vs winning"
          hint="each dot = a team"
          stale={stale.teamZoneWins}
          source={src("teamZoneWins")}
        >
          <ShootingWinChart teamZoneWins={teamZoneWins} />
        </Section>
      )}

      <Section title="All teams" hint={`${teams.length} teams · ${seasonName}${final ? " · final" : ""}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
          {teams.map((team) => {
            const rec = recordOf(team.id);
            const rank = netById.get(team.id);
            return (
              <TeamLink
                key={team.id}
                team={team}
                href={teamHref(team)}
                onGo={onPickTeam}
                style={{
                  background: C.PANEL_2,
                  border: `1px solid ${C.LINE}`,
                  borderRadius: 14,
                  padding: "12px 14px",
                  gap: 12,
                }}
              >
                <TeamBadge team={team} size={38} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {team.teamName}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: C.MUTE }}>
                    {rec ? `${rec.w}-${rec.l}` : team.city}
                    {rank ? (
                      <>
                        {" · "}
                        <span style={{ color: rank.net >= 0 ? C.GOOD : C.LOSS_FG, fontWeight: 700 }}>{signed(rank.net)}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </TeamLink>
            );
          })}
        </div>
      </Section>
    </main>
  );
}
