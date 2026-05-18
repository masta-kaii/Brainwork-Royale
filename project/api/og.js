/* ============================================================
   BRAINWORK ROYALE — OG IMAGE GENERATION
   Vercel serverless function using @vercel/og.
   Route: /api/og?matchId=xxx&placement=N&name=Berok&class=engineer
   Returns a 1200×630 PNG share card.
   ============================================================ */

// @vercel/og is auto-installed by Vercel at deploy time
// when it detects this file in the api/ directory.

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("matchId") || "????";
  const name = searchParams.get("name") || "Warden";
  const cls = searchParams.get("class") || "engineer";
  const placement = parseInt(searchParams.get("placement") || "?");
  const mazeName = searchParams.get("mazeName") || "Neon Lab";

  const placementLabel = placement === 1 ? "WINNER"
    : placement <= 3 ? `#${placement}`
    : !isNaN(placement) ? `#${placement}` : "—";

  const placementColor = placement === 1 ? "#5df2d6"
    : placement <= 3 ? "#ffb84d"
    : "#8b91b8";

  try {
    const { ImageResponse } = await import("@vercel/og");

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #07080d, #0b0d16 50%, #131626)",
            fontFamily: "'JetBrains Mono', monospace",
            color: "#f3f5ff",
            padding: 60,
          }}
        >
          {/* Grid background */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.08,
              backgroundImage: `
                linear-gradient(90deg, #5df2d6 1px, transparent 1px),
                linear-gradient(180deg, #5df2d6 1px, transparent 1px)
              `,
              backgroundSize: "40px 40px",
            }}
          />

          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "linear-gradient(135deg, #5df2d6, #2fa893)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 800,
                color: "#07080d",
                boxShadow: "0 0 30px rgba(93,242,214,0.4)",
              }}
            >
              B
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.2em", color: "#5df2d6" }}>
                BRAINWORK
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.3em", color: "#8b91b8" }}>
                ROYALE
              </div>
            </div>
          </div>

          {/* Main info */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              marginBottom: 40,
            }}
          >
            <div style={{ fontSize: 14, letterSpacing: "0.15em", color: "#5a608a", textTransform: "uppercase" }}>
              MATCH {matchId} · {mazeName}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.02em" }}>
                {name}
              </div>
              <div
                style={{
                  fontSize: 40,
                  fontWeight: 800,
                  color: placementColor,
                  textShadow: placement === 1 ? "0 0 40px rgba(93,242,214,0.6)" : "none",
                }}
              >
                {placementLabel}
              </div>
            </div>
            <div style={{ fontSize: 16, letterSpacing: "0.15em", color: "#8b91b8", textTransform: "uppercase" }}>
              {cls.toUpperCase()} CLASS
            </div>
          </div>

          {/* Footer */}
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#383d63" }}>
            brainwork-royale.vercel.app · S03 Beta
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e) {
    // Fallback: return a simple SVG if @vercel/og isn't available
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#07080d"/>
          <stop offset="50%" stop-color="#0b0d16"/>
          <stop offset="100%" stop-color="#131626"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <rect x="60" y="60" width="56" height="56" rx="14" fill="#5df2d6"/>
      <text x="88" y="95" text-anchor="middle" font-family="monospace" font-size="30" font-weight="bold" fill="#07080d">B</text>
      <text x="140" y="88" font-family="monospace" font-size="18" font-weight="bold" fill="#5df2d6" letter-spacing="4">BRAINWORK</text>
      <text x="140" y="108" font-family="monospace" font-size="12" font-weight="bold" fill="#8b91b8" letter-spacing="6">ROYALE</text>
      <text x="600" y="300" text-anchor="middle" font-family="monospace" font-size="14" fill="#5a608a" letter-spacing="3">MATCH ${matchId} · ${mazeName}</text>
      <text x="600" y="380" text-anchor="middle" font-family="monospace" font-size="56" font-weight="bold" fill="#f3f5ff">${name}</text>
      <text x="600" y="450" text-anchor="middle" font-family="monospace" font-size="40" font-weight="bold" fill="${placementColor}">${placementLabel}</text>
      <text x="600" y="500" text-anchor="middle" font-family="monospace" font-size="16" fill="#8b91b8" letter-spacing="3">${cls.toUpperCase()} CLASS</text>
      <text x="600" y="570" text-anchor="middle" font-family="monospace" font-size="11" fill="#383d63">brainwork-royale.vercel.app · S03 Beta</text>
    </svg>`;
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
    });
  }
}

export const config = {
  runtime: "nodejs20.x",
};
