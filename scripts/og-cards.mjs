// ---------------------------------------------------------------------------
// Per-page social cards: the 1200x630 image Messages, Slack, X and the rest
// unfurl when someone shares a link to a team, a player or a tool page.
//
// Drawn as SVG and rasterised with resvg (a prebuilt native addon — no
// browser), so it runs inside `npm run build` on Vercel and the cards carry the
// same nightly numbers as the pages they describe. scripts/prerender.mjs calls
// renderCard once per page and writes the PNG next to the HTML.
//
// Same visual language as scripts/og-template.html (the site-wide og.png):
// white ground, JetBrains Mono, the brand mark top-left and a slab of color
// bleeding off the right edge — plum for league pages, the team's own colors
// for team and player pages.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { C } from "../src/palette.js";
import { teamColors, teamWashStops } from "../src/teamColors.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export const CARD_W = 1200;
export const CARD_H = 630;
const PAD_X = 80;
const FONT = "JetBrains Mono";
// Every JetBrains Mono glyph advances 0.6em; titles are set at -0.04em.
const ADVANCE = 0.6;
const TITLE_TRACK = -0.04;

const FONT_FILES = ["Regular", "SemiBold", "Bold"].map((w) =>
  resolve(here, "fonts", `JetBrainsMono-${w}.ttf`)
);

// The mark's artwork, lifted from the SVG the favicon is built from so the two
// can't drift.
const markSvg = readFileSync(resolve(root, "public/brand/mark.svg"), "utf8");
const MARK_PATH = /<path[^>]*\sd="([^"]+)"/.exec(markSvg)[1];

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The largest size, up to `max`, at which `text` fits in `width`. */
function fitSize(text, width, max, track = TITLE_TRACK) {
  const em = [...String(text)].length * (ADVANCE + track);
  return Math.floor(Math.min(max, width / Math.max(em, 1)));
}

function luminance(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * The team color that can carry text on white: the primary unless it's too
 * pale (the Spurs' silver), then the secondary, then plain black.
 */
function inkFor(team) {
  if (!team) return C.BRAND;
  const readable = teamColors(team).find((hex) => luminance(hex) < 0.3);
  return readable || C.TXT;
}

function brandRow(eyebrow) {
  return `
  <g transform="translate(${PAD_X}, 66) scale(1.56)">
    <path d="${MARK_PATH}" fill="${C.TXT}" fill-rule="evenodd" transform="translate(0.4, 0.5)"/>
    <circle cx="15.4" cy="12.5" r="5" fill="#DB6A59"/>
  </g>
  <text x="${PAD_X + 58}" y="100" font-size="30" font-weight="600" letter-spacing="-0.3">Highlight Factory</text>
  ${eyebrow ? `<text x="${CARD_W - PAD_X}" y="98" text-anchor="end" font-size="22" font-weight="600" fill="${C.MUTE}" letter-spacing="1.5">${esc(eyebrow.toUpperCase())}</text>` : ""}`;
}

function wash(team) {
  const [top, bottom] = team ? teamWashStops(team) : [C.BRAND, C.BRAND_HI];
  const opacity = team ? 0.22 : 0.1;
  return `
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect x="${CARD_W - 540}" y="-180" width="720" height="990" fill="url(#wash)" opacity="${opacity}"
        transform="rotate(-12 ${CARD_W - 180} 315)"/>`;
}

/** The team disc, abbreviation in place of the app's emoji (no emoji font here). */
function badge(team, cx, cy, r) {
  const [top, bottom] = teamWashStops(team);
  // White reads on the deep washes; a pale primary (the Spurs' silver) needs black.
  const label = luminance(teamColors(team)[0]) < 0.3 ? "#FFFFFF" : C.TXT;
  return `
  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#badge)"/>
  <text x="${cx}" y="${cy + r * 0.2}" text-anchor="middle" font-size="${Math.round(r * 0.58)}" font-weight="700"
        fill="${label}" letter-spacing="-1">${esc(team.abbr || "")}</text>`;
}

/** Two big title lines, the second in the accent color — "NBA / Stats." */
function titleBlock({ lines, accent, x, top, width, max }) {
  const size = Math.min(...lines.map((l) => fitSize(l, width, max)));
  const lead = size * 1.0;
  return {
    height: lead * lines.length,
    svg: lines
      .map(
        (line, i) =>
          `<text x="${x}" y="${top + size * 0.82 + lead * i}" font-size="${size}" font-weight="700" ` +
          `letter-spacing="${(size * TITLE_TRACK).toFixed(1)}"${i === lines.length - 1 ? ` fill="${accent}"` : ""}>${esc(line)}</text>`
      )
      .join("\n  "),
  };
}

function statRow(stats, y) {
  const w = (CARD_W - PAD_X * 2) / stats.length;
  return stats
    .map((s, i) => {
      const x = PAD_X + w * i;
      const valueSize = fitSize(s.value, w - 32, 56, -0.02);
      return `
  ${i ? `<line x1="${x - 1}" y1="${y - 4}" x2="${x - 1}" y2="${y + 92}" stroke="${C.LINE}" stroke-width="2"/>` : ""}
  <text x="${x + (i ? 28 : 0)}" y="${y + 52}" font-size="${valueSize}" font-weight="700" letter-spacing="${(valueSize * -0.02).toFixed(1)}">${esc(s.value)}</text>
  <text x="${x + (i ? 28 : 0)}" y="${y + 88}" font-size="20" font-weight="600" fill="${C.MUTE}" letter-spacing="1.2">${esc(s.label.toUpperCase())}</text>`;
    })
    .join("");
}

function chipRow(chips, y) {
  let x = PAD_X;
  return chips
    .map((c) => {
      const w = Math.round([...c].length * 21 * ADVANCE + 46);
      const svg = `
  <rect x="${x}" y="${y}" width="${w}" height="54" rx="27" fill="none" stroke="${C.LINE}" stroke-width="1.5"/>
  <text x="${x + w / 2}" y="${y + 35}" text-anchor="middle" font-size="21" font-weight="600" fill="${C.BRAND}">${esc(c)}</text>`;
      x += w + 12;
      return x - 12 > CARD_W - PAD_X ? "" : svg;
    })
    .join("");
}

/**
 * The card's SVG.
 *   eyebrow   small caps, top right ("2026-27 season")
 *   lines     the title, one or two lines; the last is set in the accent
 *   subtitle  one muted line under the title
 *   stats     up to four {value, label} tiles along the bottom, or
 *   chips     pill labels along the bottom
 *   team      tints the wash and accent and adds the badge
 */
export function cardSvg({ eyebrow, lines, subtitle, stats, chips, team }) {
  const accent = inkFor(team);
  const badgeR = team ? 92 : 0;
  const textX = team ? PAD_X + badgeR * 2 + 40 : PAD_X;
  const textW = CARD_W - PAD_X - textX;

  const title = titleBlock({ lines, accent, x: textX, top: 176, width: textW, max: team ? 96 : 104 });
  const subY = 176 + title.height + 44;
  const fitSub = subtitle ? Math.min(27, fitSize(subtitle, textW, 27, 0)) : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}"
     font-family="${FONT}" fill="${C.TXT}">
  <rect width="100%" height="100%" fill="#FFFFFF"/>
  ${wash(team)}
  ${brandRow(eyebrow)}
  ${team ? badge(team, PAD_X + badgeR, 176 + title.height / 2, badgeR) : ""}
  ${title.svg}
  ${subtitle ? `<text x="${textX}" y="${subY}" font-size="${fitSub}" fill="${C.MUTE}">${esc(subtitle)}</text>` : ""}
  ${stats?.length ? statRow(stats, 474) : chips?.length ? chipRow(chips, 500) : ""}
</svg>`;
}

/** The card as a PNG buffer. */
export function renderCard(spec) {
  const resvg = new Resvg(cardSvg(spec), {
    fitTo: { mode: "original" },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONT },
  });
  return resvg.render().asPng();
}
