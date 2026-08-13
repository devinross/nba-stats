import React from "react";
import { teamGradient } from "./teamColors";

// A team's mark: its colors washed down a disc, with the team emoji centered on
// it. The web counterpart of the iOS app's `TeamBadge`, down to the emoji being
// sized at 0.52 of the diameter — emoji glyphs carry their own padding and read
// as oversized if fitted any closer to the rim.
//
// Everything scales off `size`, so the mark stays composed anywhere it's used.
export default function TeamBadge({ team, size = 50, style }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        background: teamGradient(team),
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.52,
        lineHeight: 1,
        ...style,
      }}
    >
      {team?.emoji}
    </div>
  );
}
