// ---------------------------------------------------------------------------
// Data layer (static snapshots, split by season and team)
//
// The app never calls stats.nba.com. `npm run fetch` (scripts/fetch-data.mjs)
// writes plain JSON files that this module reads:
//
//   data/index.json              { currentSeason, seasons: [{ season, ... }] }
//   data/<season>/league.json    { meta, teams: [{ ..., players }], teamRanks,
//                                  teamProfiles, leagueShotZones,
//                                  positionShotZones, teamZoneWins, stale }
//   data/<season>/teams/<id>.json  { games, roster, onOff, fourFactors,
//                                    playerAdv, lineups, shotZones, upcoming,
//                                    errors, stale }
//
// One file per season held every team, which meant downloading ~4.5MB to look
// at one of them. Now a cold load is the index plus one season's league file
// (~30KB) plus the team you asked for (~150KB), and everything fetched is kept
// in memory for the rest of the session, so switching back is instant.
// ---------------------------------------------------------------------------

// Root-absolute, not relative to the current page: the site serves prerendered
// HTML from nested paths (/team/boston-celtics/, /2023-24/team/boston-celtics/), and
// a relative URL would look for the data underneath those. See the note on
// `base` in vite.config.js.
const DATA_ROOT = "/data";

// Completed seasons are immutable, so they're allowed to sit in the HTTP cache;
// only the in-progress season has to be revalidated on every load.
const cache = new Map();

async function loadJson(path, { fresh = false } = {}) {
  const hit = cache.get(path);
  if (hit) return hit;

  const request = (async () => {
    let res;
    try {
      res = await fetch(path, fresh ? { cache: "no-cache" } : undefined);
    } catch (e) {
      throw new Error(`Couldn't load ${path} (${e.message}). Generate it with: npm run fetch`);
    }
    if (!res.ok) {
      throw new Error(
        `Couldn't load ${path} (HTTP ${res.status}). ` +
          `Run \`npm run fetch\` to create it, then rebuild/redeploy.`
      );
    }
    return res.json();
  })();

  // Cache the promise, not the result, so two components asking at once share
  // one request. A failure is evicted so a retry can actually retry.
  cache.set(path, request);
  request.catch(() => cache.delete(path));
  return request;
}

/** The season list the app boots from. Always revalidated: a new season appears here first. */
export function loadIndex() {
  return loadJson(`${DATA_ROOT}/index.json`, { fresh: true });
}

/** One season's team list and league-wide datasets. */
export function loadSeason(season, { current = false } = {}) {
  return loadJson(`${DATA_ROOT}/${season}/league.json`, { fresh: current });
}

/** One team's bundle within a season (its games, roster, on/off, lineups, ...). */
export function loadTeam(season, teamId, { current = false } = {}) {
  return loadJson(`${DATA_ROOT}/${season}/teams/${teamId}.json`, { fresh: current });
}

/**
 * Warm the cache for a team without waiting on it — used when the season loads,
 * so the team the page is about is usually already there by the time it renders.
 * Failures are ignored here; the real load reports them.
 */
export function prefetchTeam(season, teamId, opts) {
  loadTeam(season, teamId, opts).catch(() => {});
}
