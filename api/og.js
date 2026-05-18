/* ============================================================
   BRAINWORK ROYALE — OG IMAGE GENERATION
   Returns SVG share card (1200×630). No dependencies required.
   Route: /api/og?matchId=xxx&name=Berok&class=engineer&placement=2
   ============================================================ */

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("matchId") || "????";
  const name = searchParams.get("name") || "Warden";
  const cls = searchParams.get("class") || "engineer";
  const placement = parseInt(searchParams.get("placement") || "?");
  const mazeName = searchParams.get("mazeName") || "Neon Lab";

  const placementLabel = placement === 1 ? "WINNER"
    : placement <= 3 ? `#${placement}`
    : !isNaN(placement) ? `#${placement}` : "--";

  const placementColor = placement === 1 ? "#5df2d6"
    : placement <= 3 ? "#ffb84d"
    : "#8b91b8";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#07080d"/>
        <stop offset="50%" stop-color="#0b0d16"/>
        <stop offset="100%" stop-color="#131626"/>
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="40" stroke="#5df2d6" stroke-width="0.5" opacity="0.08"/>
        <line x1="0" y1="0" x2="40" y2="0" stroke="#5df2d6" stroke-width="0.5" opacity="0.08"/>
      </pattern>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect width="1200" height="630" fill="url(#grid)"/>
    <rect x="60" y="60" width="56" height="56" rx="14" fill="#5df2d6"/>
    <text x="88" y="95" text-anchor="middle" font-family="monospace" font-size="30" font-weight="bold" fill="#07080d">B</text>
    <text x="140" y="88" font-family="monospace" font-size="18" font-weight="bold" fill="#5df2d6" letter-spacing="4">BRAINWORK</text>
    <text x="140" y="108" font-family="monospace" font-size="12" font-weight="bold" fill="#8b91b8" letter-spacing="6">ROYALE</text>
    <text x="600" y="300" text-anchor="middle" font-family="monospace" font-size="14" fill="#5a608a" letter-spacing="3">MATCH ${escapeXml(matchId)} · ${escapeXml(mazeName)}</text>
    <text x="600" y="380" text-anchor="middle" font-family="monospace" font-size="56" font-weight="bold" fill="#f3f5ff">${escapeXml(name)}</text>
    <text x="600" y="450" text-anchor="middle" font-family="monospace" font-size="40" font-weight="bold" fill="${placementColor}">${placementLabel}</text>
    <text x="600" y="500" text-anchor="middle" font-family="monospace" font-size="16" fill="#8b91b8" letter-spacing="3">${escapeXml(cls).toUpperCase()} CLASS</text>
    <text x="600" y="570" text-anchor="middle" font-family="monospace" font-size="11" fill="#383d63">brainwork-royale.vercel.app · S03 Beta</text>
  </svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => {
    switch (c) { case "<": return "&lt;"; case ">": return "&gt;"; case "&": return "&amp;"; case "'": return "&apos;"; case "\"": return "&quot;"; }
  });
}
