// ---------------------------------------------------------------------------
// Theme palette + type stack — mirrors the Highlight Factory site
// (highlight-factory-promo-site/src/palette.js and index.css), which in turn
// mirrors the iOS app's semantic surfaces. This site is a subdomain of that
// brand, so the tokens are copied one-for-one rather than reinterpreted.
//
// Like the marketing site, this is LIGHT-ONLY: white page, white cards
// separated by a hairline rather than a shadow, black type, brand plum as the
// accent. There is no night mode and no toggle.
//
// Colors live in JS (not only CSS variables) because Recharts passes them into
// SVG presentation attributes (stroke="...", fill="..."), where CSS var() does
// NOT resolve. Page chrome that isn't drawn by Recharts is themed in index.css
// from the same values.
// ---------------------------------------------------------------------------

export const C = {
  INK: "#FFFFFF", // pageBackground
  BRAND: "#3A1136", // highlightPurple — nav fill + the primary accent
  BRAND_HI: "#B0507E", // the lighter plum the app's intro card gradients into
  ACCENT: "#6155F5", // chartBlue — the secondary chart series
  MUTE: "#737373", // secondaryText
  PANEL: "#FFFFFF", // cardBackground
  PANEL_2: "#F5F5F5", // subtleFill — zebra rows, inset wells, tooltips
  LINE: "#E2E2E2", // cardBorder — the hairline that outlines every card
  SEPARATOR: "#BFBFBF", // heavier rules inside tables
  TXT: "#000000", // primaryText
  GOOD: "#34C759", // ratingGood
  WARN: "#FFCC00", // ratingFair
  BAD: "#FF383C", // ratingPoor
  ON_BRAND: "#FFFFFF", // white type on a plum fill

  // Rest of the app's categorical chart palette, for series beyond the first two.
  CHART_MAGENTA: "#CB30E0",
  CHART_TEAL: "#00C3D0",
  CHART_BASELINE: "#C7C7CC",

  // --- Tokens this site needs that the marketing pages never do -------------
  // ratingPoor is tuned for fills; as small text on white it vibrates, so loss
  // numbers and error copy use a darkened cousin of it.
  LOSS_FG: "#C7262A",
  // Result badges: the lightest readable tint of GOOD / BAD.
  WIN_BG: "#E4F7E9",
  LOSS_BG: "#FDE8E8",
  // Recharts hover overlay, on a white page.
  HOVER_FILL: "rgba(0,0,0,.05)",
  // The app's page is plain white; so is this one.
  BG_IMAGE: "none",
};

// Type stack, matched to the marketing site: JetBrains Mono carries titles,
// scores and labels; supporting copy is set in the system UI face. Exported as
// strings because SVG <text fontFamily="..."> is an attribute, not a style, and
// can't resolve the var(--font-display) that CSS uses for the same thing.
export const FONT_DISPLAY = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const FONT_BODY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
