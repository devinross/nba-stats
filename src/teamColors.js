// ---------------------------------------------------------------------------
// Team colors + the badge gradient recipe.
//
// Ported from the iOS app's `TeamBadge` (HighlightFactory/Views/SwiftUI/
// DiagonalAbbreviation.swift), which draws a team as a circle washed
// top-to-bottom from its primary color into its secondary. Same two constants
// there and here: the colors are saturation-boosted first, then composited at
// half opacity — compositing washes chroma out, so the boost is what keeps a
// navy from landing as gray. A team with one color fades to itself and reads
// as a flat tint.
//
// Keyed by the NBA stats abbreviation the data feed gives us, with the team
// nickname as the fallback key so a feed that renames an abbreviation (BKN was
// BRK for a while) or an opponent referenced by name only still finds its
// colors.
// ---------------------------------------------------------------------------

import { C } from "./palette";

// [primary, secondary] — the primary is the color the team leads with, so it
// sits at the top of the wash.
export const TEAM_COLORS = {
  ATL: ["#E03A3E", "#C1D32F"], // Hawks — red into volt
  BOS: ["#007A33", "#BA9653"], // Celtics — green into gold
  BKN: ["#000000", "#C4C4C4"], // Nets — black into silver (their white reads as no color at all)
  CHA: ["#1D1160", "#00788C"], // Hornets — purple into teal
  CHI: ["#CE1141", "#1D1D1D"], // Bulls — red into black
  CLE: ["#860038", "#FDBB30"], // Cavaliers — wine into gold
  DAL: ["#00538C", "#002B5E"], // Mavericks — blue into navy
  DEN: ["#0E2240", "#FEC524"], // Nuggets — navy into gold
  DET: ["#C8102E", "#1D42BA"], // Pistons — red into blue
  GSW: ["#1D428A", "#FFC72C"], // Warriors — blue into gold
  HOU: ["#CE1141", "#1D1D1D"], // Rockets — red into black
  IND: ["#002D62", "#FDBB30"], // Pacers — navy into gold
  LAC: ["#C8102E", "#1D428A"], // Clippers — red into blue
  LAL: ["#552583", "#FDB927"], // Lakers — purple into gold
  MEM: ["#5D76A9", "#12173F"], // Grizzlies — blue into navy
  MIA: ["#98002E", "#F9A01B"], // Heat — red into orange
  MIL: ["#00471B", "#EEE1C6"], // Bucks — green into cream
  MIN: ["#0C2340", "#78BE20"], // Timberwolves — navy into green
  NOP: ["#0C2340", "#C8102E"], // Pelicans — navy into red
  NYK: ["#006BB6", "#F58426"], // Knicks — blue into orange
  OKC: ["#007AC1", "#EF3B24"], // Thunder — blue into red
  ORL: ["#0077C0", "#C4CED4"], // Magic — blue into silver
  PHI: ["#006BB6", "#ED174C"], // 76ers — blue into red
  PHX: ["#1D1160", "#E56020"], // Suns — purple into orange
  POR: ["#E03A3E", "#1D1D1D"], // Trail Blazers — red into black
  SAC: ["#5A2D81", "#63727A"], // Kings — purple into gray
  SAS: ["#C4CED4", "#1D1D1D"], // Spurs — silver into black
  TOR: ["#CE1141", "#1D1D1D"], // Raptors — red into black
  UTA: ["#002B5C", "#F9A01B"], // Jazz — navy into yellow
  WAS: ["#002B5C", "#E31837"], // Wizards — navy into red
};

// Same palette reached by nickname, for opponents we only have a name for.
// Keyed by the last word of the team name, which is the nickname for all 30
// teams (splitTeamName in league.js handles the Trail Blazers' two-word one).
const COLORS_BY_NAME = {
  hawks: TEAM_COLORS.ATL,
  celtics: TEAM_COLORS.BOS,
  nets: TEAM_COLORS.BKN,
  hornets: TEAM_COLORS.CHA,
  bulls: TEAM_COLORS.CHI,
  cavaliers: TEAM_COLORS.CLE,
  mavericks: TEAM_COLORS.DAL,
  nuggets: TEAM_COLORS.DEN,
  pistons: TEAM_COLORS.DET,
  warriors: TEAM_COLORS.GSW,
  rockets: TEAM_COLORS.HOU,
  pacers: TEAM_COLORS.IND,
  clippers: TEAM_COLORS.LAC,
  lakers: TEAM_COLORS.LAL,
  grizzlies: TEAM_COLORS.MEM,
  heat: TEAM_COLORS.MIA,
  bucks: TEAM_COLORS.MIL,
  timberwolves: TEAM_COLORS.MIN,
  pelicans: TEAM_COLORS.NOP,
  knicks: TEAM_COLORS.NYK,
  thunder: TEAM_COLORS.OKC,
  magic: TEAM_COLORS.ORL,
  "76ers": TEAM_COLORS.PHI,
  suns: TEAM_COLORS.PHX,
  blazers: TEAM_COLORS.POR,
  kings: TEAM_COLORS.SAC,
  spurs: TEAM_COLORS.SAS,
  raptors: TEAM_COLORS.TOR,
  jazz: TEAM_COLORS.UTA,
  wizards: TEAM_COLORS.WAS,
};

// A team the map hasn't caught up with — an expansion franchise, a relocation —
// still gets a badge in the brand plum, which is what every badge on the site
// used to be.
const FALLBACK = [C.BRAND, C.BRAND_HI];

// How far the disc's gradient lets the page through, and the chroma boost
// applied before it. iOS runs 0.5 / 1.6; this page is white rather than the
// app's card gray, so half opacity strands the darker teams (Wings navy, Storm
// green) as pastels next to type that's solid black. Holding a little more of
// the color back keeps the wash reading as the team's colors while staying
// light enough for a dark emoji — the Aces' spade — to sit on top of it.
export const BADGE_OPACITY = 0.72;
export const BADGE_SATURATION = 1.35;
// Floor on how dark a stop is allowed to get. Five teams carry black as one of
// their two colors, and the emoji sits in the middle of the disc — the Nets'
// net on a true black wash is a dark glyph on a near-black ground. Lifting
// the darkest stops to a deep charcoal keeps those teams reading as black
// without swallowing their own mark.
export const BADGE_MIN_BRIGHTNESS = 0.55;

/** The [primary, secondary] pair for a team, by abbreviation then nickname. */
export function teamColors(team) {
  if (!team) return FALLBACK;
  const byAbbr = TEAM_COLORS[String(team.abbr || "").toUpperCase()];
  if (byAbbr) return byAbbr;
  // Match on the last word of whatever name we have — "Los Angeles Lakers",
  // "Lakers" and "LA Lakers" all land on the same entry. The Trail Blazers are
  // reached by "blazers" for the same reason.
  const words = String(team.teamName || team.name || team || "").trim().split(/\s+/);
  const nickname = words[words.length - 1].toLowerCase();
  return COLORS_BY_NAME[nickname] || FALLBACK;
}

/** The CSS the badge paints: the team's wash, top to bottom. */
export function teamGradient(team) {
  const [top, bottom] = teamColors(team);
  return `linear-gradient(180deg, ${wash(top)}, ${wash(bottom)})`;
}

// --- color math -------------------------------------------------------------
// UIColor.saturated(by:) works in HSB and leaves brightness alone, so this does
// too — the same hex has to produce the same disc on both platforms.

function wash(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(r, g, b);
  const stop = hsvToRgb(h, Math.min(s * BADGE_SATURATION, 1), Math.max(v, BADGE_MIN_BRIGHTNESS));
  return `rgba(${stop.r}, ${stop.g}, ${stop.b}, ${BADGE_OPACITY})`;
}

function hexToRgb(hex) {
  const raw = String(hex).replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsv(r, g, b) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}
