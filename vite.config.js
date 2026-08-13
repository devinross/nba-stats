import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app reads static data files (public/data/index.json and one folder per
// season) produced by `npm run fetch`, so there is no dev/prod proxy to
// stats.wnba.com.
//
// `base: "/"` (not "./") is required: the site prerenders a page per team and
// player, so HTML is served from nested paths like /2019/team/atlanta-dream/. A
// relative asset URL on that page would resolve to
// /team/atlanta-dream/assets/…, which doesn't exist. Root-absolute URLs resolve
// the same from every depth.
//
// The trade-off is that the build now assumes it is served from a domain root
// (which wnba.highlightfactory.app is). It can no longer be dropped into a
// subfolder like example.com/wnba/.
export default defineConfig({
  plugins: [react()],
  base: "/",
  // Honor PORT when something else already holds 5173 (e.g. the marketing site
  // running alongside this one).
  server: { port: Number(process.env.PORT) || 5173 },
});
