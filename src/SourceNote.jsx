// ---------------------------------------------------------------------------
// The footnote under a section: which nba.com page the numbers came from, and
// what (if anything) happened to them on the way here. Most sections are a
// straight copy, so `formula` usually just says so — where it doesn't, it names
// the convention or the arithmetic, so a number that looks off can be traced.
//
// Deliberately quiet. It sits below the explanatory copy in a section, at the
// smallest readable size, and only the source link carries any emphasis.
// ---------------------------------------------------------------------------

import { C } from "./palette.js";

export default function SourceNote({ source }) {
  if (!source) return null;
  const { label, url, formula } = source;
  return (
    <p
      style={{
        fontSize: 11,
        color: C.MUTE,
        margin: "10px 2px 0",
        paddingTop: 8,
        borderTop: `1px solid ${C.LINE}`,
        lineHeight: 1.55,
      }}
    >
      <span style={{ letterSpacing: 0.4, textTransform: "uppercase" }}>Source</span>{" · "}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: C.BRAND, borderBottom: `1px solid ${C.LINE}`, textDecoration: "none" }}
      >
        nba.com › {label}
      </a>
      {formula && <> — {formula}</>}
    </p>
  );
}
