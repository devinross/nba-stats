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
//
// Completed seasons never change, so they are fetched once and then left alone;
// only the current season is worth re-running. A season is named by its start
// year on disk (2025 = the 2025-26 season) — see the note in src/league.js.
// Output layout (see writeSeason):
//
//     public/data/index.json            the season list the app boots from
//     public/data/2025/league.json      teams + league-wide sets for 2025-26
//     public/data/2025/teams/<id>.json  one file per team
//
// Run from a machine whose IP stats.nba.com doesn't block (your Mac is fine;
// many shared hosts are not). It prints the real status of every request.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The app's own slug rules, imported rather than reimplemented so a player's
// URL can never mean one thing in the data and another in the browser.
import { rosterSlugs } from "../src/routes.js";
// Everything league-specific — host, LeagueID, season spelling, pace column,
// team names and emoji — so this script and the app can't disagree about them.
import { LEAGUE, seasonParam, seasonLabel, parseSeasonLabel, emojiFor, splitTeamName } from "../src/league.js";

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

async function statsFetch(endpoint, params) {
  const usp = new URLSearchParams(params);
  const url = `${HOST}/stats/${endpoint}?${usp.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : e.message);
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
  for (const team of league.teams) {
    try {
      data[team.id] = JSON.parse(await readFile(teamPath(dir, season, team.id), "utf8"));
    } catch (_) { /* a missing team file just means nothing to carry over for it */ }
  }
  return { ...league, data };
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

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
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
  } catch (_) { /* first season written */ }

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
  await writeJson(indexPath(dir), index);
  return entry;
}

// Datasets that would render as "unavailable" — nothing fetched and nothing to
// carry over. Zero means the season is complete and --repair can skip it.
function countMissing(payload) {
  const LEAGUE_KEYS = ["teamRanks", "teamProfiles", "leagueShotZones", "positionShotZones", "teamZoneWins"];
  const TEAM_KEYS = ["games", "roster", "onOff", "fourFactors", "playerAdv", "lineups", "shotZones"];
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
async function fetchSeason(season, { outDir, final, nth, of }) {
  const startedAt = Date.now();
  const which = of > 1 ? `  [season ${nth} of ${of}]` : "";
  console.log(`\n${"─".repeat(64)}\n${seasonLabel(season)}${final ? " (completed season)" : " (season in progress)"}${which}\n`);

  // Anything that fails below falls back on this (see "previous-snapshot
  // fallback"), so a bad night degrades to older numbers instead of blank charts.
  const prev = await readSeason(outDir, season);
  const prevAt = prev ? prev.meta.generatedAt : null;
  console.log(
    prev
      ? `Already on disk from ${prevAt} — will back-fill anything that fails today.\n`
      : "Nothing on disk for this season — nothing to fall back on if a request fails.\n"
  );

  // ----- league-wide data (one call each) -----
  // Each one is numbered so a run that stalls says how far in it got. A
  // completed season skips the schedule call, hence one step fewer.
  // The league-wide requests in the order they go out, so "[4/9]" counts against
  // what actually runs — add a request below and add its label here. A completed
  // season has no schedule to look ahead at, hence one fewer.
  const LEAGUE_REQUESTS = [
    "team game log", "player game log", "ratings", "playeradv", "profiles",
    "factors", "teamShotZones", "playerShotZones",
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
    let count = 0;
    for (const gd of gameDates) {
      for (const g of gd.games || []) {
        if (g.gameStatus !== 1) continue; // 1 = scheduled, 2 = live, 3 = final
        const ts = Date.parse(g.gameDateEst || g.gameDateTimeEst || gd.gameDate);
        if (Number.isFinite(ts) && ts < cutoff) continue;
        const home = g.homeTeam, away = g.awayTeam;
        if (!home || !away) continue;
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
    done(`${count} upcoming games`);
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
    for (const p of roster) p.shotZones = shotZonesByPlayer.get(p.playerId) || null;

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

    teams.push({ id: teamId, name: fullName, city, teamName, abbr, emoji });
    const upcoming = upcomingByTeam.get(teamId) || [];
    const bundle = { games, roster, onOff, fourFactors, playerAdv, lineups, shotZones, upcoming, errors };

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

    const fallbackKeys = ["onOff", "fourFactors", "playerAdv", "lineups", "shotZones"];
    // An empty schedule is legitimate once a season ends, so only reuse the old
    // one when the schedule request actually failed.
    if (scheduleErr) fallbackKeys.push("upcoming");
    Object.assign(stale, carryOver(bundle, prevBundle, fallbackKeys, {
      prevAt, prevStale, expired, final,
      errors: { ...errors, upcoming: scheduleErr },
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

  // Back-fill the rest of the league-wide sets (the ranking was done above).
  Object.assign(league, { teamProfiles, leagueShotZones, positionShotZones, teamZoneWins });
  Object.assign(
    leagueStale,
    carryOver(league, prev, ["teamProfiles", "leagueShotZones", "positionShotZones", "teamZoneWins"], {
      prevAt,
      prevStale: (prev && prev.stale) || {},
      expired, final,
      errors: {
        teamProfiles: errLeague.profiles,
        leagueShotZones: errLeague.teamShotZones,
        positionShotZones: errLeague.playerShotZones,
        teamZoneWins: errLeague.teamShotZones,
      },
    })
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
  const opts = { seasons: null, mode: "current", outDir: DEFAULT_OUT_DIR };
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
      const entry = await fetchSeason(season, { outDir: opts.outDir, final, nth: i + 1, of: seasons.length });
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

main().catch((e) => {
  abandon();
  console.error(`\nFatal: ${e.message}\n`);
  process.exit(1);
});
