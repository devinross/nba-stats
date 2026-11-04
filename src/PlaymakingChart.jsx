import React, { useMemo } from "react";
import { C, FONT_DISPLAY, FONT_BODY } from "./palette";
import StaleNote from "./StaleNote.jsx";
import SourceNote from "./SourceNote.jsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, LabelList, ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Playmaking: assists against the turnovers that come with them.
//
// The team page already says who passes (the assists leader card) and who the
// advanced feed credits with a high AST%. Neither says what a possession spent
// in a player's hands actually costs. Two bars per player answer that at a
// glance — a tall assist bar over a short turnover bar is a guard the offense
// can run through; two bars the same length is volume without a return.
//
// Built from the per-game logs already in the team file, so this draws with no
// extra request.
// ---------------------------------------------------------------------------

// Deep-bench lines are noise here: three minutes and one turnover reads as a
// catastrophic ratio. Same idea as the on/off chart's on-court floor.
const MIN_FLOOR = 100;

const sum = (arr, k) => arr.reduce((a, b) => a + b[k], 0);
const r1 = (n) => Math.round(n * 10) / 10;

// "Holland II" rather than "II": a generational suffix isn't a name anyone
// would recognise a player by.
const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i;
function lastName(name) {
  const parts = String(name).trim().split(" ");
  const last = parts.pop();
  return SUFFIX.test(last) && parts.length > 1 ? `${parts.pop()} ${last}` : last;
}

// The axis has room for about fourteen characters before a name runs off the
// left edge of the SVG, and the league has plenty that don't fit —
// Gilgeous-Alexander, Robinson-Earl, Caldwell-Pope and more.
// A hyphenated name shortens to its first half and an initial, which still
// reads as a person; anything else long enough to clip gets an ellipsis. The
// tooltip carries the full name either way.
const AXIS_MAX = 14;
function axisLabel(surname) {
  if (surname.length <= AXIS_MAX) return surname;
  const [head, next] = surname.split("-");
  if (next) return `${head}-${next[0]}.`;
  return `${surname.slice(0, AXIS_MAX - 1)}…`;
}

/** Season assist/turnover line per player, richest playmaker first. */
export function playmaking(roster) {
  return (roster || [])
    .map((p) => {
      const gp = p.logs.length;
      const ast = sum(p.logs, "ast");
      const tov = sum(p.logs, "tov");
      const min = sum(p.logs, "min");
      return {
        name: p.name,
        label: axisLabel(lastName(p.name)),
        gp,
        min,
        ast,
        tov,
        apg: gp > 0 ? r1(ast / gp) : 0,
        tpg: gp > 0 ? r1(tov / gp) : 0,
        // A player with assists and no turnovers has no ratio to speak of, not
        // an infinite one — the chart shows a dash rather than a fake number.
        ratio: tov > 0 ? Math.round((ast / tov) * 100) / 100 : null,
      };
    })
    .filter((p) => p.gp > 0 && p.min >= MIN_FLOOR)
    .sort((a, b) => b.apg - a.apg);
}

function PlaymakingTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const row = (label, val, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: C.MUTE }}>{label}</span>
      <span style={{ color: color || C.TXT, fontWeight: 700 }}>{val}</span>
    </div>
  );
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 190 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{d.name}</div>
      {row("Assists", `${d.apg} / game`, C.BRAND)}
      {row("Turnovers", `${d.tpg} / game`, C.ACCENT)}
      {row("Assist-to-turnover", d.ratio == null ? "—" : `${d.ratio.toFixed(2)}×`)}
      <div style={{ color: C.MUTE, marginTop: 6, fontSize: 11, lineHeight: 1.4 }}>
        {d.ast} assists · {d.tov} turnovers
        <br />
        {d.gp} games · {d.min} min
      </div>
    </div>
  );
}

// The number at the end of each assist bar is the ratio, not the bar's own
// length — a direct label earns its place by carrying something the axis can't.
function RatioLabel({ x, y, width, height, value }) {
  if (x == null || value == null) return null;
  return (
    <text
      x={x + width + 7}
      y={y + height / 2 + 4}
      fill={C.MUTE}
      fontSize={11}
      fontFamily={FONT_DISPLAY}
    >
      {Number(value).toFixed(2)}×
    </text>
  );
}

export default function PlaymakingChart({ roster, stale, source }) {
  const data = useMemo(() => playmaking(roster), [roster]);

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>Playmaking · assists vs turnovers</h2>
      <span style={{ fontSize: 11, color: C.MUTE }}>per game · label = assist-to-turnover</span>
    </div>
  );

  const shell = (children) => (
    <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
      {header}
      <StaleNote stale={stale} />
      {children}
      <SourceNote source={source} />
    </section>
  );

  if (!data.length) {
    return shell(
      <p style={{ color: C.MUTE, fontSize: 13, margin: "6px 0 0" }}>
        No player has cleared {MIN_FLOOR} minutes yet, so there's nothing here worth reading.
      </p>
    );
  }

  const best = data.reduce((a, b) => (b.ratio != null && (a.ratio == null || b.ratio > a.ratio) ? b : a), data[0]);

  return shell(
    <>
      <p style={{ fontSize: 12, color: C.MUTE, margin: "0 0 10px", lineHeight: 1.5 }}>
        Assists and turnovers per game for every player past {MIN_FLOOR} minutes, ordered by assists.
        The number beside each pair is his assist-to-turnover ratio — how many passes he turns into
        points for each possession he gives away.{" "}
        {best.ratio != null && (
          <>
            <strong style={{ color: C.TXT }}>{best.name}</strong> is the team's safest hand at{" "}
            <strong style={{ color: C.TXT }}>{best.ratio.toFixed(2)}×</strong>.
          </>
        )}
      </p>

      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 46 + 60)}>
        <BarChart
          data={data}
          layout="vertical"
          barGap={2}
          margin={{ top: 4, right: 52, bottom: 20, left: 4 }}
        >
          <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            // Recharts' default domain rounds up to a "nice" number well past
            // the longest bar, which leaves the chart looking half-empty on a
            // team with no high-volume passer.
            domain={[0, (dataMax) => Math.ceil(dataMax)]}
            tick={{ fill: C.MUTE, fontSize: 11 }}
            stroke={C.LINE}
            label={{ value: "per game", position: "bottom", offset: 0, fill: C.MUTE, fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={92}
            tick={{ fill: C.TXT, fontSize: 12, fontFamily: FONT_BODY }}
            stroke={C.LINE}
            interval={0}
          />
          <Tooltip content={<PlaymakingTooltip />} cursor={{ fill: C.HOVER_FILL }} />
          <Legend
            verticalAlign="top"
            align="right"
            height={26}
            iconType="circle"
            iconSize={9}
            wrapperStyle={{ fontSize: 12, color: C.MUTE }}
            formatter={(v) => <span style={{ color: C.MUTE }}>{v === "apg" ? "Assists" : "Turnovers"}</span>}
          />
          <Bar dataKey="apg" fill={C.BRAND} radius={[0, 4, 4, 0]} barSize={13} isAnimationActive={false}>
            <LabelList dataKey="ratio" content={<RatioLabel />} />
          </Bar>
          <Bar dataKey="tpg" fill={C.ACCENT} radius={[0, 4, 4, 0]} barSize={13} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
