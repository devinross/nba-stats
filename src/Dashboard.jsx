import React, { useMemo } from "react";
import { C, FONT_DISPLAY } from "./palette";
import { LEAGUE, seasonLabel } from "./league.js";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from "recharts";
import CourtChart, { ZoneTable } from "./CourtChart.jsx";
import SourceNote from "./SourceNote.jsx";
import { sourceFor } from "./sources.js";
import {
  ShotTypeChart, ShotTypeTable, ShotTypeCaveat,
  DefendTable, DefendExplainer, baselineFor, POSITION_LABELS,
} from "./PlayTypes.jsx";

const sum = (arr, k) => arr.reduce((a, b) => a + b[k], 0);
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (m, a) => (a > 0 ? r1((m / a) * 100) : 0);
// Surname only, for chart legends where the full name would crowd the plot.
const lastName = (name) => String(name).trim().split(" ").pop();

function aggregate(p) {
  const L = p.logs, gp = L.length;
  const pts = sum(L, "pts"), reb = sum(L, "orb") + sum(L, "drb");
  const fgm = sum(L, "fgm"), fga = sum(L, "fga");
  const tpm = sum(L, "tpm"), tpa = sum(L, "tpa");
  const ftm = sum(L, "ftm"), fta = sum(L, "fta");
  const tsDen = 2 * (fga + 0.44 * fta);
  return {
    gp,
    ppg: r1(pts / gp), rpg: r1(reb / gp), apg: r1(sum(L, "ast") / gp),
    spg: r1(sum(L, "stl") / gp), bpg: r1(sum(L, "blk") / gp), tpg: r1(sum(L, "tov") / gp),
    mpg: r1(sum(L, "min") / gp),
    pm: r1(sum(L, "pm") / gp),
    fgPct: pct(fgm, fga), tpPct: pct(tpm, tpa), ftPct: pct(ftm, fta),
    efg: fga > 0 ? r1(((fgm + 0.5 * tpm) / fga) * 100) : 0,
    ts: tsDen > 0 ? r1((pts / tsDen) * 100) : 0,
    high: Math.max(...L.map((g) => g.pts)),
    fgm, fga, tpm, tpa, ftm, fta,
  };
}

function StatTile({ label, value, accent }) {
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: C.MUTE, fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, lineHeight: 1, color: accent || C.TXT }}>{value}</span>
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
      <div style={{ height: 7, background: C.PANEL_2, borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${Math.min((value / max) * 100, 100)}%`, height: "100%", background: color, borderRadius: 6, transition: "width .6s ease" }} />
      </div>
    </div>
  );
}

export default function Dashboard({ games, roster, sel, setSel, leagueShotZones = [], leagueShotTypes = null, positionShotZones = null, positionShotTypes = null, playerHref, season, teamId }) {
  // Same footnote links as the Team tab — see src/sources.js.
  const seasonSource = sourceFor("roster", { season, teamId });
  const logSource = sourceFor("playerLog", { season, teamId });
  const zoneSource = sourceFor("playerShotZones", { season, teamId });
  const typeSource = sourceFor("playerShotTypes", { season, teamId });
  const defendSource = sourceFor("shotDefend", { season, teamId });

  // league.json carries the shot-type buckets alongside the share of attempts
  // the feed left unlabelled, which is what decides whether the split is worth
  // showing straight or with a warning (see ShotTypeCaveat).
  const leagueTypes = (leagueShotTypes && leagueShotTypes.buckets) || [];
  const typeGeneric = leagueShotTypes && leagueShotTypes.generic;

  const player = roster[sel] || roster[0];
  const agg = useMemo(() => aggregate(player), [sel, roster]);

  // Compare a player's shot zones against same-position peers (guards vs
  // forwards; centers count as forwards). Falls back to the whole-league
  // baseline if the position is unknown or that bucket is unavailable.
  const posGroup = String(player.pos || "").trim().toUpperCase().charAt(0) === "G" ? "G" : "F";
  const zoneBaseline =
    (positionShotZones && positionShotZones[posGroup]?.length && positionShotZones[posGroup]) || leagueShotZones;
  const baselineLabel = positionShotZones && positionShotZones[posGroup]?.length
    ? (posGroup === "G" ? "guards" : "forwards")
    : "lg";

  // Shot types get their own baseline, split three ways rather than the zones'
  // two: what a center is asked to shoot is nothing like what a guard is, and
  // measuring him against a league average that is a third spot-up threes says
  // little beyond "he is a center". Falls back to the league when his position
  // is unlisted — see baselineFor.
  const typeBaseline = baselineFor(player.pos, positionShotTypes, leagueTypes);

  const trend = useMemo(
    () => player.logs.map((l) => {
      const g = games[l.g];
      return { name: g.opp, label: `${g.date} ${g.home ? "vs" : "@"} ${g.opp}`, pts: l.pts, ts: l.ts };
    }),
    [sel, roster, games]
  );

  return (
    <div className="hf-container roster-layout" style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) 1fr" }}>
        <aside className="roster-rail" style={{ borderRight: `1px solid ${C.LINE}`, padding: "18px 14px 18px 0", minHeight: "calc(100vh - 150px)" }}>
          <div style={{ fontSize: 11, color: C.MUTE, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, padding: "0 8px 10px" }}>Roster</div>
          {roster.map((p, i) => {
            const active = i === sel;
            const initials = p.name.split(" ").map((n) => n[0]).join("").slice(0, 2);
            return (
              // An <a> rather than a <button>: each player is a real page, so
              // this needs to be crawlable, middle-clickable and copyable. The
              // click handler still takes plain left-clicks so switching players
              // stays instant, but anything else (new tab, new window) falls
              // through to the browser.
              <a
                key={p.name + i}
                href={playerHref ? playerHref(i) : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  setSel(i);
                }}
                aria-current={active ? "page" : undefined}
                style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                padding: "10px", marginBottom: 4, borderRadius: 12, cursor: "pointer",
                border: `1px solid ${active ? C.BRAND + "66" : "transparent"}`,
                // The selected row is marked the way the app marks a selected
                // cell: subtleFill behind it and a plum hairline, no gradient.
                background: active ? C.PANEL_2 : "transparent" }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center",
                  background: active ? C.BRAND : C.PANEL_2, color: active ? C.ON_BRAND : C.TXT, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13 }}>{initials}</div>
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", color: C.TXT }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: C.MUTE }}>{p.num ? `#${p.num} · ` : ""}{p.pos || "—"} · {p.logs.length} GP</div>
                </div>
              </a>
            );
          })}
        </aside>

        {/* minWidth 0 lets this grid column shrink below its content's natural
            width — without it a long name in wide mono glyphs blows the column
            (and every chart in it) past the page. */}
        <main style={{ padding: "24px 0 40px 28px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.BRAND, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
                {player.num ? `#${player.num} · ` : ""}{player.pos === "G" ? "Guard" : player.pos === "F" ? "Forward" : player.pos === "C" ? "Center" : player.pos}
              </div>
              {/* Mono is much wider than a proportional face, so the name scales
                  with the viewport rather than sitting at a fixed display size. */}
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: "clamp(24px, 4.2vw, 40px)", margin: "2px 0 0", lineHeight: 1.05, letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{player.name}</h2>
            </div>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: C.BRAND }}>{agg.high}</div>
                <div style={{ fontSize: 10, color: C.MUTE, letterSpacing: 1, textTransform: "uppercase" }}>Season high</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26 }}>{agg.mpg}</div>
                <div style={{ fontSize: 10, color: C.MUTE, letterSpacing: 1, textTransform: "uppercase" }}>Min / game</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: agg.pm >= 0 ? C.GOOD : C.BAD }}>{agg.pm > 0 ? "+" : ""}{agg.pm}</div>
                <div style={{ fontSize: 10, color: C.MUTE, letterSpacing: 1, textTransform: "uppercase" }}>Avg +/–</div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12, marginBottom: 24 }}>
            <StatTile label="PPG" value={agg.ppg} accent={C.BRAND} />
            <StatTile label="RPG" value={agg.rpg} />
            <StatTile label="APG" value={agg.apg} />
            <StatTile label="SPG" value={agg.spg} />
            <StatTile label="BPG" value={agg.bpg} />
            <StatTile label="TOV" value={agg.tpg} />
          </div>

          <div className="split-2" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 18, marginBottom: 22 }}>
            <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px" }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: "0 0 16px" }}>Shooting splits</h3>
              <SplitBar label="Field goal %" value={agg.fgPct} color={C.ACCENT} />
              <SplitBar label="3-point %" value={agg.tpPct} color={C.BRAND} />
              <SplitBar label="Free throw %" value={agg.ftPct} color={C.ACCENT} />
              <SplitBar label="Effective FG %" value={agg.efg} max={120} color={C.BRAND} />
              <SplitBar label="True shooting %" value={agg.ts} max={120} color={C.ACCENT} />
              <div style={{ display: "flex", gap: 10, marginTop: 14, fontSize: 11, color: C.MUTE }}>
                <span>FG {agg.fgm}/{agg.fga}</span><span>·</span>
                <span>3P {agg.tpm}/{agg.tpa}</span><span>·</span>
                <span>FT {agg.ftm}/{agg.fta}</span>
              </div>
              <SourceNote source={seasonSource} />
            </section>

            <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>Points by game</h3>
                <span style={{ fontSize: 11, color: C.MUTE }}>dashed = season avg</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.BRAND} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={C.BRAND} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                  <YAxis tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                  <Tooltip contentStyle={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, color: C.TXT }}
                    labelStyle={{ color: C.BRAND }} formatter={(v) => [v, "Points"]}
                    labelFormatter={(l, pl) => (pl && pl[0] ? pl[0].payload.label : l)} />
                  <ReferenceLine y={agg.ppg} stroke={C.ACCENT} strokeDasharray="5 4" />
                  <Area type="monotone" dataKey="pts" stroke={C.BRAND} strokeWidth={2.5} fill="url(#pg)" dot={{ r: 3, fill: C.BRAND }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
              <SourceNote source={logSource} />
            </section>
          </div>

          <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>Shooting by zone</h3>
              <span style={{ fontSize: 11, color: C.MUTE }}>
                shaded vs {LEAGUE.name} {baselineLabel === "lg" ? "average" : baselineLabel} · toggle volume
              </span>
            </div>
            {player.shotZones && player.shotZones.some((z) => z.a > 0) ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, alignItems: "start" }}>
                <CourtChart zones={player.shotZones} league={zoneBaseline} baseDesc={baselineLabel === "lg" ? undefined : `${LEAGUE.name} ${baselineLabel}`} />
                <div className="scroll-x" style={{ overflowX: "auto" }}>
                  <ZoneTable zones={player.shotZones} league={zoneBaseline} baselineLabel={baselineLabel === "lg" ? "lg" : posGroup} />
                </div>
              </div>
            ) : (
              <p style={{ color: C.MUTE, fontSize: 13, margin: 0 }}>No zone shooting data for this player yet.</p>
            )}
            <SourceNote source={zoneSource} />
          </section>

          <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>Shot types</h3>
              <span style={{ fontSize: 11, color: C.MUTE }}>
                how each shot was created · share of his attempts vs {typeBaseline.label === "lg" ? "the league" : typeBaseline.name}
              </span>
            </div>
            <ShotTypeCaveat generic={typeGeneric} season={season} />
            {player.shotTypes && player.shotTypes.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22, alignItems: "start" }}>
                <ShotTypeChart
                  types={player.shotTypes}
                  league={typeBaseline.types}
                  label={lastName(player.name)}
                  baseName={typeBaseline.label === "lg" ? LEAGUE.name : typeBaseline.name}
                />
                <div className="scroll-x" style={{ overflowX: "auto" }}>
                  <ShotTypeTable types={player.shotTypes} league={typeBaseline.types} baselineLabel={typeBaseline.label} />
                  <p style={{ fontSize: 12, color: C.MUTE, margin: "10px 2px 0", lineHeight: 1.5 }}>
                    Measured against {typeBaseline.label === "lg" ? "the whole league" : `every ${LEAGUE.name} ${POSITION_LABELS[typeBaseline.label].replace(/s$/, "")}`}
                    {typeBaseline.label === "lg"
                      ? " — no position is listed for him, so there's no positional group to compare against."
                      : ", not the whole league. A center's shot diet looks nothing like a guard's, so the league average would mostly just tell you his position."}
                  </p>
                </div>
              </div>
            ) : (
              <p style={{ color: C.MUTE, fontSize: 13, margin: 0 }}>No shot-type data for this player yet.</p>
            )}
            <SourceNote source={typeSource} />
          </section>

          <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0 }}>Defensive matchups</h3>
              <span style={{ fontSize: 11, color: C.MUTE }}>as the closest defender</span>
            </div>
            {player.shotDefend && player.shotDefend.length ? (
              <>
                <DefendExplainer />
                <div className="scroll-x" style={{ overflowX: "auto" }}>
                  <DefendTable rows={player.shotDefend} />
                </div>
              </>
            ) : (
              <p style={{ color: C.MUTE, fontSize: 13, margin: 0 }}>
                {Number(season) < LEAGUE.defendFirstSeason
                  ? `Closest-defender tracking starts in ${seasonLabel(LEAGUE.defendFirstSeason)}, so there are no matchup numbers for ${seasonLabel(season)}.`
                  : "No defensive matchup data for this player yet."}
              </p>
            )}
            <SourceNote source={defendSource} />
          </section>

          <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: "0 0 8px" }}>True shooting % trend</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
                <YAxis tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} domain={[0, 120]} />
                <Tooltip contentStyle={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, color: C.TXT }}
                  labelStyle={{ color: C.BRAND }} formatter={(v) => [`${v}%`, "TS%"]}
                  labelFormatter={(l, pl) => (pl && pl[0] ? pl[0].payload.label : l)} />
                <ReferenceLine y={agg.ts} stroke={C.BRAND} strokeDasharray="5 4" />
                <Line type="monotone" dataKey="ts" stroke={C.ACCENT} strokeWidth={2.5} dot={{ r: 3, fill: C.ACCENT }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
            <SourceNote source={logSource} />
          </section>

          <section style={{ background: C.PANEL, border: `1px solid ${C.LINE}`, borderRadius: 16, padding: "18px 20px" }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Game log</h3>
            <div className="scroll-x" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
                <thead>
                  <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
                    {["Matchup", "Result", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "FG", "3P", "+/–"].map((h, k) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: k < 2 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {player.logs.map((l) => {
                    const g = games[l.g];
                    return (
                      <tr key={l.g} style={{ borderBottom: `1px solid ${C.LINE}55` }}>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                          <span style={{ color: C.MUTE }}>{g.date} {g.home ? "vs" : "@"}</span> <span style={{ fontWeight: 700 }}>{g.opp}</span>
                        </td>
                        <td style={{ padding: "9px 10px" }}>
                          <span style={{ fontWeight: 700, fontSize: 12, padding: "2px 8px", borderRadius: 6,
                            background: g.w ? C.WIN_BG : C.LOSS_BG, color: g.w ? C.GOOD : C.LOSS_FG }}>
                            {g.w ? "W" : "L"} {g.tm}-{g.op}
                          </span>
                        </td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: C.MUTE }}>{l.min}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, fontFamily: FONT_DISPLAY, color: l.pts === agg.high ? C.BRAND : C.TXT }}>{l.pts}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right" }}>{l.orb + l.drb}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right" }}>{l.ast}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right" }}>{l.stl}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right" }}>{l.blk}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: C.MUTE }}>{l.tov}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: C.MUTE }}>{l.fgm}/{l.fga}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: C.MUTE }}>{l.tpm}/{l.tpa}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: l.pm >= 0 ? C.GOOD : C.LOSS_FG }}>{l.pm > 0 ? "+" : ""}{l.pm}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SourceNote source={logSource} />
          </section>
        </main>
      </div>
  );
}
