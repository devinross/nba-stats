// ---------------------------------------------------------------------------
// Everything that differs between this site and its WNBA sibling
// (`wnba-analytics`), in one module.
//
// The two projects are forks of the same app. Keeping every league-specific
// value here — the host, the LeagueID, how a season is spelled, which pace
// column to read, what a team is called — is what makes them diffable: outside
// this file, `git diff` between the two trees should be copy, colors and this
// module's import, not logic.
//
// Imported by the browser app, `scripts/prerender.mjs` AND
// `scripts/fetch-data.mjs`, so it must stay free of browser globals and run in
// plain Node.
//
// ## How a season is represented
//
// An NBA season straddles two calendar years, which the WNBA's does not. Rather
// than thread a string through code that compares, sorts and ranges over
// seasons, a season is its **start year as an integer** everywhere internally —
// 2025 means the 2025-26 season — and is rendered through `seasonLabel` at
// every point a human sees it:
//
//   internal        2025
//   API parameter   "2025-26"      seasonParam()
//   URL segment     /2025-26       seasonLabel(), parsed by parseSeasonLabel()
//   on screen       "2025-26"      seasonLabel()
//   on disk         data/2025/     the integer, so the season index, the range
//                                  arithmetic and vercel.json's cache rule all
//                                  keep working on plain numbers
// ---------------------------------------------------------------------------

export const LEAGUE = {
  /** LeagueID in every stats endpoint. 00 = NBA, 10 = WNBA. */
  id: "00",
  name: "NBA",
  /** The JSON API the fetch script calls. */
  statsHost: "https://stats.nba.com",
  webHost: "https://www.nba.com",
  /**
   * Where the human-readable version of each endpoint lives — what every
   * source footnote links to, with the season and filters already applied.
   *
   * Not `statsHost`: stats.nba.com 301s to www.nba.com/stats **and drops the
   * query string on the way**, which would land every footnote on an unfiltered
   * current-season table instead of the rows the number came from. (The WNBA
   * fork can use its stats host directly; this one can't.) No trailing slash —
   * www.nba.com/stats 308s to strip one, and there's no reason to spend a
   * redirect on it.
   */
  pagesHost: "https://www.nba.com/stats",

  /**
   * The season in progress: the only one the nightly refresh touches, and the
   * one the site opens on. Bump it when a new season tips off.
   *
   * In the NBA's long offseason this points at the season that just finished —
   * there is no "current" season from late June until October, and pointing at
   * a season with no games would open the site on an empty page. The fetcher
   * says so plainly if the season it's asked for hasn't started yet.
   */
  currentSeason: 2025,
  /**
   * How far back --missing / --repair / --all reach. Every endpoint the site
   * uses goes back to 1996-97 if you ever want more history; budget about four
   * minutes and ~5MB per season.
   */
  oldestSeason: 2016,

  /**
   * The pace column to read out of the Advanced team dashboard. The NBA plays
   * 48-minute games and `PACE` is already on that basis, so it's the right one
   * here. (The WNBA fork reads `PACE_PER40` instead: that backend inherits the
   * NBA's 48-minute basis for `PACE` and so reports ~97 for a 40-minute game.)
   */
  paceField: "PACE",

  /**
   * The clock, for the rotation grid: four 12-minute quarters. Overtime is
   * counted in a player's minutes but has no column of its own, which is why
   * these two are separate from "how long a game actually ran".
   */
  regulationMinutes: 48,
  periodMinutes: 12,
  periods: 4,

  /**
   * How many games a block of the rotation grid covers. An NBA regular season
   * is 82 games, so 20 gives four blocks and a short fifth — close enough to
   * "quarters of the season", which is the timescale a rotation changes on.
   */
  segmentGames: 20,

  /**
   * Share of a team's games a player must appear in before a per-game average
   * counts as a league lead. The NBA's own leaderboard qualifier is 58 of 82,
   * which is this share to within a game.
   */
  leaderMinShare: 0.7,

  /**
   * Teams per conference that make the postseason, counting the play-in: the
   * line the standings table draws. Six seeds are automatic and 7-10 play in,
   * so the meaningful cut for a standings table is 10.
   */
  playoffSpots: 10,

  /**
   * The first season with closest-defender tracking behind
   * `leaguedashptdefend`. The NBA's goes back to 2013-14, comfortably before
   * `oldestSeason`, so every season this site carries has matchup data — the
   * field exists so the fetch script and the UI can say so in one place (the
   * WNBA fork's tracking only starts in 2023).
   */
  defendFirstSeason: 2013,
};

/**
 * Which conference a team plays in, by team id. Hardcoded rather than fetched:
 * `leaguedashteamstats` doesn't carry it, and pulling `leaguestandingsv3` just
 * for this would be a request for something that has not changed once in the
 * seasons this site covers. The standings table is the only thing that reads
 * it, and a team missing from the map simply lands in neither half.
 *
 * (The WNBA fork has nothing like this — that league seeds one table.)
 */
export const CONFERENCE = {
  1610612737: "East", // Atlanta Hawks
  1610612738: "East", // Boston Celtics
  1610612751: "East", // Brooklyn Nets
  1610612766: "East", // Charlotte Hornets
  1610612741: "East", // Chicago Bulls
  1610612739: "East", // Cleveland Cavaliers
  1610612765: "East", // Detroit Pistons
  1610612754: "East", // Indiana Pacers
  1610612748: "East", // Miami Heat
  1610612749: "East", // Milwaukee Bucks
  1610612752: "East", // New York Knicks
  1610612753: "East", // Orlando Magic
  1610612755: "East", // Philadelphia 76ers
  1610612761: "East", // Toronto Raptors
  1610612764: "East", // Washington Wizards
  1610612742: "West", // Dallas Mavericks
  1610612743: "West", // Denver Nuggets
  1610612744: "West", // Golden State Warriors
  1610612745: "West", // Houston Rockets
  1610612746: "West", // LA Clippers
  1610612747: "West", // Los Angeles Lakers
  1610612763: "West", // Memphis Grizzlies
  1610612750: "West", // Minnesota Timberwolves
  1610612740: "West", // New Orleans Pelicans
  1610612760: "West", // Oklahoma City Thunder
  1610612756: "West", // Phoenix Suns
  1610612757: "West", // Portland Trail Blazers
  1610612758: "West", // Sacramento Kings
  1610612759: "West", // San Antonio Spurs
  1610612762: "West", // Utah Jazz
};

/** "East" / "West", or null for a team the map doesn't know. */
export function conferenceOf(teamId) {
  return CONFERENCE[teamId] || null;
}

/** 2025 -> "2025-26". Handles the century roll: 1999 -> "1999-00". */
export function seasonLabel(startYear) {
  const y = Number(startYear);
  if (!Number.isFinite(y)) return String(startYear);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** The `Season` parameter every stats endpoint wants. Same spelling as the label. */
export const seasonParam = seasonLabel;

/**
 * "2025-26" -> 2025. Returns null for anything that isn't a season label,
 * including a bare year, so a stray "/2025" can't be mistaken for a season and
 * silently resolve to one.
 */
export function parseSeasonLabel(text) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(text || "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  // The two halves have to be consecutive years: "2025-26" is a season,
  // "2025-99" is a typo.
  return Number(m[2]) === (start + 1) % 100 ? start : null;
}

/**
 * "Los Angeles Lakers" -> { city: "Los Angeles", teamName: "Lakers" }.
 *
 * The feed gives one joined string, and the site needs the nickname on its own
 * (it's the short label in the header and the picker). Taking the last word
 * covers 29 teams and breaks on exactly one, which is why the exception list
 * exists rather than a cleverer rule.
 */
const TWO_WORD_NICKNAMES = ["Trail Blazers"];

export function splitTeamName(full) {
  const name = String(full).trim();
  for (const nickname of TWO_WORD_NICKNAMES) {
    if (name.endsWith(` ${nickname}`)) {
      return { city: name.slice(0, -nickname.length - 1), teamName: nickname };
    }
  }
  const parts = name.split(" ");
  return { teamName: parts[parts.length - 1], city: parts.slice(0, -1).join(" ") };
}

/**
 * Emoji "logo" per team, matched by a keyword in the team name — the site shows
 * one everywhere a logo would go, since the league's marks aren't ours to
 * serve. Edit freely; anything that doesn't match falls back to a basketball.
 *
 * Ordered so a longer keyword is tested before a shorter one it contains.
 */
export const TEAM_EMOJI = [
  [/hawk/i, "🦅"],
  [/celtic/i, "☘️"],
  [/\bnets\b/i, "🥅"],
  [/hornet/i, "🐝"],
  [/bull/i, "🐂"],
  [/cavalier/i, "🛡️"],
  [/maverick/i, "🐎"],
  [/nugget/i, "💎"],
  [/piston/i, "⚙️"],
  [/warrior/i, "⚔️"],
  [/rocket/i, "🚀"],
  [/pacer/i, "🏎️"],
  [/clipper/i, "⛵"],
  [/laker/i, "💜"],
  [/grizzl/i, "🐻"],
  [/heat/i, "🔥"],
  [/buck/i, "🦌"],
  [/timberwol/i, "🐺"],
  [/pelican/i, "🦩"],
  [/knick/i, "🗽"],
  [/thunder/i, "⚡"],
  [/magic/i, "🪄"],
  [/76er|sixer/i, "🔔"],
  [/\bsuns\b/i, "☀️"],
  [/blazer/i, "🌲"],
  [/king/i, "👑"],
  [/spur/i, "🤠"],
  [/raptor/i, "🦖"],
  [/jazz/i, "🎷"],
  [/wizard/i, "🧙"],
];

export function emojiFor(name) {
  const hit = TEAM_EMOJI.find(([re]) => re.test(String(name)));
  return hit ? hit[1] : "🏀";
}
