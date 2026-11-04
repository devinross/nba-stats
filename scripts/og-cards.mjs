// ---------------------------------------------------------------------------
// Per-page social cards: the 1200x630 image Messages, Slack, X and the rest
// unfurl when someone shares a link to a team, a player or a tool page.
//
// Drawn as SVG and rasterised with resvg (a prebuilt native addon — no
// browser), so it runs inside `npm run build` on Vercel and the cards carry the
// same nightly numbers as the pages they describe. scripts/prerender.mjs calls
// renderCard once per page and writes the PNG next to the HTML.
//
// Same template as the Highlight Factory hub's link previews (og/layouts.jsx
// there): white ground, a tile on the left — the team badge, or the brand mark
// for league pages — then a gray eyebrow, the name in JetBrains Mono, and the
// numbers under it. The badge is the site's TeamBadge: the team's wash with
// its emoji in the middle. resvg can't draw a color emoji font, so the emoji
// comes from Twemoji's SVGs (scripts/emoji/, as the hub's previews use), and a
// team whose emoji isn't there falls back to its abbreviation.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { teamWashStops } from "../src/teamColors.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export const CARD_W = 1200;
export const CARD_H = 630;

const GRAY = "#7E7E7E";
const MONO = "JetBrains Mono";
const SANS = "Inter";
// Every JetBrains Mono glyph advances 0.6em. Inter is proportional; 0.56em is
// a little over its average for the digits, capitals and punctuation the
// eyebrow and labels carry, so fitting by it errs on the side of room.
const MONO_ADVANCE = 0.6;
const SANS_ADVANCE = 0.56;

const FONT_FILES = [
  "JetBrainsMono-Regular.ttf",
  "JetBrainsMono-SemiBold.ttf",
  "Inter-Regular.otf",
  "Inter-Medium.otf",
].map((f) => resolve(here, "fonts", f));

// The mark's artwork, lifted from the SVG the favicon is built from so the two
// can't drift.
const markSvg = readFileSync(resolve(root, "public/brand/mark.svg"), "utf8");
const MARK_PATH = /<path[^>]*\sd="([^"]+)"/.exec(markSvg)[1];
const BRAND_CORAL = "#DB6A59";

// Twemoji names its files by codepoint, without the emoji-presentation selector.
const emojiFile = (emoji) =>
  resolve(here, "emoji", `${[...emoji].filter((c) => c !== "\uFE0F").map((c) => c.codePointAt(0).toString(16)).join("-")}.svg`);
const emojiCache = new Map();
function emojiHref(emoji) {
  if (!emoji) return null;
  if (!emojiCache.has(emoji)) {
    let href = null;
    try {
      href = `data:image/svg+xml;base64,${readFileSync(emojiFile(emoji)).toString("base64")}`;
    } catch (_) {
      console.warn(`og-cards: no Twemoji SVG for ${emoji} — drawing the abbreviation instead.`);
    }
    emojiCache.set(emoji, href);
  }
  return emojiCache.get(emoji);
}

// The hub's Row: a 300px tile, 48px gap, 96px side padding.
const PAD = 96;
const TILE = 300;
const TEXT_X = PAD + TILE + 48;
const TEXT_W = CARD_W - PAD - TEXT_X;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The largest size, up to `max`, at which `text` fits in `width`. */
function fitSize(text, width, max, advance = MONO_ADVANCE) {
  return Math.floor(Math.min(max, width / Math.max([...String(text)].length * advance, 1)));
}

/** Greedy word wrap for the mono face; null if a single word can't fit. */
function wrap(text, maxChars) {
  const lines = [];
  for (const word of String(text).split(/\s+/)) {
    if (word.length > maxChars) return null;
    const last = lines.at(-1);
    if (last && last.length + 1 + word.length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** The title at the hub's 70px, stepping down until it wraps into two lines. */
function titleLines(title) {
  for (const size of [70, 62, 54, 48, 42]) {
    const lines = wrap(title, Math.floor(TEXT_W / (size * MONO_ADVANCE)));
    if (lines && lines.length <= 2) return { size, lines };
  }
  return { size: 42, lines: [title] };
}

// ---- tiles -----------------------------------------------------------------

/**
 * TeamBadge: the team's wash down a disc, the emoji centered at 0.52 of the
 * diameter (src/TeamBadge.jsx's proportion).
 */
function badge(team, x, y, size) {
  const [top, bottom] = teamWashStops(team);
  const cx = x + size / 2;
  const cy = y + size / 2;
  const href = emojiHref(team.emoji);
  const glyph = size * 0.52;
  const center = href
    ? `<image x="${cx - glyph / 2}" y="${cy - glyph / 2}" width="${glyph}" height="${glyph}" href="${href}"/>`
    : `<text x="${cx}" y="${cy + size * 0.1}" text-anchor="middle" font-family="${SANS}" font-weight="500" font-size="${size * 0.28}">${esc(team.abbr || "")}</text>`;
  return `
  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="#FFFFFF"/>
  <circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="url(#badge)"/>
  ${center}`;
}

/** The brand mark, filling the tile the way the badge does. */
function mark(x, y, size) {
  const scale = (size * 0.8) / 28;
  const w = 27 * scale;
  const h = 28 * scale;
  return `
  <g transform="translate(${(x + (size - w) / 2).toFixed(1)}, ${(y + (size - h) / 2).toFixed(1)}) scale(${scale.toFixed(3)})">
    <path d="${MARK_PATH}" fill="#000000" fill-rule="evenodd" transform="translate(0.4, 0.5)"/>
    <circle cx="15.4" cy="12.5" r="5" fill="${BRAND_CORAL}"/>
  </g>`;
}

// ---- card ------------------------------------------------------------------

/**
 * The card's SVG.
 *   eyebrow   small gray line above the title ("#2 · Guard · Thunder")
 *   title     the name, in mono; wraps to two lines
 *   detail    one gray line under the title, or
 *   stats     up to four {value, label} pairs under the title
 *   team      draws its badge as the tile; without it, the brand mark
 */
export function cardSvg({ eyebrow, title, detail, stats, team }) {
  const t = titleLines(title);
  const lead = t.size * 1.15;
  const eyebrowSize = eyebrow ? Math.min(30, fitSize(eyebrow, TEXT_W, 30, SANS_ADVANCE)) : 0;
  const detailSize = detail ? Math.min(42, fitSize(detail, TEXT_W, 42, SANS_ADVANCE)) : 0;
  const statsH = stats?.length ? 24 + 52 + 34 : 0;

  // Stack the block and center it on the tile, as the hub's flex row does.
  const blockH =
    (eyebrow ? eyebrowSize * 1.2 + 12 : 0) + lead * t.lines.length + (detail ? 12 + detailSize * 1.2 : 0) + statsH;
  let y = (CARD_H - blockH) / 2;
  const parts = [];

  if (eyebrow) {
    parts.push(
      `<text x="${TEXT_X}" y="${(y + eyebrowSize * 0.95).toFixed(1)}" font-family="${SANS}" font-size="${eyebrowSize}" fill="${GRAY}">${esc(eyebrow)}</text>`
    );
    y += eyebrowSize * 1.2 + 12;
  }
  t.lines.forEach((line, i) => {
    parts.push(
      `<text x="${TEXT_X}" y="${(y + lead * i + t.size * 0.88).toFixed(1)}" font-family="${MONO}" font-size="${t.size}">${esc(line)}</text>`
    );
  });
  y += lead * t.lines.length;

  if (detail) {
    y += 12;
    parts.push(
      `<text x="${TEXT_X}" y="${(y + detailSize * 0.95).toFixed(1)}" font-family="${SANS}" font-size="${detailSize}" fill="${GRAY}">${esc(detail)}</text>`
    );
  }

  if (stats?.length) {
    y += 24;
    const w = TEXT_W / stats.length;
    // One size for the row, set by the longest value, so the numbers line up.
    const valueSize = Math.min(...stats.map((s) => fitSize(s.value, w - 32, 48)));
    stats.forEach((s, i) => {
      const x = TEXT_X + w * i;
      const labelSize = Math.min(22, fitSize(s.label, w - 12, 22, SANS_ADVANCE));
      parts.push(
        `<text x="${x}" y="${(y + 44).toFixed(1)}" font-family="${MONO}" font-size="${valueSize}" font-weight="600">${esc(s.value)}</text>`,
        `<text x="${x}" y="${(y + 52 + 28).toFixed(1)}" font-family="${SANS}" font-size="${labelSize}" font-weight="500" fill="${GRAY}">${esc(s.label)}</text>`
      );
    });
  }

  const tileY = (CARD_H - TILE) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" fill="#000000">
  <rect width="100%" height="100%" fill="#FFFFFF"/>
  ${team ? badge(team, PAD, tileY, TILE) : mark(PAD, tileY, TILE)}
  ${parts.join("\n  ")}
</svg>`;
}

/** The card as a PNG buffer. */
export function renderCard(spec) {
  const resvg = new Resvg(cardSvg(spec), {
    fitTo: { mode: "original" },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: MONO },
  });
  return resvg.render().asPng();
}
