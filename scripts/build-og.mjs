// ---------------------------------------------------------------------------
// Writes public/og.png (1200x630), the site-wide share image. Every
// prerendered page points at its own card instead (drawn by
// scripts/og-cards.mjs during `npm run build`); this one remains the fallback
// in index.html, which is what the dev server and any unprerendered URL serve.
//
// Same renderer as the per-page cards, minus the nightly numbers — so it only
// needs re-running (`npm run og`) when the card design changes. The PNG is
// committed.
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCard } from "./og-cards.mjs";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/og.png");
writeFileSync(
  out,
  renderCard({
    eyebrow: "Updated nightly",
    title: "NBA Stats",
    detail: "Shot charts, four factors & lineups",
  })
);
console.log(`Wrote ${out}`);
