// ---------------------------------------------------------------------------
// URL scheme.
//
//   /                                         current season, league landing
//   /team/boston-celtics                      a team's Team tab
//   /team/boston-celtics/jayson-tatum         a player's Players tab
//   /2023-24                                  a past season's landing
//   /2023-24/team/boston-celtics              that team, that season
//   /2023-24/team/boston-celtics/jayson-tatum
//
// The season in progress keeps unprefixed URLs, so nothing already indexed
// moves when a new season starts; past seasons live under a season prefix.
//
// A season is an integer everywhere in the code (2023 = the 2023-24 season) and
// is spelled out only in the URL — see the note at the top of src/league.js.
//
// This module is imported by BOTH the browser app (src/App.jsx) and the build
// script that prerenders one HTML file per route (scripts/prerender.mjs), so
// the two can never disagree about what a URL means. Keep it free of browser
// globals — it has to run in Node.
// ---------------------------------------------------------------------------

import { seasonLabel, parseSeasonLabel } from "./league.js";

/** "Boston Celtics" -> "boston-celtics"; "De'Aaron Fox" -> "deaaron-fox". */
export function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents: Nikolić -> Nikolic
    .toLowerCase()
    .replace(/['’]/g, "") // apostrophes vanish rather than becoming a dash
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const teamSlug = (team) => slugify(team.name);

/**
 * Slugs for a roster, aligned to its indices. Two players on one roster could
 * in principle slugify the same (a "Jr." suffix stripped, say), so repeats get
 * a numeric suffix instead of two routes fighting over one URL.
 *
 * The fetch script runs this at write time and stores the result as
 * `team.players[].slug` in league.json, so the browser can resolve a player URL
 * without first downloading that team's roster. Both callers share this
 * function precisely so those two answers can't drift apart.
 */
export function rosterSlugs(roster = []) {
  const seen = new Map();
  return roster.map((p) => {
    const base = slugify(p.name) || "player";
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** The URL prefix for a season: "" for the one in progress, "/2023-24" for the rest. */
export function seasonPrefix(season, currentSeason) {
  return Number(season) === Number(currentSeason) ? "" : `/${seasonLabel(season)}`;
}

/** The canonical path for a piece of app state. */
export function buildPath({ team, tab, player, season, currentSeason }) {
  const prefix = seasonPrefix(season, currentSeason);
  if (!team) return prefix || "/";
  const base = `${prefix}/team/${teamSlug(team)}`;
  if (tab === "players" && player) return `${base}/${player}`;
  return base;
}

/**
 * pathname -> { season, teamSlug, playerSlug }. Pure string work: it runs
 * before any data has loaded, which is what lets the app fetch only the season
 * and team the URL actually asks for.
 *
 * `seasons` is the list of seasons that exist (from data/index.json), so
 * "/2023-24/..." is only read as a season when 2023-24 is one of them —
 * otherwise the whole path falls back to the current season's landing.
 */
export function parsePath(pathname, { seasons = [], currentSeason } = {}) {
  const parts = String(pathname || "/").split("/").filter(Boolean);
  const known = new Set(seasons.map(Number));

  let season = currentSeason;
  const leading = parts.length ? parseSeasonLabel(parts[0]) : null;
  if (leading != null) {
    if (!known.has(leading)) return { season: currentSeason, teamSlug: null, playerSlug: null, matched: false };
    season = leading;
    parts.shift();
  }

  if (!parts.length) return { season, teamSlug: null, playerSlug: null, matched: true };
  if (parts[0] !== "team" || !parts[1]) return { season, teamSlug: null, playerSlug: null, matched: false };
  return { season, teamSlug: parts[1], playerSlug: parts[2] || null, matched: true };
}

/**
 * Resolve the team/player halves of a parsed path against a loaded season.
 *
 * A path with no team is the league page — the season as a whole — so it
 * resolves to `teamId: null` rather than to some arbitrary first team. Anything
 * unrecognized falls back to the same league page, so a stale or hand-edited URL
 * still renders the app instead of an error.
 */
export function resolveInSeason({ teamSlug: wantTeam, playerSlug: wantPlayer }, league) {
  const fallback = { teamId: null, tab: "team", sel: 0, matched: false };
  if (!wantTeam) return { ...fallback, matched: true };

  const team = league.teams.find((t) => teamSlug(t) === wantTeam);
  if (!team) return fallback;
  if (!wantPlayer) return { teamId: team.id, tab: "team", sel: 0, matched: true };

  const idx = (team.players || []).findIndex((p) => p.slug === wantPlayer);
  if (idx < 0) return { teamId: team.id, tab: "team", sel: 0, matched: true };
  return { teamId: team.id, tab: "players", sel: idx, matched: true };
}

/**
 * Every route for one season, in sitemap order. `players: false` stops at team
 * pages — what the build does for past seasons, where ~250 prerendered player
 * pages per archived year would swamp the build for little crawl value.
 */
export function seasonRoutes(league, currentSeason, { players = true } = {}) {
  const prefix = seasonPrefix(league.meta.season, currentSeason);
  const routes = [prefix || "/"];
  for (const team of league.teams) {
    const base = `${prefix}/team/${teamSlug(team)}`;
    routes.push(base);
    if (players) for (const p of team.players || []) routes.push(`${base}/${p.slug}`);
  }
  return routes;
}
