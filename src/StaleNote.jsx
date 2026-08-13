import React from "react";
import { C } from "./palette";

// Shown above a section whose numbers came from an earlier snapshot because
// stats.nba.com didn't return them on the last refresh (the fetch script
// back-fills those from the previous file rather than writing a hole — see the
// "previous-snapshot fallback" section of scripts/fetch-data.mjs). The chart
// still renders; this just says how old it is, with the exact reason on hover.
//
// `stale` is the { at, reason } record the fetch script wrote for that dataset.
export default function StaleNote({ stale, style }) {
  if (!stale || !stale.at) return null;
  const when = new Date(stale.at);
  const date = Number.isNaN(when.getTime())
    ? null
    : when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <p
      title={stale.reason || undefined}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        flexWrap: "wrap",
        fontSize: 11.5,
        color: C.MUTE,
        margin: "0 0 12px",
        lineHeight: 1.5,
        ...style,
      }}
    >
      <span style={{ color: C.BRAND, fontWeight: 700 }} aria-hidden="true">↺</span>
      <span>
        The last refresh didn't return this — showing the numbers from
        {date ? <strong style={{ color: C.TXT, fontWeight: 700 }}> {date}</strong> : " the previous update"}.
      </span>
    </p>
  );
}
