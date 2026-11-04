import React, { useMemo } from "react";
import { C, FONT_DISPLAY, FONT_BODY } from "./palette";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import StaleNote from "./StaleNote.jsx";
import SourceNote from "./SourceNote.jsx";

// ---------------------------------------------------------------------------
// What a pass produced — the three things play-by-play can say that a box score
// can't: which pairs of players an offense actually runs on, what kind of shot
// each playmaker creates, and how much of a scorer's night someone else set up.
//
// All three read the `assists` block the fetch script builds from cached
// play-by-play (see the "assists" section of scripts/fetch-data.mjs). That block fills in over several nights rather than
// in one run, so every chart here states the games behind it instead of
// implying a whole season.
//
// None of this is Synergy play-type data — there is no pick-and-roll or
// isolation frequency here. A pass is described by the shot at the end of it.
// ---------------------------------------------------------------------------

// "Holland II" rather than "II": a generational suffix isn't a name anyone
// would recognise a player by.
const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i;
function lastName(name) {
  const parts = String(name).trim().split(" ");
  const last = parts.pop();
  return SUFFIX.test(last) && parts.length > 1 ? `${parts.pop()} ${last}` : last;
}

// The matrix shades one hue from light to dark, which needs the brand color as
// channels rather than a hex string. Read from the token so the ramp follows the
// palette instead of drifting from it.
function rgbOf(hex) {
  const h = String(hex).replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(v, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}
const BRAND_RGB = rgbOf(C.BRAND).join(", ");

/** "6 of 36 games" — the honest denominator under every chart on this page. */
function Coverage({ assists, children }) {
  const { games = 0, scheduled = 0 } = assists || {};
  const pct = scheduled ? Math.round((games / scheduled) * 100) : 0;
  return (
    <p style={{ fontSize: 12, color: C.MUTE, margin: "0 0 10px", lineHeight: 1.5 }}>
      {children}{" "}
      {/* Only the count itself resists wrapping — nowrap on the whole sentence
          made it one ~600px line that pushed the page into a horizontal scroll
          on a phone. */}
      From{" "}
      <span style={{ whiteSpace: "nowrap" }}>
        <strong style={{ color: C.TXT }}>{games}</strong> of {scheduled} games
        {pct < 100 && ` (${pct}%)`}
      </span>
      {pct < 100 ? " — play-by-play is fetched in batches, so this fills in over time." : "."}
    </p>
  );
}

function Shell({ title, hint, stale, source, children }) {
  return (
    <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>{title}</h2>
        {hint && <span style={{ fontSize: 11, color: C.MUTE }}>{hint}</span>}
      </div>
      <StaleNote stale={stale} />
      {children}
      <SourceNote source={source} />
    </section>
  );
}

// Two different empty states that must not be told as one. "No play-by-play for
// this team yet" and "we have games but nothing has recurred often enough to
// chart" are different facts, and showing the first when the second is true
// reads as a broken feature rather than a thin sample.
function Waiting({ what, assists, needs }) {
  const games = (assists && assists.games) || 0;
  return (
    <p style={{ color: C.MUTE, fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
      {games > 0 ? (
        <>
          {what} is waiting on a bigger sample: {games} of {assists.scheduled} games are on
          disk, and {needs}. It fills in as more games are fetched.
        </>
      ) : (
        <>
          {what} needs play-by-play, which is fetched in batches and hasn't reached
          this team yet. It'll appear once some of their games are on disk.
        </>
      )}
    </p>
  );
}

// ===== 1. the assist network ===============================================
// A matrix rather than a ranked list: the interesting thing about an offense's
// passing isn't its single most common pair, it's the shape — one hub feeding
// everyone, two guards feeding each other, or a flat spread with no engine.
// A list hides that shape; a grid is the shape.

export function AssistNetwork({ assists, stale, source }) {
  const grid = useMemo(() => {
    const pairs = (assists && assists.network) || [];
    if (!pairs.length) return null;
    const passTotal = new Map();
    const recvTotal = new Map();
    for (const p of pairs) {
      passTotal.set(p.from, (passTotal.get(p.from) || 0) + p.n);
      recvTotal.set(p.to, (recvTotal.get(p.to) || 0) + p.n);
    }
    const nameById = new Map();
    for (const p of pairs) { nameById.set(p.from, p.fromName); nameById.set(p.to, p.toName); }
    const rows = [...passTotal].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const cols = [...recvTotal].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const cell = new Map(pairs.map((p) => [`${p.from}:${p.to}`, p.n]));
    const max = Math.max(...pairs.map((p) => p.n));
    return { rows, cols, cell, max, nameById, passTotal };
  }, [assists]);

  return (
    <Shell title="Assist network · who sets up whom" hint="darker = more assists" stale={stale} source={source}>
      {!grid ? (
        <Waiting
          what="The assist network"
          assists={assists}
          needs={`no pair has connected the ${(assists && assists.minPair) || 2} times it takes to show`}
        />
      ) : (
        <>
          <Coverage assists={assists}>
            Every pair that connected at least {(assists && assists.minPair) || 2} times: the row
            passes, the column finishes.
          </Coverage>
          <div className="scroll-x" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: C.PANEL, textAlign: "right", padding: "0 8px 6px 0", fontWeight: 600, color: C.MUTE }}>
                    passer ↓ / finisher →
                  </th>
                  {grid.cols.map((id) => (
                    <th key={id} style={{ padding: "0 0 6px", fontWeight: 600, color: C.MUTE, fontSize: 11, minWidth: 46 }}>
                      {lastName(grid.nameById.get(id) || "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((from) => (
                  <tr key={from}>
                    <th style={{ position: "sticky", left: 0, background: C.PANEL, textAlign: "right", padding: "0 8px 0 0", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {lastName(grid.nameById.get(from) || "")}
                    </th>
                    {grid.cols.map((to) => {
                      const n = grid.cell.get(`${from}:${to}`) || 0;
                      // One hue, light to dark — this is a magnitude, not a set
                      // of categories. The floor keeps a single assist visible
                      // against the empty cells around it.
                      const weight = n ? 0.15 + 0.85 * (n / grid.max) : 0;
                      return (
                        <td
                          key={to}
                          title={n ? `${grid.nameById.get(from)} → ${grid.nameById.get(to)}: ${n} assists` : undefined}
                          style={{
                            textAlign: "center",
                            padding: "7px 6px",
                            borderRadius: 5,
                            background: n ? `rgba(${BRAND_RGB}, ${weight})` : C.PANEL_2,
                            color: n ? (weight > 0.55 ? C.ON_BRAND : C.TXT) : "transparent",
                            fontFamily: FONT_DISPLAY,
                            fontWeight: 700,
                          }}
                        >
                          {n || "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

// ===== 2. the assist diet ==================================================
// The ten shot-type buckets the rest of the site uses are too fine to stack —
// past four or five segments a stacked bar stops being readable, and several of
// the buckets differ by a distinction that doesn't matter to the passer. These
// four are the ones a pass actually chooses between.
//
// `cut` stays on its own rather than folding into the rim group because it is
// the one bucket the feed labels itself, and it's the closest thing this data
// has to a roll man — see the shot-type note in scripts/fetch-data.mjs.
const DIET_GROUPS = [
  ["threes", "Threes", ["spot3", "pull3"], "#6155F5"],
  ["cuts", "Cuts", ["cut"], "#00C3D0"],
  ["rim", "Rim", ["rim", "drive", "putback"], "#B0507E"],
  ["mid", "Mid-range", ["spot2", "pull2", "float", "post"], "#3A1136"],
  // Not folded into a neighbour: a label the feed adds later should be visibly
  // uncategorised rather than quietly inflating one of the real groups.
  ["other", "Other", ["other"], "#C7C7CC"],
];
const GROUP_OF = new Map();
for (const [key, , buckets] of DIET_GROUPS) for (const b of buckets) GROUP_OF.set(b, key);

function DietTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 180 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{d.name}</div>
      {DIET_GROUPS.map(([key, label, , color]) =>
        d[key] ? (
          <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: C.MUTE }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 6 }} />
              {label}
            </span>
            <span style={{ color: C.TXT, fontWeight: 700 }}>{d[key]}% · {d[`${key}_n`]}</span>
          </div>
        ) : null
      )}
      <div style={{ color: C.MUTE, marginTop: 6, fontSize: 11 }}>{d.ast} assists in all</div>
    </div>
  );
}

export function AssistDiet({ assists, stale, source }) {
  const data = useMemo(() => {
    const diet = (assists && assists.diet) || [];
    return diet.map((p) => {
      const counts = Object.fromEntries(DIET_GROUPS.map(([k]) => [k, 0]));
      for (const b of p.buckets) {
        const g = GROUP_OF.get(b.t) || "other";
        counts[g] += b.n;
      }
      const row = { name: p.name, label: lastName(p.name), ast: p.ast };
      for (const [key] of DIET_GROUPS) {
        row[`${key}_n`] = counts[key];
        row[key] = p.ast ? Math.round((counts[key] / p.ast) * 1000) / 10 : 0;
      }
      return row;
    });
  }, [assists]);

  return (
    <Shell title="What each pass creates" hint="share of that player's assists" stale={stale} source={source}>
      {!data.length ? (
        <Waiting
          what="The breakdown of what each playmaker creates"
          assists={assists}
          needs={`nobody has the ${(assists && assists.minAssists) || 8} assists it takes to read a shot mix from`}
        />
      ) : (
        <>
          <Coverage assists={assists}>
            For everyone with at least {(assists && assists.minAssists) || 8} assists on record,
            the kind of shot at the end of them. A guard whose passes mostly become threes is running a different offense
            from one whose passes mostly become cuts.
          </Coverage>
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 46 + 60)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 4 }}>
              <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow unit="%"
                tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                label={{ value: "share of his assists", position: "bottom", offset: 0, fill: C.MUTE, fontSize: 12 }}
              />
              <YAxis
                type="category" dataKey="label" width={92} interval={0}
                tick={{ fill: C.TXT, fontSize: 12, fontFamily: FONT_BODY }} stroke={C.LINE}
              />
              <Tooltip content={<DietTooltip />} cursor={{ fill: C.HOVER_FILL }} />
              <Legend
                verticalAlign="top" align="right" height={26} iconType="circle" iconSize={9}
                wrapperStyle={{ fontSize: 12 }}
                formatter={(v) => {
                  const row = DIET_GROUPS.find(([k]) => k === v);
                  return <span style={{ color: C.MUTE }}>{row ? row[1] : v}</span>;
                }}
              />
              {DIET_GROUPS.map(([key, , , color]) => (
                <Bar
                  key={key} dataKey={key} stackId="diet" fill={color} barSize={18}
                  isAnimationActive={false}
                  // A hairline of surface between segments so two dark
                  // neighbours don't read as one bar.
                  stroke={C.PANEL} strokeWidth={1}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Shell>
  );
}

// ===== 3. assisted share ===================================================

function ShareTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 180 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{d.name}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: C.MUTE }}>Set up by a teammate</span>
        <span style={{ color: C.TXT, fontWeight: 700 }}>{d.pct}%</span>
      </div>
      <div style={{ color: C.MUTE, marginTop: 6, fontSize: 11, lineHeight: 1.4 }}>
        {d.assisted} of {d.made} made field goals
        <br />
        {d.made - d.assisted} created for himself
      </div>
    </div>
  );
}

export function AssistedShare({ assists, stale, source }) {
  const data = useMemo(() => {
    const scorers = (assists && assists.scorers) || [];
    const games = (assists && assists.games) || 0;
    // A percentage needs a denominator worth dividing by. Early in a backfill a
    // center with eight makes in the one game on disk is genuinely "100%
    // assisted", and putting that on a chart is worse than leaving him off —
    // so the floor rises with coverage and starts high enough that a single
    // game can't qualify anyone.
    const floor = Math.max(10, games * 2);
    return scorers
      .filter((s) => s.made >= floor)
      .map((s) => ({ ...s, label: lastName(s.name), self: Math.round((100 - s.pct) * 10) / 10 }))
      .sort((a, b) => b.pct - a.pct);
  }, [assists]);

  return (
    <Shell title="Created for him, or created himself" hint="% of made field goals that were assisted" stale={stale} source={source}>
      {!data.length ? (
        <Waiting
          what="The assisted share of each scorer's night"
          assists={assists}
          needs="no scorer has enough made field goals on record for a percentage to mean anything"
        />
      ) : (
        <>
          <Coverage assists={assists}>
            How much of each scorer's offense came off someone else's pass. A low bar is a
            player who makes his own shot; a high one is a finisher the offense has to find.
          </Coverage>
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40 + 60)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 20, left: 4 }}>
              <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow unit="%"
                tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
                label={{ value: "% of his makes that were assisted", position: "bottom", offset: 0, fill: C.MUTE, fontSize: 12 }}
              />
              <YAxis
                type="category" dataKey="label" width={92} interval={0}
                tick={{ fill: C.TXT, fontSize: 12, fontFamily: FONT_BODY }} stroke={C.LINE}
              />
              <Tooltip content={<ShareTooltip />} cursor={{ fill: C.HOVER_FILL }} />
              <Bar dataKey="pct" fill={C.BRAND} radius={[0, 4, 4, 0]} barSize={15} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Shell>
  );
}
