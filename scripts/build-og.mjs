// ---------------------------------------------------------------------------
// Renders scripts/og-template.html to public/og.png (1200x630), the image
// social platforms show when someone links this site.
//
// Run with `npm run og`. This is NOT part of `npm run build`: it shells out to
// a local Chrome and needs the network for the webfont, neither of which is
// guaranteed on a CI runner. The PNG is committed instead, and only needs
// regenerating when the template changes.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const template = resolve(here, "og-template.html");
const out = resolve(root, "public/og.png");
const tmpDir = resolve(root, ".og-tmp");

// Chrome writes the screenshot into a directory it controls, so render to a
// scratch dir and move the result into place.
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
const shot = resolve(tmpDir, "og.png");

console.log(`Rendering ${template}\n     with ${chrome}`);
execFileSync(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    "--screenshot=" + shot,
    // Give the webfont a moment to load, or the card renders in fallback mono.
    "--virtual-time-budget=4000",
    "file://" + template,
  ],
  { stdio: "inherit" }
);

renameSync(shot, out);
rmSync(tmpDir, { recursive: true, force: true });
console.log(`Wrote ${out}`);
