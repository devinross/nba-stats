// ---------------------------------------------------------------------------
// Shot-type diet and defensive matchups — the two datasets fetch-data.mjs adds
// from `shotchartdetail` and `leaguedashptdefend`.
//
// A word on what this is NOT, since the obvious question it invites is "who is
// the best pick-and-roll scorer?" and this can't answer it. Every attempt
// carries an ACTION_TYPE describing how the shot was created — "Pullup Jump
// shot", "Cutting Layup Shot", "Step Back Jump shot", "Putback Layup Shot" and
// forty-odd others — and bucketing those gets honest answers about spot-ups,
// cuts, putbacks and post-ups. It does not get pick-and-roll: no feed records a
// screen, so "pull-up" here means off the dribble generally, which mixes a P&R
// ball handler in with isolations, and there is no roll-man bucket at all.
//
// nba.com does publish Synergy play types (`synergyplaytypes`), which is the
// dataset that answers the P&R question properly — it is a different section
// than this one, not a better version of it, since these two count different
// things (every attempt here, offensive possessions there). The WNBA fork of
// this site has no such option: that endpoint returns zero rows for LeagueID=10.
// ---------------------------------------------------------------------------

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { C, FONT_DISPLAY } from "./palette.js";
import { LEAGUE } from "./league.js";

// Fixed display order, so the same row means the same thing on every player's
// page — the data arrives sorted by that player's own volume, which would make
// two players' tables impossible to read against each other. Roughly ordered
// jump shots first, then attacks at the rim, then the back-to-basket stuff.
export const SHOT_TYPE_ROWS = [
  ["spot3", "Spot-up 3", "Caught and shot from three — no dribble qualifier on the play"],
  ["pull3", "Pull-up 3", "Off the dribble from three: pull-ups and step-backs"],
  ["spot2", "Spot-up 2", "Caught and shot inside the arc, mostly mid-range"],
  ["pull2", "Pull-up 2", "Off the dribble inside the arc"],
  ["float", "Floater", "Floaters and runners in the lane"],
  ["drive", "Drive", "Attacking off the bounce — driving and running layups and dunks, finger rolls, reverses"],
  ["cut", "Cut", "Moving to the rim off a pass, including alley-oops"],
  ["putback", "Putback", "Second-chance finishes off an offensive rebound"],
  ["post", "Post", "Back-to-basket footwork: hooks, turnarounds, fadeaways"],
  ["rim", "Layup/dunk", "Layups and dunks the feed left unqualified"],
];

// Position buckets, as league.json's positionShotTypes keys them. Shot type is
// the split where position matters most — a third of league attempts are
// spot-up threes, a shot most centers rarely take — so a center measured
// against everyone mostly reports that he is a center. Against other centers it
// reports whether he is getting good shots for one.
export const POSITION_LABELS = { G: "guards", F: "forwards", C: "centers" };

// A positional baseline needs enough shots behind it to be worth preferring to
// the league one. Every full season clears this many times over — a 30-team
// season is ~218,000 attempts — but the floor keeps a season whose roster feed
// returned few positions from producing a baseline built on a handful of
// players.
const MIN_BASELINE_ATTEMPTS = 2000;

/**
 * Which baseline a player should be read against, and what to call it. Falls
 * back to the whole league when his position is unlisted, that bucket is
 * missing, or it's too thin to mean anything — some archived seasons have
 * players the roster feed never gave a position for.
 */
export function baselineFor(pos, positionShotTypes, leagueTypes) {
  const group = String(pos || "").trim().toUpperCase().charAt(0);
  const bucket = positionShotTypes && positionShotTypes[group];
  const league = { types: leagueTypes || [], label: "lg", name: "the league" };
  if (!bucket || !bucket.length) return league;
  if (totalOf(bucket) < MIN_BASELINE_ATTEMPTS) return league;
  return { types: bucket, label: group, name: `${LEAGUE.name} ${POSITION_LABELS[group]}` };
}

const r1 = (v) => Math.round(v * 10) / 10;
const pct = (m, a) => (a > 0 ? r1((m / a) * 100) : null);
const totalOf = (list) => (list || []).reduce((sum, b) => sum + b.a, 0);
const signed = (v) => `${v > 0 ? "+" : ""}${v}`;

/** Index a bucket list by type key. */
const byType = (list) => new Map((list || []).map((b) => [b.t, b]));

/**
 * Merge a shot-type list with the league baseline into one row per bucket, in
 * SHOT_TYPE_ROWS order. `share` is the bucket's cut of this player's (or team's)
 * attempts; `shareDelta` compares that with the league's, in percentage points,
 * which is what says "he shoots far more spot-up threes than most".
 */
export function shotTypeRows(types, league) {
  const mine = byType(types);
  const base = byType(league);
  const total = totalOf(types);
  const baseTotal = totalOf(league);
  return SHOT_TYPE_ROWS.map(([key, label, hint]) => {
    const b = mine.get(key);
    const lb = base.get(key);
    const fg = b ? pct(b.m, b.a) : null;
    const lgFg = lb ? pct(lb.m, lb.a) : null;
    const share = b && total > 0 ? r1((b.a / total) * 100) : null;
    const lgShare = lb && baseTotal > 0 ? r1((lb.a / baseTotal) * 100) : null;
    return {
      key, label, hint,
      m: b ? b.m : 0,
      a: b ? b.a : 0,
      fg, lgFg, share, lgShare,
      fgDelta: fg != null && lgFg != null ? r1(fg - lgFg) : null,
      shareDelta: share != null && lgShare != null ? r1(share - lgShare) : null,
    };
  });
}

// The share of attempts the feed labelled with no play context at all — a bare
// "Jump Shot" or "Layup Shot". It runs around a third in recent seasons, higher
// the further back you go, because the feed simply recorded less: drives were
// logged as ordinary layups and pull-ups as ordinary jumpers. Past a point the
// breakdown is describing the feed's vocabulary more than the player, so the
// section says so rather than letting an old season be read as if it were this
// one.
const GENERIC_WARN = 50;

export function ShotTypeCaveat({ generic, season }) {
  if (generic == null || generic < GENERIC_WARN) return null;
  return (
    <p style={{ color: C.MUTE, fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>
      <strong style={{ color: C.LOSS_FG }}>Read {season} loosely.</strong>{" "}
      {generic}% of this season's attempts came back with no play detail (a plain "Jump Shot" or
      "Layup Shot"), against roughly a third in recent seasons — back then the feed logged drives as
      ordinary layups and pull-ups as ordinary jumpers. That pushes everything toward spot-ups and
      layups and away from drives and pull-ups, so these splits aren't comparable with a current one.
    </p>
  );
}

function ShotTypeTooltip({ active, payload, baseName = "the league" }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const cap = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  return (
    <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, maxWidth: 260 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: C.BRAND, marginBottom: 6 }}>{d.label}</div>
      <div style={{ color: C.MUTE, marginBottom: 8, lineHeight: 1.4 }}>{d.hint}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: C.MUTE }}>Share of shots</span>
        <span style={{ fontWeight: 700 }}>{d.share == null ? "—" : `${d.share}%`}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: C.MUTE }}>{cap}</span>
        <span style={{ fontWeight: 700 }}>{d.lgShare == null ? "—" : `${d.lgShare}%`}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 4 }}>
        <span style={{ color: C.MUTE }}>FG%</span>
        <span style={{ fontWeight: 700 }}>{d.fg == null ? "—" : `${d.fg}% on ${d.a}`}</span>
      </div>
    </div>
  );
}

/**
 * Shot diet: how the attempts split by type, against the league's split. Volume
 * rather than accuracy, because "what does he take" is the question the table
 * next to it can't answer at a glance.
 */
export function ShotTypeChart({ types, league, label = "This player", baseName = LEAGUE.name }) {
  const rows = shotTypeRows(types, league).filter((r) => r.a > 0 || r.lgShare != null);
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 6, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={C.LINE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} unit="%" />
        <YAxis type="category" dataKey="label" width={86} tick={{ fill: C.MUTE, fontSize: 11 }} stroke={C.LINE} />
        <Tooltip content={<ShotTypeTooltip baseName={baseName} />} cursor={{ fill: C.HOVER_FILL }} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.MUTE }} />
        <Bar dataKey="share" name={label} fill={C.BRAND} radius={[0, 3, 3, 0]} />
        <Bar dataKey="lgShare" name={baseName} fill={C.CHART_BASELINE} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The same rows as numbers: accuracy and volume, each against the league. */
export function ShotTypeTable({ types, league, baselineLabel = "lg" }) {
  const rows = shotTypeRows(types, league);
  const total = totalOf(types);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
          {["Shot type", "FG%", "FGM/FGA", "Share", `FG% vs ${baselineLabel}`, `Vol vs ${baselineLabel}`].map((h, k) => (
            <th key={h} style={{ padding: "8px 8px", textAlign: k === 0 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ borderBottom: `1px solid ${C.LINE}55` }}>
            <td style={{ padding: "9px 8px", fontWeight: 700, whiteSpace: "nowrap" }} title={r.hint}>{r.label}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{r.fg == null ? "—" : `${r.fg}%`}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{r.a ? `${r.m}/${r.a}` : "—"}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{r.share == null ? "—" : `${r.share}%`}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: r.fgDelta == null ? C.MUTE : r.fgDelta >= 0 ? C.GOOD : C.LOSS_FG }}>
              {r.fgDelta == null ? "—" : signed(r.fgDelta)}
            </td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700 }}>
              {r.shareDelta == null ? "—" : signed(r.shareDelta)}
            </td>
          </tr>
        ))}
        <tr style={{ borderTop: `2px solid ${C.LINE}` }}>
          <td style={{ padding: "9px 8px", fontWeight: 700, color: C.MUTE }}>Total</td>
          <td colSpan={5} style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{total} attempts</td>
        </tr>
      </tbody>
    </table>
  );
}

// ----- defensive matchups ---------------------------------------------------

// Category keys as the fetch script writes them, in the order they read best:
// the whole picture first, then by distance.
const DEFEND_ROWS = [
  ["all", "Overall", "Every attempt with him as the closest defender"],
  ["3pt", "3-pointers", "Threes taken with him closest"],
  ["2pt", "2-pointers", "Twos taken with him closest"],
  ["lt6", "Within 6 ft", "Attempts from inside six feet"],
  ["lt10", "Within 10 ft", "Attempts from inside ten feet"],
  ["gt15", "Beyond 15 ft", "Attempts from beyond fifteen feet"],
];

// Defence inverts the usual colour rule: a negative number is shooters doing
// WORSE than they normally do, which is the good outcome.
const diffColor = (v) => (v == null ? C.MUTE : v < 0 ? C.GOOD : v > 0 ? C.LOSS_FG : C.TXT);

export function DefendExplainer() {
  return (
    <p style={{ color: C.MUTE, fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>
      What shooters managed with him as the closest defender, next to what those same shooters
      normally shoot from there. The gap is the number worth reading — raw FG% allowed mostly
      measures who a player is asked to guard. <strong style={{ color: C.GOOD }}>Negative is good.</strong>
    </p>
  );
}

/** One player's six categories. */
export function DefendTable({ rows }) {
  const mine = new Map((rows || []).map((r) => [r.c, r]));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
          {["Defending", "FGA faced", "Allowed", "Normally", "Diff"].map((h, k) => (
            <th key={h} style={{ padding: "8px 8px", textAlign: k === 0 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DEFEND_ROWS.map(([key, label, hint], i) => {
          const r = mine.get(key);
          return (
            <tr key={key} style={{ borderBottom: `1px solid ${C.LINE}55`, borderTop: i === 1 ? `2px solid ${C.LINE}` : undefined }}>
              <td style={{ padding: "9px 8px", fontWeight: 700, whiteSpace: "nowrap", color: key === "all" ? C.TXT : C.MUTE }} title={hint}>{label}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{r ? `${r.fgm}/${r.fga}` : "—"}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{r && r.fga ? `${r.pct}%` : "—"}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{r && r.fga ? `${r.normPct}%` : "—"}</td>
              <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: diffColor(r && r.fga ? r.diff : null) }}>
                {r && r.fga ? signed(r.diff) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * A roster's defenders, best first. Minutes aren't in this feed, so the sort is
 * on the gap and the volume filter is attempts faced — a player who was closest
 * on forty shots all season can post a huge number on noise.
 */
export function TeamDefendTable({ roster, minFga = 200, playerLink }) {
  const rows = (roster || [])
    .map((p) => {
      const overall = (p.shotDefend || []).find((r) => r.c === "all");
      const three = (p.shotDefend || []).find((r) => r.c === "3pt");
      const rim = (p.shotDefend || []).find((r) => r.c === "lt6");
      return overall && overall.fga >= minFga ? { name: p.name, overall, three, rim } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.overall.diff - b.overall.diff);

  if (!rows.length) {
    return (
      <p style={{ color: C.MUTE, fontSize: 13, margin: 0 }}>
        No defender on this roster was the closest defender on {minFga}+ attempts this season.
      </p>
    );
  }

  const cell = (r) => (r && r.fga ? signed(r.diff) : "—");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: C.MUTE, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
          {["Player", "FGA faced", "Allowed", "Normally", "Overall", "On 3s", "At rim"].map((h, k) => (
            <th key={h} style={{ padding: "8px 8px", textAlign: k === 0 ? "left" : "right", fontWeight: 600, borderBottom: `1px solid ${C.LINE}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} style={{ borderBottom: `1px solid ${C.LINE}55` }}>
            <td style={{ padding: "9px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
              {playerLink ? playerLink(r.name) : r.name}
            </td>
            <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{r.overall.fga}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{r.overall.pct}%</td>
            <td style={{ padding: "9px 8px", textAlign: "right", color: C.MUTE }}>{r.overall.normPct}%</td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: diffColor(r.overall.diff) }}>{signed(r.overall.diff)}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: diffColor(r.three && r.three.fga ? r.three.diff : null) }}>{cell(r.three)}</td>
            <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 700, color: diffColor(r.rim && r.rim.fga ? r.rim.diff : null) }}>{cell(r.rim)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
