// ---------------------------------------------------------------------------
// IndexNow: tell Bing and the other IndexNow engines (Yandex, Seznam, Naver,
// Yep) which pages this deploy changed, so they recrawl them without waiting
// to re-read the sitemap. Google doesn't take part; it keeps working from the
// sitemap as before.
//
// Runs last in `npm run build`, after prerender has written dist/sitemap.xml.
// It diffs that against the sitemap currently live on the site — the previous
// deploy — and submits only URLs that are new or whose <lastmod> moved. Night
// to night that's the season in progress, whose numbers change on every page;
// archived seasons only when they're re-fetched.
//
// Only production builds on Vercel submit (VERCEL_ENV=production): local
// builds and preview deploys don't change what's live. `--dry-run` prints what
// would be sent, from anywhere, without sending it.
//
// Because it runs during the build, the ping goes out shortly before the
// deploy is promoted. Engines queue a crawl rather than fetching on receipt,
// so that gap doesn't matter in practice.
//
// A network failure never fails the build: a missed ping costs a slower
// recrawl, and must not stand between the nightly refresh and its deploy. A
// missing or mismatched key file does fail it, since that's a config mistake
// every build would repeat.
//
// The key is public by design — engines verify it by fetching
// public/<key>.txt from the site. To rotate it, rename that file, change its
// contents and INDEXNOW_KEY together.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_URL } from "../src/pageMeta.js";

const INDEXNOW_KEY = "dfb914d17581ebb8fc73675b1bcf3ff4";
const ENDPOINT = "https://api.indexnow.org/indexnow";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const dryRun = process.argv.includes("--dry-run");

const log = (msg) => console.log(`indexnow: ${msg}`);

const keyFile = resolve(distDir, `${INDEXNOW_KEY}.txt`);
if (!existsSync(keyFile) || readFileSync(keyFile, "utf8").trim() !== INDEXNOW_KEY) {
  console.error(`indexnow: dist/${INDEXNOW_KEY}.txt is missing or doesn't contain the key — check public/.`);
  process.exit(1);
}

if (process.env.VERCEL_ENV !== "production" && !dryRun) {
  log(`skipped — only Vercel production builds submit (VERCEL_ENV=${process.env.VERCEL_ENV || "unset"}). Use --dry-run to preview.`);
  process.exit(0);
}

// loc -> lastmod. The sitemap's shape is fixed by prerender.mjs, one <url> per line.
function parseSitemap(xml) {
  const entries = new Map();
  for (const [, loc, lastmod] of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    entries.set(loc, lastmod);
  }
  return entries;
}

async function liveSitemap() {
  try {
    const res = await fetch(`${SITE_URL}/sitemap.xml`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseSitemap(await res.text());
  } catch (err) {
    log(`couldn't read the live sitemap (${err.message}) — treating every URL as changed.`);
    return new Map();
  }
}

const next = parseSitemap(readFileSync(resolve(distDir, "sitemap.xml"), "utf8"));
const live = await liveSitemap();
const changed = [...next].filter(([loc, lastmod]) => live.get(loc) !== lastmod).map(([loc]) => loc);

if (!changed.length) {
  log(`nothing to submit — all ${next.size} URLs match the live sitemap.`);
  process.exit(0);
}

if (dryRun) {
  log(`dry run — would submit ${changed.length} of ${next.size} URLs:`);
  for (const url of changed.slice(0, 10)) console.log(`  ${url}`);
  if (changed.length > 10) console.log(`  … and ${changed.length - 10} more`);
  process.exit(0);
}

try {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(SITE_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
      urlList: changed,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  // 200 is accepted; 202 is accepted with the key check still pending, which
  // is normal on the first submission after the key file goes live.
  if (res.ok) log(`submitted ${changed.length} of ${next.size} URLs — HTTP ${res.status}.`);
  else log(`rejected (HTTP ${res.status}) ${(await res.text()).slice(0, 200)} — not failing the build.`);
} catch (err) {
  log(`submission failed (${err.message}) — not failing the build.`);
}
