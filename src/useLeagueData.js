import { useEffect, useState } from "react";
import { loadIndex, loadSeason, loadTeam, prefetchTeam } from "./api";

// The data now arrives in three stages instead of one big file — the season
// index, then a season, then a team — so each has its own hook and its own
// { loading, error, data } state. The page can render as soon as the season is
// there and swap in the team when it lands, rather than blocking on everything.

function useAsync(run, deps, enabled = true) {
  const [state, setState] = useState({ loading: enabled, error: null, data: null });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    let alive = true;
    setState((s) => ({ loading: true, error: null, data: s.data }));
    run().then(
      (data) => alive && setState({ loading: false, error: null, data }),
      (error) => alive && setState({ loading: false, error, data: null })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/** Which seasons exist, and which one is in progress. */
export function useSeasonIndex() {
  return useAsync(() => loadIndex(), []);
}

/**
 * One season's league-wide data. Also kicks off a background fetch for the team
 * the page is about, so switching seasons doesn't wait on two round trips.
 */
export function useSeason(season, { current, prefetchTeamId } = {}) {
  return useAsync(
    () =>
      loadSeason(season, { current }).then((data) => {
        const first = prefetchTeamId ?? (data.teams[0] && data.teams[0].id);
        if (first != null) prefetchTeam(season, first, { current });
        return data;
      }),
    [season, current],
    season != null
  );
}

/** One team's bundle. Re-fetched when the season or the selected team changes. */
export function useTeam(season, teamId, { current } = {}) {
  return useAsync(
    () => loadTeam(season, teamId, { current }),
    [season, teamId, current],
    season != null && teamId != null
  );
}
