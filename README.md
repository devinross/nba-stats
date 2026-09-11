# NBA Analytics — setup guide

A React dashboard for **all 30 NBA teams**, across **every season since
2016-17**. The home page is the **league page** — the night's slate, both
conferences' standings, the per-game leaders, and every team as a card. From
there, pick a team (each shown with an emoji, e.g. "☘️ Celtics", "💜 Lakers")
and a season from the dropdown beside it; each team has a **Team** tab and a
**Players** tab, built from data pulled from **stats.nba.com**.

The key idea: the website does **not** talk to stats.nba.com. Instead you run a
small script that downloads the data and saves it as static files under
`public/data/`. The site just reads those. So the deployed site is plain static
files — no proxy, no API key, and none of the CORS / IP blocking / "500"
problems that come from calling stats.nba.com live from a web host. You refresh
the numbers by re-running the script whenever you want.

**This project is a fork of `wnba-analytics`**, and the two are meant to stay
diffable. Every league difference — the host, the LeagueID, how a season is
spelled, which pace column to read, the team list — lives in **`src/league.js`**
and nowhere else. If you fix a bug in one repo, the same patch should apply
cleanly to the other.

This guide assumes you've **never used React**.

---

## How the pieces fit together

```
  npm run fetch                          The website (static files)
  +--------------------------+          +------------------------------+
  | scripts/fetch-data.mjs   |  writes  | reads  data/index.json        |
  |  -> stats.nba.com        | -------> |        data/<season>/league…  |
  |  (run on your Mac)       |  JSON    |        data/<season>/teams/…  |
  +--------------------------+          +------------------------------+
```

Run the fetch script on your Mac (its IP isn't blocked by stats.nba.com). It
writes one folder per season. Build the site from those and upload the static
files.

**Why the data is split up.** A single file per season is ~4.4MB, which every
visitor would download to look at one team. Instead each season is a small
`league.json` (the team list and the league-wide charts, ~49KB) plus one file per
team (~146KB). A cold load is about **195KB instead of 4.4MB**; switching teams
fetches one more small file, and anything already fetched stays in memory for the
rest of the session. Finished seasons never change, so their files are cached
permanently by the browser (see `vercel.json`) — only the current season is ever
re-downloaded.

**A note on season names.** An NBA season spans two calendar years. In the code
and on disk a season is its **start year** (`2025` = the 2025-26 season, written
to `public/data/2025/`); everywhere a person sees it — the dropdown, page titles,
URLs like `/2023-24/team/boston-celtics` — it is spelled out in full. The
conversion lives in `seasonLabel` / `parseSeasonLabel` in `src/league.js`.

---

## 0. Install Node.js (one time)

Download the **LTS** version from **nodejs.org** and install it. Restart your
terminal afterward so the `npm` command is available. (Node 18 or newer — the
fetch script uses the built-in `fetch`.)

## 1. Open the project and install dependencies

```bash
cd nba-analytics       # the unzipped folder
npm install              # one time, downloads dependencies
```

## 2. Fetch the data

```bash
npm run fetch
```

That downloads **the current season** — every team's games, box scores, on/off
ratings, four factors, advanced player stats, league-wide ratings, lineups and
shot zones. It makes ~135 requests (14 league-wide plus 4 per team) and takes
about four minutes, plus however long the rotation backfill runs, printing the
real status of each one:

```
Seasons: 2025-26  →  .../public/data

────────────────────────────────────────────────────────────
2025-26 (season in progress)

Already on disk from 2026-08-11T11:00:12.994Z — will back-fill anything that fails today.

League-wide data for 2025-26:
  • 2025-26 [1/11] team game log … 2460 rows · 1.3s
  • 2025-26 [2/11] player game log … 26651 rows · 3.2s
  • 2025-26 [3/11] ratings … 30 rows
  ...
  • 2025-26 [9/11] shotTypes … 219160 shots · 582 players · 22.5s
  • 2025-26 [10/11] shotDefend … 581 defenders · 6/6 categories · 4.2s
  ...
Per-team data for 2025-26 (roster · on/off · lineups) — 30 teams, 3 requests each:
  • 2025-26 [1/30] ☘️ Celtics … 82 games · 18 players · 0 upcoming · on/off ✓ · lineups ✓
  • 2025-26 [2/30] 💜 Lakers … 82 games · 24 players · 0 upcoming · on/off ✓ · lineups ✓
  ... (one line per team) ...

Writing .../public/data/2025 … 30 teams, 2460 games — season done in 163.2s
```

If something fails, the script falls back on the numbers already on disk rather
than writing a hole — see **When a request fails** below. A line ending in
`↺ kept onOff, lineups` means those two sections for that team came from the
previous fetch.

### Other seasons

Completed seasons never change, so they're fetched **once** and then left alone.
The nightly refresh only touches the current one.

```bash
npm run fetch                       # the current season (what the nightly job runs)
npm run fetch -- --missing          # any season since 2016-17 not on disk yet
npm run fetch -- --season 2019-20   # one season, refetched from scratch
npm run fetch -- --seasons 16-19    # a range of start years (short or full)
npm run fetch -- --repair           # only the seasons with gaps in them
npm run fetch -- --all              # every season from 2016-17 to now
npm run fetch -- --out <dir>        # write somewhere other than public/data
npm run fetch -- --no-rotations     # skip the per-game rotation backfill
npm run fetch -- --rotation-limit 0 # no cap on rotations this run (see below)
```

A season selector accepts either spelling: `2019-20` and `2019` mean the same
season. A range is written with both years in full (`--seasons 2016-2019`) or
both short (`16-19`); `2019-20` is read as one season rather than a two-season
range, because a season label always names consecutive years.

Two fields in `src/league.js` set the boundaries: `currentSeason` (the season in
progress — bump it when a new one tips off) and `oldestSeason` (how far back
`--missing`, `--repair` and `--all` reach; 2016 by default). Every endpoint this
project uses goes back to **1996-97**, so you can lower `oldestSeason` and run
`npm run fetch -- --missing` for more history — budget about three minutes and
~4.4MB per season.

**In the offseason** there is no season in progress: from late June until
October the newest season has no games. Leave `currentSeason` on the last
completed season until the new one tips off — the site opens on it and the
nightly job keeps it current through the playoffs. Asking the fetcher for a
season that hasn't started says so plainly rather than failing obscurely.

**If a season came out wrong**, `--repair` retries the ones with holes in them.
The script records how many datasets are missing from each season in
`public/data/index.json`, and `--repair` re-runs exactly those; anything that
fails again keeps the value it already had. To force a full refetch of one
season regardless, name it: `npm run fetch -- --season 2019-20`.

### When a request fails

stats.nba.com is flaky — an endpoint that answered yesterday can return a 500
today. That used to punch a hole in the snapshot, and a chart that had been on
the page for weeks would disappear until the next good fetch.

Instead, **every dataset that fails or comes back empty is carried over from
what's already on disk**, tagged with the date it was really fetched. The section
keeps rendering, with a note above it:

> ↺ The last refresh didn't return this — showing the numbers from Aug 11.

(Hovering the note shows the underlying error.) The rules:

- **Carried per dataset**, so one broken endpoint never affects the rest. On/off
  and lineups are per team; ratings, shot zones and league profiles are shared.
- **Games and rosters carry as a pair**, since each player's game logs index into
  that team's game list.
- **The date isn't restamped.** If a section has been failing for a week, it says
  a week ago — not yesterday.
- **Nothing older than 21 days is reused** (`MAX_STALE_DAYS` in
  `scripts/fetch-data.mjs`). Past that the section goes back to showing
  "unavailable" rather than passing off three-week-old numbers as current.
- **A different season never back-fills another.** Each season only ever falls
  back on its own earlier fetch.
- **Completed seasons are exempt from both rules.** Their numbers are final, so
  a value reused from an earlier fetch isn't stale — it's just the answer. It's
  carried over however old it is, and shown without a note.
- **If the core team game log fails, nothing is written for that season** — its
  existing files are left untouched, so the site keeps serving them, and a
  ten-season backfill carries on with the next year rather than giving up.

## 3. Preview locally

```bash
npm run dev
```

Open the printed URL (usually **http://localhost:5173**). Stop with `Ctrl + C`.

## 4. Build the production files

```bash
npm run build
```

Creates the **`dist/`** folder — the finished static site (it includes the data
file you fetched). There's a shortcut that fetches fresh data and builds in one
step:

```bash
npm run refresh
```

`npm run build` runs `scripts/prerender.mjs` after Vite, which is why the build
prints something like `prerender: 971 pages`. See
[Search engines & sharing](#search-engines--sharing) — the short version is that
it turns the one-page app into a real page per team and player, each with its
own URL, title and crawlable content.

---

## 5. Upload to Bluehost

Bluehost serves files from **`public_html`**. Because the site is now fully
static, **you do not need PHP or the old proxy** — just upload the files.

**Option A - cPanel File Manager:** zip the **contents of `dist/`**, upload to
`public_html`, and extract so `public_html/index.html` exists (and the
`public_html/data/` folder exists alongside it).

**Option B - SFTP / your editor's publish feature:** upload the **contents of
`dist/`** into `public_html/`.

> **Subfolder deploys no longer work.** They used to: asset and data paths were
> relative (`base: "./"`). The site now prerenders a page per team and player,
> which are served from nested paths like `/team/boston-celtics/`, and a relative
> asset URL on one of those resolves to `/team/boston-celtics/assets/…`. So
> `vite.config.js` sets `base: "/"` and the build must be served from a domain
> root — `nba.highlightfactory.app`, or `public_html/` itself, but not
> `public_html/nba/`.

Any host also needs to serve `dist/team/boston-celtics/index.html` for the URL
`/team/boston-celtics`, which static hosts (Vercel, Netlify, Apache, nginx) do by
default. It also needs a **single-page-app fallback** for paths with no file of
their own — a past season's player pages are rendered in the browser rather than
prerendered (see [Search engines & sharing](#search-engines--sharing)), so
`/2019-20/team/los-angeles-lakers/lebron-james` has to serve the root
`index.html` instead of 404ing. `vercel.json` does this with a rewrite that
excludes `/data` and `/assets`, so a genuinely missing data file still fails
honestly rather than returning HTML.

That's it. Load your domain and the dashboard appears.

---

## Branding & theme

This site is a subdomain of Highlight Factory (`nba.highlightfactory.app`) and
shares that brand's design language, copied from the marketing site
(`highlight-factory-promo-site`):

- **Type** — JetBrains Mono on titles, scores and labels; the system UI face on
  supporting copy. Both are exported from `src/palette.js` as `FONT_DISPLAY` /
  `FONT_BODY`, and mirrored as `--font-display` / `--font-body` in
  `src/index.css`. Components must use those rather than naming a family, since
  SVG `fontFamily` attributes can't resolve CSS variables.
- **Color** — white page, white cards separated by a hairline (never a shadow),
  black type, brand plum `#3A1136` as the accent and chart blue `#6155F5` as the
  secondary series. Edit `src/palette.js` to change any of it; keep
  `src/index.css` in sync, since the two describe the same tokens for different
  consumers (Recharts vs. page chrome).
- **Light only.** Like the main site, there is no night mode and no toggle.
- **Header/footer** — `src/App.jsx` carries a header matched to the marketing
  site's (`BrandMark` + "NBA Stats / powered by Highlight Factory", mono nav,
  plum download capsule). The links back to the main site live in
  `src/config.js`.

## Search engines & sharing

A client-rendered app is two things search engines handle badly: the deployed
HTML is `<div id="root"></div>` with no content in it, and the whole site lives
at one URL. A stats site's search demand is almost all long-tail ("boston celtics
stats", "nikola jokic shot chart"), which one URL can never answer. So the build
turns the app into hundreds of real pages:

```
/                                      league landing, current season
/team/boston-celtics                   a team
/team/boston-celtics/jayson-tatum      a player
/2019-20                               a past season's landing
/2019-20/team/los-angeles-lakers       that team, that season
/2019-20/team/los-angeles-lakers/…     a player that season (rendered in the browser)
```

The season in progress keeps unprefixed URLs, so nothing already indexed moves
when a new season starts; past seasons live under a season prefix.

**What gets prerendered.** The current season in full — landing, every team,
every player. Completed seasons get their landing and team pages only: another
~600 player pages per archived year would multiply the build for little crawl
value. Those URLs still work, they just render client-side, which is why the
host needs the SPA fallback described in step 5.

- **`src/routes.js`** owns the URL scheme — slugs, `buildPath`, `parsePath`,
  `resolveInSeason`, `seasonRoutes`. It is imported by the app, the build script
  *and* the fetch script, so none of them can disagree about what a URL means.
  Player slugs are de-duplicated per roster (so two similar names can't fight
  over one URL) and written into each season's `league.json` at fetch time, which
  is what lets the browser resolve a player URL before that team's file arrives.
- **`src/pageMeta.js`** owns the `<title>`, description and canonical for every
  route, and is likewise shared: `scripts/prerender.mjs` writes them into the
  static files, and `App.jsx` applies the same values during client-side
  navigation, so the page a visitor sees always matches the one Google indexed.
- **`scripts/prerender.mjs`** runs as part of `npm run build`. For each route it
  writes `dist/<route>/index.html` containing that entity's real numbers (record,
  per-game averages, leaders, roster — read from `public/data/`, which it
  reassembles from the split files),
  the right meta tags, and JSON-LD (`SportsTeam` / `Person` / `Dataset` plus
  breadcrumbs). React replaces the static content on mount, so it's on screen
  for a frame — but a crawler that doesn't run JavaScript still gets the
  substance and, importantly, links to follow. It also writes `dist/sitemap.xml`
  and fails the build if the page count and the sitemap ever disagree.
- **`scripts/indexnow.mjs`** runs last in `npm run build`. On a Vercel
  production build it diffs the new `dist/sitemap.xml` against the one live on
  the site and pings [IndexNow](https://www.indexnow.org) with every URL that's
  new or whose `<lastmod>` moved, so Bing, Yandex and the other participating
  engines pick up the nightly numbers without waiting to re-read the sitemap.
  Google doesn't take part. Local and preview builds skip the ping;
  `node scripts/indexnow.mjs --dry-run` shows what a deploy would send. The key
  is public by design (engines verify it by fetching `public/<key>.txt`), so to
  rotate it, rename that file, change its contents and `INDEXNOW_KEY` together.
- **Internal links.** The sitemap alone isn't enough — pages need to link to
  each other. The team `<select>` isn't crawlable, so there's an "All teams" nav
  above the footer, and the roster rail and the advanced-stats table use real
  `<a href>`s (a plain left-click is still intercepted for instant navigation;
  cmd-click opens a new tab like any other link).
- **Headings.** The `<h1>` is the selected team (in `TeamPicker`), with the city
  and season attached in an `.sr-only` span since the visible design only has
  room for the short name. Section headings are `<h2>`; on the Players tab the
  player name is the `<h2>` and its sections are `<h3>`.
- **`public/og.png`** is the 1200x630 share card. It is *generated*, not drawn
  by hand — edit `scripts/og-template.html` and run:

  ```bash
  npm run og
  ```

  That renders the template with a local headless Chrome and writes the PNG.
  It's deliberately kept out of `npm run build` (it needs a browser on the
  machine and the network for the webfont), so commit the PNG when it changes.

The production domain is named in `src/pageMeta.js` (`SITE_URL`, which drives
every canonical and Open Graph URL), `src/config.js`, `index.html` and
`public/robots.txt`. Change it in all four if the subdomain ever moves; the
sitemap and the per-page canonicals follow `SITE_URL` automatically.

## Mobile

The dashboard is dense, so a few layouts are explicitly re-flowed for phones
(all in `src/index.css`, no separate mobile build):

- Below 820px the header nav collapses to a menu button and the Players tab's
  roster rail becomes a scrollable band above the stats instead of a side rail.
- Below 720px the paired panels (`.split-2`) stack, and lineup rows
  (`.lineup-row`) move their net-rating bar to a second line so the player names
  keep their width.
- Wide stat tables never squeeze — they scroll inside `.scroll-x`, which paints
  a fade on the right edge as the only available hint on a device with no
  resting scrollbar.
- On touch devices (`hover: none`), the pill toggles, footer links and the team
  picker get larger hit areas. The picker grows via an invisible overlay so the
  visible label doesn't move.

## Refreshing / updating the data

The numbers are a snapshot from when you last ran the fetch. To update:

```bash
npm run fetch      # re-download the current season into public/data/<season>/
npm run build      # rebuild dist/  (or: npm run refresh to do both)
```

Then re-upload `dist/` (or just the updated `dist/data/<season>/` folder and
`dist/data/index.json`).

**When a new season starts:** bump `currentSeason` in `src/league.js` and run
`npm run fetch`. Last year's data becomes an
archive automatically — it moves under a `/<year>` URL prefix, stops being
re-fetched, and drops to team-pages-only in the prerender. Optionally add the
finished year to the immutable-cache rule in `vercel.json`; forgetting only
costs a revalidation round trip.

**Change a team's emoji:** edit the `TEAM_EMOJI` list in `src/league.js` (each
entry matches a keyword in the team name), then re-run `npm run fetch`. Any team
that doesn't match gets a 🏀.

**Refresh straight onto the server (optional):** you can point the script at any
output directory, so a cron job could refresh the live files without a rebuild:

```bash
node scripts/fetch-data.mjs --out /home/youruser/public_html/data
```

(Only works if that server's IP isn't blocked by stats.nba.com — many shared
hosts are blocked, which is exactly why we fetch from your Mac by default.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site says "Couldn't load data/index.json" | You haven't fetched yet, or didn't upload the `data/` folder. Run `npm run fetch`, rebuild, and make sure `data/` sits next to `index.html`. |
| A season is missing from the dropdown | It isn't on disk. `npm run fetch -- --missing` fetches every season since `oldestSeason` that you don't have. |
| A past season looks incomplete | `npm run fetch -- --repair` retries just the seasons with gaps recorded in `data/index.json`. |
| `npm run fetch` stops at the team game log | stats.nba.com refused the core request from your network. Try again; if it persists, your IP may be temporarily blocked - try a different network. |
| `the 2026-27 season has no games yet` | The season hasn't tipped off. Leave `currentSeason` in `src/league.js` on the last completed season until it does. |
| A section says "showing the numbers from …" | That endpoint failed on the last fetch, so those numbers came from the previous snapshot. Hover the note for the reason; re-run `npm run fetch` to try again. |
| A Team-tab section shows "unavailable" | That endpoint failed **and** there was nothing recent enough to fall back on (no earlier snapshot, or it's over 21 days old). The red text under it shows the exact reason. Re-run `npm run fetch`. |
| "No games found" | The fetched season has no completed games, or `currentSeason` in `src/league.js` is wrong. Fix and re-run `npm run fetch`. |
| Blank page / asset errors after deploying | The build expects to be served from a domain root (see the note in step 5). Check that `/assets/…` and `/data/index.json` resolve at the top level, not inside a subfolder. |
| A past season's *player* URL 404s | The host has no SPA fallback. Those pages aren't prerendered by design — see step 5. |
| A team or player URL shows the landing page | The host is falling back to the root `index.html` instead of serving the prerendered `dist/team/<team>/index.html`. Expected under `vite preview`; on a real static host, check that directory indexes are enabled. |

---

## What data is pulled

The fetch script calls these stats.nba.com endpoints (LeagueID 00 = NBA) for
every team, once per season, and transforms the responses into the files under
`public/data/<season>/`. The game logs and the advanced team/player/four-factor
dashboards are league-wide (one call each); the roster, on/off, lineup and shot-
chart endpoints are per-team (one call per team); rotations are per game:

- `leaguegamelog` (teams) - every team's games -> each game's score, the team
  list, and a team-id->abbreviation map for the league ranking chart.
- `leaguegamelog` (players) - every player's game line -> each team's per-game
  player logs (PTS, REB, AST, FG/3P/FT, +/-, minutes, etc.).
- `commonteamroster` - jersey numbers and positions (optional).
- `teamplayeronoffdetails` (Advanced) - on/off impact (offensive/defensive
  rating per 100 possessions with each player on vs. off).
- `leaguedashteamstats` (Advanced) - every team's offensive/defensive/net
  rating, for the league-wide ranking.
- `leaguedashplayerstats` (Advanced) - per-player usage, true shooting,
  AST%/REB%, net rating, PIE.
- `leaguedashlineups` (Advanced) - five-player units -> the eight most-used
  lineups by minutes with their net rating.

- `leaguedashteamstats` (Base, `PerMode=Per100Possessions`) - every team's
  shooting & possession profile per 100 possessions (3PM, 3PA, FTM, FTA,
  offensive rebounds, turnovers), powering the "profile vs the NBA" comparison.
- `leaguedashteamstats` ("Four Factors") - team and opponent eFG%, turnover %,
  offensive-rebound % and FT rate.
- `scheduleleaguev2` - the season schedule -> each team's upcoming games, and
  the league-wide slate around today that the home page's scoreboard shows.
  Filtered to regular-season game ids, since the feed also carries preseason,
  All-Star and playoff games and every other dataset here is regular season.
- `shotchartdetail` (`ContextMeasure=FGA`) - **one row per attempt**, with the
  `ACTION_TYPE` label the shot-type breakdown is bucketed from. See the note
  below: this one is fetched **per team**, not league-wide.
- `leaguedashptdefend` (six categories) - closest-defender matchups: the FG%
  shooters managed against each defender, and what those same shooters normally
  shoot from there.
- `gamerotation` - **one request per game**: every substitution's in/out clock
  times, which the rotation grid is built from. See "Rotations" below.

The standings and the league leaderboard are **not** separate requests — both
are rolled up from the team and player game logs already in memory, so the home
page costs nothing extra to fetch.

**Why the shot chart is per team.** `shotchartdetail` caps its response at
**102,400 rows**, and an NBA season is around 218,000 attempts. Asking for the
whole league at once (`TeamID=0`, which is what the WNBA fork does — its seasons
are ~35,000 shots) returns a truncated season and no error saying so. Thirty
per-team requests take about 25 seconds in total and return the lot.

**Rotations.** `gamerotation` is per game, so a full season is 1,230 requests
against an endpoint that answers in one of two regimes: ~150ms for a game its
backend has warm, or almost exactly 30 seconds for one it doesn't (both return
correct data). So every game is cached to its own file and never refetched, one
retry rather than an escalating chain, and **a cap of 8 games per run** — which
keeps the nightly job to a few minutes and goes easy on the endpoint.

That cap is worth understanding before you rely on it. Eight a night is fine for
**keeping up** with a season in progress, which only produces ~10 games a night
once the backfill has caught up. It is not a way to **backfill** one: 1,230
games at 8 a night is about five months, and the rotation chart stays thin until
then. Burst it by hand instead:

```bash
npm run fetch -- --season 2025-26 --rotation-limit 0    # no cap: fetch every missing game
npm run fetch -- --season 2025-26 --rotation-limit 200  # or a specific number
```

The step reports itself game by game — which matchup is on the wire, how long it
took and which regime it landed in, a running tally every five games, and a
closing line saying how many games are still missing and how many more runs that
is at the current cap.

The cache lives in **`data-cache/rotations/<season>/`**, outside `public/` on
purpose: the browser only reads the season aggregate that gets folded into each
team's file, and a season of per-game files is ~5MB that would otherwise be
deployed for nothing. It is committed, so the nightly job accumulates games
instead of starting cold. `--no-rotations` skips the step entirely;
`--rotation-limit N` raises or removes the per-run cap for a manual backfill.

Both of the team dashboards are taken as published rather than derived here — see "Nothing is
estimated" below.

The `leaguedash*` endpoints are sent the full NBA filter set, including the
NBA-only `TwoWay` and `ISTRound` parameters (both empty: no two-way filter, all
tournament rounds), which is what nba.com's own pages send. The WNBA fork has to
omit those two — sending them makes that backend error — which is the sort of
difference `src/league.js` exists to hold.

## Checking the numbers against nba.com

Every section on the site carries a **source footnote** linking to the
nba.com/stats page it was built from, with the season and filters already
applied, so any number can be opened and checked by hand. The mapping lives in
`src/sources.js` — one entry per dataset, with query strings that mirror the
parameter sets in `scripts/fetch-data.mjs`. **If you change a `PerMode` or a
`MeasureType` in the fetch script, change it in `sources.js` too**, or the
footnote will point at a view that doesn't reconcile.

### Nothing is estimated

Every team-level rate is taken from stats.nba.com already computed, so the
linked page reconciles cell-for-cell. Nothing here re-derives a team number from
box scores, and that is a deliberate rule rather than a convenience — the WNBA
fork learned it the hard way, and its README records the three places where
home-made arithmetic diverged from the published figure. In short:

- **Possessions are theirs, not estimated.** nba.com counts possessions from
  play-by-play; the classic box-score estimate
  (`FGA + 0.44×FTA − OREB + TOV`) does not reproduce that count. Asking for
  `PerMode=Per100Possessions` hands us their division instead of approximating
  it.
- **Team totals are never summed from player rows.** A player row can't carry a
  shot-clock violation or a 5-second inbounds, so a roster's turnovers sum
  short of the team's.
- **Pace is read from the column that matches the clock.** Here that's plain
  `PACE`, which is already on the NBA's 48-minute basis (`LEAGUE.paceField` in
  `src/league.js`; the WNBA fork points it at `PACE_PER40`).

The four factors are nba.com's definitions, which are **not** the
Basketball-Reference ones. Turnover % is `TOV ÷ possessions` rather than Dean
Oliver's `TOV ÷ (FGA + 0.44×FTA + TOV)`, and the rebound percentages sit on a
different base than `OREB ÷ (OREB + opponent DREB)`. Both read higher here than
on Basketball-Reference — same factor, different convention, not a discrepancy.
*2024-25 Thunder: nba.com's TOV% is 11.6 (turnovers per 100 possessions);
the Basketball-Reference formula on the same season gives 10.3. eFG% and FT rate
are identical either way.*

One estimate is left, and it is not a team stat: **true shooting %** on the
Team-tab shooting panel and the Players tab still uses `PTS ÷ (2 × (FGA +
0.44×FTA))`, computed from game logs, because the per-game TS% trend needs a
per-game number. The exact season TS% is available in `leaguedashplayerstats`
(Advanced) if that ever matters more than the trend line does.

## Project map

```
index.html              app entry
vite.config.js          dev server + build config (no proxy needed anymore)
scripts/
  fetch-data.mjs        downloads a season from stats.nba.com -> public/data/<season>/
                        (anything that fails is carried over from what's on disk;
                         the league constants it reads live in src/league.js)
  prerender.mjs         after `vite build`: one HTML page per team/player, every season, + sitemap.xml
  indexnow.mjs          after prerender: pings IndexNow with the URLs this deploy changed (production only)
  build-og.mjs          renders og-template.html -> public/og.png (run by hand: `npm run og`)
  build-icons.mjs       renders the brand mark -> the raster favicons Safari needs
                        (run by hand: `npm run icons`; only after mark.svg changes)
  og-template.html      the artwork for the social share card
public/
  data/index.json       which seasons exist, when each was fetched, what's missing
  data/<season>/league.json      that season's team list + league-wide charts
  data/<season>/teams/<id>.json  one file per team (its games, roster, on/off, lineups)
data-cache/
  rotations/<season>/<gameId>.json  per-game substitution logs (committed, never deployed)
src/
  main.jsx              boots React
  league.js             EVERY difference from the WNBA fork: host, LeagueID, season
                        spelling, pace column, team emoji + name splitting
  App.jsx               season + team dropdowns, tabs, routing, loading / error states
  api.js                loads the data files on demand and caches them (no network calls to stats.nba.com)
  palette.js            brand colors + type stack (edit colors here)
  config.js             site name, canonical URL, links back to highlightfactory.app
  routes.js             the URL scheme (slugs, buildPath, parsePath) - shared with the build + fetch
  pageMeta.js           per-route title / description / canonical - shared with the build
  sources.js            each dataset -> the nba.com page it came from (+ the formulas we apply)
  SourceNote.jsx        the "Source · nba.com > ..." footnote under every section
  BrandMark.jsx         the Highlight Factory app mark (copied from the main site)
  useLeagueData.js      React hooks for the three loads: season index, season, team
  qualify.js            the minimum-playing-time rules the player charts apply
  Dashboard.jsx         per-player view (Players tab)
  TeamView.jsx          team view (Team tab): ranking, four factors, lineups, ...
  LeagueView.jsx        the home page: slate, conference standings, leaders, all teams
  OnOffChart.jsx        on/off impact scatter (shown on the Team tab)
  RotationChart.jsx     the minute-by-minute rotation grid (Team tab)
  PlayTypes.jsx         shot-type diet + defensive matchup tables (both tabs)
  ShootingWinChart.jsx  shooting profile vs winning (shared by the team + league pages)
  StaleNote.jsx         the "showing the numbers from ..." note on carried-over sections
  index.css             brand tokens, typography, shared .hf-* classes
```
