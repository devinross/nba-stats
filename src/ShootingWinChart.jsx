import React, { useMemo, useState } from "react";
import { C, FONT_DISPLAY } from "./palette";
import { LEAGUE } from "./league.js";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// "Shooting profile vs winning": every team plotted by how well (or how often)
// it shoots from a zone against its win percentage, with the league trend line
// and the correlation behind it.
//
// It's a league-wide chart that happens to also be useful on a team page, so it
// lives here and both views render it — the team page passes `teamId` to pick
// its own dot out in plum, the league page passes nothing and every dot is
// equal. Its data (teamZoneWins) is in league.json, which every page already
// has, so neither view fetches anything extra to draw it.
// ---------------------------------------------------------------------------

const r1 = (n) => Math.round(n * 10) / 10;

// Zones for the scatter. "Three" combines both corners and above-the-break; the
// other three map to single court zones.
export const WIN_ZONES = [
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

export function MetricButton({ active, onClick, children }) {
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

// One dot per team; the selected team (if any) is larger and plum, the rest
// muted blue, each labelled by abbr.
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

export default function ShootingWinChart({ teamZoneWins = [], teamId = null }) {
  const [zone, setZone] = useState("three");
  const [mode, setMode] = useState("eff");

  const scatter = useMemo(() => {
    const zoneDef = WIN_ZONES.find((z) => z.key === zone) || WIN_ZONES[0];
    const pts = (teamZoneWins || [])
      .map((t) => ({
        abbr: t.abbr,
        teamId: t.teamId,
        y: t.winPct,
        x: zoneMetric(t.zones, zoneDef.parts, mode),
        isSelected: teamId != null && t.teamId === teamId,
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
    return { pts, zoneDef, r, seg, unit: mode === "eff" ? "FG%" : "shot share" };
  }, [teamZoneWins, zone, mode, teamId]);

  if (!scatter.pts.length) return null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {WIN_ZONES.map((z) => (
          <MetricButton key={z.key} active={zone === z.key} onClick={() => setZone(z.key)}>
            {z.label}
          </MetricButton>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <MetricButton active={mode === "eff"} onClick={() => setMode("eff")}>Efficiency</MetricButton>
        <MetricButton active={mode === "vol"} onClick={() => setMode("vol")}>Volume</MetricButton>
      </div>
      <div style={{ marginBottom: 6, fontSize: 13, color: C.MUTE }}>
        {scatter.zoneDef.label} {scatter.unit === "FG%" ? "FG%" : "shot share"} vs win %
        {scatter.r != null && (
          <>
            {" · "}
            <span style={{ color: Math.abs(scatter.r) >= 0.3 ? C.TXT : C.MUTE, fontWeight: 700 }}>
              correlation r = {scatter.r > 0 ? "+" : ""}{scatter.r.toFixed(2)}
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
            label={{ value: `${scatter.zoneDef.label} ${scatter.unit === "FG%" ? "FG%" : "shot share %"}  →`, position: "bottom", fill: C.MUTE, fontSize: 12 }}
          />
          <YAxis
            type="number" dataKey="y"
            domain={[(min) => Math.max(0, Math.floor(min - 5)), (max) => Math.min(100, Math.ceil(max + 5))]}
            tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
            label={{ value: "Win %  ↑", angle: -90, position: "insideLeft", fill: C.MUTE, fontSize: 12, style: { textAnchor: "middle" } }}
          />
          <ZAxis range={[60, 60]} />
          {scatter.seg && (
            <ReferenceLine segment={scatter.seg} stroke={C.BRAND} strokeDasharray="6 4" strokeOpacity={0.65} ifOverflow="extendDomain" />
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
                    <span style={{ color: C.MUTE }}>{scatter.zoneDef.label} {scatter.unit === "FG%" ? "FG%" : "share"}</span>
                    <span style={{ color: C.TXT, fontWeight: 700 }}>{d.x}%</span>
                  </div>
                </div>
              );
            }}
          />
          <Scatter data={scatter.pts} shape={renderWinDot} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
        Every {LEAGUE.name} team plotted by its {scatter.zoneDef.label.toLowerCase()} {scatter.unit === "FG%" ? "shooting accuracy" : "share of shot attempts"} against
        win %. The dashed line is the league trend; a steeper line and a larger correlation (r) mean shot profile in
        this zone tracks more strongly with winning. Toggle efficiency vs volume to compare “shoot it well” against “shoot it often.”
      </p>
    </>
  );
}
