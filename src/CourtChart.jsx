import React, { useMemo, useState } from "react";
import { C, FONT_DISPLAY } from "./palette";
import { LEAGUE } from "./league.js";

// ---------------------------------------------------------------------------
// CourtChart — a schematic SVG half-court that colors six shot zones either by
// shooting efficiency (FG% vs the league average for that zone) or by shot volume
// (share of attempts). FG% and makes/attempts are always printed on each zone.
//
// Zones come from the leaguedash*shotlocations feed as { z, m, a } where m/a are
// season totals; `league` is the same shape aggregated across the whole NBA and
// is the baseline the efficiency view compares against.
// ---------------------------------------------------------------------------

const r1 = (n) => Math.round(n * 10) / 10;
const pctOf = (m, a) => (a > 0 ? r1((m / a) * 100) : null);

// Linear interpolate between two #rrggbb colors. t in [0,1].
function hexLerp(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

// Court coordinates run 0–500 x 0–470 with the baseline at the bottom, so the
// scale is 10 units to the foot (a half court is 50ft × 47ft) and the hoop sits
// at (250, 425). The lines below are a schematic rather than a survey — each is
// within about a foot of the real thing:
//
//   3-point arc apex   drawn 24.5ft   ·  NBA 23.75ft
//   corner 3 line      drawn 20.5ft   ·  NBA 22ft
//   paint              drawn 15×18.5  ·  NBA 16×19ft
//   free-throw arc     drawn 5.4ft    ·  NBA 6ft
//
// The corner line is the loosest of them, deliberately: painting it at a true
// 22ft leaves a 3ft-wide strip, too narrow for the corner zones' labels to sit
// in. None of this moves a number — which zone a shot belongs to is decided by
// the API's own zone definitions, not by where this file paints the line.
//
// Zone label text + anchor point. The rendered viewBox is padded 8 units wider
// on each side (see the <svg> below) so edge labels aren't clipped.
const ZONE_META = {
  ra: { label: "Restricted", x: 250, y: 398 },
  paint: { label: "Paint", x: 250, y: 345 },
  mid: { label: "Mid-range", x: 250, y: 232 },
  lc3: { label: "L corner", x: 24, y: 388 },
  rc3: { label: "R corner", x: 476, y: 388 },
  atb3: { label: "Above break", x: 250, y: 92 },
};

// Filled zone shapes. Drawn in this order so paint sits on top of the mid-range
// horseshoe and the restricted area sits on top of the paint.
const ZONE_PATHS = [
  ["mid", "M45,300 L45,470 L455,470 L455,300 Q250,60 45,300 Z"],
  ["atb3", "M0,0 L0,300 L45,300 Q250,60 455,300 L500,300 L500,0 Z"],
  ["lc3", "M0,300 L45,300 L45,470 L0,470 Z"],
  ["rc3", "M455,300 L500,300 L500,470 L455,470 Z"],
  ["paint", "M175,285 L325,285 L325,470 L175,470 Z"],
  // Restricted area: straight sides up from the baseline, then a semicircle that
  // bulges toward center court (same direction as the 3-point arc).
  ["ra", "M204,470 L204,425 A46,46 0 0,1 296,425 L296,470 Z"],
];

// Aggregate rows derived from the base zones (not drawn on the court): corner 3s
// combine both corners, all 3s add the above-the-break threes.
const ZONE_AGGREGATES = {
  c3: ["lc3", "rc3"],
  all3: ["lc3", "rc3", "atb3"],
};

// Display order + full names for the numbers table. The first six match the
// court zones; the last two are aggregate totals separated by a divider.
const ZONE_ROWS = [
  ["ra", "Restricted area"],
  ["paint", "Paint (non-RA)"],
  ["mid", "Mid-range"],
  ["lc3", "Left corner 3"],
  ["rc3", "Right corner 3"],
  ["atb3", "Above the break 3"],
  ["c3", "Corner 3 (L+R)", true],
  ["all3", "All 3-pointers", true],
];

// The six court zones (everything in ZONE_ROWS that isn't an aggregate total).
const BASE_ZONE_KEYS = ZONE_ROWS.filter((r) => !r[2]).map((r) => r[0]);

// Resolve a zone's makes/attempts, summing component zones for aggregate keys.
function zoneTotals(byZone, key) {
  const parts = ZONE_AGGREGATES[key];
  if (!parts) return byZone.get(key) || null;
  let m = 0, a = 0;
  for (const p of parts) {
    const z = byZone.get(p);
    if (z) { m += z.m; a += z.a; }
  }
  return { m, a };
}

// Total attempts across the six base zones (used to turn raw attempts into a
// shot-distribution share for the volume comparison).
function totalAttempts(byZone) {
  let a = 0;
  for (const k of BASE_ZONE_KEYS) { const z = byZone.get(k); if (z) a += z.a; }
  return a;
}

// Per-zone numbers table: FG% and shot share, each shown as a difference vs the
// baseline (the whole league for teams, same-position peers for players).
// `baselineLabel` names the baseline in the column headers ("lg", "G", "F").
// Reused by the Team and Players tabs next to the court.
export function ZoneTable({ zones, league, baselineLabel = "lg" }) {
  const lByZone = new Map((league || []).map((z) => [z.z, z]));
  const byZone = new Map((zones || []).map((z) => [z.z, z]));
  const totAtt = totalAttempts(byZone);
  const baseAtt = totalAttempts(lByZone);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
          {["Zone", "FG%", "FGM/FGA", `FG% vs ${baselineLabel}`, `Vol vs ${baselineLabel}`].map((h, k) => (
            <th key={h} style={{ padding: "8px 8px", textAlign: k === 0 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ZONE_ROWS.map(([key, name, agg], i) => {
          const z = zoneTotals(byZone, key);
          const lz = zoneTotals(lByZone, key);
          const pct = z && z.a ? pctOf(z.m, z.a) : null;
          const lp = lz && lz.a ? pctOf(lz.m, lz.a) : null;
          const effDelta = pct != null && lp != null ? r1(pct - lp) : null;
          // Volume = this zone's share of all shot attempts, compared with the
          // baseline's share for the same zone (percentage points).
          const share = z && totAtt > 0 ? (z.a / totAtt) * 100 : null;
          const baseShare = lz && baseAtt > 0 ? (lz.a / baseAtt) * 100 : null;
          const volDelta = share != null && baseShare != null ? r1(share - baseShare) : null;
          const firstAgg = agg && !ZONE_ROWS[i - 1]?.[2];
          return (
            <tr key={key} style={{ borderBottom: `1px solid ${C.LINE}55`, borderTop: firstAgg ? `2px solid ${C.LINE}` : undefined }}>
              <td style={{ padding: "9px 8px", fontWeight: 700, whiteSpace: "nowrap", color: agg ? C.MUTE : C.TXT }}>{name}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{pct == null ? "—" : `${pct}%`}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{z && z.a ? `${z.m}/${z.a}` : "—"}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: effDelta == null ? C.MUTE : effDelta >= 0 ? C.GOOD : C.LOSS_FG }}>
                {effDelta == null ? "—" : `${effDelta > 0 ? "+" : ""}${effDelta}`}
              </td>
              <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: volDelta == null ? C.MUTE : C.TXT }}>
                {volDelta == null ? "—" : `${volDelta > 0 ? "+" : ""}${volDelta}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ToggleButton({ active, onClick, children }) {
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

export default function CourtChart({ zones, league, baseDesc = `the ${LEAGUE.name} average` }) {
  const [mode, setMode] = useState("eff"); // "eff" = vs baseline · "vol" = shot share

  const byZone = useMemo(() => {
    const m = new Map();
    for (const z of zones || []) m.set(z.z, z);
    return m;
  }, [zones]);

  const leagueByZone = useMemo(() => {
    const m = new Map();
    for (const z of league || []) m.set(z.z, z);
    return m;
  }, [league]);

  const totalAtt = useMemo(
    () => (zones || []).reduce((s, z) => s + z.a, 0),
    [zones]
  );
  const maxAtt = useMemo(
    () => Math.max(1, ...(zones || []).map((z) => z.a)),
    [zones]
  );

  if (!zones || !zones.length) return null;

  // Fill color + opacity for a zone under the active mode.
  const fillFor = (key) => {
    const z = byZone.get(key);
    if (!z || z.a === 0) return { fill: C.PANEL_2, opacity: 0.3 };
    if (mode === "vol") {
      return { fill: C.BRAND, opacity: 0.14 + 0.6 * (z.a / maxAtt) };
    }
    // Efficiency: this zone's FG% minus the league's FG% for the same zone,
    // mapped onto a red→neutral→green scale clamped at ±10 percentage points.
    const lz = leagueByZone.get(key);
    const lp = lz && lz.a > 0 ? (lz.m / lz.a) * 100 : null;
    const p = (z.m / z.a) * 100;
    if (lp == null) return { fill: C.PANEL_2, opacity: 0.55 };
    const t = Math.max(-1, Math.min(1, (p - lp) / 10));
    const fill = t >= 0 ? hexLerp(C.PANEL_2, C.GOOD, t) : hexLerp(C.PANEL_2, C.BAD, -t);
    return { fill, opacity: 0.7 };
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <ToggleButton active={mode === "eff"} onClick={() => setMode("eff")}>
          Efficiency
        </ToggleButton>
        <ToggleButton active={mode === "vol"} onClick={() => setMode("vol")}>
          Volume
        </ToggleButton>
      </div>

      {/* The viewBox is 8 units wider than the 0–500 court on each side purely as
          breathing room: the corner-zone labels are centred on narrow zones at
          the edges, so at phone widths they were being clipped by the SVG
          boundary. Nothing in the geometry moves. */}
      <svg viewBox="-8 0 516 470" width="100%" style={{ display: "block", maxWidth: 460, margin: "0 auto" }}>
        {/* Zone fills */}
        {ZONE_PATHS.map(([key, d]) => {
          const { fill, opacity } = fillFor(key);
          return <path key={key} d={d} fill={fill} fillOpacity={opacity} />;
        })}

        {/* Court line overlays */}
        <g fill="none" stroke={C.LINE} strokeWidth={2} strokeOpacity={0.9}>
          <rect x={1} y={1} width={498} height={468} rx={4} />
          {/* paint + free-throw arc */}
          <rect x={175} y={285} width={150} height={185} />
          <path d="M196,285 A54,54 0 0,0 304,285" />
          {/* 3-point line: corners + arc */}
          <path d="M45,470 L45,300 Q250,60 455,300 L455,470" strokeWidth={2.5} />
          {/* backboard + hoop */}
          <line x1={234} y1={432} x2={266} y2={432} strokeWidth={3} stroke={C.MUTE} />
          <circle cx={250} cy={425} r={5} stroke={C.MUTE} strokeWidth={2} />
        </g>

        {/* Zone labels */}
        {ZONE_PATHS.map(([key]) => {
          const meta = ZONE_META[key];
          const z = byZone.get(key);
          const pct = z ? pctOf(z.m, z.a) : null;
          return (
            <g key={`l-${key}`} textAnchor="middle" style={{ pointerEvents: "none" }}>
              <text x={meta.x} y={meta.y - 12} fontSize={10} fontWeight={600} fill={C.MUTE}>
                {meta.label}
              </text>
              <text x={meta.x} y={meta.y + 6} fontSize={17} fontWeight={700} fontFamily={FONT_DISPLAY} fill={C.TXT}>
                {pct == null ? "—" : `${pct}%`}
              </text>
              <text x={meta.x} y={meta.y + 20} fontSize={10} fill={C.MUTE}>
                {z ? `${z.m}/${z.a}` : "0/0"}
              </text>
            </g>
          );
        })}
      </svg>

      <p style={{ fontSize: 11, color: C.MUTE, margin: "12px 2px 0", lineHeight: 1.5, textAlign: "center" }}>
        {mode === "eff"
          ? `Each zone shaded by FG% vs ${baseDesc} for that zone — green = above, red = below.`
          : "Each zone shaded plum by its share of shot attempts — brighter = more shots taken there."}
      </p>
    </div>
  );
}
