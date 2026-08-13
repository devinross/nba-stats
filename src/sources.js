// ---------------------------------------------------------------------------
// Where every number on this site comes from.
//
// scripts/fetch-data.mjs pulls from the stats.nba.com JSON endpoints, but each
// of those endpoints has a human-readable page on the same site showing the
// same rows with the same filters. This module maps one to the other so every
// section can footnote its own source and you can open the page and check the
// numbers by hand.
//
// The query strings here deliberately mirror the parameter sets in
// fetch-data.mjs (COMMON / TEAM_DASH / PLAYER_DASH / ONOFF / LINEUP_DASH). If
// you change a PerMode or a MeasureType there, change it here too, or the
// footnote will point at a view that doesn't reconcile.
//
// `formula` is filled in only where we compute something stats.nba.com does
// not publish directly — those are the numbers worth double-checking, because
// the arithmetic is ours, not theirs.
// ---------------------------------------------------------------------------

import { LEAGUE, seasonParam } from "./league.js";

// The pages the footnotes link to, which is not the host the fetch script
// calls — see LEAGUE.pagesHost for why.
export const STATS_HOST = LEAGUE.pagesHost;

const qs = (params) =>
  new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== "")
  ).toString();

// Shared filters: every request the fetch script makes is regular season only.
const SEASON = (season) => ({ Season: seasonParam(season), SeasonType: "Regular Season" });

const SOURCES = {
  // --- league-wide -------------------------------------------------------
  // Taken as published, in nba.com's own per-100 mode: their possession count
  // comes from play-by-play, where the classic box-score estimate
  // (FGA + 0.44×FTA − OREB + TOV) runs ~2% high. The linked page shows these
  // exact numbers, so it reconciles cell-for-cell.
  teamProfiles: ({ season }) => ({
    label: "Teams · Traditional (per 100 possessions)",
    url: `${STATS_HOST}/teams/traditional?${qs({ ...SEASON(season), PerMode: "Per100Possessions" })}`,
    formula: "Shown as published. 2P is the only arithmetic — FGA minus 3PA, both counted.",
  }),

  fourFactors: ({ season }) => ({
    label: "Teams · Four Factors",
    url: `${STATS_HOST}/teams/four-factors?${qs({ ...SEASON(season), PerMode: "Totals" })}`,
    formula:
      "Shown as published, in nba.com's definitions — turnover % is turnovers ÷ possessions, and the " +
      "rebound percentages sit on a different base than Basketball-Reference's, so both read higher there.",
  }),

  teamRanks: ({ season }) => ({
    label: "Teams · Advanced",
    url: `${STATS_HOST}/teams/advanced?${qs({ ...SEASON(season), PerMode: "PerGame" })}`,
    formula:
      "Pace is the PACE column — possessions per 48 minutes, as nba.com publishes it.",
  }),

  teamShotZones: ({ season }) => ({
    label: "Teams · Shooting (by zone)",
    url: `${STATS_HOST}/teams/shooting?${qs({
      ...SEASON(season),
      PerMode: "Totals",
      DistanceRange: "By Zone",
    })}`,
  }),

  teamZoneWins: ({ season }) => ({
    label: "Teams · Shooting (by zone)",
    url: `${STATS_HOST}/teams/shooting?${qs({
      ...SEASON(season),
      PerMode: "Totals",
      DistanceRange: "By Zone",
    })}`,
    formula: "Win% is from the team game log; zone accuracy is ours, plotted against it.",
  }),

  // --- per team ----------------------------------------------------------
  games: ({ season, teamId }) => ({
    label: "Team · Box Scores",
    url: `${STATS_HOST}/team/${teamId}/boxscores-traditional?${qs(SEASON(season))}`,
  }),

  roster: ({ season, teamId }) => ({
    label: "Team · Players Traditional",
    url: `${STATS_HOST}/team/${teamId}/players-traditional?${qs({
      ...SEASON(season),
      PerMode: "PerGame",
    })}`,
  }),

  teamShooting: ({ season, teamId }) => ({
    label: "Team · Players Traditional (season totals)",
    url: `${STATS_HOST}/team/${teamId}/players-traditional?${qs({
      ...SEASON(season),
      PerMode: "Totals",
    })}`,
    formula:
      "Summed across the roster, then eFG% = (FGM + 0.5×3PM) ÷ FGA and TS% = PTS ÷ (2 × (FGA + 0.44×FTA)).",
  }),

  scoringShare: ({ season, teamId }) => ({
    label: "Team · Players Traditional (season totals)",
    url: `${STATS_HOST}/team/${teamId}/players-traditional?${qs({
      ...SEASON(season),
      PerMode: "Totals",
    })}`,
    formula: "Each player's points ÷ the roster's combined points.",
  }),

  playerAdv: ({ season, teamId }) => ({
    label: "Players · Advanced",
    url: `${STATS_HOST}/players/advanced?${qs({
      ...SEASON(season),
      PerMode: "PerGame",
      TeamID: teamId,
    })}`,
  }),

  // Anything drawn game-by-game (a player's scoring line, their TS% trend, the
  // game log itself) comes from the player game log, so it points at the
  // game-by-game page rather than the season-averages one.
  playerLog: ({ season, teamId }) => ({
    label: "Players · Box Scores (game by game)",
    url: `${STATS_HOST}/players/boxscores-traditional?${qs({
      ...SEASON(season),
      TeamID: teamId,
    })}`,
  }),

  playerShotZones: ({ season, teamId }) => ({
    label: "Players · Shooting (by zone)",
    url: `${STATS_HOST}/players/shooting?${qs({
      ...SEASON(season),
      PerMode: "Totals",
      DistanceRange: "By Zone",
      TeamID: teamId,
    })}`,
  }),

  onOff: ({ season, teamId }) => ({
    label: "Team · On/Off Court Advanced",
    url: `${STATS_HOST}/team/${teamId}/onoffcourt-advanced?${qs({
      ...SEASON(season),
      PerMode: "Totals",
    })}`,
  }),

  lineups: ({ season, teamId }) => ({
    label: "Team · Lineups Advanced (5-player)",
    url: `${STATS_HOST}/team/${teamId}/lineups-advanced?${qs({
      ...SEASON(season),
      PerMode: "Totals",
      GroupQuantity: "5",
    })}`,
  }),

  upcoming: () => ({
    label: `${LEAGUE.name} schedule`,
    url: `${LEAGUE.webHost}/schedule`,
  }),
};

// Keys whose URL is team-scoped, so they can't be built before the team is
// known. Listed explicitly rather than sniffed off the builder's source, which
// a minifier would rewrite.
const TEAM_SCOPED = new Set([
  "games", "roster", "teamShooting", "scoringShare",
  "playerAdv", "playerLog", "playerShotZones", "onOff", "lineups",
]);

/**
 * The nba.com page behind a dataset, or null if the key is unknown or the
 * context it needs (a team id, a season) hasn't arrived yet.
 */
export function sourceFor(key, { season, teamId } = {}) {
  const build = SOURCES[key];
  if (!build || season == null) return null;
  if (TEAM_SCOPED.has(key) && teamId == null) return null;
  return build({ season, teamId });
}
