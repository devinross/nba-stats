// ---------------------------------------------------------------------------
// Rotation pattern — when each player is actually on the floor.
//
// Every other chart on this site is a season total. This one is a clock: each
// row is a player, each column one minute of game time, and the shading is how
// often he's on the floor in that minute. Starters read as a dark band that
// breaks around the 6-8 minute mark; bench players read as the inverse. Where
// two rows are exact negatives of each other, you're looking at a substitution
// pair.
//
// The shading divides by the games that player appeared in, not the team's
// games, so someone who missed a month still reads as whatever role he plays
// when available. `gp` is on every row so a thin sample is visible rather than
// implied.
//
// The whole season averages away the thing a rotation actually does, which is
// change — so the same grid can be cut into blocks of the schedule (twenty
// games each, roughly a quarter of an 82-game season). The row set and its
// order are fixed by the season across every toggle, so switching blocks
// re-shades the grid instead of reshuffling it and only the pattern moves.
//
// Built from stats.nba.com's `gamerotation` endpoint (one request per game),
// aggregated by scripts/fetch-data.mjs into team.rotation.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from "react";
import { C, FONT_DISPLAY, FONT_BODY } from "./palette";
import { LEAGUE } from "./league.js";
import { MetricButton } from "./ShootingWinChart.jsx";
import StaleNote from "./StaleNote.jsx";
import SourceNote from "./SourceNote.jsx";

const MINUTES = LEAGUE.regulationMinutes; // regulation; overtime is in the totals, not the grid
const QUARTER = LEAGUE.periodMinutes;
const PERIOD_LABELS = Array.from({ length: LEAGUE.periods }, (_, i) => `Q${i + 1}`);

// Keep the grid readable: a player who appeared in a handful of games has a
// row driven by noise, and a deep-bench row of near-empty cells says nothing.
const MIN_SHARE_OF_GAMES = 0.25;
// Placeholder for a player who has no data in the selected block: the row keeps
// its slot, drawn as empty cells.
const EMPTY_ROW = new Array(MINUTES).fill(0);
const MIN_MPG = 5;

// White → brand plum. The ramp is the share of games on the floor, so it reads
// as one quantity and needs one hue (a rainbow here would imply categories).
function shade(pct) {
  if (pct <= 1) return C.PANEL_2;
  const t = Math.min(100, pct) / 100;
  // Perceptually the low end needs help or everything under ~30% looks blank.
  const e = Math.pow(t, 0.78);
  const from = [245, 240, 244]; // a hair off PANEL_2 so 1% isn't a hard edge
  const to = [58, 17, 54]; // C.BRAND
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * e)).join(",")})`;
}

const firstName = (n) => String(n).trim().split(" ")[0];
const lastName = (n) => {
  const parts = String(n).trim().split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
};

function clock(min) {
  // Minute index → the quarter and the time within it, the way a box score
  // would say it (minute 0 is "Q1 12:00", the tip).
  const q = Math.floor(min / QUARTER) + 1;
  const left = QUARTER - (min % QUARTER);
  return `Q${q} ${left}:00–${left - 1}:00`;
}

export default function RotationChart({ rotation, stale, source, selectedName, onPlayer, playerHref }) {
  const [hover, setHover] = useState(null);
  const [view, setView] = useState("all"); // "all" or a segment index

  const segments = (rotation && rotation.segments) || [];

  // The rows, decided once from the whole season and reused by every toggle.
  // A player is in the grid if he cleared the bar across the season *or* in
  // any single block — otherwise a midseason arrival who plays 30 minutes a
  // night for the last quarter would be missing from the block that's about
  // him. Order is always season minutes, so the toggles only change shading.
  const players = useMemo(() => {
    if (!rotation || !Array.isArray(rotation.players)) return [];
    const clears = (p, games) => p.gp >= Math.max(2, games * MIN_SHARE_OF_GAMES) && p.mpg >= MIN_MPG;
    const keep = new Set();
    for (const p of rotation.players) if (clears(p, rotation.games || 0)) keep.add(p.id);
    for (const s of segments) {
      for (const p of s.players) if (clears(p, s.games || 0)) keep.add(p.id);
    }
    return rotation.players.filter((p) => keep.has(p.id));
  }, [rotation, segments]);

  // The block being shown, and its per-player rows keyed for lookup. A player
  // missing from this map didn't appear in these games at all.
  const active = view === "all" ? null : segments[view];
  const rowById = useMemo(() => {
    const src = active ? active.players : (rotation && rotation.players) || [];
    return new Map(src.map((p) => [p.id, p]));
  }, [active, rotation]);

  if (!players.length) {
    return (
      <section style={panel}>
        <h2 style={heading}>Rotation pattern</h2>
        <p style={{ color: C.MUTE, fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          Rotation data isn't available for this team yet. It's built one game at a time from
          nba.com's play-by-play rotations, and a season fills in over several nightly refreshes.
        </p>
      </section>
    );
  }

  const teamGames = rotation.games || 0;
  const shownGames = active ? active.games : teamGames;

  return (
    <section style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h2 style={heading}>Rotation pattern · when each player is on the floor</h2>
        <span style={{ fontSize: 11, color: C.MUTE }}>
          darker = on the floor more often · {shownGames} game{shownGames === 1 ? "" : "s"}
          {active ? ` of games ${active.from}–${active.to}` : ""}
        </span>
      </div>
      <StaleNote stale={stale} />
      <p style={{ fontSize: 12, color: C.MUTE, margin: "0 0 12px", lineHeight: 1.5 }}>
        Each column is one minute of game time. Shading is the share of his own appearances that
        player was on the floor for that minute, so a starter who missed time still reads as a
        starter. Rows that are photo-negatives of each other are the substitution pairs.
      </p>

      {/* Season blocks. Twenty games is about a quarter of an 82-game season,
          which is the timescale a rotation actually changes on — an injury, a
          trade, a rookie earning minutes. The rows stay put between blocks so
          the difference is the only thing that moves. */}
      {segments.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <MetricButton active={view === "all"} onClick={() => setView("all")}>
            All games
          </MetricButton>
          {segments.map((s, i) => (
            <MetricButton key={s.from} active={view === i} onClick={() => setView(i)}>
              {s.from}–{s.to}
            </MetricButton>
          ))}
          <span style={{ fontSize: 11, color: C.MUTE, marginLeft: 2 }}>
            {active
              ? `${active.games} of games ${active.from}–${active.to} have rotation data`
              : `${teamGames} of ${rotation.scheduled || teamGames} games have rotation data`}
          </span>
        </div>
      )}

      {active && !active.games && (
        <p style={{ fontSize: 12, color: C.MUTE, margin: "0 0 12px", lineHeight: 1.5 }}>
          None of games {active.from}–{active.to} have rotation data yet — the per-game endpoint
          fills in over several nightly refreshes.
        </p>
      )}

      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, color: C.MUTE }}>
        <span>Share of games on floor</span>
        {[0, 25, 50, 75, 100].map((v) => (
          <span key={v} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: shade(v), border: `1px solid ${C.LINE}` }} />
            {v}%
          </span>
        ))}
      </div>

      <div className="scroll-x" style={{ overflowX: "auto", position: "relative" }}>
        <div style={{ minWidth: 640 }}>
          {players.map((p) => {
            const selected = p.name === selectedName;
            // `p` fixes the row's identity and position (season order); `row`
            // is what the selected block actually has for him, which may be
            // nothing at all.
            const row = rowById.get(p.id) || null;
            return (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "132px 1fr", gap: 10, alignItems: "center", marginBottom: 3 }}>
                <div
                  style={{
                    fontSize: 12,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: selected ? C.BRAND : row ? C.TXT : C.MUTE,
                    fontWeight: selected ? 700 : 400,
                  }}
                  title={
                    row
                      ? `${p.name} — ${row.gp} game${row.gp === 1 ? "" : "s"}, ${row.starts} start${row.starts === 1 ? "" : "s"}`
                      : `${p.name} — no appearances in these games`
                  }
                >
                  {/* A player can appear in the rotation but not the current
                      roster (mid-season trades), and there's no page to send
                      those to — so the link only exists when the slug does. */}
                  {onPlayer && playerHref && playerHref(p.name) ? (
                    <a
                      href={playerHref(p.name)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                        e.preventDefault();
                        onPlayer(p.name);
                      }}
                      style={{ color: "inherit", textDecoration: "none", borderBottom: `1px solid ${C.LINE}` }}
                    >
                      <span style={{ color: C.MUTE }}>{firstName(p.name).charAt(0)}. </span>
                      {lastName(p.name)}
                    </a>
                  ) : (
                    <>
                      <span style={{ color: C.MUTE }}>{firstName(p.name).charAt(0)}. </span>
                      {lastName(p.name)}
                    </>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${MINUTES}, 1fr)`, gap: 1.5 }}>
                  {/* An absent row keeps its slot rather than collapsing: "he
                      wasn't in this stretch of the season" is a fact about the
                      rotation, and losing the row would hide it. */}
                  {(row ? row.heat : EMPTY_ROW).map((v, m) => (
                    <div
                      key={m}
                      onMouseEnter={() => row && setHover({ p, row, m, v })}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        height: 18,
                        background: row ? shade(v) : "transparent",
                        border: row ? "none" : `1px dashed ${C.LINE}`,
                        borderRadius: 2,
                        // A hairline before each quarter keeps the eye from
                        // reading the 48 columns as one undifferentiated strip.
                        marginLeft: m > 0 && m % QUARTER === 0 ? 3 : 0,
                        cursor: "default",
                        outline: hover && hover.p.id === p.id && hover.m === m ? `2px solid ${C.BRAND_HI}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Quarter axis */}
          <div style={{ display: "grid", gridTemplateColumns: "132px 1fr", gap: 10, marginTop: 6 }}>
            <div />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${PERIOD_LABELS.length}, 1fr)`, fontSize: 11, color: C.MUTE }}>
              {PERIOD_LABELS.map((q) => (
                <div key={q} style={{ textAlign: "center" }}>{q}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hover readout — a fixed slot rather than a floating tooltip, so the
          grid never shifts and the number is always in the same place. */}
      <div style={{ minHeight: 20, marginTop: 10, fontSize: 12, color: C.MUTE, fontFamily: FONT_BODY }}>
        {hover ? (
          <>
            <span style={{ color: C.BRAND, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{hover.p.name}</span>
            {" · "}{clock(hover.m)}{" · on the floor in "}
            <strong style={{ color: C.TXT }}>{hover.v}%</strong>
            {` of his ${hover.row.gp} game${hover.row.gp === 1 ? "" : "s"}`}
            {active ? ` in games ${active.from}–${active.to}` : ""}
          </>
        ) : (
          "Hover a cell for the exact share."
        )}
      </div>

      {/* The same rotation as numbers: how a coach uses each player, rather
          than when. Sorted by minutes, like the grid. */}
      <div className="scroll-x" style={{ overflowX: "auto", marginTop: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr>
              {["Player", "GP", "Starts", "MPG", "Shifts/g", "Avg shift", "First sub in", "+/− per g"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const row = rowById.get(p.id);
              if (!row) {
                return (
                  <tr key={p.id}>
                    <td style={{ ...td, textAlign: "left", color: C.MUTE }}>{p.name}</td>
                    <td style={{ ...td, color: C.MUTE }} colSpan={7}>
                      no appearances in these games
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={p.id} style={{ background: p.name === selectedName ? C.PANEL_2 : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: p.name === selectedName ? 700 : 400 }}>{p.name}</td>
                  <td style={td}>{row.gp}</td>
                  <td style={td}>{row.starts}</td>
                  <td style={td}>{row.mpg}</td>
                  <td style={td}>{row.stints}</td>
                  <td style={td}>{row.avgStint}</td>
                  <td style={{ ...td, color: row.firstIn == null ? C.MUTE : C.TXT }}>
                    {row.firstIn == null ? "always starts" : `${row.firstIn} min`}
                  </td>
                  <td style={{ ...td, color: row.plus > 0 ? C.GOOD : row.plus < 0 ? C.LOSS_FG : C.MUTE }}>
                    {row.plus > 0 ? "+" : ""}{row.plus}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
        A shift is one unbroken stretch on the floor. "First sub in" is the average game clock of
        his first appearance in the games he came off the bench — blank for a player who has
        always started. Players under {MIN_MPG} minutes a game, or appearing in under a quarter of
        the team's games, are left out — unless they clear that bar inside one block, so a
        midseason arrival still shows up in the stretch he played. Rows and their order are fixed
        by the whole season, so switching blocks changes the shading and nothing else.
      </p>
      <SourceNote source={source} />
    </section>
  );
}

const panel = {
  background: C.PANEL,
  border: `1px solid ${C.LINE}`,
  borderRadius: 16,
  padding: "18px 20px",
  marginBottom: 22,
};
const heading = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: "0 0 6px" };
const th = {
  padding: "6px 8px",
  borderBottom: `1px solid ${C.SEPARATOR}`,
  color: C.MUTE,
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  whiteSpace: "nowrap",
};
const td = {
  padding: "6px 8px",
  borderBottom: `1px solid ${C.LINE}`,
  textAlign: "right",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
