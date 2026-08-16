#!/usr/bin/env node
// ---------------------------------------------------------------------------
// NBA Analytics — data fetcher (all teams, any season)
//
// Pulls NBA data from stats.nba.com and writes it to static files the web app
// reads. The deployed site never talks to stats.nba.com — no proxy, no CORS,
// no IP blocking, no runtime 500s.
//
//     npm run fetch                       just the current season (the nightly job)
//     npm run fetch -- --missing          fetch any season since 2016-17 not on disk
//     npm run fetch -- --season 2019-20   one season, refetched from scratch
//     npm run fetch -- --seasons 16-19    a range (start years, short or full)
//     npm run fetch -- --repair           retry only the seasons with gaps in them
//     npm run fetch -- --out <dir>        write somewhere other than public/data
//     npm run fetch -- --no-rotations     skip the per-game rotation backfill
//     npm run fetch -- --rotation-limit 200   fetch more rotations than the
//                                         nightly cap (0 = no cap)
//
// Completed seasons never change, so they are fetched once and then left alone;
// only the current season is worth re-running. A season is named by its start
// year on disk (2025 = the 2025-26 season) — see the note in src/league.js.
// Output layout (see writeSeason):
//
//     public/data/index.json            the season list the app boots from
//     public/data/2025/league.json      teams + league-wide sets for 2025-26
//     public/data/2025/teams/<id>.json  one file per team
//     data-cache/rotations/2025/<g>.json   one file per game's substitutions
//
// Most of this is a handful of league-wide requests. Two things are not: the
// shot chart is one request per team (the league-wide form truncates — see
// SHOT_CHART), and rotations are one request per game, cached per game and
// never refetched. The first run on a season is long; every run after it is
// short. See the "rotations" section below.
//
// Run from a machine whose IP stats.nba.com doesn't block (your Mac is fine;
// many shared hosts are not). It prints the real status of every request.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, readdir, rm, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The app's own slug rules, imported rather than reimplemented so a player's
// URL can never mean one thing in the data and another in the browser.
import { rosterSlugs } from "../src/routes.js";
// Everything league-specific — host, LeagueID, season spelling, pace column,
// team names and emoji — so this script and the app can't disagree about them.
import { LEAGUE, seasonParam, seasonLabel, parseSeasonLabel, emojiFor, splitTeamName, conferenceOf } from "../src/league.js";

// ----- config ---------------------------------------------------------------

const { currentSeason: CURRENT_SEASON, oldestSeason: OLDEST_SEASON } = LEAGUE;

const HOST = LEAGUE.statsHost;
const REQUEST_TIMEOUT_MS = 30000;
const DELAY_BETWEEN_CALLS_MS = 500; // be gentle with the undocumented endpoint

// How long a carried-over dataset may keep standing in for a live one (see the
// "previous-snapshot fallback" section below). Past this, we'd rather show the
// section as unavailable than pass off three-week-old ratings as current.
// Completed seasons are exempt: their numbers are final, so last year's copy of
// a dataset is not "stale", it's just the answer.
const MAX_STALE_DAYS = 21;

// How much of the league schedule the home page's scoreboard carries: enough
// finished games behind today to show last night's results, enough ahead to
// show the next few days. See the scoreboard block in fetchSeason.
const SCOREBOARD_BACK_DAYS = 4;
const SCOREBOARD_FWD_DAYS = 6;

// A per-game average only counts as a league lead once a player has appeared in
// this share of his team's games — the NBA's own 58-of-82 leaderboard qualifier.
const LEADER_MIN_SHARE = LEAGUE.leaderMinShare;

// The nba.com schedule feed carries preseason, All-Star and postseason games
// alongside the regular season, keyed by the game id's third digit. Every other
// dataset here is SeasonType=Regular Season, so the schedule is filtered to
// match rather than putting a preseason game on a page of regular-season rows.
const REGULAR_SEASON_GAME = /^\d{2}2/;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${LEAGUE.webHost}/`,
  Origin: LEAGUE.webHost,
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  Connection: "keep-alive",
};

const DEFAULT_OUT_DIR = fileURLToPath(new URL("../public/data", import.meta.url));

// ----- parameter sets --------------------------------------------------------
// Every set is a function of the season, since one run can cover several.

const COMMON = (season) => ({
  LeagueID: LEAGUE.id, Season: seasonParam(season), SeasonType: "Regular Season",
  Counter: "0", Sorter: "DATE", Direction: "ASC", DateFrom: "", DateTo: "",
});

const ONOFF = (season) => ({
  LeagueID: LEAGUE.id, Season: seasonParam(season), SeasonType: "Regular Season",
  MeasureType: "Advanced", PerMode: "Totals", PlusMinus: "N", PaceAdjust: "N",
  Rank: "N", Outcome: "", Location: "", Month: "0", SeasonSegment: "",
  DateFrom: "", DateTo: "", OpponentTeamID: "0", VsConference: "", VsDivision: "",
  GameSegment: "", Period: "0", LastNGames: "0",
});

// The full NBA filter set. TwoWay and ISTRound are NBA-only — the WNBA fork
// omits them because sending them makes that backend error — and are sent empty
// here, which is what nba.com's own pages do: no two-way filter, all rounds.
const DASH_COMMON = (season) => ({
  LeagueID: LEAGUE.id, Season: seasonParam(season), SeasonType: "Regular Season",
  PerMode: "PerGame", MeasureType: "Advanced", PlusMinus: "N", PaceAdjust: "N",
  Rank: "N", Outcome: "", Location: "", Month: "0", SeasonSegment: "",
  DateFrom: "", DateTo: "", OpponentTeamID: "0", VsConference: "", VsDivision: "",
  Conference: "", Division: "", GameScope: "", GameSegment: "", Period: "0",
  ShotClockRange: "", LastNGames: "0", PORound: "0", TeamID: "0", DistanceRange: "",
  TwoWay: "0", ISTRound: "",
});
const TEAM_DASH = (season) => ({ ...DASH_COMMON(season), PlayerExperience: "", PlayerPosition: "", StarterBench: "" });
const PLAYER_DASH = (season) => ({ ...TEAM_DASH(season), College: "", Country: "", DraftPick: "", DraftYear: "", Height: "", Weight: "" });
const LINEUP_DASH = (season) => ({ ...DASH_COMMON(season), GroupQuantity: "5", GameID: "" });

// Every attempt of one team's season, one row each, with the ACTION_TYPE label
// that shapeShotTypes buckets. ContextMeasure=FGA is what makes it return
// misses as well as makes — without it the whole breakdown would read as 100%.
//
// Per team, not per league: `shotchartdetail` caps its response at 102,400 rows
// and an NBA season is around 218,000 attempts, so the TeamID=0 form the WNBA
// fork uses would silently return half a season here and no error with it. One
// team is ~7,500 rows and answers in about two seconds.
const SHOT_CHART = (season, teamId) => ({
  LeagueID: LEAGUE.id, Season: seasonParam(season), SeasonType: "Regular Season",
  PlayerID: "0", TeamID: String(teamId), GameID: "", ContextMeasure: "FGA",
  PlayerPosition: "", Outcome: "", Location: "", Month: "0", SeasonSegment: "",
  DateFrom: "", DateTo: "", OpponentTeamID: "0", VsConference: "", VsDivision: "",
  RookieYear: "", Period: "0", LastNGames: "0", ContextFilter: "", StartPeriod: "",
  EndPeriod: "", StartRange: "", EndRange: "", RangeType: "", AheadBehind: "",
  ClutchTime: "", PointDiff: "", GameSegment: "",
});

const DEFEND = (season, category) => ({
  LeagueID: LEAGUE.id, Season: seasonParam(season), SeasonType: "Regular Season",
  PerMode: "Totals", DefenseCategory: category, TeamID: "0",
  Conference: "", Division: "", PlayerExperience: "", PlayerPosition: "",
  StarterBench: "", Outcome: "", Location: "", Month: "0", SeasonSegment: "",
  DateFrom: "", DateTo: "", OpponentTeamID: "0", VsConference: "", VsDivision: "",
  PORound: "0", GameSegment: "", Period: "0", LastNGames: "0",
});

// ----- fetch + parse helpers -------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- progress reporting -----------------------------------------------------
// Every step announces itself before it goes out and reports what came back when
// it lands. On a terminal the open line also ticks a seconds counter while we
// wait, so a slow endpoint (they get REQUEST_TIMEOUT_MS before giving up) reads
// as "still working" rather than a hung script. Redirected to a log file — the
// nightly job — the ticker is skipped and each step stays one static line.

const TTY = Boolean(process.stdout.isTTY);
const CLEAR_EOL = "\u001b[K"; // rub out the previous tick, which may be longer
const elapsed = (since) => `${((Date.now() - since) / 1000).toFixed(1)}s`;
// Wall-clock HH:MM:SS for the log-only lines of a long step: a run that stalls
// at 3am should say where in the night it stalled.
const stamp = () => new Date().toTimeString().slice(0, 8);
let live = null; // { label, started, timer } while a step is in flight

function begin(label) {
  live = { label, started: Date.now(), timer: null };
  process.stdout.write(label);
  if (!TTY) return;
  live.timer = setInterval(() => {
    process.stdout.write(`\r${label}${elapsed(live.started)}${CLEAR_EOL}`);
  }, 1000);
  live.timer.unref(); // a ticking line must never be what keeps the run alive
}

// A step that threw past its own handler: stop the ticker and end the line, so
// the error that follows isn't written over a half-finished one.
function abandon() {
  if (!live) return;
  clearInterval(live.timer);
  if (TTY) process.stdout.write(`\r${live.label}${CLEAR_EOL}`);
  console.log("FAILED");
  live = null;
}

// Close the line begin() opened with whatever the step produced. Anything that
// took a moment carries its own timing, so the slow parts of a run are obvious.
function done(result) {
  if (!live) return void console.log(result);
  clearInterval(live.timer);
  const took = Date.now() - live.started;
  if (TTY) process.stdout.write(`\r${live.label}${CLEAR_EOL}`);
  console.log(took >= 1000 ? `${result} · ${elapsed(live.started)}` : result);
  live = null;
}

async function statsFetch(endpoint, params, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const usp = new URLSearchParams(params);
  const url = `${HOST}/stats/${endpoint}?${usp.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === "AbortError" ? `timed out after ${timeoutMs}ms` : e.message);
  }
  clearTimeout(timer);
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch (_) {}
    let detail = `HTTP ${res.status}`;
    if (body) {
      try {
        const j = JSON.parse(body);
        const msg = j.error || j.message || j.Message || "";
        if (msg) detail = `HTTP ${res.status}: ${msg}`;
      } catch (_) {
        const snippet = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
        if (snippet) detail = `HTTP ${res.status}: ${snippet}`;
      }
    }
    throw new Error(detail);
  }
  return res.json();
}

// The six standard shot zones we keep from leaguedash*shotlocations, mapped to
// short stable keys. The API also returns "Backcourt" and an aggregate
// "Corner 3" which we ignore (the two corners are kept separately).
const SHOT_ZONES = [
  ["Restricted Area", "ra"],
  ["In The Paint (Non-RA)", "paint"],
  ["Mid-Range", "mid"],
  ["Left Corner 3", "lc3"],
  ["Right Corner 3", "rc3"],
  ["Above the Break 3", "atb3"],
];

// Parse a leaguedash*shotlocations response. Its resultSet has a two-tier
// header: headers[0].columnNames are the zone names (in order), and
// headers[1].columnNames is a flat list of a few id columns followed by
// FGM,FGA,FG_PCT repeated once per zone. We locate each kept zone by its name
// and read the makes/attempts from the matching triplet. Returns
// [{ <idField>: ..., zones: [{ z, m, a }] }].
function shapeShotZones(json, idFields) {
  let sets = json.resultSets || json.resultSet || [];
  if (!Array.isArray(sets)) sets = [sets];
  const set = sets.find((s) => s && s.headers && s.headers.length) || sets[0];
  if (!set || !set.headers) return [];
  const zoneNames = (set.headers[0] && set.headers[0].columnNames) || [];
  const flat = (set.headers[1] && set.headers[1].columnNames) || [];
  const idCount = flat.length - zoneNames.length * 3; // 2 for teams, 6 for players
  // Column offset of the FGM cell for each kept zone.
  const zoneCols = SHOT_ZONES.map(([name, key]) => {
    const i = zoneNames.indexOf(name);
    return { key, col: i >= 0 ? idCount + i * 3 : -1 };
  });
  return (set.rowSet || []).map((row) => {
    const o = {};
    idFields.forEach((f, i) => (o[f] = row[i]));
    o.zones = zoneCols.map(({ key, col }) => ({
      z: key,
      m: col >= 0 ? n(row[col]) : 0,
      a: col >= 0 ? n(row[col + 1]) : 0,
    }));
    return o;
  });
}

// ----- shot action types -----------------------------------------------------
// `shotchartdetail` labels every attempt with an ACTION_TYPE describing how the
// shot was created — "Pullup Jump shot", "Cutting Layup Shot", "Step Back Jump
// shot", "Putback Layup Shot" and forty-odd others. Bucketing those gets most
// of the way to a play-type breakdown without a second dataset.
//
// What this can and cannot answer, so nobody reads more into it than it holds:
// spot-ups, cuts, putbacks and post-ups are close to honest — cuts and putbacks
// are labelled by the API rather than inferred. Pick-and-roll is NOT here. The
// shot feed records no screens, so `pull3`/`pull2` mean "off the dribble", a
// P&R ball handler mixed in with isolations, and there is no roll-man bucket.
// nba.com does publish Synergy play types (`synergyplaytypes`) if that question
// is worth its own section one day; this is not a lesser version of it, it
// counts a different thing (every attempt, rather than possessions used).
//
// Ten buckets, matched in order — the first pattern that hits wins, so the
// specific ones (cut, putback) come before the generic ones (rim, spot). Every
// action type lands somewhere; `other` exists so a label the API adds later is
// visibly uncategorised rather than silently dropped.
const SHOT_TYPES = [
  ["putback", /Putback|^Tip /i],           // second-chance finishes off an offensive board
  ["cut", /Cutting|Alley Oop/i],           // moving to the rim off a pass — the closest thing to a roll
  ["post", /Hook|Turnaround|Fadeaway/i],   // back-to-basket footwork
  ["float", /Floating/i],                  // floaters and runners in the lane
  ["pull", /Pullup|Pull-Up|Step Back|Running Jump/i], // off the dribble (split 2/3 below)
  // Attacking off the bounce. The dunk half of this is the one real departure
  // from the WNBA fork's list: "Running Dunk Shot" and "Reverse Dunk Shot" are
  // 2,000 attempts a season here and essentially none there, and they are
  // drives finished above the rim rather than the unqualified layups `rim`
  // exists to catch.
  ["drive", /Driving|Running .*(Layup|Dunk)|Finger Roll|Reverse (Layup|Dunk)/i],
  ["rim", /Layup|Dunk/i],                  // plain layups and dunks, no other qualifier
  ["spot", /Jump/i],                       // caught and shot (split 2/3 below)
];

// Rows that aren't a shot. "No Shot" turns up attached to goaltending and
// similar oddities; counting them would quietly pad a player's attempts with
// events he never took.
const NON_SHOT = /^No Shot$/i;

// `pull` and `spot` are the two buckets where the shot's distance changes what
// it means — a caught-and-shot three is a very different skill from a caught-
// and-shot mid-range — so each splits into a 2PT and a 3PT variant. The rest
// are close-range by nature and stay whole.
const SPLIT_BY_DISTANCE = new Set(["pull", "spot"]);

function classifyShot(actionType, shotType) {
  const hit = SHOT_TYPES.find(([, re]) => re.test(String(actionType)));
  if (!hit) return "other";
  const [key] = hit;
  if (!SPLIT_BY_DISTANCE.has(key)) return key;
  return String(shotType).startsWith("3") ? `${key}3` : `${key}2`;
}

/**
 * Accumulates `shotchartdetail`'s one-row-per-attempt into per-player, per-team
 * and league-wide tallies. One instance collects the whole season across the
 * per-team requests (see SHOT_CHART for why there are thirty of them).
 *
 * Buckets with no attempts are dropped rather than kept as zeroes: most players
 * only ever touch half of them, and the team files are downloaded by the
 * browser.
 */
function shotTypeCollector() {
  const byPlayer = new Map();
  const byTeam = new Map();
  const league = new Map();
  // How many attempts carried no play context at all — a bare "Jump Shot" or
  // "Layup Shot" with none of the qualifiers the buckets key off. It runs ~30%
  // in recent seasons and higher the further back you go, when the feed simply
  // recorded less: drives were logged as plain layups, pull-ups as plain
  // jumpers. That pushes an old season's breakdown toward `spot` and `rim` and
  // away from `drive` and `pull`, so the number rides along with the data and
  // the UI can caveat a season rather than show 2016 and 2025 as equals.
  let generic = 0;
  let counted = 0;

  const bump = (map, id, key, made) => {
    if (!map.has(id)) map.set(id, new Map());
    const buckets = map.get(id);
    const e = buckets.get(key) || { t: key, m: 0, a: 0 };
    e.a++; e.m += made;
    buckets.set(key, e);
  };

  return {
    /** Fold one response in. Returns how many attempts it contributed. */
    add(json) {
      const set = (json.resultSets || []).find((s) => s && s.name === "Shot_Chart_Detail");
      if (!set || !set.rowSet) return 0;
      const H = Object.fromEntries(set.headers.map((h, i) => [h, i]));
      let added = 0;
      for (const row of set.rowSet) {
        const action = row[H.ACTION_TYPE];
        if (NON_SHOT.test(action)) continue;
        counted++;
        added++;
        if (action === "Jump Shot" || action === "Layup Shot") generic++;
        const key = classifyShot(action, row[H.SHOT_TYPE]);
        const made = n(row[H.SHOT_MADE_FLAG]);
        bump(byPlayer, row[H.PLAYER_ID], key, made);
        bump(byTeam, row[H.TEAM_ID], key, made);
        bump(league, 0, key, made);
      }
      return added;
    },
    /**
     * Sorted by volume so the UI can render buckets in order without
     * re-sorting, and the biggest part of a player's diet reads first.
     */
    result() {
      const flatten = (map) =>
        new Map([...map].map(([id, buckets]) => [id, [...buckets.values()].sort((a, b) => b.a - a.a)]));
      return {
        byPlayer: flatten(byPlayer),
        byTeam: flatten(byTeam),
        league: [...(league.get(0) || new Map()).values()].sort((a, b) => b.a - a.a),
        generic: counted ? Math.round((generic / counted) * 1000) / 10 : 0,
      };
    },
  };
}

// ----- defensive matchups ----------------------------------------------------
// `leaguedashptdefend` gives, per defender, the FG% shooters managed with him
// as the closest defender, next to what those same shooters normally shoot
// (NORMAL_FG_PCT). The gap between the two is the stat worth having — raw FG%
// allowed mostly measures who a defender happens to guard.
//
// One request per category rather than one per player: the per-player form
// (`playerdashptshotdefend`) needs ~550 calls a season against an endpoint that
// throttles, and this returns the same numbers for the whole league in six.
const DEFEND_CATEGORIES = [
  ["Overall", "all"],
  ["3 Pointers", "3pt"],
  ["2 Pointers", "2pt"],
  ["Less Than 6Ft", "lt6"],
  ["Less Than 10Ft", "lt10"],
  ["Greater Than 15Ft", "gt15"],
];

// Takes [categoryKey, resultSet] pairs straight off the API rather than row
// objects, because the columns that matter have to be found by position.
function shapeDefend(setsByCategory) {
  const byPlayer = new Map();
  const skipped = [];
  for (const [key, set] of setsByCategory) {
    if (!set || !Array.isArray(set.headers) || !Array.isArray(set.rowSet)) continue;
    const H = Object.fromEntries(set.headers.map((h, i) => [h, i]));

    // Every category ends with the same five columns in the same order — makes,
    // attempts, the FG% he allowed, the FG% those shooters normally manage,
    // and the gap between them. Only the *names* change: Overall calls them
    // D_FGM/D_FG_PCT/NORMAL_FG_PCT, threes use FG3M/FG3_PCT/NS_FG3_PCT, and the
    // distance splits use FGM_LT_06/LT_06_PCT/NS_LT_06_PCT and friends. Reading
    // the tail by position beats keeping six sets of names in sync by hand.
    const tail = set.headers.length - 5;
    const [cFgm, cFga, cPct, cNorm, cDiff] = [0, 1, 2, 3, 4].map((i) => tail + i);
    // ...but "the last five" is an assumption about someone else's API, so
    // check it holds before trusting the numbers. Both percentage columns say
    // so in their names; if they don't, the layout moved and this category is
    // dropped rather than written out as plausible-looking nonsense.
    if (tail < 0 || !/PCT/.test(set.headers[cPct] || "") || !/PCT/.test(set.headers[cNorm] || "")) {
      skipped.push(key);
      continue;
    }

    for (const row of set.rowSet) {
      const id = row[H.CLOSE_DEF_PERSON_ID];
      if (id == null) continue;
      if (!byPlayer.has(id)) byPlayer.set(id, []);
      byPlayer.get(id).push({
        c: key,
        gp: n(row[H.GP]),
        freq: pctOf(row[H.FREQ]),
        fgm: n(row[cFgm]),
        fga: n(row[cFga]),
        // Allowed, expected, and the difference — negative means shooters did
        // worse than usual against him, which is the direction that is good.
        pct: pctOf(row[cPct]),
        normPct: pctOf(row[cNorm]),
        diff: pctOf(row[cDiff]),
      });
    }
  }
  // Keep the categories in DEFEND_CATEGORIES order regardless of which request
  // came back first, so every player's row reads the same way.
  const order = new Map(DEFEND_CATEGORIES.map(([, key], i) => [key, i]));
  for (const list of byPlayer.values()) list.sort((a, b) => order.get(a.c) - order.get(b.c));
  return { byPlayer, skipped };
}

function toObjects(json, name) {
  let sets = json.resultSets || json.resultSet || [];
  if (!Array.isArray(sets)) sets = [sets];
  let set = name ? sets.find((s) => s && s.name === name) : sets[0];
  if (!set) set = sets.find((s) => s && s.headers && s.headers.length);
  if (!set || !set.headers) return [];
  const cols = set.headers;
  return (set.rowSet || []).map((row) => {
    const o = {};
    cols.forEach((c, i) => (o[c] = row[i]));
    return o;
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  const [, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!m || !d) return String(iso);
  return `${MONTHS[m - 1]} ${d}`;
}
const n = (v) => (v == null ? 0 : Number(v) || 0);
const sumPts = (logs) => logs.reduce((a, l) => a + l.pts, 0);
const r1 = (v) => Math.round(n(v) * 10) / 10;
const pctOf = (v) => Math.round(n(v) * 1000) / 10;
function lastName(name) { const p = String(name).trim().split(" "); return p[p.length - 1]; }
function cleanLineup(g) { return String(g).split(" - ").map((s) => lastName(s)).join(" / "); }

// ----- per-team transforms ---------------------------------------------------

function buildGames(teamRows, teamId, rowsByGame, scoreOf) {
  return teamRows
    .filter((r) => r.TEAM_ID === teamId)
    .sort((a, b) => (a.GAME_DATE < b.GAME_DATE ? -1 : 1))
    .map((r) => {
      const pair = rowsByGame.get(r.GAME_ID) || [];
      const opp = pair.find((x) => x.TEAM_ID !== teamId);
      const oppId = opp ? opp.TEAM_ID : null;
      // The team game-log PTS is the final (OT-inclusive) score, but it can
      // briefly lag for a just-finished game and show a regulation tie. The sum
      // of a team's players' points is always the final total, so take whichever
      // is larger — that guarantees overtime scoring is reflected.
      const tm = Math.max(n(r.PTS), scoreOf(r.GAME_ID, teamId));
      const op = opp ? Math.max(n(opp.PTS), scoreOf(r.GAME_ID, oppId)) : null;
      return {
        id: r.GAME_ID, date: fmtDate(r.GAME_DATE),
        opp: opp ? opp.TEAM_ABBREVIATION : String(r.MATCHUP || "").split(/ vs\.? | @ /)[1] || "",
        home: String(r.MATCHUP || "").includes(" vs"),
        w: r.WL === "W", tm, op,
      };
    })
    .filter((g) => (g.tm || 0) > 0 || (g.op || 0) > 0) // drop unplayed / not-yet-scored games
    .map((g, idx) => ({ ...g, i: idx })); // contiguous game indices after filtering
}

/**
 * League standings, from the same team game log the per-team game lists are
 * built from. Nothing here is a fresh request: it's the one table a league-wide
 * page has to open with, and computing it once at fetch time keeps the home
 * page from having to download all thirty team files to add up W-L.
 *
 * Sorted by win percentage, then point differential. Each row carries its
 * conference, and games behind is measured against that conference's leader —
 * the NBA seeds two brackets, so a league-wide GB column would be a number
 * nobody uses. These are not the league's own standings: the real tiebreakers
 * (head-to-head, division, conference record) aren't applied, so teams level on
 * record can be a row out of official order.
 */
function buildStandings(teamRows, teamIds, rowsByGame, scoreOf) {
  const byTeam = new Map(teamIds.map((id) => [id, []]));
  const chronological = [...teamRows].sort((a, b) => (a.GAME_DATE < b.GAME_DATE ? -1 : 1));
  for (const r of chronological) {
    const list = byTeam.get(r.TEAM_ID);
    if (!list) continue;
    const opp = (rowsByGame.get(r.GAME_ID) || []).find((x) => x.TEAM_ID !== r.TEAM_ID);
    const tm = Math.max(n(r.PTS), scoreOf(r.GAME_ID, r.TEAM_ID));
    const op = opp ? Math.max(n(opp.PTS), scoreOf(r.GAME_ID, opp.TEAM_ID)) : 0;
    if (tm <= 0 && op <= 0) continue; // scheduled but not yet played
    list.push({ w: r.WL === "W", home: String(r.MATCHUP || "").includes(" vs"), tm, op });
  }

  const rows = [];
  for (const [teamId, games] of byTeam) {
    const gp = games.length;
    const w = games.filter((g) => g.w).length;
    const rec = (arr) => [arr.filter((g) => g.w).length, arr.filter((g) => !g.w).length];
    const [l10w, l10l] = rec(games.slice(-10));
    const [homeW, homeL] = rec(games.filter((g) => g.home));
    const [awayW, awayL] = rec(games.filter((g) => !g.home));
    // Signed run of the same result, most recent first: +3 = won the last three.
    let streak = 0;
    for (let i = games.length - 1; i >= 0; i--) {
      if (i < games.length - 1 && games[i].w !== games[i + 1].w) break;
      streak += games[i].w ? 1 : -1;
    }
    const pf = games.reduce((a, g) => a + g.tm, 0);
    const pa = games.reduce((a, g) => a + g.op, 0);
    rows.push({
      teamId,
      conf: conferenceOf(teamId),
      gp, w, l: gp - w,
      pct: gp ? Math.round((w / gp) * 1000) / 1000 : 0,
      pf: gp ? r1(pf / gp) : 0,
      pa: gp ? r1(pa / gp) : 0,
      diff: gp ? r1((pf - pa) / gp) : 0,
      streak,
      l10w, l10l, homeW, homeL, awayW, awayL,
    });
  }

  rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff);
  // Games behind and seed, both within the conference — or league-wide for a
  // team the conference map doesn't know, so a row is never left without them.
  const leaders = new Map();
  const seeds = new Map();
  for (const t of rows) {
    const key = t.conf || "league";
    if (!leaders.has(key)) leaders.set(key, t);
    seeds.set(key, (seeds.get(key) || 0) + 1);
    t.rank = seeds.get(key);
    const lead = leaders.get(key);
    t.gb = Math.round((((lead.w - t.w) + (t.l - lead.l)) / 2) * 10) / 10;
  }
  return rows;
}

// The per-game categories the league leaderboard carries, in display order.
const LEADER_CATS = [
  ["pts", "Points"],
  ["reb", "Rebounds"],
  ["ast", "Assists"],
  ["stl", "Steals"],
  ["blk", "Blocks"],
];

/**
 * The league's per-game leaders in each category — top five, qualified players
 * only. Built from the player game log that's already in memory. Players are
 * identified by name + team so the app can resolve them to a player page
 * through league.json's own roster slugs rather than carrying a second set.
 */
function buildLeaders(playerRows, gpByTeam, { top = 5 } = {}) {
  const byPlayer = new Map();
  for (const r of playerRows) {
    let p = byPlayer.get(r.PLAYER_ID);
    if (!p) {
      p = { name: r.PLAYER_NAME, teamId: r.TEAM_ID, gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
      byPlayer.set(r.PLAYER_ID, p);
    }
    // Traded mid-season: his leaderboard row belongs to whoever he plays for now.
    p.teamId = r.TEAM_ID;
    p.gp++;
    p.pts += n(r.PTS);
    p.reb += n(r.OREB) + n(r.DREB);
    p.ast += n(r.AST);
    p.stl += n(r.STL);
    p.blk += n(r.BLK);
  }

  const qualified = [...byPlayer.values()].filter(
    (p) => p.gp >= Math.max(1, Math.ceil(LEADER_MIN_SHARE * (gpByTeam.get(p.teamId) || 0)))
  );
  const leaders = {};
  for (const [key] of LEADER_CATS) {
    leaders[key] = qualified
      .map((p) => ({ name: p.name, teamId: p.teamId, gp: p.gp, v: r1(p[key] / p.gp) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, top);
  }
  return leaders;
}

function buildRoster(playerRows, teamId, idToIndex, meta) {
  const byPlayer = new Map();
  for (const r of playerRows) {
    if (r.TEAM_ID !== teamId) continue;
    const gi = idToIndex.get(r.GAME_ID);
    if (gi == null) continue;
    if (!byPlayer.has(r.PLAYER_ID)) {
      const m = meta.get(r.PLAYER_ID) || {};
      byPlayer.set(r.PLAYER_ID, { playerId: r.PLAYER_ID, name: r.PLAYER_NAME, pos: m.pos || "", num: m.num || "", logs: [] });
    }
    const pts = n(r.PTS), fga = n(r.FGA), fta = n(r.FTA), fgm = n(r.FGM), tpm = n(r.FG3M);
    const tsDen = 2 * (fga + 0.44 * fta);
    byPlayer.get(r.PLAYER_ID).logs.push({
      g: gi, pts, fgm, fga, tpm, tpa: n(r.FG3A), ftm: n(r.FTM), fta,
      orb: n(r.OREB), drb: n(r.DREB), ast: n(r.AST), stl: n(r.STL), blk: n(r.BLK),
      tov: n(r.TOV), pf: n(r.PF), min: parseInt(r.MIN, 10) || 0, pm: n(r.PLUS_MINUS),
      ts: tsDen > 0 ? Math.round((pts / tsDen) * 1000) / 10 : 0,
    });
  }
  return [...byPlayer.values()]
    .map((p) => ({ ...p, logs: p.logs.sort((a, b) => a.g - b.g) }))
    .filter((p) => p.logs.length > 0)
    .sort((a, b) => sumPts(b.logs) - sumPts(a.logs));
}

function shapeOnOff(json) {
  const onRows = toObjects(json, "PlayersOnCourtTeamPlayerOnOffDetails");
  const offRows = toObjects(json, "PlayersOffCourtTeamPlayerOnOffDetails");
  const offMap = new Map(offRows.map((r) => [r.VS_PLAYER_ID, r]));
  return onRows.map((on) => {
    const off = offMap.get(on.VS_PLAYER_ID);
    if (!off) return null;
    const offOn = n(on.OFF_RATING), offOff = n(off.OFF_RATING);
    const defOn = n(on.DEF_RATING), defOff = n(off.DEF_RATING);
    const offDiff = Math.round((offOn - offOff) * 10) / 10;
    const defDiff = Math.round((defOn - defOff) * 10) / 10;
    return {
      playerId: on.VS_PLAYER_ID, name: on.VS_PLAYER_NAME, minOn: parseInt(on.MIN, 10) || 0,
      offOn, offOff, defOn, defOff, offDiff, defDiff,
      netDiff: Math.round((offDiff - defDiff) * 10) / 10,
    };
  }).filter(Boolean);
}

function shapePlayerAdv(rows) {
  return rows.map((r) => ({
    playerId: r.PLAYER_ID, name: r.PLAYER_NAME, gp: n(r.GP), min: r1(r.MIN),
    usg: pctOf(r.USG_PCT), ts: pctOf(r.TS_PCT), astPct: pctOf(r.AST_PCT),
    rebPct: pctOf(r.REB_PCT), net: r1(r.NET_RATING), pie: pctOf(r.PIE),
  }));
}

function shapeLineups(rows) {
  return rows.map((r) => ({
    id: r.GROUP_ID, name: cleanLineup(r.GROUP_NAME), gp: n(r.GP), min: r1(r.MIN),
    off: r1(r.OFF_RATING), def: r1(r.DEF_RATING), net: r1(r.NET_RATING),
  })).sort((a, b) => b.min - a.min).slice(0, 8);
}

// ----- rotations (substitution patterns) -------------------------------------
// Every other dataset here is one request for the whole league (or, for the
// shot chart, one per team). Rotations are not: `gamerotation` is per game, and
// it answers with one row per stint — when a player came on, when he came off,
// and what happened while he was out there. That's the only endpoint carrying
// substitution timing at all (playbyplayv3 has SUB events, but names the
// incoming player by surname only, so it would need roster name-matching;
// gamerotation gives person ids on both sides of the swap).
//
// Per game means 1,230 requests for a full NBA season against an endpoint that
// answers a cold request in ~300ms and degrades under sustained use. The design
// follows from that: every game is cached to its own file and never refetched,
// one retry rather than an escalating chain, a bounded number of games per run,
// and whatever fails is simply left for tomorrow. A season fills in over
// several nights instead of one long run, and no run is unbounded.
//
//     public/data/<season>/rotations/<gameId>.json
//
// One file per game rather than one per season so a nightly commit adds a few
// KB instead of rewriting a megabyte, and so the per-game stints stay on disk
// for anything that wants the game-level timeline later.
//
// It lives outside `--out` on purpose. This is a build-time cache, not output:
// the browser only ever reads the season aggregate it feeds into each team's
// bundle, and a season of it is ~5MB across 1,230 files that would otherwise be
// copied into dist/ and deployed for nothing. It is still committed, so the
// nightly job accumulates games instead of starting cold every run.

const ROTATION_DELAY_MS = 700; // slower than the rest: this endpoint throttles
const ROTATION_BACKOFF_MS = [0, 4000]; // one retry; the rest is tomorrow's problem
// This endpoint answers in one of two regimes and nothing in between: a game
// the backend has warm comes back in ~150ms, and one it doesn't sits open for
// almost exactly 30 seconds and then answers correctly. (Measured over an
// afternoon: 122ms, 202ms — then 30.7s, 30.0s, 28.2s, 18.3s in a row, every one
// of them a 200 with real stint rows.) An 8-second cutoff, which is what the
// WNBA fork uses, therefore throws away requests that were about to succeed and
// makes no progress at all. Wait the stall out; ROTATION_BUDGET_MS is what
// keeps a run bounded.
const ROTATION_TIMEOUT_MS = 35000;
// The schedule is cut into blocks this size for the "quarter of the season"
// toggles. 82 games gives four blocks of twenty and a short fifth.
const SEGMENT_GAMES = LEAGUE.segmentGames;
// A hard ceiling on time spent fetching new rotations in one run. With the cap
// below it almost never binds — eight games can't outrun it even if every one
// takes the slow path — so it is a backstop against the endpoint hanging in
// some way the per-request timeout doesn't catch, not the usual limit.
const ROTATION_BUDGET_MS = 25 * 60 * 1000;
// How many games this step will *attempt* in one run — not how many succeed.
// Deliberately small: the nightly job stays a few minutes rather than a long
// throttled pass, and this endpoint is the one we lean on hardest.
//
// The trade-off is real and worth knowing. A season is 1,230 games, so at eight
// a night a cold season takes about five months to fill in, and the rotation
// chart is thin until then. That is fine for the season in progress, which only
// ever needs to keep up with ~10 new games a night once it has caught up — but
// backfilling an archived season this way is not practical. Burst it by hand
// instead: `--rotation-limit 0` (no cap) or a specific number.
const ROTATION_MAX_PER_RUN = 8;
// Above this, a request took the slow path (see ROTATION_TIMEOUT_MS). Logged
// per game so a run makes it obvious which regime the endpoint is in.
const ROTATION_SLOW_MS = 10000;
const REGULATION_MIN = LEAGUE.regulationMinutes; // the heat map's x-axis; overtime is
                           // counted in the per-player totals but has no column of its own

const ROTATION_CACHE_DIR = fileURLToPath(new URL("../data-cache/rotations", import.meta.url));
const rotationPath = (season, gameId) => join(ROTATION_CACHE_DIR, String(season), `${gameId}.json`);

/**
 * One game's stints, in the compact shape that goes to disk. Times are tenths
 * of a second of elapsed game clock, exactly as the endpoint gives them, so
 * nothing is lost to rounding here — 0 is tip-off, 28800 the end of regulation.
 */
function shapeRotation(json) {
  const stints = [];
  const names = {};
  for (const rs of (json && json.resultSets) || []) {
    const at = Object.fromEntries(rs.headers.map((h, i) => [h, i]));
    for (const row of rs.rowSet) {
      const pid = row[at.PERSON_ID];
      if (pid == null) continue;
      names[pid] = `${row[at.PLAYER_FIRST] || ""} ${row[at.PLAYER_LAST] || ""}`.trim();
      stints.push([
        row[at.TEAM_ID], pid,
        row[at.IN_TIME_REAL], row[at.OUT_TIME_REAL],
        row[at.PLAYER_PTS], row[at.PT_DIFF],
      ]);
    }
  }
  return stints.length ? { names, stints } : null;
}

/** A game already on disk, or null if we've never successfully fetched it. */
async function readRotation(season, gameId) {
  try {
    const g = JSON.parse(await readFile(rotationPath(season, gameId), "utf8"));
    return g && Array.isArray(g.stints) ? g : null;
  } catch (_) {
    return null;
  }
}

/**
 * Fill in every game of the season not already cached, and return the full set
 * keyed by game id. Games that fail are simply left out — the next run picks
 * them up, and a season is useful long before it's complete.
 *
 * This is by far the longest step in a run, so it narrates itself: `onPlan`
 * fires once the cache has been read (how much work there actually is), and
 * `onProgress` fires after every game with which game it was and how it went.
 */
async function fetchRotations(season, gameIds, { onPlan, onProgress, limit = ROTATION_MAX_PER_RUN } = {}) {
  const byGame = new Map();
  const missing = [];
  for (const id of gameIds) {
    const cached = await readRotation(season, id);
    if (cached) byGame.set(id, cached);
    else missing.push(id);
  }

  // Oldest first (the order the schedule came in), so a backlog drains from the
  // start of the season rather than leaving holes scattered through it.
  const queue = limit > 0 ? missing.slice(0, limit) : missing;
  const deferred = missing.length - queue.length;

  // Roughly what the loop below costs if nothing fails: one request (~0.3s on a
  // good day) plus the fixed delay per game. Failures cost more — timeout plus
  // backoff — but the point is to set an expectation, not to predict.
  if (onPlan) {
    onPlan({
      total: gameIds.length,
      cached: byGame.size,
      missing: missing.length,
      queued: queue.length,
      deferred,
      estMs: queue.length * (ROTATION_DELAY_MS + 400),
    });
  }

  const failed = [];
  const durations = []; // every attempt's wall clock, for the pace line + summary
  const deadline = Date.now() + ROTATION_BUDGET_MS;
  let ranOut = 0;
  for (const [i, id] of queue.entries()) {
    if (Date.now() > deadline) {
      ranOut = queue.length - i;
      break;
    }
    let game = null;
    let lastErr = "";
    let tries = 0;
    const startedAt = Date.now();
    for (const wait of ROTATION_BACKOFF_MS) {
      if (wait) await sleep(wait);
      tries += 1;
      try {
        game = shapeRotation(
          await statsFetch("gamerotation", { GameID: id, LeagueID: LEAGUE.id }, { timeoutMs: ROTATION_TIMEOUT_MS })
        );
        if (game) break;
        lastErr = "no stint rows returned";
      } catch (e) {
        lastErr = e.message;
      }
    }
    if (game) {
      await writeJson(rotationPath(season, id), game);
      byGame.set(id, game);
    } else {
      failed.push({ id, error: lastErr });
    }
    const ms = Date.now() - startedAt;
    durations.push(ms);
    if (onProgress) {
      // Everything the caller needs to narrate the step without recomputing it:
      // this game, the run's tally, the pace, and where the season stands.
      const done = i + 1;
      const perGame = durations.reduce((a, b) => a + b, 0) / durations.length + ROTATION_DELAY_MS;
      onProgress({
        done,
        total: queue.length,
        okCount: done - failed.length,
        failed: failed.length,
        id,
        ok: Boolean(game),
        error: lastErr,
        tries,
        ms,
        slow: ms >= ROTATION_SLOW_MS, // took the ~30s path rather than the ~150ms one
        players: game ? Object.keys(game.names).length : 0,
        stints: game ? game.stints.length : 0,
        perGameMs: perGame,
        etaMs: (queue.length - done) * perGame,
        // The season, not just this run's queue — "8/8 done" means nothing on
        // its own when there are 1,230 games to get through.
        seasonHeld: byGame.size,
        seasonTotal: gameIds.length,
        seasonMissing: gameIds.length - byGame.size,
      });
    }
    await sleep(ROTATION_DELAY_MS);
  }

  // How the endpoint behaved, for the one-line verdict at the end of the step.
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    byGame,
    cached: gameIds.length - missing.length,
    fetched: queue.length - failed.length - ranOut,
    failed,
    ranOut,
    deferred, // held back by the per-run cap, not by failure or the budget
    timing: durations.length
      ? {
          attempts: durations.length,
          slow: durations.filter((d) => d >= ROTATION_SLOW_MS).length,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          maxMs: sorted[sorted.length - 1],
          totalMs: durations.reduce((a, b) => a + b, 0),
        }
      : null,
  };
}

/**
 * Roll a set of one team's games up into a per-player rotation profile.
 *
 * `heat[m]` is the share of his own appearances a player was on the floor
 * during minute m of the game — his availability is divided out, so a starter
 * who missed a month still reads as a starter rather than as a faint row. The
 * denominator is on the row as `gp` so a thin sample is visible rather than
 * implied.
 *
 * `games` is [{ stints, names }] — one team's slice of however many games the
 * caller wants summed, which is what lets the same code do the whole season and
 * each quarter of it.
 */
function summariseRotation(games) {
  const players = new Map();

  for (const { stints: gameStints, names } of games) {
    // Group by player first: "appearances" and "did he start" are per player
    // per game, not per stint.
    const byPlayer = new Map();
    for (const [pid, tin, tout, pts, diff] of gameStints) {
      if (!byPlayer.has(pid)) byPlayer.set(pid, []);
      byPlayer.get(pid).push({ in: tin / 10, out: tout / 10, pts, diff });
    }

    for (const [pid, stints] of byPlayer) {
      if (!players.has(pid)) {
        players.set(pid, {
          id: pid, name: names[pid] || String(pid),
          gp: 0, starts: 0, stints: 0, secs: 0, plus: 0,
          firstIn: [], lens: [], heat: new Array(REGULATION_MIN).fill(0),
        });
      }
      const p = players.get(pid);
      p.name = names[pid] || p.name;
      p.gp++;
      stints.sort((a, b) => a.in - b.in);
      if (stints[0].in === 0) p.starts++;
      else p.firstIn.push(stints[0].in);

      for (const s of stints) {
        const len = s.out - s.in;
        if (!(len > 0)) continue; // a zero-length stint is a data artefact, not a shift
        p.stints++;
        p.secs += len;
        p.plus += s.diff || 0;
        p.lens.push(len);
        // Spread the stint across the game-minutes it covers. Overtime falls
        // off the end of `heat` but is still in `secs`, so minutes per game
        // stays the true number.
        const from = Math.floor(s.in / 60);
        const to = Math.min(REGULATION_MIN - 1, Math.floor((s.out - 0.001) / 60));
        for (let m = Math.max(0, from); m <= to; m++) {
          p.heat[m] += Math.min(s.out, (m + 1) * 60) - Math.max(s.in, m * 60);
        }
      }
    }
  }

  return [...players.values()]
    .filter((p) => p.stints > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      gp: p.gp,
      starts: p.starts,
      mpg: r1(p.secs / p.gp / 60),
      stints: Math.round((p.stints / p.gp) * 100) / 100,
      avgStint: r1(p.lens.reduce((a, b) => a + b, 0) / p.lens.length / 60),
      // Average clock time of his first appearance in the games he came off
      // the bench; null for a player who has never not started.
      firstIn: p.firstIn.length ? r1(p.firstIn.reduce((a, b) => a + b, 0) / p.firstIn.length / 60) : null,
      plus: r1(p.plus / p.gp),
      heat: p.heat.map((s) => Math.round((s / (60 * p.gp)) * 100)),
    }))
    .sort((a, b) => b.mpg - a.mpg);
}

/**
 * Collapse a season of stints into one rotation profile per team, plus the same
 * profile recomputed over each block of the schedule.
 *
 * A rotation is not one fact about a season — it's the thing a coach spends the
 * season changing. So alongside the whole-season view, the schedule is cut into
 * SEGMENT_GAMES-game blocks and each is summarised separately, which is what
 * makes a starter's promotion or a veteran's fade visible instead of averaged
 * away.
 *
 * Blocks are cut on each team's own chronological schedule position
 * (`orderByTeam`), not on the games we happen to hold rotation data for — so
 * "games 1-20" always means the season's first twenty, and a block with gaps
 * reports a smaller `games` rather than silently pulling in the twenty-first.
 */
function aggregateRotations(byGame, teamIds, orderByTeam, segmentSize = SEGMENT_GAMES) {
  // Split every game's stints by team once, so each team only walks its own.
  const perTeamGame = new Map(teamIds.map((id) => [id, new Map()]));
  for (const [gameId, game] of byGame) {
    for (const [teamId, pid, tin, tout, pts, diff] of game.stints) {
      const teamGames = perTeamGame.get(teamId);
      if (!teamGames) continue; // a team not in this season's league (shouldn't happen)
      if (!teamGames.has(gameId)) teamGames.set(gameId, { stints: [], names: game.names });
      teamGames.get(gameId).stints.push([pid, tin, tout, pts, diff]);
    }
  }

  const out = new Map();
  for (const [teamId, teamGames] of perTeamGame) {
    if (!teamGames.size) continue;
    const order = orderByTeam.get(teamId) || [...teamGames.keys()];

    const all = summariseRotation([...teamGames.values()]);

    // One block per SEGMENT_GAMES games of the schedule, including blocks we
    // hold no data for yet — the UI shows those as an empty quarter, which is
    // the honest answer rather than a missing button.
    const segments = [];
    for (let start = 0; start < order.length; start += segmentSize) {
      const slice = order.slice(start, start + segmentSize);
      const held = slice.map((id) => teamGames.get(id)).filter(Boolean);
      segments.push({
        from: start + 1,
        to: start + slice.length,
        scheduled: slice.length,
        games: held.length,
        players: held.length ? summariseRotation(held) : [],
      });
    }

    out.set(teamId, { games: teamGames.size, scheduled: order.length, segmentSize, players: all, segments });
  }
  return out;
}

// ----- previous-snapshot fallback --------------------------------------------
// stats.nba.com is flaky: an endpoint that answered yesterday can return a 500
// today, and a chart that had been on the page for weeks would simply vanish
// until the next good fetch. So instead of writing a hole into the snapshot,
// every dataset that comes back empty or errored is back-filled from the file
// we wrote last time and tagged with the date it was really fetched, which lets
// the UI keep rendering the section with an "as of …" note.

// Reassemble a season already on disk into the same shape fetchSeason builds,
// so the carry-over below can treat "what we have" and "what we just fetched"
// identically. Returns null if that season has never been written.
async function readSeason(dir, season) {
  let league;
  try {
    league = JSON.parse(await readFile(leaguePath(dir, season), "utf8"));
  } catch (_) {
    return null; // never fetched, or the file is missing / unreadable / corrupt
  }
  if (!league || !league.meta || !league.meta.generatedAt || !Array.isArray(league.teams)) return null;
  if (Number(league.meta.season) !== Number(season)) return null; // never back-fill across seasons

  const data = {};
  // A team file that can't be read means that team has nothing to fall back on,
  // which is survivable — but it must not be silent. Without this, a failed
  // request for a team whose previous file was missing produces an empty
  // section, no "stale" marker and no explanation anywhere in the log, which is
  // indistinguishable from the carry-over being broken.
  const unreadable = [];
  for (const team of league.teams) {
    try {
      data[team.id] = JSON.parse(await readFile(teamPath(dir, season, team.id), "utf8"));
    } catch (e) {
      unreadable.push({ id: team.id, name: team.teamName || team.name, error: e.message });
    }
  }
  return { ...league, data, unreadable };
}

// "Nothing usable came back": null/undefined, an empty array, or an empty object.
function isEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

// Back-fill each empty key on `fresh` from `prev`, mutating `fresh`. Returns
// { key: { at, reason } } describing whatever was carried over, where `at` is
// when that data was actually fetched — if the previous snapshot had itself
// carried the key over, its original date is kept rather than restamped, so a
// section that's been broken for a week reports a week-old date, and ages out
// at MAX_STALE_DAYS instead of looking fresh forever.
// `expired` collects the keys that were dropped for being too old, so the run
// can report why a section is about to vanish from the site.
// `final` (a completed season) turns off both the age limit and the staleness
// bookkeeping: those numbers can't change, so a copy from an earlier fetch is
// the right answer rather than an old one, and the UI shouldn't caveat it.
function carryOver(fresh, prev, keys, { errors = {}, prevStale = {}, prevAt, expired, final = false } = {}) {
  const stale = {};
  if (!prev) return stale;
  const oldest = Date.now() - MAX_STALE_DAYS * 86400000;
  for (const key of keys) {
    if (!isEmpty(fresh[key]) || isEmpty(prev[key])) continue;
    const at = (prevStale[key] && prevStale[key].at) || prevAt;
    const ts = Date.parse(at);
    if (!final && (!Number.isFinite(ts) || ts < oldest)) {
      if (expired) expired.add(key);
      continue;
    }
    fresh[key] = prev[key];
    if (!final) stale[key] = { at, reason: errors[key] || "the endpoint returned no rows this run" };
  }
  return stale;
}

// ----- output layout ---------------------------------------------------------
// One ~900KB file per season made every visitor download all 15 teams to look at
// one. Splitting it per team means a cold load is the season's league-wide sets
// (~10KB) plus the team you asked for (~60KB), and switching teams fetches one
// small file that then caches. Completed seasons are immutable, so their files
// can be cached forever (see vercel.json).

const indexPath = (dir) => join(dir, "index.json");
const leaguePath = (dir, season) => join(dir, String(season), "league.json");
const teamPath = (dir, season, teamId) => join(dir, String(season), "teams", `${teamId}.json`);

// Written to a temporary file and renamed into place, which is atomic: a run
// that is killed mid-write leaves either the old file or the new one, never a
// half-written one. This matters most for index.json — a truncated index parses
// as nothing, and updateIndex would then rebuild it from scratch and silently
// drop every season it didn't fetch this run.
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, path);
}

/**
 * Split one season's payload across disk and refresh the season index.
 * `data` (per-team bundles) is peeled off into teams/<id>.json; everything else
 * — the team list, the league-wide sets — stays in league.json, plus a slug per
 * player so the app can resolve a player URL before that team's file arrives.
 */
async function writeSeason(dir, payload) {
  const { data, ...league } = payload;
  const season = payload.meta.season;

  // Each team carries its roster's names and URL slugs, in roster order. It's a
  // few KB that saves the app from downloading a team just to discover whether
  // /team/atlanta-dream/allisha-gray points at anyone.
  league.teams = league.teams.map((t) => {
    const roster = (data[t.id] || {}).roster || [];
    const slugs = rosterSlugs(roster);
    return { ...t, players: roster.map((p, i) => ({ name: p.name, slug: slugs[i] })) };
  });

  await writeJson(leaguePath(dir, season), league);
  for (const team of league.teams) {
    await writeJson(teamPath(dir, season, team.id), data[team.id] || {});
  }

  // Drop team files from a previous fetch whose team no longer exists (an
  // expansion team's id changing, say) so the directory can't accumulate ghosts.
  const keep = new Set(league.teams.map((t) => `${t.id}.json`));
  try {
    for (const name of await readdir(join(dir, String(season), "teams"))) {
      if (name.endsWith(".json") && !keep.has(name)) await rm(join(dir, String(season), "teams", name));
    }
  } catch (_) { /* directory was just created — nothing stale in it */ }

  return updateIndex(dir, payload); // the season's index entry, for the summary
}

/**
 * The tiny file the app boots from: which seasons exist, when each was fetched,
 * and how many datasets are still missing from it (what --repair goes after).
 * Rewritten from the existing index plus this season's entry, so fetching one
 * season never disturbs the others' records.
 */
async function updateIndex(dir, payload) {
  let index = { currentSeason: CURRENT_SEASON, seasons: [] };
  try {
    const existing = JSON.parse(await readFile(indexPath(dir), "utf8"));
    if (existing && Array.isArray(existing.seasons)) index = existing;
  } catch (_) { /* first season written, or the index was lost — recovered below */ }

  const season = payload.meta.season;
  const entry = {
    season,
    generatedAt: payload.meta.generatedAt,
    teams: payload.teams.length,
    games: Object.values(payload.data).reduce((a, b) => a + (b.games || []).length, 0),
    missing: countMissing(payload),
  };

  index.currentSeason = CURRENT_SEASON;
  index.seasons = [...index.seasons.filter((s) => Number(s.season) !== Number(season)), entry]
    .sort((a, b) => b.season - a.season); // newest first: the order the dropdown wants

  // The index is derived data, so it is reconciled against what is actually on
  // disk rather than trusted. A season whose folder exists but whose entry is
  // missing gets rebuilt from its own files — which is what recovers a lost or
  // truncated index instead of quietly publishing a site with one season in the
  // dropdown and nine still sitting in public/data.
  const known = new Set(index.seasons.map((s) => Number(s.season)));
  for (const onDisk of await seasonsOnDisk(dir)) {
    if (known.has(onDisk)) continue;
    const recovered = await readSeason(dir, onDisk);
    if (!recovered) continue;
    index.seasons.push({
      season: onDisk,
      generatedAt: recovered.meta.generatedAt,
      teams: recovered.teams.length,
      games: Object.values(recovered.data).reduce((a, b) => a + (b.games || []).length, 0),
      missing: countMissing(recovered),
    });
    console.log(`  index: recovered the ${seasonLabel(onDisk)} entry from public/data/${onDisk}/`);
  }
  index.seasons.sort((a, b) => b.season - a.season);

  await writeJson(indexPath(dir), index);
  return entry;
}

/** Every season with a folder under the output directory, newest first. */
async function seasonsOnDisk(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
      .map((e) => Number(e.name))
      .sort((a, b) => b - a);
  } catch (_) {
    return [];
  }
}

// Datasets that would render as "unavailable" — nothing fetched and nothing to
// carry over. Zero means the season is complete and --repair can skip it.
function countMissing(payload) {
  const LEAGUE_KEYS = ["teamRanks", "teamProfiles", "leagueShotZones", "leagueShotTypes", "positionShotZones", "positionShotTypes", "teamZoneWins"];
  // `rotation` is deliberately not here. It fills in over several nights rather
  // than in one run (see the rotations section), and the seasons before it was
  // added have none at all — counting it would mark every season permanently
  // incomplete and send --repair back to refetch archives that are in fact fine.
  // `shotDefend` is deliberately absent for the same reason: it lives on roster
  // entries rather than as a bundle key.
  const TEAM_KEYS = ["games", "roster", "onOff", "fourFactors", "playerAdv", "lineups", "shotZones", "shotTypes"];
  let missing = LEAGUE_KEYS.filter((k) => isEmpty(payload[k])).length;
  for (const bundle of Object.values(payload.data)) {
    missing += TEAM_KEYS.filter((k) => isEmpty(bundle[k])).length;
  }
  return missing;
}

// ----- main ------------------------------------------------------------------

/**
 * Fetch one season and return its payload (the shape writeSeason splits up).
 * `final` marks a completed season: no schedule to look ahead at, and anything
 * reused from an earlier fetch is simply correct rather than stale.
 */
async function fetchSeason(season, { outDir, final, nth, of, rotations = true, rotationLimit = ROTATION_MAX_PER_RUN }) {
  const startedAt = Date.now();
  const which = of > 1 ? `  [season ${nth} of ${of}]` : "";
  console.log(`\n${"─".repeat(64)}\n${seasonLabel(season)}${final ? " (completed season)" : " (season in progress)"}${which}\n`);

  // Anything that fails below falls back on this (see "previous-snapshot
  // fallback"), so a bad night degrades to older numbers instead of blank charts.
  const prev = await readSeason(outDir, season);
  const prevAt = prev ? prev.meta.generatedAt : null;
  console.log(
    prev
      ? `Already on disk from ${prevAt} — will back-fill anything that fails today.`
      : "Nothing on disk for this season — nothing to fall back on if a request fails."
  );
  if (prev && prev.unreadable && prev.unreadable.length) {
    // Named, because these are exactly the teams where a failed request today
    // will leave a hole rather than last night's numbers.
    console.log(
      `  ${prev.unreadable.length} team file${prev.unreadable.length === 1 ? "" : "s"} could not be read, so ` +
        `${prev.unreadable.length === 1 ? "it has" : "they have"} nothing to fall back on: ` +
        prev.unreadable.map((t) => `${t.name} (${t.error})`).join(", ")
    );
  }
  console.log("");

  // ----- league-wide data (one call each) -----
  // Each one is numbered so a run that stalls says how far in it got. A
  // completed season skips the schedule call, hence one step fewer.
  // The league-wide requests in the order they go out, so "[4/9]" counts against
  // what actually runs — add a request below and add its label here. A completed
  // season has no schedule to look ahead at, hence one fewer.
  const LEAGUE_REQUESTS = [
    "team game log", "player game log", "ratings", "playeradv", "profiles",
    "factors", "teamShotZones", "playerShotZones",
    // One request per team behind the first label, six behind the second.
    "shotTypes", "shotDefend",
    ...(final ? [] : ["schedule"]),
  ];
  let stepNo = 0;
  // Every line carries its season: one run can cover ten of them (--missing),
  // and in the log a line has to say which season it belongs to on its own.
  const step = (label) => {
    const known = LEAGUE_REQUESTS.indexOf(label); // -1 if someone forgot the list
    stepNo = known >= 0 ? known + 1 : stepNo + 1;
    begin(`  • ${seasonLabel(season)} [${stepNo}/${Math.max(LEAGUE_REQUESTS.length, stepNo)}] ${label} … `);
  };

  console.log(`League-wide data for ${seasonLabel(season)}:`);
  step("team game log");
  const teamRows = toObjects(await statsFetch("leaguegamelog", { ...COMMON(season), PlayerOrTeam: "T" }), "LeagueGameLog");
  // Zero rows from a request that otherwise succeeded means one of two very
  // different things, and the NBA's four-month offseason makes the difference
  // worth spelling out: a season that hasn't tipped off yet is not a failure.
  if (!teamRows.length) {
    throw new Error(
      season >= CURRENT_SEASON
        ? `the ${seasonLabel(season)} season has no games yet. Until it tips off, leave ` +
          `LEAGUE.currentSeason (src/league.js) on the last completed season.`
        : "No team game-log rows returned — cannot continue."
    );
  }
  done(`${teamRows.length} rows`);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // The player game log is the source of every box score (rosters, four
  // factors, team profiles). It used to be fatal; now it degrades to the
  // previous snapshot's rosters so the Players tab doesn't empty out.
  step("player game log");
  let playerRows = [];
  let playerLogErr = null;
  try {
    playerRows = toObjects(await statsFetch("leaguegamelog", { ...COMMON(season), PlayerOrTeam: "P" }), "LeagueGameLog");
    done(`${playerRows.length} rows`);
    if (!playerRows.length) playerLogErr = "No player game-log rows returned.";
  } catch (e) {
    playerLogErr = e.message;
    done(`FAILED — ${e.message}`);
  }
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ----- three league-wide dashboards (advanced ratings, four factors, player advanced) -----
  const errLeague = {};
  async function dash(label, endpoint, params, setName) {
    step(label);
    try {
      const rows = toObjects(await statsFetch(endpoint, params), setName);
      done(`${rows.length} rows`);
      await sleep(DELAY_BETWEEN_CALLS_MS);
      return rows;
    } catch (e) {
      done(`FAILED — ${e.message}`);
      errLeague[label] = e.message;
      await sleep(DELAY_BETWEEN_CALLS_MS);
      return [];
    }
  }
  const ratingRows = await dash("ratings", "leaguedashteamstats", { ...TEAM_DASH(season), MeasureType: "Advanced", TeamID: "0" }, "LeagueDashTeamStats");
  const advRows = await dash("playeradv", "leaguedashplayerstats", { ...PLAYER_DASH(season), MeasureType: "Advanced", TeamID: "0" }, "LeagueDashPlayerStats");

  // The per-100 profile and the four factors, both taken as published rather
  // than derived here. stats.nba.com counts possessions from play-by-play; the
  // classic box-score estimate (FGA + 0.44*FTA - OREB + TOV) runs about 2% above
  // that count for every team, which used to push every per-100 number on the
  // site ~2% low. Asking for PerMode=Per100Possessions hands us their division
  // instead of approximating it.
  const profileRows = await dash(
    "profiles", "leaguedashteamstats",
    { ...TEAM_DASH(season), MeasureType: "Base", PerMode: "Per100Possessions", TeamID: "0" },
    "LeagueDashTeamStats"
  );
  // The "Four Factors" measure type returns the opponent's four alongside the
  // team's. (The WNBA fork once derived these from box scores because that
  // backend answered HTTP 500 for this measure type; the NBA one never has.)
  const factorRows = await dash(
    "factors", "leaguedashteamstats",
    { ...TEAM_DASH(season), MeasureType: "Four Factors", PerMode: "Totals", TeamID: "0" },
    "LeagueDashTeamStats"
  );

  // Shot-location zones (one call each, all teams / all players). These use a
  // two-tier header, so they go through shapeShotZones rather than the generic
  // dash() helper. Totals (not PerGame) so league averages aggregate correctly.
  async function shotDash(label, endpoint, params, idFields) {
    step(label);
    try {
      const rows = shapeShotZones(await statsFetch(endpoint, params), idFields);
      done(`${rows.length} rows`);
      await sleep(DELAY_BETWEEN_CALLS_MS);
      return rows;
    } catch (e) {
      done(`FAILED — ${e.message}`);
      errLeague[label] = e.message;
      await sleep(DELAY_BETWEEN_CALLS_MS);
      return [];
    }
  }
  const teamZoneRows = await shotDash(
    "teamShotZones", "leaguedashteamshotlocations",
    { ...TEAM_DASH(season), MeasureType: "Base", PerMode: "Totals", DistanceRange: "By Zone", TeamID: "0" },
    ["TEAM_ID", "TEAM_NAME"]
  );
  const playerZoneRows = await shotDash(
    "playerShotZones", "leaguedashplayershotlocations",
    { ...PLAYER_DASH(season), MeasureType: "Base", PerMode: "Totals", DistanceRange: "By Zone", TeamID: "0" },
    ["PLAYER_ID", "PLAYER_NAME"]
  );

  // ----- indexes -----
  const abbrById = new Map();
  const nameById = new Map();
  for (const r of teamRows) {
    if (r.TEAM_ID != null && !abbrById.has(r.TEAM_ID)) {
      abbrById.set(r.TEAM_ID, r.TEAM_ABBREVIATION || "");
      nameById.set(r.TEAM_ID, r.TEAM_NAME || "");
    }
  }
  const rowsByGame = new Map();
  for (const r of teamRows) {
    if (!rowsByGame.has(r.GAME_ID)) rowsByGame.set(r.GAME_ID, []);
    rowsByGame.get(r.GAME_ID).push(r);
  }

  const teamIds = [...nameById.keys()];
  console.log(`\nFound ${teamIds.length} teams.\n`);

  // Shot action types, one request per team (see SHOT_CHART for why it can't be
  // one request for the league). A team that fails costs only that team's
  // breakdown — the league baseline is the sum of whatever came back, so the
  // step as a whole only counts as failed if every team did.
  const shotTypeAgg = shotTypeCollector();
  let shotTypeFailures = [];
  step("shotTypes");
  {
    let attempts = 0;
    for (const [i, teamId] of teamIds.entries()) {
      try {
        attempts += shotTypeAgg.add(
          await statsFetch("shotchartdetail", SHOT_CHART(season, teamId), { timeoutMs: 60000 })
        );
      } catch (e) {
        shotTypeFailures.push(`${abbrById.get(teamId) || teamId}: ${e.message}`);
      }
      if (TTY) {
        process.stdout.write(
          `\r  • ${seasonLabel(season)} [${stepNo}/${LEAGUE_REQUESTS.length}] shotTypes … ` +
            `${i + 1}/${teamIds.length} teams · ${attempts} shots${CLEAR_EOL}`
        );
      }
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
    if (!attempts) {
      const why = shotTypeFailures.length ? shotTypeFailures.slice(0, 3).join("; ") : "no shots returned";
      done(`FAILED — ${why}`);
      errLeague.shotTypes = why;
    } else {
      done(
        `${attempts} shots · ${shotTypeAgg.result().byPlayer.size} players` +
          (shotTypeFailures.length ? ` · ${shotTypeFailures.length}/${teamIds.length} teams failed` : "")
      );
    }
  }
  const shotTypes = shotTypeAgg.result();

  // Defensive matchups, six requests (one per shot category).
  let defendByPlayer = new Map();
  if (season >= LEAGUE.defendFirstSeason) {
    step("shotDefend");
    const collected = [];
    const failures = [];
    for (const [category, key] of DEFEND_CATEGORIES) {
      try {
        const json = await statsFetch("leaguedashptdefend", DEFEND(season, category));
        const set = (json.resultSets || []).find((s) => s && s.name === "LeagueDashPTDefend");
        if (!set || !(set.rowSet || []).length) throw new Error("no rows");
        collected.push([key, set]);
      } catch (e) {
        failures.push(`${category}: ${e.message}`);
      }
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
    const shaped = shapeDefend(collected);
    defendByPlayer = shaped.byPlayer;
    if (!defendByPlayer.size) {
      const why = failures.length ? failures.join("; ") : "no rows returned";
      done(`FAILED — ${why}`);
      errLeague.shotDefend = why;
    } else {
      // A partial answer is still worth keeping: a player with five of six
      // categories is more useful than none, as long as the log says so.
      const kept = collected.length - shaped.skipped.length;
      done(`${defendByPlayer.size} defenders · ${kept}/${DEFEND_CATEGORIES.length} categories`
        + (failures.length ? ` · ${failures.length} failed` : "")
        + (shaped.skipped.length ? ` · unreadable columns: ${shaped.skipped.join(", ")}` : ""));
    }
  }

  // League ranking (shared by all teams' Team tab).
  const teamRanks = ratingRows.length
    ? { teams: ratingRows.map((r) => ({
        teamId: r.TEAM_ID,
        name: r.TEAM_NAME,
        abbr: abbrById.get(r.TEAM_ID) || lastName(r.TEAM_NAME).slice(0, 3).toUpperCase(),
        // LEAGUE.paceField is PACE here: the NBA plays 48-minute games and
        // that column is already on a 48-minute basis. (The WNBA fork reads
        // PACE_PER40 instead — same possessions, right clock for a 40-minute
        // game — which is exactly the kind of difference league.js exists for.)
        off: r1(r.OFF_RATING), def: r1(r.DEF_RATING), net: r1(r.NET_RATING), pace: r1(r[LEAGUE.paceField]),
      })) }
    : null;

  // The league-wide sets, and a record of which of them had to come from the
  // previous snapshot. The ranking is back-filled here rather than with the
  // rest at the end, because the upcoming-opponent rows below read net ratings
  // out of it — otherwise a failed ratings call would blank that column too.
  const league = { teamRanks };
  const expired = new Set(); // keys dropped for being older than MAX_STALE_DAYS
  const leagueStale = carryOver(league, prev, ["teamRanks"], {
    prevAt,
    prevStale: (prev && prev.stale) || {},
    errors: { teamRanks: errLeague.ratings },
    expired, final,
  });

  // Current W-L (from played games) and net rating, keyed by team — used to
  // annotate each upcoming opponent.
  const recordByTeam = new Map();
  for (const r of teamRows) {
    const rec = recordByTeam.get(r.TEAM_ID) || { w: 0, l: 0 };
    if (r.WL === "W") rec.w++;
    else if (r.WL === "L") rec.l++;
    recordByTeam.set(r.TEAM_ID, rec);
  }
  const rankedTeams = (league.teamRanks && league.teamRanks.teams) || [];
  const netByTeam = new Map(rankedTeams.map((t) => [t.teamId, t.net]));

  // ----- schedule → each team's upcoming (not-yet-played) games -----
  // A completed season has nothing upcoming, so that request is simply skipped.
  const upcomingByTeam = new Map();
  // The league-wide slate around today — what the home page's scoreboard reads.
  // Both halves come out of the same response as `upcoming`.
  let scoreboard = [];
  let scheduleErr = null;
  if (!final) {
  step("schedule");
  try {
    const sched = await statsFetch("scheduleleaguev2", { LeagueID: LEAGUE.id, Season: seasonParam(season) });
    const gameDates = (sched && sched.leagueSchedule && sched.leagueSchedule.gameDates) || [];
    const cutoff = Date.now() - 18 * 3600 * 1000; // keep games from ~today onward
    const annotate = (oppTeam) => {
      const oppId = oppTeam.teamId;
      const rec = recordByTeam.get(oppId);
      return {
        opp: abbrById.get(oppId) || oppTeam.teamTricode || "",
        oppEmoji: emojiFor(nameById.get(oppId) || `${oppTeam.teamCity || ""} ${oppTeam.teamName || ""}`),
        oppW: rec ? rec.w : oppTeam.wins ?? 0,
        oppL: rec ? rec.l : oppTeam.losses ?? 0,
        oppNet: netByTeam.has(oppId) ? netByTeam.get(oppId) : null,
      };
    };
    // The scoreboard's window. Bounded on both sides on purpose: the home page
    // only ever shows the days around today, and the whole 1,230-game schedule
    // would be ~150KB in a file every page of the site downloads. A team's full
    // remaining schedule still lives in its own file, as `upcoming`.
    const from = Date.now() - SCOREBOARD_BACK_DAYS * 86400000;
    const to = Date.now() + SCOREBOARD_FWD_DAYS * 86400000;

    let count = 0;
    for (const gd of gameDates) {
      for (const g of gd.games || []) {
        // Preseason, All-Star and playoff games ride along in this feed; every
        // other dataset here is regular season, so they're dropped.
        if (!REGULAR_SEASON_GAME.test(String(g.gameId || ""))) continue;
        const ts = Date.parse(g.gameDateEst || g.gameDateTimeEst || gd.gameDate);
        const home = g.homeTeam, away = g.awayTeam;
        if (!home || !away) continue;

        // --- the league-wide slate around today ---
        // Keyed by the ET calendar date the league schedules against, so the app
        // can ask "what's on today?" in the league's own timezone rather than
        // the visitor's. `tip` is the real kickoff instant, for local times.
        if (Number.isFinite(ts) && ts >= from && ts <= to) {
          scoreboard.push({
            id: g.gameId,
            date: String(g.gameDateEst || gd.gameDate).slice(0, 10),
            tip: g.gameDateTimeUTC || null,
            status: g.gameStatus, // 1 = scheduled, 2 = live, 3 = final
            statusText: g.gameStatusText || "",
            home: home.teamId,
            away: away.teamId,
            homeScore: g.gameStatus === 1 ? null : n(home.score),
            awayScore: g.gameStatus === 1 ? null : n(away.score),
            tv: (g.broadcasters?.nationalBroadcasters || [])
              .map((b) => b.broadcasterDisplay).filter(Boolean)[0] || null,
          });
        }

        // --- each team's own upcoming list ---
        if (g.gameStatus !== 1) continue; // 1 = scheduled, 2 = live, 3 = final
        if (Number.isFinite(ts) && ts < cutoff) continue;
        const date = fmtDate(g.gameDateEst || gd.gameDate);
        const sortTs = Number.isFinite(ts) ? ts : 0;
        const hList = upcomingByTeam.get(home.teamId) || [];
        hList.push({ date, ts: sortTs, home: true, ...annotate(away) });
        upcomingByTeam.set(home.teamId, hList);
        const aList = upcomingByTeam.get(away.teamId) || [];
        aList.push({ date, ts: sortTs, home: false, ...annotate(home) });
        upcomingByTeam.set(away.teamId, aList);
        count++;
      }
    }
    for (const list of upcomingByTeam.values()) {
      list.sort((a, b) => a.ts - b.ts);
      list.forEach((x) => delete x.ts); // sorting key only; keep the JSON tidy
    }
    scoreboard.sort((a, b) => (a.date === b.date ? String(a.tip).localeCompare(String(b.tip)) : a.date.localeCompare(b.date)));
    done(`${count} upcoming games · ${scoreboard.length} on the scoreboard`);
  } catch (e) {
    scheduleErr = e.message;
    done(`FAILED — ${e.message}`);
  }
  await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  // Final (OT-inclusive) team score for a game = sum of that team's players'
  // points. The player log is only consulted for this and for the rosters; every
  // team-level rate now comes from stats.nba.com already computed, so the
  // box-score totals that used to be built here are gone — along with the team
  // turnovers they silently dropped (a player row can't carry a shot-clock
  // violation, so those totals ran ~40 turnovers per team per season light).
  const ptsByGameTeam = new Map(); // key: `${gameId}|${teamId}` -> points
  for (const r of playerRows) {
    const key = `${r.GAME_ID}|${r.TEAM_ID}`;
    ptsByGameTeam.set(key, (ptsByGameTeam.get(key) || 0) + n(r.PTS));
  }
  const scoreOf = (gameId, tid) => ptsByGameTeam.get(`${gameId}|${tid}`) || 0;

  // Shooting & possession profile per team, per 100 possessions, exactly as
  // stats.nba.com publishes it. 2P is the only arithmetic left, and it's a
  // subtraction of two counted numbers rather than an estimate.
  const factorsByTeam = new Map(factorRows.map((r) => [r.TEAM_ID, r]));
  const teamProfiles = profileRows.map((r) => {
    const ff = factorsByTeam.get(r.TEAM_ID);
    return {
      teamId: r.TEAM_ID,
      abbr: abbrById.get(r.TEAM_ID) || lastName(r.TEAM_NAME || "").slice(0, 3).toUpperCase(),
      gp: n(r.GP),
      fg3m: r1(r.FG3M),
      fg3a: r1(r.FG3A),
      fg2m: r1(n(r.FGM) - n(r.FG3M)),
      fg2a: r1(n(r.FGA) - n(r.FG3A)),
      ftm: r1(r.FTM),
      fta: r1(r.FTA),
      oreb: r1(r.OREB),
      tov: r1(r.TOV),
      // A rate, so it's pace-independent and the same in every PerMode.
      efg: ff ? pctOf(ff.EFG_PCT) : 0,
    };
  });

  // The four factors, team and opponent, as published. Note these are
  // stats.nba.com's definitions: turnover % is TOV/possessions (not Dean
  // Oliver's TOV/(FGA + 0.44*FTA + TOV)), and its rebound percentages sit on a
  // different base than OREB/(OREB + opponent DREB). Both read higher than the
  // Basketball-Reference versions — same factor, different convention.
  const fourFactorsByTeam = new Map(
    factorRows.map((r) => [r.TEAM_ID, {
      team: { efg: pctOf(r.EFG_PCT), tov: pctOf(r.TM_TOV_PCT), oreb: pctOf(r.OREB_PCT), ftRate: pctOf(r.FTA_RATE) },
      opp: { efg: pctOf(r.OPP_EFG_PCT), tov: pctOf(r.OPP_TOV_PCT), oreb: pctOf(r.OPP_OREB_PCT), ftRate: pctOf(r.OPP_FTA_RATE) },
    }])
  );

  const advByTeam = new Map();
  for (const r of advRows) {
    if (!advByTeam.has(r.TEAM_ID)) advByTeam.set(r.TEAM_ID, []);
    advByTeam.get(r.TEAM_ID).push(r);
  }

  // Shot-zone indexes (team + player), and league totals per zone for the
  // efficiency-vs-league baseline the court chart compares against.
  const shotZonesByTeam = new Map(teamZoneRows.map((r) => [r.TEAM_ID, r.zones]));
  const shotZonesByPlayer = new Map(playerZoneRows.map((r) => [r.PLAYER_ID, r.zones]));
  const leagueZoneAgg = new Map(SHOT_ZONES.map(([, key]) => [key, { z: key, m: 0, a: 0 }]));
  for (const r of teamZoneRows) {
    for (const zn of r.zones || []) {
      const agg = leagueZoneAgg.get(zn.z);
      if (agg) { agg.m += zn.m; agg.a += zn.a; }
    }
  }
  // Left empty (rather than a row of zeroes) when the request failed, so the
  // fallback below can tell "no data" apart from "genuinely zero attempts".
  const leagueShotZones = teamZoneRows.length ? [...leagueZoneAgg.values()] : [];

  // League standings and the league leaderboard — what the home page opens on.
  // Both are rollups of rows already fetched, so neither costs a request.
  const standings = buildStandings(teamRows, teamIds, rowsByGame, scoreOf);
  const leaders = buildLeaders(playerRows, new Map(standings.map((t) => [t.teamId, t.gp])));

  // League-wide win% + zone shooting per team, for the "shooting profile vs
  // winning" scatter on the Team tab (does shot selection track with winning?).
  const teamZoneWins = teamIds
    .map((tid) => {
      const rec = recordByTeam.get(tid) || { w: 0, l: 0 };
      const gp = rec.w + rec.l;
      return {
        teamId: tid,
        abbr: abbrById.get(tid) || lastName(nameById.get(tid) || "").slice(0, 3).toUpperCase(),
        winPct: gp > 0 ? Math.round((rec.w / gp) * 1000) / 10 : 0,
        zones: shotZonesByTeam.get(tid) || null,
      };
    })
    .filter((t) => t.zones);

  // Player position by id (from each team's roster), used to build per-position
  // zone baselines (guards vs forwards) so a player's shot profile is compared
  // against peers at the same position rather than the whole league.
  const playerPosById = new Map();

  // ----- rotations (one request per game, cached forever) -----
  // Anything already on disk is reused, so this is a long backfill spread over
  // the first few runs on a season and a short top-up every night after.
  let rotationByTeam = new Map();
  let rotationErr = null;
  if (rotations) {
    const gameIds = [...rowsByGame.keys()];
    // "BOS @ LAL · Nov 12" for a game id, so the log says which matchup is on
    // the wire rather than an opaque 0022400001.
    const gameLabel = (id) => {
      const pair = rowsByGame.get(id) || [];
      if (!pair.length) return String(id);
      const when = pair[0].GAME_DATE ? ` · ${fmtDate(pair[0].GAME_DATE)}` : "";
      if (pair.length < 2) return `${String(pair[0].MATCHUP || id)}${when}`;
      const home = pair.find((r) => String(r.MATCHUP || "").includes(" vs")) || pair[1];
      const away = pair.find((r) => r !== home) || pair[0];
      const ab = (r) => r.TEAM_ABBREVIATION || abbrById.get(r.TEAM_ID) || "???";
      return `${ab(away)} @ ${ab(home)}${when}`;
    };
    // This step is the slowest thing in a run and the only one that can sit
    // silent for half a minute at a time, so it narrates every game rather than
    // sampling. With the per-run cap that is a handful of lines, not a flood.
    // begin() opens a line the ticker overwrites and done() closes, so it is
    // started at the end of onPlan — after the plan has had its own full lines.
    let lineOpen = false;
    const logLine = (line) => {
      if (lineOpen) {
        process.stdout.write("\n");
        lineOpen = false;
      }
      console.log(line);
    };
    const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
    const mins = (ms) =>
      ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.max(1, Math.round(ms / 1000))}s`;
    const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "0%");

    try {
      const res = await fetchRotations(season, gameIds, {
        limit: rotationLimit,
        // Printed before the first request goes out, in a terminal or not: it
        // is the answer to "how long is this going to sit here", and to "why is
        // it only doing eight of them".
        onPlan: ({ total, cached, missing, queued, deferred, estMs }) => {
          console.log(`  • ${seasonLabel(season)} rotations · ${total} games this season`);
          if (!missing) {
            console.log(`      all ${total} already cached — nothing to fetch`);
            begin(`  • ${seasonLabel(season)} rotations … `);
            lineOpen = true;
            return;
          }
          console.log(
            `      ${cached} cached (${pct(cached, total)}) · ${missing} missing → attempting ${queued} this run` +
              (deferred ? ` · ${deferred} held back by the ${rotationLimit}/run cap` : "")
          );
          console.log(
            `      ~${mins(estMs)} if the endpoint answers warm; a stalled game takes ~${Math.round(ROTATION_TIMEOUT_MS / 1000)}s each ` +
              `(budget ${mins(ROTATION_BUDGET_MS)})`
          );
          if (deferred) {
            const runs = Math.ceil(missing / Math.max(1, queued));
            console.log(
              `      at ${queued} a run that is ~${runs} more run${runs === 1 ? "" : "s"} to finish the season · ` +
                `use --rotation-limit 0 to fetch the rest in one go`
            );
          }
          begin(`  • ${seasonLabel(season)} rotations … `);
          lineOpen = true;
        },
        onProgress: ({
          done: done_, total, okCount, failed, id, ok, error, tries, ms, slow,
          players, stints, perGameMs, etaMs, seasonHeld, seasonTotal,
        }) => {
          const label = gameLabel(id);
          const outcome = ok
            ? `${players} players, ${stints} stints${tries > 1 ? " (took a retry)" : ""}${slow ? " · slow path" : ""}`
            : `FAILED: ${error || "unknown"}${tries > 1 ? ` (${tries} tries)` : ""}`;
          if (TTY) {
            // One live line: which game, how the run is going, and when it ends.
            const note =
              `${done_}/${total} · ${okCount} ok${failed ? `, ${failed} failed` : ""} · ` +
              `${label} · ${secs(ms)} · ~${mins(etaMs)} left`;
            process.stdout.write(`\r  • ${seasonLabel(season)} rotations … ${note}${CLEAR_EOL}`);
            lineOpen = true;
            return;
          }
          logLine(
            `      [${stamp()}] ${done_}/${total}  ${label} … ${outcome} · ${secs(ms)}`
          );
          // A tally every few games, so a long log still answers "is this
          // moving, and how far into the season are we" without arithmetic.
          if (done_ % 5 === 0 || done_ === total) {
            logLine(
              `      ├─ ${okCount}/${done_} ok · ${secs(perGameMs)}/game · ~${mins(etaMs)} left this run · ` +
                `season ${seasonHeld}/${seasonTotal} (${pct(seasonHeld, seasonTotal)})`
            );
          }
        },
      });
      // Each team's schedule in date order — the same sort buildGames uses, so
      // a block boundary here lands on the same game the Results table calls
      // number 20. Unplayed games have no rotation rows, so they can't shift a
      // boundary by sitting in the list.
      const orderByTeam = new Map(
        teamIds.map((tid) => [
          tid,
          teamRows
            .filter((r) => r.TEAM_ID === tid)
            .sort((a, b) => (a.GAME_DATE < b.GAME_DATE ? -1 : 1))
            .map((r) => r.GAME_ID),
        ])
      );
      rotationByTeam = aggregateRotations(res.byGame, teamIds, orderByTeam);
      const bits = [`${res.byGame.size}/${gameIds.length} games (${pct(res.byGame.size, gameIds.length)})`];
      if (res.cached) bits.push(`${res.cached} cached`);
      if (res.fetched) bits.push(`${res.fetched} new`);
      if (res.failed.length) bits.push(`${res.failed.length} failed — will retry next run`);
      if (res.ranOut) bits.push(`${res.ranOut} left for next run (${mins(ROTATION_BUDGET_MS)} budget)`);
      if (res.deferred) bits.push(`${res.deferred} queued for later runs (cap ${rotationLimit}/run)`);
      const summary = bits.join(" · ");
      // The per-game lines already closed the label line, so the summary has to
      // carry the label itself rather than finishing a line that's long gone.
      done(lineOpen ? summary : `  • ${seasonLabel(season)} rotations … ${summary}`);

      // Which regime the endpoint was in tonight. Worth a line of its own: a run
      // where every game took the slow path is not broken, it is throttled, and
      // that reads very differently from one where they all answered fast.
      if (res.timing) {
        const t = res.timing;
        console.log(
          `      endpoint: ${t.slow}/${t.attempts} took the slow path · median ${secs(t.medianMs)} · ` +
            `slowest ${secs(t.maxMs)} · ${mins(t.totalMs)} of request time`
        );
      }
      // What is left, and what it would take — so the next run is a decision
      // rather than a guess.
      const left = gameIds.length - res.byGame.size;
      if (left) {
        const perRun = rotationLimit > 0 ? Math.min(rotationLimit, left) : left;
        const runs = Math.ceil(left / Math.max(1, perRun));
        console.log(
          `      ${left} game${left === 1 ? "" : "s"} still missing · ~${runs} more run${runs === 1 ? "" : "s"} at ${perRun}/run · ` +
            `\`npm run fetch -- --season ${seasonLabel(season)} --rotation-limit 0\` to finish it now`
        );
      }
      if (res.failed.length) {
        // One line for the reasons, not one per game: this endpoint fails in
        // clusters and the pattern (all of them, or three of two hundred) is
        // what matters. The matchups follow so a failure is identifiable
        // without matching game ids by hand.
        const reasons = [...new Set(res.failed.map((f) => f.error))].slice(0, 3);
        console.log(`      ${res.failed.length} game${res.failed.length === 1 ? "" : "s"} didn't answer: ${reasons.join(" / ")}`);
        const labels = res.failed.slice(0, 8).map((f) => gameLabel(f.id));
        const more = res.failed.length - labels.length;
        // " / " between games: the labels have their own "·" in them.
        console.log(`      ${labels.join(" / ")}${more > 0 ? ` / +${more} more` : ""}`);
      }
      if (!res.byGame.size) rotationErr = "No games returned rotation data.";
    } catch (e) {
      abandon();
      rotationErr = e.message;
    }
  }

  // ----- per-team loops (roster, on/off, lineups) -----
  console.log(`Per-team data for ${seasonLabel(season)} (roster · on/off · lineups) — ${teamIds.length} teams, 3 requests each:`);
  const teams = [];
  const data = {};

  // Per-team failures, grouped by request and message: one endpoint breaking for
  // every team should read as a line naming the teams, not fifteen lines.
  const teamFails = new Map(); // `${label}|${message}` -> { label, message, teams }
  function noteFail(label, message, teamName) {
    if (!message) return;
    const key = `${label}|${message}`;
    if (!teamFails.has(key)) teamFails.set(key, { label, message, teams: [] });
    teamFails.get(key).teams.push(teamName);
  }

  for (const [teamNo, teamId] of teamIds.entries()) {
    const fullName = nameById.get(teamId);
    const { teamName, city } = splitTeamName(fullName);
    const abbr = abbrById.get(teamId) || "";
    const emoji = emojiFor(fullName);
    begin(`  • ${seasonLabel(season)} [${teamNo + 1}/${teamIds.length}] ${emoji} ${teamName} … `);

    const games = buildGames(teamRows, teamId, rowsByGame, scoreOf);
    const idToIndex = new Map(games.map((g) => [g.id, g.i]));

    const errors = {};
    if (errLeague.playeradv) errors.playerAdv = errLeague.playeradv;
    if (errLeague.ratings) errors.teamRanks = errLeague.ratings;
    if (scheduleErr) errors.schedule = scheduleErr;

    // roster meta (jersey/position)
    const meta = new Map();
    try {
      const rosterRows = toObjects(
        await statsFetch("commonteamroster", { TeamID: String(teamId), Season: seasonParam(season), LeagueID: LEAGUE.id }),
        "CommonTeamRoster"
      );
      for (const r of rosterRows) {
        meta.set(r.PLAYER_ID, { num: r.NUM, pos: r.POSITION });
        if (!playerPosById.has(r.PLAYER_ID)) playerPosById.set(r.PLAYER_ID, r.POSITION);
      }
    } catch (e) {
      // Jersey/position are cosmetic, so this never fails the team — but it is
      // still a request that didn't answer, so the run gets to say so.
      noteFail("roster meta (jersey/position)", e.message, teamName);
    }
    await sleep(DELAY_BETWEEN_CALLS_MS);

    const roster = buildRoster(playerRows, teamId, idToIndex, meta);
    for (const p of roster) {
      p.shotZones = shotZonesByPlayer.get(p.playerId) || null;
      p.shotTypes = shotTypes.byPlayer.get(p.playerId) || null;
      // Null rather than [] for a player with no defensive rows: he may simply
      // never have been the closest defender on a tracked attempt, and the UI
      // needs to tell that apart from "this season has no tracking at all".
      p.shotDefend = defendByPlayer.get(p.playerId) || null;
    }

    // on/off
    let onOff = [];
    try {
      onOff = shapeOnOff(await statsFetch("teamplayeronoffdetails", { ...ONOFF(season), TeamID: String(teamId) }));
      if (!onOff.length) errors.onOff = "No rows returned.";
    } catch (e) { errors.onOff = e.message; }
    await sleep(DELAY_BETWEEN_CALLS_MS);

    // lineups
    let lineups = [];
    try {
      lineups = shapeLineups(
        toObjects(await statsFetch("leaguedashlineups", { ...LINEUP_DASH(season), MeasureType: "Advanced", PerMode: "Totals", TeamID: String(teamId) }), "Lineups")
      );
      if (!lineups.length) errors.lineups = "No rows returned.";
    } catch (e) { errors.lineups = e.message; }
    await sleep(DELAY_BETWEEN_CALLS_MS);

    const fourFactors = fourFactorsByTeam.get(teamId) || null;
    if (!fourFactors) errors.fourFactors = errLeague.factors || "No four-factor row returned for this team.";
    const playerAdv = shapePlayerAdv(advByTeam.get(teamId) || []);
    if (!playerAdv.length && !errors.playerAdv) errors.playerAdv = "No rows returned.";

    const shotZones = shotZonesByTeam.get(teamId) || null;
    if (!shotZones && errLeague.teamShotZones) errors.shotZones = errLeague.teamShotZones;

    const teamShotTypes = shotTypes.byTeam.get(teamId) || null;
    if (!teamShotTypes && errLeague.shotTypes) errors.shotTypes = errLeague.shotTypes;

    teams.push({ id: teamId, name: fullName, city, teamName, abbr, emoji });
    const upcoming = upcomingByTeam.get(teamId) || [];
    const rotation = rotationByTeam.get(teamId) || null;
    if (!rotation && rotations) errors.rotation = rotationErr || "No rotation data for this team yet.";

    const bundle = { games, roster, onOff, fourFactors, playerAdv, lineups, shotZones, shotTypes: teamShotTypes, rotation, upcoming, errors };

    // Back-fill this team's empty datasets from the last snapshot.
    const prevBundle = prev ? prev.data[teamId] : null;
    const prevStale = (prevBundle && prevBundle.stale) || {};
    const stale = {};

    // A player's game logs index into `games` by position, so the roster and the
    // game list are only meaningful together — carry both or neither, never one
    // snapshot's logs against the other's games. (This is the player game log
    // failing; both are built from it.)
    if (isEmpty(bundle.roster) && prevBundle) {
      const pair = { games: [], roster: [] };
      const carried = carryOver(pair, prevBundle, ["games", "roster"], {
        prevAt, prevStale, expired, final,
        errors: { games: playerLogErr, roster: playerLogErr },
      });
      if (carried.games && carried.roster) {
        Object.assign(bundle, pair);
        Object.assign(stale, carried);
      }
    }

    // Per-player shot types and defensive matchups hang off roster entries, so
    // the whole-dataset carryOver below can't reach them: a night where the
    // player game log succeeds but shotchartdetail fails produces a fresh roster
    // with every breakdown nulled out. Back-fill those two fields player by
    // player from the last snapshot instead, keyed by id so a roster that
    // changed between runs still lines up.
    for (const [key, failed] of [["shotTypes", errLeague.shotTypes], ["shotDefend", errLeague.shotDefend]]) {
      if (!failed || !prevBundle) continue;
      const prevById = new Map((prevBundle.roster || []).map((p) => [p.playerId, p[key]]));
      let kept = 0;
      for (const p of bundle.roster) {
        if (p[key] || !prevById.get(p.playerId)) continue;
        p[key] = prevById.get(p.playerId);
        kept++;
      }
      if (kept) stale[key] = { at: prevAt, reason: failed };
    }

    const fallbackKeys = ["onOff", "fourFactors", "playerAdv", "lineups", "shotZones", "shotTypes", "rotation"];
    // An empty schedule is legitimate once a season ends, so only reuse the old
    // one when the schedule request actually failed.
    if (scheduleErr) fallbackKeys.push("upcoming");
    Object.assign(stale, carryOver(bundle, prevBundle, fallbackKeys, {
      prevAt, prevStale, expired, final,
      errors: {
        ...errors,
        upcoming: scheduleErr,
        rotation: rotations ? errors.rotation : "rotations were skipped this run (--no-rotations)",
      },
    }));
    if (Object.keys(stale).length) bundle.stale = stale;
    data[teamId] = bundle;

    // The two per-team requests get a three-state mark rather than a tick: it
    // came back (✓), it failed but the last snapshot covers it (↺), or it failed
    // and that section is now empty (✗). A ✓ should only ever mean fresh.
    noteFail("on/off", errors.onOff, teamName);
    noteFail("lineups", errors.lineups, teamName);
    // (a completed season back-fills without marking anything stale — its old
    // numbers are simply the right ones — so ask the bundle, not just `stale`.)
    const mark = (key) => (!errors[key] ? "✓" : isEmpty(bundle[key]) ? "✗" : "↺");

    const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
    // onOff/lineups already say their own state above, so the kept-list covers
    // the rest (roster, playerAdv, shot zones, upcoming).
    const carried = Object.keys(stale).filter((k) => k !== "onOff" && k !== "lineups");
    const flags = [
      plural(bundle.games.length, "game"),
      plural(bundle.roster.length, "player"),
      `${bundle.upcoming.length} upcoming`,
      `on/off ${mark("onOff")}`,
      `lineups ${mark("lineups")}`,
    ];
    if (carried.length) flags.push(`↺ kept ${carried.join(", ")}`);
    done(flags.join(" · "));
  }

  teams.sort((a, b) => a.name.localeCompare(b.name));

  // Per-position zone baselines: aggregate every player's zones into a guard or
  // forward bucket (by the first letter of their listed position; centers count
  // as forwards). Players whose position is unknown are left out of the
  // baselines (the UI falls back to the whole-league baseline for them).
  const posAgg = {
    G: new Map(SHOT_ZONES.map(([, key]) => [key, { z: key, m: 0, a: 0 }])),
    F: new Map(SHOT_ZONES.map(([, key]) => [key, { z: key, m: 0, a: 0 }])),
  };
  for (const r of playerZoneRows) {
    const pos = String(playerPosById.get(r.PLAYER_ID) || "").trim().toUpperCase();
    if (!pos) continue;
    const group = pos.charAt(0) === "G" ? "G" : "F";
    for (const zn of r.zones || []) {
      const agg = posAgg[group].get(zn.z);
      if (agg) { agg.m += zn.m; agg.a += zn.a; }
    }
  }
  const positionShotZones = playerZoneRows.length
    ? { G: [...posAgg.G.values()], F: [...posAgg.F.values()] }
    : null; // null, not zeroes — see leagueShotZones above

  // Per-position shot-type baselines. Three buckets here rather than the zones'
  // two, because shot type is exactly where a center stops looking like a
  // forward: the league average is a third spot-up threes, which is not a shot
  // most centers take at all, so measuring one against it says little more than
  // "he is a center". Splitting them out asks the question worth asking — is he
  // getting good shots for a center?
  //
  // Bucketed on the first letter of the listed position, so a hyphenated "F-C"
  // counts as a forward and "C-F" as a center. Players with no listed position
  // are left out (the UI falls back to the league baseline for them).
  const TYPE_POS_GROUPS = ["G", "F", "C"];
  const typePosAgg = { G: new Map(), F: new Map(), C: new Map() };
  for (const [playerId, buckets] of shotTypes.byPlayer) {
    const pos = String(playerPosById.get(playerId) || "").trim().toUpperCase();
    const group = pos.charAt(0);
    if (!TYPE_POS_GROUPS.includes(group)) continue;
    for (const b of buckets) {
      const agg = typePosAgg[group].get(b.t) || { t: b.t, m: 0, a: 0 };
      agg.m += b.m; agg.a += b.a;
      typePosAgg[group].set(b.t, agg);
    }
  }
  // Only publish a bucket set that actually has shots behind it: an archived
  // season whose roster feed never returned positions would otherwise ship
  // three empty arrays, which the UI can't tell from a real zero.
  const positionShotTypes = shotTypes.byPlayer.size
    ? Object.fromEntries(
        TYPE_POS_GROUPS
          .map((g) => [g, [...typePosAgg[g].values()].sort((x, y) => y.a - x.a)])
          .filter(([, list]) => list.length)
      )
    : null;

  // League-wide action-type totals: the baseline a player's own breakdown is
  // read against, since "44% on spot-up threes" only means something next to
  // what the league shoots on them. The buckets travel with the generic share
  // that qualifies them (see shotTypeCollector) as one object, so a run that
  // loses the shot chart carries over both together or neither — a fresh 0%
  // generic sitting next to last week's buckets would read as a clean season.
  const leagueShotTypes = shotTypes.league.length
    ? { buckets: shotTypes.league, generic: shotTypes.generic }
    : null;

  // Back-fill the rest of the league-wide sets (the ranking was done above).
  Object.assign(league, { standings, leaders, scoreboard, teamProfiles, leagueShotZones, leagueShotTypes, positionShotZones, positionShotTypes, teamZoneWins });
  Object.assign(
    leagueStale,
    carryOver(
      league,
      prev,
      [
        "teamProfiles", "leagueShotZones", "leagueShotTypes", "positionShotZones", "positionShotTypes", "teamZoneWins", "leaders",
        // A completed season has no slate to show, so an empty scoreboard is the
        // right answer there rather than something to back-fill.
        ...(final ? [] : ["scoreboard"]),
      ],
      {
        prevAt,
        prevStale: (prev && prev.stale) || {},
        expired, final,
        errors: {
          teamProfiles: errLeague.profiles,
          leagueShotZones: errLeague.teamShotZones,
          leagueShotTypes: errLeague.shotTypes,
          positionShotZones: errLeague.playerShotZones,
          positionShotTypes: errLeague.shotTypes,
          teamZoneWins: errLeague.teamShotZones,
          leaders: playerLogErr,
          scoreboard: scheduleErr,
        },
      }
    )
  );

  const payload = {
    meta: { generatedAt: new Date().toISOString(), season, final: Boolean(final) },
    teams,
    ...league,
    stale: leagueStale,
    data,
  };

  console.log("");
  begin(`Writing ${join(outDir, String(season))} … `);
  const entry = await writeSeason(outDir, payload);
  done(`${teams.length} teams, ${entry.games} games — season done in ${elapsed(startedAt)}`);

  // ----- what failed -----
  // stats.nba.com fails a request or two most nights, and until now the only
  // trace was a FAILED scrolled far up the run. Collected here instead: one line
  // per broken request with the reason it gave, and for the per-team ones, which
  // teams it broke for. What the site actually shows as a result is the
  // carried-over / not-kept lines below.
  const named = (list, cap = 6) =>
    list.length > cap ? `${list.slice(0, cap).join(", ")} +${list.length - cap} more` : list.join(", ");

  const failures = []; // { line, calls } — one line per request, however many teams
  for (const [label, message] of [
    ["player game log", playerLogErr],
    ["schedule", scheduleErr],
    ...Object.entries(errLeague),
  ]) {
    if (message) failures.push({ line: `  • ${label} (league-wide) … ${message}`, calls: 1 });
  }
  for (const f of teamFails.values()) {
    failures.push({
      line: `  • ${f.label} … ${f.message} — ${f.teams.length} of ${teams.length} teams: ${named(f.teams)}`,
      calls: f.teams.length,
    });
  }
  const failedCalls = failures.reduce((a, f) => a + f.calls, 0);

  if (failures.length) {
    console.log(`\n  ${failedCalls} failed request${failedCalls === 1 ? "" : "s"} for ${seasonLabel(season)}:`);
    for (const f of failures) console.log(f.line);
  } else {
    console.log(`\n  No failures — every ${seasonLabel(season)} request answered.`);
  }

  const leagueCarried = Object.keys(leagueStale);
  const teamsCarried = Object.values(data).filter((b) => b.stale).length;
  if (final && prev) {
    console.log(`  (completed season — anything the API didn't return was taken from the earlier fetch)`);
  } else if (leagueCarried.length || teamsCarried) {
    console.log(
      `  kept from ${prevAt}: ${leagueCarried.length ? leagueCarried.join(", ") : "no league-wide sets"}` +
        `${teamsCarried ? ` · per-team sets for ${teamsCarried} of ${teams.length} teams` : ""}`
    );
    console.log(`  (those sections stay on the page, labelled with the date they came from)`);
  }
  if (expired.size) {
    console.log(
      `  NOT kept (older than ${MAX_STALE_DAYS} days): ${[...expired].join(", ")}` +
        ` — those sections now show as unavailable`
    );
  }
  if (entry.missing) {
    console.log(`  ${entry.missing} dataset${entry.missing === 1 ? "" : "s"} still missing — retry with: npm run fetch -- --repair`);
  }
  return { ...entry, failed: failedCalls };
}

// ----- CLI -------------------------------------------------------------------

/**
 * Season selectors, in the forms the usage note advertises. A season is named
 * by its start year, and the returned list is of start years:
 *
 *   "2019-20"              one season, written the way nba.com writes it
 *   "2019"                 the same season, by start year alone
 *   "16-19" / "2016-2019"  an inclusive range of start years
 *   "2016,2019,2024"       an explicit list (what a failed run prints to retry)
 *
 * "2019-20" is read as a single season rather than a 2019→2020 range because a
 * season label always names consecutive years; write "2019-2020" (both years in
 * full) for the two-season range. That check is what keeps the two forms from
 * quietly meaning different things.
 */
function parseSeasonRange(text) {
  if (text == null) throw new Error("--season/--seasons needs a season, range or list after it.");
  const full = (y) => (Number(y) < 100 ? 2000 + Number(y) : Number(y));
  const out = new Set();
  for (const part of String(text).split(",").map((x) => x.trim()).filter(Boolean)) {
    const single = parseSeasonLabel(part);
    if (single != null) {
      out.add(single);
      continue;
    }
    const [a, b] = part.split(/[-–:]/).map((x) => full(x.trim()));
    if (!Number.isFinite(a)) throw new Error(`Not a season or range: "${part}"`);
    const to = Number.isFinite(b) ? b : a;
    const [lo, hi] = a <= to ? [a, to] : [to, a];
    for (let y = lo; y <= hi; y++) out.add(y);
  }
  if (!out.size) throw new Error(`No seasons in "${text}".`);
  return [...out].sort((a, b) => a - b);
}

function parseArgs(argv) {
  const opts = { seasons: null, mode: "current", outDir: DEFAULT_OUT_DIR, rotations: true, rotationLimit: ROTATION_MAX_PER_RUN };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--season" || arg === "--seasons") {
      opts.seasons = parseSeasonRange(argv[++i]);
      opts.mode = "explicit";
    } else if (arg === "--missing") {
      opts.mode = "missing";
    } else if (arg === "--repair") {
      opts.mode = "repair";
    } else if (arg === "--out") {
      opts.outDir = argv[++i];
    } else if (arg === "--no-rotations") {
      opts.rotations = false;
    } else if (arg === "--rotation-limit") {
      const raw = argv[++i];
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error(`--rotation-limit needs a whole number of games (0 for no cap), not "${raw}".`);
      }
      opts.rotationLimit = limit;
    } else if (arg === "--all") {
      opts.seasons = parseSeasonRange(`${OLDEST_SEASON}-${CURRENT_SEASON}`);
      opts.mode = "explicit";
    } else {
      throw new Error(`Unknown argument "${arg}". See the usage note at the top of this file.`);
    }
  }
  return opts;
}

/**
 * Which seasons this run should actually fetch. Completed seasons are expensive
 * (~45 requests each) and never change, so --missing and --repair exist to fetch
 * only what's absent or broken rather than redoing the archive every time.
 */
async function planSeasons(opts) {
  const index = await readIndex(opts.outDir);
  const known = new Map(index.seasons.map((s) => [Number(s.season), s]));
  const range = () => parseSeasonRange(`${OLDEST_SEASON}-${CURRENT_SEASON}`);

  if (opts.mode === "explicit") return opts.seasons;
  if (opts.mode === "current") return [CURRENT_SEASON];
  if (opts.mode === "missing") return range().filter((y) => !known.has(y));
  // repair: seasons we have but that still have holes in them, plus any missing
  return range().filter((y) => !known.has(y) || (known.get(y).missing || 0) > 0);
}

async function readIndex(dir) {
  try {
    const index = JSON.parse(await readFile(indexPath(dir), "utf8"));
    if (index && Array.isArray(index.seasons)) return index;
  } catch (_) { /* no index yet */ }
  return { currentSeason: CURRENT_SEASON, seasons: [] };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seasons = await planSeasons(opts);

  console.log(`\n${LEAGUE.name} Analytics — fetching from ${HOST}`);
  if (!seasons.length) {
    console.log(`\nNothing to do: every season from ${seasonLabel(OLDEST_SEASON)} to ${seasonLabel(CURRENT_SEASON)} is already complete.\n`);
    return;
  }
  console.log(`Seasons: ${seasons.map(seasonLabel).join(", ")}  →  ${opts.outDir}`);

  const runStartedAt = Date.now();
  const failures = [];
  const degraded = []; // seasons that were written, but with requests that failed
  for (const [i, season] of seasons.entries()) {
    // Only the season in progress can change; everything before it is history.
    const final = season < CURRENT_SEASON;
    try {
      const entry = await fetchSeason(season, {
        outDir: opts.outDir, final, nth: i + 1, of: seasons.length,
        rotations: opts.rotations, rotationLimit: opts.rotationLimit,
      });
      if (entry.failed) degraded.push({ season, failed: entry.failed, missing: entry.missing });
    } catch (e) {
      // One bad season must not abandon the rest of a 10-season backfill.
      abandon(); // whichever step threw still has its line open
      failures.push({ season, message: e.message });
      console.error(`\n  ${seasonLabel(season)} FAILED — ${e.message}`);
      console.error(`  Nothing was written for ${seasonLabel(season)}; any existing files for it are untouched.`);
    }
  }

  console.log(`\n${"─".repeat(64)}`);
  const written = seasons.length - failures.length;
  console.log(`Done: ${written} of ${seasons.length} season${seasons.length === 1 ? "" : "s"} written in ${elapsed(runStartedAt)}.`);
  if (failures.length) {
    for (const f of failures) console.log(`  ${seasonLabel(f.season)}: ${f.message}`);
    console.log(`Retry those with: npm run fetch -- --seasons ${failures.map((f) => seasonLabel(f.season)).join(",")}`);
    process.exitCode = 1;
  }
  // A season can be written and still be missing pieces, which the per-season
  // detail above spells out — this is the "did anything go wrong tonight?" line,
  // so it survives however far the log has scrolled.
  if (degraded.length) {
    for (const d of degraded) {
      console.log(
        `  ${seasonLabel(d.season)}: ${d.failed} failed request${d.failed === 1 ? "" : "s"}` +
          (d.missing ? ` · ${d.missing} dataset${d.missing === 1 ? "" : "s"} unavailable` : " · every section still filled")
      );
    }
    // (a single season already printed this hint above its own detail)
    if (seasons.length > 1 && degraded.some((d) => d.missing)) {
      console.log(`Retry the gaps with: npm run fetch -- --repair`);
    }
  } else if (!failures.length) {
    console.log(`Every request answered — no failures.`);
  }
  console.log("");
}

// Only run when invoked as a command. Importing this file — to reuse the
// rotation shapers, or just to syntax-check it — should not kick off a fetch.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    abandon();
    console.error(`\nFatal: ${e.message}\n`);
    process.exit(1);
  });
}

export { shapeRotation, aggregateRotations, summariseRotation, shotTypeCollector, buildStandings, REGULATION_MIN, SEGMENT_GAMES };
