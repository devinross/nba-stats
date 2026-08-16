// ---------------------------------------------------------------------------
// Renders the Highlight Factory mark to the raster icons Safari actually uses:
//
//   public/apple-touch-icon.png  180x180  Safari bookmarks, Start Page
//                                         favourites, Reading List and iOS
//                                         "Add to Home Screen"
//   public/favicon-32.png         32x32   tab/bookmark-sidebar fallback for
//   public/favicon-16.png         16x16   browsers that skip the SVG favicon
//
// Safari never rasterises favicon.svg for those bookmark surfaces, so the SVG
// alone leaves a blank or letter tile. The artwork is baked onto white here:
// iOS composites transparency against black, and the Start Page tile sits on a
// light card, so a transparent PNG reads as a black square in both places.
//
// Run with `npm run icons`. Like `npm run og` this is NOT part of `npm run
// build` — it shells out to a local Chrome. The PNGs are committed instead and
// only need regenerating when public/brand/mark.svg changes.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const mark = resolve(root, "public/brand/mark.svg");
const tmpDir = resolve(root, ".icon-tmp");

// Master render size. Everything else is downsampled from this so the small
// sizes stay sharp rather than being rasterised at 16px by the browser.
const MASTER = 1024;
// Share of the canvas the mark occupies. iOS rounds the corners off, and the
// Start Page draws the tile inset, so the mark needs air around it.
const INSET = 0.76;

const OUTPUTS = [
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
  ["favicon-16.png", 16],
];

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error(
    "No Chrome/Chromium found. Looked in:\n  " + CHROME_CANDIDATES.join("\n  ")
  );
  process.exit(1);
}

mkdirSync(tmpDir, { recursive: true });

// The mark is inlined rather than <img>-tagged so it rasterises from vectors at
// the master size. `!important` pins the brackets black: favicon.svg flips them
// for dark UI, and a raster icon can only be one of the two.
const page = resolve(tmpDir, "icon.html");
writeFileSync(
  page,
  `<!doctype html>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    width: ${MASTER}px; height: ${MASTER}px;
    display: flex; align-items: center; justify-content: center;
  }
  svg { width: ${Math.round(MASTER * INSET)}px; height: ${Math.round(MASTER * INSET)}px; }
  svg .brackets, svg path { fill: #000000 !important; }
  svg circle { fill: #DB6A59 !important; }
</style>
${readFileSync(mark, "utf8")}
`
);

const shot = resolve(tmpDir, "icon.png");
console.log(`Rendering ${mark}\n     with ${chrome}`);
execFileSync(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${MASTER},${MASTER}`,
    "--screenshot=" + shot,
    "file://" + page,
  ],
  { stdio: "inherit" }
);

// sips ships with macOS, so no image dependency is needed to downsample.
for (const [name, size] of OUTPUTS) {
  const out = resolve(root, "public", name);
  const scaled = resolve(tmpDir, name);
  execFileSync("cp", [shot, scaled]);
  execFileSync("sips", ["-z", String(size), String(size), scaled], { stdio: "ignore" });
  renameSync(scaled, out);
  console.log(`  ${name} (${size}x${size})`);
}

rmSync(tmpDir, { recursive: true, force: true });
console.log("Done.");
