// ---------------------------------------------------------------------------
// Site-wide config for the NBA stats subdomain. Mirrors the shape of
// highlight-factory-promo-site/src/config.js so the two stay easy to diff.
//
// This site is a subdomain of the Highlight Factory brand: the header, footer
// and cross-links below are what tie it back to the main site, so keep the URLs
// here in sync with the marketing site's own nav (its Layout links to
// SITE.url below under "More → NBA Stats").
// ---------------------------------------------------------------------------

export const SITE = {
  name: "NBA Stats",
  parentName: "Highlight Factory",
  url: "https://nba.highlightfactory.app",
  parentUrl: "https://highlightfactory.app",
  tagline: "Every NBA team, broken down — shot zones, four factors, lineups and on/off impact.",
  description:
    "NBA team and player analytics from Highlight Factory: shot-zone maps, four factors, lineup net ratings, on/off impact and league-wide rankings, refreshed nightly.",
  appStoreUrl: "https://apps.apple.com/us/app/highlight-factory/id6733216494",
  contactEmail: "hello@highlightfactory.app",
};

// Header nav — everything here points back at the main site, since this
// subdomain is a single app rather than a set of pages.
export const NAV_LINKS = [
  { href: "https://wnba.highlightfactory.app", label: "WNBA Stats" },
  { href: `${SITE.parentUrl}/blog`, label: "Blog" },
  { href: `${SITE.parentUrl}/faq`, label: "FAQ" },
];

// Absolute URL helper for canonical + og:url.
export const abs = (path = "/") =>
  SITE.url.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`);
