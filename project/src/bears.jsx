/* ============================================================
   BRAINWORK ROYALE — BEAR PORTRAITS
   Original chunky CSS-pixel bears.
   Each is a 16x16 grid; colors define the silhouette.
   ============================================================ */

const BEAR_W = 16;

/** Pattern key for each class. '.' = empty.
 *  Custom letters → color slots provided per class.
 */
const BEAR_PATTERNS = {
  // Engineer: hard hat + goggles
  engineer: [
    "................",
    "................",
    ".....HHHHHH.....",
    "....HHHHHHHH....",
    "...HHYYYYYYHH...",
    "...HHYYYYYYHH...",
    "..FFFFFFFFFFFF..",
    "..FFGGFFFFGGFF..",
    "..FFGNFFFFGNFF..",
    "..FFFFFFKKFFFF..",
    "..FFFFFFFFFFFF..",
    "...FFFFFFFFFF...",
    "....FFFFFFFF....",
    ".....FFFFFF.....",
    "................",
    "................",
  ],
  // Polar (Tank): white + scarf
  polar: [
    "................",
    "................",
    "....FF....FF....",
    "...FFFF..FFFF...",
    "..FFFFFFFFFFFF..",
    "..FFFFFFFFFFFF..",
    "..FFKKFFFFKKFF..",
    "..FFKKFFFFKKFF..",
    "..FFFFFFNNFFFF..",
    "..FFFFFFFFFFFF..",
    "...FFFFFFFFFF...",
    "....SSSSSSSS....",
    "....SSPPPPSS....",
    "....SSSSSSSS....",
    "................",
    "................",
  ],
  // Dark Angel (Glass Cannon): black + red eyes + horns
  angel: [
    "................",
    "....H........H..",
    "...HH........HH.",
    "..HHF........FHH",
    "..FFFFFFFFFFFFFF",
    "..FFFFFFFFFFFFFF",
    "..FFRRFFFFRRFF..",
    "..FFRRFFFFRRFF..",
    "..FFFFFFNNFFFF..",
    "..FFFFFFFFFFFF..",
    "...FFFFFFFFFF...",
    "....FFFFFFFF....",
    "................",
    "..WW........WW..",
    ".W.W........W.W.",
    "................",
  ],
  // Rainbow (Trickster): rainbow stripes
  rainbow: [
    "................",
    "................",
    "....AA....AA....",
    "...AAAA..AAAA...",
    "..AAAAAAAAAAAA..",
    "..BBBBBBBBBBBB..",
    "..CCKKCCCCKKCC..",
    "..CCKKCCCCKKCC..",
    "..DDDDDDNNDDDD..",
    "..EEEEEEEEEEEE..",
    "...GGGGGGGGGG...",
    "....IIIIIIII....",
    ".....IIIIII.....",
    "................",
    "................",
    "................",
  ],
  // Helmet (Support): + cub
  helmet: [
    "................",
    "................",
    "....HHHHHHHH....",
    "...HHHHHHHHHH...",
    "..HHHHHHHHHHHH..",
    "..FFHHHHHHHHFF..",
    "..FFKKFFFFKKFF..",
    "..FFKKFFFFKKFF..",
    "..FFFFFFNNFFFF..",
    "..FFFFFFFFFFFF..",
    "...FFFFFFFFFF...",
    "....FFFFFFFF....",
    "................",
    "......CCCC......",
    "......CKKC......",
    "......CCCC......",
  ],
};

/* color slot maps per class:
   F = primary fur, K = eye, N = nose, H = helmet/hat, Y = visor
   plus class-specific
*/
const BEAR_COLORS = {
  engineer: {
    F: "#8a5a2c",          // brown fur
    K: "#0a0c12",
    N: "#1a1d2a",
    H: "oklch(0.82 0.15 75)", // amber helmet
    Y: "oklch(0.6 0.18 250)", // blue visor
    G: "#444b6a",          // googles strap
  },
  polar: {
    F: "#e6ecf5",
    K: "#0a0c12",
    N: "#2a3050",
    S: "oklch(0.7 0.22 25)", // scarf
    P: "#e6ecf5",
  },
  angel: {
    F: "#15161e",
    H: "#15161e",          // horns
    R: "oklch(0.7 0.22 25)", // red eyes
    N: "#3c1818",
    W: "#3a1820",          // wings
  },
  rainbow: {
    A: "oklch(0.75 0.18 30)",   // red
    B: "oklch(0.82 0.15 75)",   // amber
    C: "oklch(0.85 0.15 175)",  // mint
    D: "oklch(0.7 0.18 250)",   // blue
    E: "oklch(0.7 0.2 310)",    // purple
    G: "oklch(0.7 0.2 0)",      // magenta
    I: "oklch(0.78 0.16 145)",  // green
    K: "#0a0c12",
    N: "#2a1d2a",
  },
  helmet: {
    F: "#8a5a2c",
    K: "#0a0c12",
    N: "#1a1d2a",
    H: "oklch(0.55 0.12 175)", // teal helmet
    C: "#a06840",              // cub fur
  },
};

function BearPortrait({ cls = "engineer", size }) {
  const pat = BEAR_PATTERNS[cls];
  const colors = BEAR_COLORS[cls];
  const cells = [];
  for (let r = 0; r < BEAR_W; r++) {
    for (let c = 0; c < BEAR_W; c++) {
      const ch = pat[r][c];
      const bg = ch === "." ? "transparent" : (colors[ch] || "#888");
      cells.push(<div key={r * BEAR_W + c} className="bear__cell" style={{ background: bg }} />);
    }
  }
  return (
    <div
      className="bear"
      style={{
        gridTemplateColumns: `repeat(${BEAR_W}, 1fr)`,
        gridTemplateRows: `repeat(${BEAR_W}, 1fr)`,
        ...(size ? { width: size, height: size } : {}),
      }}
    >
      {cells}
    </div>
  );
}

// ============================================================
// CLASS DATA
// ============================================================

const CLASSES = {
  engineer: {
    id: "engineer",
    name: "Engineer Bear",
    role: "Tech",
    color: "oklch(0.82 0.15 75)",
    stats: { speed: 55, stamina: 60, intelligence: 92, strength: 45 },
    blurb: "Long perception range. Repairs gear mid-battle and reads the maze ahead of others.",
    ability: "Wide-Scan: +50% raycast range",
  },
  polar: {
    id: "polar",
    name: "Polar Bear",
    role: "Tank",
    color: "oklch(0.85 0.04 240)",
    stats: { speed: 35, stamina: 95, intelligence: 55, strength: 80 },
    blurb: "Slow. Tough. Refuses to die. Built for last-AI-standing strategies.",
    ability: "Heavy Coat: 30% damage resistance",
  },
  angel: {
    id: "angel",
    name: "Dark Angel Bear",
    role: "Glass Cannon",
    color: "oklch(0.7 0.22 0)",
    stats: { speed: 70, stamina: 40, intelligence: 65, strength: 95 },
    blurb: "Hits like a truck, falls like one too. Wins by reaching treasure first.",
    ability: "Wingbeat: dash through walls once per match",
  },
  rainbow: {
    id: "rainbow",
    name: "Rainbow Bear",
    role: "Trickster",
    color: "oklch(0.85 0.15 175)",
    stats: { speed: 95, stamina: 70, intelligence: 75, strength: 40 },
    blurb: "Fastest in the maze. Dodges, baits, weaves. Bad to face in a tight corridor.",
    ability: "Prismshift: 40% dodge chance for 3s",
  },
  helmet: {
    id: "helmet",
    name: "Helmet Bear",
    role: "Support",
    color: "oklch(0.7 0.18 200)",
    stats: { speed: 50, stamina: 80, intelligence: 70, strength: 55 },
    blurb: "Travels with cub. Cub scouts ahead and reveals enemy positions to your AI.",
    ability: "Cub Sentry: passive +1 visible enemy",
  },
};

const CLASS_LIST = Object.values(CLASSES);

// Export to window for cross-script access
Object.assign(window, {
  BearPortrait,
  CLASSES,
  CLASS_LIST,
  BEAR_PATTERNS,
  BEAR_COLORS,
});
