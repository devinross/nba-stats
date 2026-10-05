import React, { useMemo, useState } from "react";
import { C, FONT_DISPLAY } from "./palette";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";
import { WIN_ZONES, MetricButton, zoneMetric, fitTrend } from "./ShootingWinChart.jsx";
import SourceNote from "./SourceNote.jsx";
import { sourceFor } from "./sources.js";
import { seasonLabel } from "./league.js";

// ---------------------------------------------------------------------------
// The trends page: every season at once. Each team-season is its own dot —
// the 2016-17 Warriors and the 2021-22 Warriors are two separate entities — so
// the league page's two scatters ("Shooting profile vs winning", "Offense vs
// defense") can be read across every year we have instead of a single
// thirty-dot season.
//
// Everything comes out of the seasons' league.json files (useAllSeasons), so
// no team file is fetched.
// ---------------------------------------------------------------------------

const r1 = (n) => Math.round(n * 10) / 10;
const signed = (v, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
// "25-26": the season without its century, for tight spots (bar ticks, the
// followed franchise's dot labels) where "2025-26" doesn't fit.
const yy = (season) => seasonLabel(season).slice(2);

// Seasons are a sequential encoding — older is lighter, newer is darker — on
// the brand plum, so the newest teams read as the "current" ink and the
// archive recedes behind them. The light end is kept dark enough to hold its
// own against the white card.
const SEASON_LIGHT = [217, 167, 193];
const SEASON_DARK = [58, 17, 54]; // C.BRAND
function seasonColor(i, n) {
  const t = n <= 1 ? 1 : i / (n - 1);
  const [r, g, b] = SEASON_LIGHT.map((c, k) => Math.round(c + (SEASON_DARK[k] - c) * t));
  return `rgb(${r},${g},${b})`;
}

// Round-number ticks spanning the data, about six of them. Recharts' function
// domains pad by a fixed amount and then tick from wherever that lands, which
// reads as -9, -5, -1, 6 with 300 dots behind it.
function niceAxis(values, pad = 0) {
  if (!values.length) return { domain: [0, 1], ticks: [0, 1] };
  const lo = Math.min(...values) - pad, hi = Math.max(...values) + pad;
  const raw = (hi - lo) / 6 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.round(t * 100) / 100);
  return { domain: [start, end], ticks };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function Section({ title, hint, source, children }) {
  return (
    <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>{title}</h2>
        {hint && <span style={{ fontSize: 11, color: C.MUTE }}>{hint}</span>}
      </div>
      {children}
      <SourceNote source={source} />
    </section>
  );
}

// A compact labelled <select>, styled like the rest of the filter row.
function Picker({ label, value, onChange, children }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: C.MUTE }}>
      <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: C.TXT,
          background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 999, padding: "6px 10px",
        }}
      >
        {children}
      </select>
    </label>
  );
}

// One swatch per season, in order — the key to the dots' colors.
function SeasonLegend({ seasons, colorOf }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center", fontSize: 11, color: C.MUTE, margin: "4px 0 10px" }}>
      {seasons.map((s) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: colorOf(s), display: "inline-block" }} />
          {seasonLabel(s)}
        </span>
      ))}
    </div>
  );
}

// A team-season dot: season-colored with a white ring so overlapping dots stay
// separable. When a franchise is being followed every other dot steps back.
const makeDot = (dimmed) => ({ cx, cy, payload }) => {
  if (cx == null || cy == null) return null;
  return (
    <circle
      cx={cx} cy={cy} r={5.5}
      fill={payload.color} stroke={C.PANEL} strokeWidth={1.5}
      fillOpacity={dimmed ? 0.28 : 0.9}
      style={{ cursor: "pointer" }}
    />
  );
};

// The followed franchise: its emoji on a disc, labelled with its season, and
// joined in season order by the Scatter's line.
const renderFollowDot = ({ cx, cy, payload }) => {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill={C.PANEL} stroke={C.ACCENT} strokeWidth={2} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12}>{payload.emoji}</text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize={10} fill={C.TXT} fontFamily={FONT_DISPLAY} fontWeight={700}>
        {yy(payload.season)}
      </text>
    </g>
  );
};

function TipRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: C.MUTE }}>{label}</span>
      <span style={{ color: color || C.TXT, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function TipCard({ d, children }) {
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 190 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, marginBottom: 6 }}>
        {d.emoji} {seasonLabel(d.season)} {d.name}
        {!d.final && <span style={{ color: C.MUTE, fontWeight: 600 }}> · in progress</span>}
      </div>
      {children}
    </div>
  );
}

// ----- shooting profile vs winning ------------------------------------------

function ShootingTrends({ entities, seasons, colorOf, follow, onFollow, relative }) {
  const [zone, setZone] = useState("three");
  const [mode, setMode] = useState("eff");
  const zoneDef = WIN_ZONES.find((z) => z.key === zone) || WIN_ZONES[0];
  const unit = mode === "eff" ? "FG%" : "shot share";

  const data = useMemo(() => {
    const raw = entities
      .map((e) => ({ ...e, raw: zoneMetric(e.zones, zoneDef.parts, mode), y: e.winPct }))
      .filter((p) => p.raw != null && p.y != null);
    // "vs season avg" subtracts each season's league mean, so a 2016-17 team and
    // a 2025-26 team are judged against their own league rather than against an
    // era that shot a different way.
    const avgBySeason = new Map(seasons.map((s) => [s, mean(raw.filter((p) => p.season === s).map((p) => p.raw))]));
    const pts = raw.map((p) => ({ ...p, x: relative ? r1(p.raw - avgBySeason.get(p.season)) : p.raw }));
    const { r, seg } = fitTrend(pts);
    // The same correlation one season at a time — whether this zone has
    // mattered more or less to winning as the league has changed. Subtracting
    // a season's own mean doesn't change its within-season r, so this is the
    // same in either mode.
    const bySeason = seasons.map((s) => {
      const sp = pts.filter((p) => p.season === s);
      const fit = fitTrend(sp);
      return { season: s, r: fit.r == null ? null : Math.round(fit.r * 100) / 100, n: sp.length, avg: r1(avgBySeason.get(s) || 0) };
    });
    return { pts, r, seg, bySeason };
  }, [entities, seasons, zoneDef, mode, relative]);

  const followed = follow ? data.pts.filter((p) => p.teamId === follow).sort((a, b) => a.season - b.season) : [];
  const metricLabel = `${zoneDef.label} ${unit}`;
  const xLabel = relative ? `${metricLabel} vs season avg (pts)  →` : `${metricLabel}${mode === "eff" ? "" : " %"}  →`;
  const xAxis = useMemo(() => niceAxis(data.pts.map((p) => p.x), 0.5), [data]);

  if (!data.pts.length) return null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {WIN_ZONES.map((z) => (
          <MetricButton key={z.key} active={zone === z.key} onClick={() => setZone(z.key)}>{z.label}</MetricButton>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <MetricButton active={mode === "eff"} onClick={() => setMode("eff")}>Efficiency</MetricButton>
        <MetricButton active={mode === "vol"} onClick={() => setMode("vol")}>Volume</MetricButton>
      </div>
      <div style={{ marginBottom: 2, fontSize: 13, color: C.MUTE }}>
        {metricLabel} vs win % · {data.pts.length} team-seasons
        {data.r != null && (
          <>
            {" · "}
            <span style={{ color: Math.abs(data.r) >= 0.3 ? C.TXT : C.MUTE, fontWeight: 700 }}>
              correlation r = {data.r > 0 ? "+" : ""}{data.r.toFixed(2)}
            </span>
          </>
        )}
      </div>
      <SeasonLegend seasons={seasons} colorOf={colorOf} />
      <ResponsiveContainer width="100%" height={440}>
        <ScatterChart margin={{ top: 20, right: 28, bottom: 30, left: 6 }}>
          <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" />
          <XAxis
            type="number" dataKey="x"
            domain={xAxis.domain} ticks={xAxis.ticks}
            tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
            label={{ value: xLabel, position: "bottom", fill: C.MUTE, fontSize: 12 }}
          />
          <YAxis
            type="number" dataKey="y"
            domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
            tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
            label={{ value: "Win %  ↑", angle: -90, position: "insideLeft", fill: C.MUTE, fontSize: 12, style: { textAnchor: "middle" } }}
          />
          <ZAxis range={[60, 60]} />
          {relative && <ReferenceLine x={0} stroke={C.SEPARATOR} strokeDasharray="5 4" />}
          {data.seg && (
            <ReferenceLine segment={data.seg} stroke={C.BRAND} strokeDasharray="6 4" strokeOpacity={0.65} ifOverflow="extendDomain" />
          )}
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: C.LINE }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <TipCard d={d}>
                  <TipRow label="Win %" value={`${d.y}%`} />
                  <TipRow label={metricLabel} value={`${d.raw}%`} />
                  {relative && <TipRow label="vs season avg" value={`${signed(d.x)} pts`} />}
                </TipCard>
              );
            }}
          />
          <Scatter
            data={data.pts}
            shape={makeDot(!!follow)}
            isAnimationActive={false}
            onClick={(p) => p && onFollow(p.teamId)}
          />
          {followed.length > 0 && (
            <Scatter
              data={followed}
              shape={renderFollowDot}
              line={{ stroke: C.ACCENT, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>

      <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, margin: "18px 0 4px" }}>
        Does it still matter? Correlation with win %, season by season
      </h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data.bySeason} margin={{ top: 10, right: 28, bottom: 4, left: 6 }}>
          <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="season" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} tickFormatter={yy} />
          <YAxis domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
          <ReferenceLine y={0} stroke={C.SEPARATOR} />
          <Tooltip
            cursor={{ fill: C.HOVER_FILL }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, minWidth: 170 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, marginBottom: 6 }}>{seasonLabel(d.season)}</div>
                  <TipRow label="Correlation r" value={d.r == null ? "—" : `${d.r > 0 ? "+" : ""}${d.r.toFixed(2)}`} />
                  <TipRow label={`League avg ${unit}`} value={`${d.avg}%`} />
                  <TipRow label="Teams" value={d.n} />
                </div>
              );
            }}
          />
          <Bar dataKey="r" radius={[4, 4, 4, 4]} maxBarSize={36} isAnimationActive={false}>
            {data.bySeason.map((d) => <Cell key={d.season} fill={colorOf(d.season)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
        Every team in every season, plotted by its {zoneDef.label.toLowerCase()}{" "}
        {mode === "eff" ? "shooting accuracy" : "share of shot attempts"} against win %. Darker dots are more recent seasons;
        the dashed line is the trend across all of them.
        {relative
          ? " Values are relative to that season's league average, so eras that shot differently line up."
          : " Raw values carry each era with them — switch to “vs season avg” to compare teams to their own league."}{" "}
        The bars repeat the correlation one season at a time. Click any dot to follow that franchise.
      </p>
    </>
  );
}

// ----- offense vs defense ---------------------------------------------------

function RatingTrends({ entities, seasons, colorOf, follow, onFollow, relative }) {
  const data = useMemo(() => {
    const raw = entities.filter((e) => e.off != null && e.def != null);
    const avg = new Map(
      seasons.map((s) => {
        const sp = raw.filter((e) => e.season === s);
        return [s, { off: mean(sp.map((e) => e.off)), def: mean(sp.map((e) => e.def)) }];
      })
    );
    const pts = raw.map((e) => {
      const a = avg.get(e.season);
      return { ...e, x: relative ? r1(e.off - a.off) : e.off, y: relative ? r1(e.def - a.def) : e.def };
    });
    const center = relative
      ? { x: 0, y: 0 }
      : { x: r1(mean(pts.map((p) => p.x))), y: r1(mean(pts.map((p) => p.y))) };
    return { pts, center };
  }, [entities, seasons, relative]);

  const followed = follow ? data.pts.filter((p) => p.teamId === follow).sort((a, b) => a.season - b.season) : [];
  const xAxis = useMemo(() => niceAxis(data.pts.map((p) => p.x), 1), [data]);
  const yAxis = useMemo(() => niceAxis(data.pts.map((p) => p.y), 1), [data]);
  if (!data.pts.length) return null;

  return (
    <>
      <SeasonLegend seasons={seasons} colorOf={colorOf} />
      <ResponsiveContainer width="100%" height={440}>
        <ScatterChart margin={{ top: 16, right: 28, bottom: 30, left: 6 }}>
          <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" />
          <XAxis
            type="number" dataKey="x"
            domain={xAxis.domain} ticks={xAxis.ticks}
            tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
            label={{ value: relative ? "Offense vs season avg  →" : "Offensive rating  →", position: "bottom", fill: C.MUTE, fontSize: 12 }}
          />
          <YAxis
            type="number" dataKey="y"
            // Reversed, as on the league page: a low defensive rating is good.
            reversed
            domain={yAxis.domain} ticks={yAxis.ticks}
            tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE}
            label={{ value: relative ? "←  Defense vs season avg" : "←  Defensive rating", angle: -90, position: "insideLeft", fill: C.MUTE, fontSize: 12, style: { textAnchor: "middle" } }}
          />
          <ZAxis range={[60, 60]} />
          <ReferenceLine x={data.center.x} stroke={C.SEPARATOR} strokeDasharray="5 4" />
          <ReferenceLine y={data.center.y} stroke={C.SEPARATOR} strokeDasharray="5 4" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: C.LINE }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <TipCard d={d}>
                  {d.winPct != null && <TipRow label="Win %" value={`${d.winPct}%`} />}
                  <TipRow label="Offense" value={relative ? `${d.off} (${signed(d.x)})` : d.off} />
                  <TipRow label="Defense" value={relative ? `${d.def} (${signed(d.y)})` : d.def} />
                  <TipRow label="Net rating" value={signed(d.net)} color={d.net >= 0 ? C.GOOD : C.LOSS_FG} />
                  {d.pace != null && <TipRow label="Pace" value={d.pace} />}
                </TipCard>
              );
            }}
          />
          <Scatter
            data={data.pts}
            shape={makeDot(!!follow)}
            isAnimationActive={false}
            onClick={(p) => p && onFollow(p.teamId)}
          />
          {followed.length > 0 && (
            <Scatter
              data={followed}
              shape={renderFollowDot}
              line={{ stroke: C.ACCENT, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 12, color: C.MUTE, margin: "8px 2px 0", lineHeight: 1.5 }}>
        Every team-season's points scored and allowed per 100 possessions; up and to the right is better.
        {relative
          ? " Both ratings are relative to that season's league average, so the dashed lines are an average team in any year."
          : " The dashed lines are the average across every team-season shown — scoring has risen over time, so newer seasons drift right."}
      </p>
    </>
  );
}

// ----- the page -------------------------------------------------------------

export default function TrendsView({ leagues = [], currentSeason }) {
  // Flatten every season into team-season entities, keyed season:team.
  const entities = useMemo(() => {
    const out = [];
    for (const lg of leagues) {
      if (!lg || !lg.meta) continue;
      const season = Number(lg.meta.season);
      const final = Number(season) !== Number(currentSeason) || !!lg.meta.final;
      const byId = new Map((lg.teams || []).map((t) => [t.id, t]));
      const ranks = new Map(((lg.teamRanks && lg.teamRanks.teams) || []).map((t) => [t.teamId, t]));
      const wins = new Map((lg.teamZoneWins || []).map((t) => [t.teamId, t]));
      for (const team of lg.teams || []) {
        const rk = ranks.get(team.id) || {};
        const zw = wins.get(team.id) || {};
        out.push({
          key: `${season}:${team.id}`,
          season, final,
          teamId: team.id,
          name: team.name,
          abbr: team.abbr,
          emoji: team.emoji || "🏀",
          winPct: zw.winPct ?? null,
          zones: zw.zones || null,
          off: rk.off ?? null,
          def: rk.def ?? null,
          net: rk.net ?? null,
          pace: rk.pace ?? null,
        });
      }
    }
    return out;
  }, [leagues, currentSeason]);

  const allSeasons = useMemo(() => [...new Set(entities.map((e) => e.season))].sort((a, b) => a - b), [entities]);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const lo = from ?? allSeasons[0];
  const hi = to ?? allSeasons[allSeasons.length - 1];
  const seasons = allSeasons.filter((s) => s >= lo && s <= hi);
  const shown = useMemo(() => entities.filter((e) => e.season >= lo && e.season <= hi), [entities, lo, hi]);

  // Colors follow the season, not its position in the filtered range, so a dot
  // keeps its color when the range is narrowed.
  const colorOf = useMemo(() => {
    const idx = new Map(allSeasons.map((s, i) => [s, i]));
    return (s) => seasonColor(idx.get(s) ?? 0, allSeasons.length);
  }, [allSeasons]);
  const colored = useMemo(() => shown.map((e) => ({ ...e, color: colorOf(e.season) })), [shown, colorOf]);

  // Franchises by their latest name — a team id survives a rename or a move.
  const franchises = useMemo(() => {
    const latest = new Map();
    for (const e of entities) {
      const cur = latest.get(e.teamId);
      if (!cur || e.season > cur.season) latest.set(e.teamId, e);
    }
    return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entities]);

  const [follow, setFollow] = useState(null);
  const [relative, setRelative] = useState(true);
  const toggleFollow = (id) => setFollow((cur) => (cur === id ? null : id));

  const latest = allSeasons[allSeasons.length - 1];
  const src = (key) => sourceFor(key, { season: latest });

  return (
    <main className="hf-container" style={{ paddingTop: 22, paddingBottom: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", alignItems: "center", marginBottom: 18 }}>
        <Picker label="From" value={lo} onChange={(v) => { const n = Number(v); setFrom(n); if (n > hi) setTo(n); }}>
          {allSeasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
        </Picker>
        <Picker label="To" value={hi} onChange={(v) => { const n = Number(v); setTo(n); if (n < lo) setFrom(n); }}>
          {allSeasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
        </Picker>
        <Picker label="Follow" value={follow ?? ""} onChange={(v) => setFollow(v ? Number(v) : null)}>
          <option value="">No team</option>
          {franchises.map((f) => <option key={f.teamId} value={f.teamId}>{f.emoji} {f.name}</option>)}
        </Picker>
        <div style={{ display: "flex", gap: 8 }}>
          <MetricButton active={relative} onClick={() => setRelative(true)}>vs season avg</MetricButton>
          <MetricButton active={!relative} onClick={() => setRelative(false)}>Raw</MetricButton>
        </div>
      </div>

      <Section
        title="Shooting profile vs winning"
        hint={`each dot = one team in one season · ${seasonLabel(seasons[0])} to ${seasonLabel(seasons[seasons.length - 1])}`}
        source={src("teamZoneWins")}
      >
        <ShootingTrends entities={colored} seasons={seasons} colorOf={colorOf} follow={follow} onFollow={toggleFollow} relative={relative} />
      </Section>

      <Section
        title="Offense vs defense"
        hint="each dot = one team in one season · up and to the right is better"
        source={src("teamRanks")}
      >
        <RatingTrends entities={colored} seasons={seasons} colorOf={colorOf} follow={follow} onFollow={toggleFollow} relative={relative} />
      </Section>
    </main>
  );
}
