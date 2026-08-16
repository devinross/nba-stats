import React, { useState, useMemo, useEffect, useRef } from "react";
import { C, FONT_DISPLAY } from "./palette";
import { SITE, NAV_LINKS } from "./config.js";
import { parsePath, resolveInSeason, buildPath, teamSlug } from "./routes.js";
import { LEAGUE, seasonLabel } from "./league.js";
import { pageMeta, applyHead } from "./pageMeta.js";
import BrandMark from "./BrandMark.jsx";
import TeamBadge from "./TeamBadge.jsx";
import { useSeasonIndex, useSeason, useTeam } from "./useLeagueData";
import Dashboard from "./Dashboard.jsx";
import TeamView from "./TeamView.jsx";
import LeagueView, { todayET } from "./LeagueView.jsx";
import StaleNote from "./StaleNote.jsx";

function Center({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.INK, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center", color: C.TXT }}>{children}</div>
    </div>
  );
}

// Tab pills, built like the marketing site's buttons: capsules, mono type, a
// flat plum fill when active and a hairline outline when not.
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`hf-btn ${active ? "hf-btn--primary" : "hf-btn--ghost"}`}
      style={{ padding: "9px 20px", fontSize: 14 }}
    >
      {children}
    </button>
  );
}

function TeamPicker({ teams, value, onChange, season }) {
  const team = teams.find((t) => t.id === value) || teams[0];
  return (
    // A bare <select> sizes itself to its *longest* option, which strands the
    // chevron far to the right of a short team name. So the label is drawn as
    // text — sized to the current team — with a transparent native select laid
    // over it for the actual interaction and keyboard/screen-reader behavior.
    <div className="team-picker" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      {/* This is the page's <h1>: the selected team is what the page is about,
          and it re-renders as you switch teams. The visible text stays the
          short team name the design calls for; the rest of the sentence is
          there for screen readers and crawlers. */}
      <h1
        style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em", lineHeight: 1.1, whiteSpace: "nowrap", margin: 0 }}
      >
        <span aria-hidden="true">{team.emoji} </span>
        {team.teamName}
        <span className="sr-only">
          {" — "}
          {team.city}
          {season ? `, ${seasonLabel(season)}` : ""} {LEAGUE.name} team and player stats
        </span>
      </h1>
      <span aria-hidden="true" style={{ color: C.BRAND, fontSize: 13, lineHeight: 1 }}>
        ▾
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || e.target.value)}
        aria-label="Select team"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          appearance: "none",
          WebkitAppearance: "none",
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id} style={{ color: "#111", fontWeight: 600 }}>
            {t.emoji} {t.teamName}
          </option>
        ))}
      </select>
    </div>
  );
}

// Tray-with-arrow glyph for the header download CTA (same as the main site's).
function DownloadIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

const navItemStyle = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: 15,
  color: C.TXT,
};

// The brand lockup: the app mark, this site's name, and the line naming whose
// subdomain this is. The whole thing links back to the main site.
function Logo() {
  return (
    <a
      href={SITE.parentUrl}
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
      aria-label={`${SITE.name}, powered by ${SITE.parentName}`}
    >
      <BrandMark size={30} />
      <span style={{ display: "grid", gap: 1 }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
          {SITE.name}
        </span>
        <span
          className="brand-sub"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: C.MUTE,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          Powered by {SITE.parentName}
        </span>
      </span>
    </a>
  );
}

// Site header, matched to the marketing site's: sticky, hairline bottom rule,
// blurred translucent page color behind it, mono nav, plum download capsule.
function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "saturate(140%) blur(10px)",
        WebkitBackdropFilter: "saturate(140%) blur(10px)",
        background: "color-mix(in srgb, var(--ink) 78%, transparent)",
        borderBottom: `1px solid ${C.LINE}`,
      }}
    >
      <div
        className="hf-container"
        style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
      >
        <Logo />

        <nav style={{ display: "flex", alignItems: "center", gap: 26 }} className="hf-nav-desktop">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} style={navItemStyle}>
              {l.label}
            </a>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a
            href={SITE.appStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="hf-btn hf-btn--primary hf-nav-desktop"
            style={{ padding: "10px 18px", fontSize: 14 }}
          >
            <DownloadIcon />
            Download
          </a>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            className="hf-nav-mobile"
            onClick={() => setOpen((v) => !v)}
            style={{
              display: "none",
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "transparent",
              border: `1px solid ${C.LINE}`,
              color: C.TXT,
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {open && (
        <div className="hf-container" style={{ paddingBottom: 16 }}>
          <nav style={{ display: "grid", gap: 4 }}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} style={{ ...navItemStyle, padding: "12px 4px" }}>
                {l.label}
              </a>
            ))}
            <a
              href={SITE.appStoreUrl}
              target="_blank"
              rel="noreferrer"
              className="hf-btn hf-btn--primary"
              style={{ marginTop: 12 }}
            >
              <DownloadIcon />
              Download
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

// Season switcher. Same trick as TeamPicker — the visible label is text sized
// to the current value, with a transparent native <select> laid over it, so the
// capsule stays narrow instead of sizing to the longest option and the control
// keeps real keyboard and screen-reader behaviour.
function SeasonPicker({ season, seasons, onChange, loading }) {
  if (!seasons || seasons.length < 2) return null;
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        border: `1px solid ${C.LINE}`,
        borderRadius: 999,
        padding: "7px 14px",
        background: C.PANEL,
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.MUTE, fontWeight: 700 }}>
        Season
      </span>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, lineHeight: 1, opacity: loading ? 0.5 : 1 }}>
        {seasonLabel(season)}
      </span>
      <span aria-hidden="true" style={{ color: C.BRAND, fontSize: 12, lineHeight: 1 }}>▾</span>
      <select
        value={season}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Select season"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0,
          appearance: "none", WebkitAppearance: "none", border: "none",
          background: "transparent", cursor: "pointer",
        }}
      >
        {seasons.map((s) => (
          <option key={s.season} value={s.season} style={{ color: "#111", fontWeight: 600 }}>
            {seasonLabel(s.season)}
          </option>
        ))}
      </select>
    </div>
  );
}

// The team context strip under the site header: which team you're looking at,
// which season, and its headline record.
function TeamBar({ team, teams, teamId, onPick, tab, games, updated, season, seasons, currentSeason, onPickSeason, seasonLoading, loading, leagueHref, onLeague }) {
  const teamW = games.filter((g) => g.w).length;
  const teamL = games.length - teamW;
  // Record and games are the selected team's, which arrives after the season
  // does — show a placeholder rather than a confident 0–0.
  const stat = (value) => (loading ? "—" : value);
  return (
    <div
      className="hf-container"
      style={{
        paddingTop: 22,
        paddingBottom: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <TeamBadge team={team} size={50} />
        <div>
          {/* Also the way back to the league page — the site header's logo goes
              to the main site, so without this a team page is a dead end. */}
          <a
            className="hf-eyebrow"
            href={leagueHref}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onLeague();
            }}
            style={{ fontSize: 10, marginBottom: 2, display: "inline-block" }}
          >
            ‹ {season ? `${seasonLabel(season)} ` : ""}{LEAGUE.name} Analytics
            {season && currentSeason && Number(season) !== Number(currentSeason) ? " · final" : ""}
          </a>
          <TeamPicker teams={teams} value={teamId} onChange={onPick} season={season} />
          <div style={{ fontSize: 12, color: C.MUTE, marginTop: 2 }}>
            {team.city}
            {team.city ? " · " : ""}
            {tab === "team" ? "team performance" : "player performance"}
            {updated ? ` · updated ${updated}` : ""}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
        <SeasonPicker season={season} seasons={seasons} onChange={onPickSeason} loading={seasonLoading} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.MUTE, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Record</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22 }}>
            {stat(
              <>
                {teamW}
                <span style={{ color: C.MUTE }}>–</span>
                {teamL}
              </>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.MUTE, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Games</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22 }}>{stat(games.length)}</div>
        </div>
      </div>
    </div>
  );
}

// The league page's counterpart to TeamBar: the season itself is the subject,
// so there's no team to name and no team record to show — what a visitor wants
// at the top is which season this is, how far into it the league is, and how
// many games are on today.
function LeagueBar({ season, seasons, currentSeason, onPickSeason, seasonLoading, updated, teams, standings, scoreboard }) {
  const isCurrent = Number(season) === Number(currentSeason);
  const played = standings.reduce((a, t) => a + t.gp, 0) / 2;
  const today = todayET();
  const todayGames = scoreboard.filter((g) => g.date === today).length;

  return (
    <div
      className="hf-container"
      style={{
        paddingTop: 22,
        paddingBottom: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 14,
      }}
    >
      <div>
        <div className="hf-eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
          {LEAGUE.name} Analytics{isCurrent ? "" : " · final"}
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0 }}>
          {seasonLabel(season)} {LEAGUE.name} Stats
          <span className="sr-only">
            {" — "}standings, {isCurrent ? "today's games" : "results"}, league leaders and every team
          </span>
        </h1>
        <div style={{ fontSize: 12, color: C.MUTE, marginTop: 2 }}>
          Every team, one page{updated ? ` · updated ${updated}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <SeasonPicker season={season} seasons={seasons} onChange={onPickSeason} loading={seasonLoading} />
        {/* The tiles wrap as one group rather than individually, so a phone gets
            a tidy row under the picker instead of two of them and an orphan. */}
        <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
          {isCurrent && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: C.MUTE, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Today</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22 }}>
                {todayGames || <span style={{ color: C.MUTE }}>—</span>}
              </div>
            </div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.MUTE, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Teams</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22 }}>{teams.length}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.MUTE, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Games</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22 }}>{played ? Math.round(played) : "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FooterCol({ title, links }) {
  return (
    <div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: C.MUTE, marginBottom: 12 }}>
        {title}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 9 }}>
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} style={{ color: C.TXT, fontSize: 15 }}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Every team, linked, on every page. The team switcher is a <select>, which a
// crawler can't follow, so without this the team pages would only be reachable
// from the sitemap — and nothing would pass authority between them.
function TeamIndex({ teams, onPick, season, currentSeason }) {
  if (!teams || !teams.length) return null;
  return (
    <nav className="hf-container" style={{ padding: "0 24px 40px" }} aria-label="All teams">
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: C.MUTE, marginBottom: 14 }}>
        All teams
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
        {teams.map((t) => (
          <li key={t.id}>
            <a
              href={buildPath({ team: t, tab: "team", season, currentSeason })}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onPick(t.id);
              }}
              style={{ fontSize: 14, color: C.TXT }}
            >
              <span aria-hidden="true">{t.emoji} </span>
              {t.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SiteFooter({ updated }) {
  const year = 2026;
  return (
    <footer style={{ borderTop: `1px solid ${C.LINE}`, marginTop: 40, background: C.PANEL }}>
      <div
        className="hf-container"
        style={{ padding: "44px 24px", display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "space-between" }}
      >
        <div style={{ maxWidth: 340 }}>
          <a href={SITE.parentUrl} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <BrandMark size={30} />
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>
              {SITE.parentName}
            </span>
          </a>
          <p style={{ color: C.MUTE, marginTop: 12, fontSize: 15 }}>{SITE.tagline}</p>
        </div>
        <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
          <FooterCol
            title={SITE.parentName}
            links={[
              ["Home", SITE.parentUrl],
              ["WNBA Stats", SITE.wnbaUrl],
              ["Blog", `${SITE.parentUrl}/blog`],
              ["FAQ", `${SITE.parentUrl}/faq`],
            ]}
          />
          <FooterCol
            title="This site"
            links={[
              ["Get the app", SITE.appStoreUrl],
              ["Contact", `mailto:${SITE.contactEmail}`],
            ]}
          />
        </div>
      </div>
      <div className="hf-container" style={{ padding: "18px 24px", borderTop: `1px solid ${C.LINE}`, color: C.MUTE, fontSize: 13 }}>
        © {year} {SITE.parentName}. Stats from {LEAGUE.statsHost.replace("https://", "")}
        {updated ? `, updated ${updated}` : ""}. Not affiliated with the {LEAGUE.name}.
      </div>
    </footer>
  );
}

function Shell({ index, league, route, setRoute, seasonLoading }) {
  const currentSeason = index.currentSeason;

  const { teams, teamRanks, teamProfiles, leagueShotZones, leagueShotTypes, positionShotZones, positionShotTypes, teamZoneWins, meta } = league;
  const {
    standings = [], scoreboard = [], leaders = null,
  } = league;
  const resolved = useMemo(() => resolveInSeason(route, league), [route, league]);
  // No team in the URL means the league page — the season as a whole — rather
  // than some arbitrary first team standing in for it.
  const team = resolved.teamId ? teams.find((t) => t.id === resolved.teamId) || null : null;
  const isLeague = !team;
  const tab = resolved.tab;
  const sel = resolved.sel;

  // The selected team's own file, fetched on demand. Everything below reads
  // through `bundle`, which is empty while that request is in flight.
  // `season` is what's on screen (the loaded file); route.season is what's been
  // asked for. They differ only for the moment between picking a season and its
  // file arriving, which is what `pending` below waits out.
  const season = league.meta.season;
  const isCurrent = Number(season) === Number(currentSeason);
  const pending = Number(route.season) !== Number(season);
  // Null on the league page: everything it draws is in league.json, so it never
  // downloads a team file.
  const teamState = useTeam(season, team ? team.id : null, { current: isCurrent });
  const bundle = teamState.data || {};
  const {
    games = [], roster = [], onOff = [], fourFactors = null, playerAdv = [],
    lineups = [], upcoming = [], shotZones = null, shotTypes = null, rotation = null, errors = {},
  } = bundle;
  const teamLoading = teamState.loading || seasonLoading;
  const player = roster[sel] || null;

  // Datasets stats.nba.com didn't return on the last refresh, which the fetch
  // script back-filled from the previous snapshot. League-wide and per-team
  // keys never collide, so one merged map covers every section. Completed
  // seasons never carry these — their numbers are final, not stale.
  const stale = { ...(league.stale || {}), ...(bundle.stale || {}) };
  // The game log underpins both tabs, so that one gets a page-level banner
  // rather than a note inside a single section.
  const staleGames = stale.games || stale.roster;

  const updated = meta && meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  // --- navigation ---------------------------------------------------------
  // Player slugs come from league.json (team.players), so a player URL can be
  // built or read without that team's roster having arrived yet.
  const playerSlugs = (team && team.players) || [];
  const go = (next) => setRoute((r) => ({ ...r, ...next }));

  const pickTeam = (id) => {
    const t = teams.find((x) => x.id === id);
    if (t) go({ teamSlug: teamSlug(t), playerSlug: null });
  };
  const pickSeason = (nextSeason) => {
    // Stay on the same team when it existed that year; otherwise that season's
    // league page.
    setRoute({ season: Number(nextSeason), teamSlug: route.teamSlug, playerSlug: null });
  };
  const setTab = (nextTab) => {
    if (nextTab === "team") return go({ playerSlug: null });
    go({ playerSlug: (playerSlugs[0] || {}).slug || null });
  };
  const setSel = (i) => {
    const p = playerSlugs[i];
    if (p) go({ playerSlug: p.slug });
  };

  const pathFor = (over) =>
    buildPath({ team, season, currentSeason, tab: over.tab, player: over.player });
  const path = buildPath({
    team,
    season, currentSeason, tab,
    player: (playerSlugs[sel] || {}).slug,
  });

  // --- links out of the league page ---------------------------------------
  // It links to every team and to the players on its leaderboards, none of
  // which is the team currently in the URL — so these build a path for a team
  // passed in rather than for the selected one.
  const hrefForTeam = (t) => buildPath({ team: t, season, currentSeason, tab: "team" });
  const findPlayer = (teamId, name) => {
    const t = teams.find((x) => x.id === teamId);
    const p = t && (t.players || []).find((pl) => pl.name === name);
    return p ? { team: t, player: p } : null;
  };
  const hrefForPlayer = (teamId, name) => {
    const hit = findPlayer(teamId, name);
    return hit ? buildPath({ team: hit.team, season, currentSeason, tab: "players", player: hit.player.slug }) : null;
  };
  const pickPlayer = (teamId, name) => {
    const hit = findPlayer(teamId, name);
    if (hit) go({ teamSlug: teamSlug(hit.team), playerSlug: hit.player.slug });
  };

  // Real hrefs for the roster, so player pages are reachable by a crawler (and
  // openable in a new tab) rather than only by a click handler. The handlers
  // still take over an ordinary left-click to keep navigation instant.
  const playerHref = (i) => pathFor({ tab: "players", player: (playerSlugs[i] || {}).slug });
  const playerHrefByName = (name) => {
    const i = playerSlugs.findIndex((p) => p.name === name);
    return i >= 0 ? playerHref(i) : null;
  };
  const goToPlayerByName = (name) => {
    const i = playerSlugs.findIndex((p) => p.name === name);
    if (i >= 0) setSel(i);
  };

  // Push the URL after an in-app change, and keep the head in step with it so
  // the rendered page matches the prerendered one Google first indexed.
  const firstRender = useRef(true);
  useEffect(() => {
    // Mid-switch the resolved team still belongs to the old season, so acting
    // now would publish a path we're about to correct. Wait for the file.
    if (pending) return;
    if (firstRender.current) {
      // Don't rewrite the address bar just because the app booted: "/" is its
      // own canonical page, not a redirect to the first team. The head is still
      // applied — routes without a prerendered file of their own (a past
      // season's player pages) are served the generic shell and need it.
      firstRender.current = false;
    } else if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    applyHead(pageMeta({
      team,
      tab, player, season, path,
      archive: !isCurrent,
    }));
    // `player` is in the deps because the roster arrives after the URL does:
    // on a deep link into a player page the first pass has no roster yet and
    // would leave the team's title on a player's page.
  }, [path, pending, player && player.name]);

  return (
    <div style={{ minHeight: "100vh", background: C.INK, color: C.TXT }}>
      <SiteHeader />

      {isLeague ? (
        <LeagueBar
          season={route.season}
          seasons={index.seasons}
          currentSeason={currentSeason}
          onPickSeason={pickSeason}
          seasonLoading={pending || seasonLoading}
          updated={updated}
          teams={teams}
          standings={standings}
          scoreboard={scoreboard}
        />
      ) : (
        <TeamBar
          team={team}
          teams={teams}
          teamId={team.id}
          onPick={pickTeam}
          tab={tab}
          games={games}
          loading={teamLoading}
          updated={updated}
          season={route.season}
          seasons={index.seasons}
          currentSeason={currentSeason}
          onPickSeason={pickSeason}
          seasonLoading={pending || seasonLoading}
          leagueHref={buildPath({ team: null, season, currentSeason })}
          onLeague={() => go({ teamSlug: null, playerSlug: null })}
        />
      )}

      {!isLeague && (
        <nav
          className="hf-container"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingBottom: 18,
            borderBottom: `1px solid ${C.LINE}`,
          }}
        >
          <TabButton active={tab === "team"} onClick={() => setTab("team")}>
            Team
          </TabButton>
          <TabButton active={tab === "players"} onClick={() => setTab("players")}>
            Players
          </TabButton>
        </nav>
      )}

      {!isLeague && staleGames && (
        <div className="hf-container" style={{ paddingTop: 16 }}>
          <div style={{ background: C.PANEL_2, border: `1px solid ${C.LINE}`, borderRadius: 12, padding: "10px 14px" }}>
            <StaleNote stale={staleGames} style={{ margin: 0 }} />
          </div>
        </div>
      )}

      {isLeague ? (
        <LeagueView
          key={`league:${season}`}
          teams={teams}
          standings={standings}
          scoreboard={scoreboard}
          leaders={leaders}
          teamRanks={teamRanks}
          teamZoneWins={teamZoneWins}
          stale={league.stale || {}}
          season={season}
          seasonName={seasonLabel(season)}
          final={!isCurrent}
          teamHref={hrefForTeam}
          playerHref={hrefForPlayer}
          onPickTeam={pickTeam}
          onPickPlayer={pickPlayer}
        />
      ) : teamState.error ? (
        <LoadFailure error={teamState.error} what={`${team.name}'s ${seasonLabel(season)} data`} />
      ) : teamLoading || !roster.length ? (
        <TeamLoading team={team} season={season} done={!teamLoading} />
      ) : tab === "team" ? (
        <TeamView
          key={`${season}:${team.id}`}
          games={games}
          roster={roster}
          onOff={onOff}
          fourFactors={fourFactors}
          teamRanks={teamRanks}
          playerAdv={playerAdv}
          lineups={lineups}
          errors={errors}
          stale={stale}
          season={season}
          teamId={team.id}
          teamName={team.teamName}
          teamProfiles={teamProfiles}
          upcoming={upcoming}
          shotZones={shotZones}
          shotTypes={shotTypes}
          rotation={rotation}
          leagueShotZones={leagueShotZones}
          leagueShotTypes={leagueShotTypes}
          teamZoneWins={teamZoneWins}
          playerHref={playerHrefByName}
          onPlayer={goToPlayerByName}
        />
      ) : (
        <Dashboard
          key={`${season}:${team.id}`}
          games={games}
          roster={roster}
          sel={Math.min(sel, roster.length - 1)}
          setSel={setSel}
          leagueShotZones={leagueShotZones}
          leagueShotTypes={leagueShotTypes}
          positionShotZones={positionShotZones}
          positionShotTypes={positionShotTypes}
          playerHref={playerHref}
          season={season}
          teamId={team.id}
        />
      )}

      {/* The league page already lists every team, as cards. */}
      {!isLeague && <TeamIndex teams={teams} onPick={pickTeam} season={season} currentSeason={currentSeason} />}

      <SiteFooter updated={updated} />
    </div>
  );
}

// Shown in place of the charts while a team's file is on its way. The team is
// already known from league.json, so this can name what it's fetching instead
// of being an anonymous spinner.
function TeamLoading({ team, season, done }) {
  return (
    <div className="hf-container" style={{ padding: "60px 24px", textAlign: "center", color: C.MUTE }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, color: C.BRAND }}>
        {done ? `No ${seasonLabel(season)} data for the ${team.teamName}` : `Loading the ${team.teamName}…`}
      </div>
      <div style={{ marginTop: 8, fontSize: 14 }}>
        {done
          ? `That team has no games recorded for the ${seasonLabel(season)} season.`
          : `${seasonLabel(season)} season`}
      </div>
    </div>
  );
}

function LoadFailure({ error, what }) {
  return (
    <div className="hf-container" style={{ padding: "40px 24px" }}>
      <div className="hf-panel" style={{ padding: "22px 24px" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
          Couldn't load {what}
        </div>
        <code style={{ color: C.LOSS_FG, fontSize: 13 }}>{String(error.message)}</code>
      </div>
    </div>
  );
}

export default function App() {
  // Three stages, each its own request: which seasons exist, then one season's
  // league-wide data, then the team you're looking at (inside Shell). Splitting
  // them is what keeps a cold load to a few tens of KB instead of a megabyte.
  const index = useSeasonIndex();

  const seasons = useMemo(
    () => (index.data ? index.data.seasons.map((s) => Number(s.season)) : []),
    [index.data]
  );
  const currentSeason = index.data ? index.data.currentSeason : null;

  // The URL is the source of truth for season / team / player, and it lives
  // here rather than in Shell because the season half of it decides which file
  // to fetch — Shell can't own a value its own data depends on. Every one of
  // those combinations is a real prerendered page (see scripts/prerender.mjs),
  // so a deep link has to land on the right state and in-app navigation has to
  // write the matching URL back.
  const [route, setRoute] = useState(null);
  useEffect(() => {
    if (!index.data) return;
    const read = () => setRoute(parsePath(window.location.pathname, { seasons, currentSeason }));
    read();
    window.addEventListener("popstate", read); // back/forward re-derives everything
    return () => window.removeEventListener("popstate", read);
  }, [index.data, seasons, currentSeason]);

  // Null until the URL has been read, so a deep link into /2019 fetches 2019 and
  // nothing else — defaulting to the current season here would download it on
  // every archive page load, only to throw it away a render later.
  const season = route ? route.season : null;
  const seasonState = useSeason(season, {
    current: Number(season) === Number(currentSeason),
    // The league page needs no team file, so it doesn't warm one up.
    prefetchTeamId: route && !route.teamSlug ? null : undefined,
  });

  const error = index.error || seasonState.error;
  if (error) {
    return (
      <Center>
        <div className="hf-panel" style={{ padding: "26px 28px", textAlign: "left" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, marginBottom: 10 }}>Couldn't load data</div>
          <div style={{ color: C.MUTE, fontSize: 14, lineHeight: 1.6 }}>
            <code style={{ color: C.LOSS_FG }}>{String(error.message)}</code>
            <p style={{ marginTop: 12 }}>
              The site reads saved data files under <code>data/</code> instead of calling{" "}
              {LEAGUE.statsHost.replace("https://", "")} directly. Generate or refresh them by running{" "}
              <code>npm run fetch</code> from the project, then rebuild and re-upload.
            </p>
          </div>
        </div>
      </Center>
    );
  }

  // useAsync keeps the previous season's data while the next one loads, so
  // switching seasons swaps the page's contents instead of blanking it.
  const league = seasonState.data;
  if (!index.data || !route || !league) {
    return (
      <Center>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 20, color: C.BRAND, letterSpacing: "-0.02em" }}>
          Loading {LEAGUE.name} data…
        </div>
        <div style={{ color: C.MUTE, marginTop: 8, fontSize: 14 }}>
          {season ? `Loading the ${seasonLabel(season)} season.` : "Loading the saved data snapshot."}
        </div>
      </Center>
    );
  }

  if (!league.teams || !league.teams.length) {
    return (
      <Center>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18 }}>No teams found</div>
        <div style={{ color: C.MUTE, marginTop: 8, fontSize: 14 }}>
          The {season} data has no teams. Re-fetch it with{" "}
          <code>npm run fetch -- --season {season}</code>.
        </div>
      </Center>
    );
  }

  // Deliberately not keyed by season: Shell holds no state of its own any more,
  // and remounting it would reset the "have we navigated yet?" guard that keeps
  // the app from rewriting the address bar on boot.
  return (
    <Shell
      index={index.data}
      league={league}
      route={route}
      setRoute={setRoute}
      seasonLoading={seasonState.loading}
    />
  );
}
