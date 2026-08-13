// ---------------------------------------------------------------------------
// Minimum-playing-time rules for the views that rank or plot players.
//
// Rate stats — usage, true shooting, on/off splits — are unstable over small
// samples, and an NBA roster is full of small samples: two-way contracts,
// 10-day signings, garbage-time call-ups, a starter who tore something in
// November. Plotted unfiltered they don't just add noise, they dominate the
// chart, because the extreme values are all theirs. A 4-game shooting guard at
// 74% true shooting sits above every rotation player on the y-axis.
//
// Every threshold here is **a share of the team's games**, never a fixed count,
// so it means the same thing in game 10 as in game 82 and needs no adjusting
// for a shortened season (2019-20 ran 63-75 games per team, 2020-21 ran 72).
//
// Each rule falls back to the unfiltered set when nothing clears the bar, so an
// opening week — or a team whose game list came back short — shows a busy chart
// rather than an empty one.
// ---------------------------------------------------------------------------

/**
 * Games a player must appear in to be eligible for the team-leaders strip,
 * as a share of the team's games. The leaders are per-game averages, so the
 * risk here is the one-game call-up with nine assists, not the low-minutes
 * regular — a games-played floor is enough.
 */
export const LEADER_MIN_GAME_SHARE = 0.3;

/**
 * Minutes per team game a player must average out to before they're plotted on
 * a rate-stat scatter — i.e. total minutes ÷ the team's games, so it counts
 * "played a little in most games" and "played a lot in a few" the same way.
 *
 * 6 lands at ~490 minutes over a full 82-game season, close to the 500-minute
 * cutoff these charts conventionally use, and in practice keeps a team's
 * rotation plus its fringe (13 or 14 players) while dropping the 3-and-4-game
 * appearances.
 */
export const SCATTER_MIN_MINUTES_PER_TEAM_GAME = 6;

/** The total-minutes bar for a team that has played `teamGames` games. */
export function minutesFloor(teamGames) {
  return Math.round(Math.max(0, teamGames || 0) * SCATTER_MIN_MINUTES_PER_TEAM_GAME);
}

/**
 * Split `rows` into the players with enough court time to plot and a count of
 * those left out, so the chart can say so rather than silently dropping them.
 *
 * `minutesOf` returns one row's **total** minutes for the season — the two
 * feeds spell that differently (the advanced dashboard gives minutes per game
 * alongside games played; the on/off endpoint gives an on-court total), which
 * is why it's a callback rather than a field name.
 *
 * Returns `{ rows, dropped, floor, applied }`. `applied` is false when the
 * floor was skipped — no games yet, or nobody clears it — and the caller got
 * everything back.
 */
export function qualifyByMinutes(rows, minutesOf, teamGames) {
  const all = rows || [];
  const floor = minutesFloor(teamGames);
  if (!floor) return { rows: all, dropped: 0, floor: 0, applied: false };

  const kept = all.filter((r) => minutesOf(r) >= floor);
  if (!kept.length) return { rows: all, dropped: 0, floor, applied: false };

  return { rows: kept, dropped: all.length - kept.length, floor, applied: true };
}

/**
 * The sentence a chart prints under itself to account for who isn't on it.
 * Null when nothing was dropped, so the note only appears when it has something
 * to explain.
 */
export function qualifyNote({ dropped, floor, applied }) {
  if (!applied || !dropped) return null;
  return `${dropped} player${dropped === 1 ? "" : "s"} under ${floor} minutes ${
    dropped === 1 ? "is" : "are"
  } left out — rate stats over a handful of minutes swamp the scale.`;
}
