/* ============================================================
   BRAINWORK ROYALE — HOME
   Dashboard: hero match countdown, daily quests, AI status,
   recent activity.
   ============================================================ */

// Small canvas preview of a maze with dots representing agents
function MiniMaze() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const c = ref.current;
    const ctx = c.getContext("2d");
    let raf, t = 0;
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr; c.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Build a simple maze
    const cols = 18, rows = 12;
    const grid = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        // border
        const wall =
          x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ||
          ((x % 3 === 0) && (y % 2 === 1) && Math.random() < 0.45) ||
          ((y % 3 === 0) && (x % 2 === 1) && Math.random() < 0.4);
        row.push(wall ? 1 : 0);
      }
      grid.push(row);
    }
    // ensure center is open
    grid[Math.floor(rows / 2)][Math.floor(cols / 2)] = 0;

    const agents = [
      { x: 1.5, y: 1.5, vx: 0.04, vy: 0.02, col: "oklch(0.85 0.15 175)" },
      { x: cols - 2.5, y: 1.5, vx: -0.03, vy: 0.04, col: "oklch(0.7 0.22 0)" },
      { x: 1.5, y: rows - 2.5, vx: 0.05, vy: -0.02, col: "oklch(0.82 0.15 75)" },
      { x: cols - 2.5, y: rows - 2.5, vx: -0.04, vy: -0.03, col: "oklch(0.7 0.18 250)" },
      { x: 4, y: 4, vx: 0.02, vy: 0.05, col: "oklch(0.78 0.16 145)" },
    ];

    const draw = () => {
      const r = c.getBoundingClientRect();
      const w = r.width, h = r.height;
      ctx.clearRect(0, 0, w, h);

      const cw = w / cols, ch = h / rows;

      // grid background
      ctx.fillStyle = "#070a14";
      ctx.fillRect(0, 0, w, h);

      // walls
      ctx.fillStyle = "oklch(0.85 0.15 175 / 0.18)";
      ctx.strokeStyle = "oklch(0.85 0.15 175 / 0.4)";
      ctx.lineWidth = 1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (grid[y][x]) {
            ctx.fillRect(x * cw, y * ch, cw, ch);
            ctx.strokeRect(x * cw + 0.5, y * ch + 0.5, cw - 1, ch - 1);
          }
        }
      }

      // central treasure
      const tx = (cols / 2) * cw;
      const ty = (rows / 2) * ch;
      const tpulse = 0.5 + Math.sin(t * 0.05) * 0.3;
      ctx.fillStyle = `oklch(0.82 0.15 75 / ${tpulse})`;
      ctx.beginPath();
      ctx.arc(tx, ty, cw * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "oklch(0.82 0.15 75)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // agents
      agents.forEach((a) => {
        // bounce off walls
        const nx = a.x + a.vx, ny = a.y + a.vy;
        const cellX = Math.floor(nx), cellY = Math.floor(ny);
        if (cellX < 0 || cellY < 0 || cellX >= cols || cellY >= rows || grid[cellY][cellX]) {
          if (grid[Math.floor(a.y)][Math.floor(nx)]) a.vx = -a.vx;
          if (grid[Math.floor(ny)][Math.floor(a.x)]) a.vy = -a.vy;
          if (Math.random() < 0.3) { a.vx = (Math.random() - 0.5) * 0.08; a.vy = (Math.random() - 0.5) * 0.08; }
        } else {
          a.x = nx; a.y = ny;
        }

        // trail glow
        ctx.fillStyle = a.col.replace(")", " / 0.25)");
        ctx.beginPath();
        ctx.arc(a.x * cw, a.y * ch, cw * 0.6, 0, Math.PI * 2);
        ctx.fill();
        // body
        ctx.fillStyle = a.col;
        ctx.beginPath();
        ctx.arc(a.x * cw, a.y * ch, cw * 0.28, 0, Math.PI * 2);
        ctx.fill();
      });

      t++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={ref} className="mini-maze" />;
}

// Countdown to next match
function NextMatchCountdown({ targetMs }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, targetMs - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return <span>{pad(h)}:{pad(m)}:{pad(s)}</span>;
}

function HomeScreen({ player, ai, onNav, dailyQuests, completeQuest, onStartBattle }) {
  const nextMatchTime = React.useMemo(() => Date.now() + 1000 * 60 * 47 + 1000 * 23, []);

  return (
    <>
      <PageHeader
        eyebrow={`Good morning, ${player.handle}`}
        title="Command Deck"
        meta={
          <>
            <span><span className="dot" />Brain v1.2 active</span>
            <span>Gen #{ai.generation}</span>
          </>
        }
      />
      <div className="page-body">
        {/* Hero match panel */}
        <div className="hero-match">
          <div className="hero-match__bg" />
          <div className="hero-match__body">
            <div className="hero-match__eyebrow">
              <span className="chip__dot" style={{ background: "var(--mint)" }} />
              Next match · Tier {ai.tier}
            </div>
            <h2 className="hero-match__title">{ai.name} is queued.</h2>
            <p className="hero-match__sub">
              16 AIs drop into a procedural maze. Last alive or first to the treasure wins.
              You've earned <b style={{ color: "var(--mint)" }}>+24 training gens</b> since
              your last battle.
            </p>
            <div className="hero-match__countdown">
              <NextMatchCountdown targetMs={nextMatchTime} />
              <small>Until drop · Auto-enter ON</small>
            </div>
            <div className="hero-match__actions">
              <button className="btn btn--primary" onClick={onStartBattle} style={{ fontSize: 13, padding: "12px 22px" }}>
                ⚔ Drop into a maze
              </button>
              <button className="btn btn--ghost" onClick={() => onNav("battle")}>
                ▶ Watch live battle
              </button>
              <button className="btn btn--ghost" onClick={() => onNav("brain")}>
                Inspect brain
              </button>
            </div>
          </div>
          <div className="hero-match__preview">
            <MiniMaze />
          </div>
        </div>

        {/* KPI row */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi__label">Rank</div>
            <div className="kpi__val">#247</div>
            <div className="kpi__sub"><span className="up">▲ 12</span> this week</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Win rate</div>
            <div className="kpi__val">61%</div>
            <div className="kpi__sub"><span className="up">▲ 4%</span> vs last gen</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Coins</div>
            <div className="kpi__val">{player.coins.toLocaleString()}</div>
            <div className="kpi__sub">+340 today</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Streak</div>
            <div className="kpi__val">7 days</div>
            <div className="kpi__sub"><span className="up">×1.5</span> reward mult</div>
          </div>
        </div>

        {/* Two-col: daily quests + AI status */}
        <div className="home-grid" style={{ marginTop: 8 }}>
          <div>
            <SectionTitle link="View all →">Daily quests · 3 of 5 active</SectionTitle>
            <div className="quest-list">
              {dailyQuests.map((q) => (
                <div className="quest-item" key={q.id} onClick={() => completeQuest(q)}>
                  <div className={`quest-item__icon quest-item__icon--${q.kind}`}>
                    {q.glyph}
                  </div>
                  <div>
                    <div className="quest-item__title">{q.title}</div>
                    <div className="quest-item__meta">
                      {q.progress}/{q.target} {q.unit} · {q.kindLabel}
                    </div>
                    <div className="quest-item__progress">
                      <div
                        className="quest-item__progress-fill"
                        style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="quest-item__reward">
                    +{q.reward}<br />
                    <span style={{ color: "var(--ink-3)" }}>{q.rewardLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>AI status</SectionTitle>
            <div className="card">
              <div className="row" style={{ gap: 12, marginBottom: 12 }}>
                <div style={{ width: 56 }}>
                  <BearPortrait cls={ai.class} />
                </div>
                <div>
                  <div className="card__title">{ai.name}</div>
                  <div className="mono tiny" style={{ color: "var(--mint)" }}>
                    {CLASSES[ai.class].name.toUpperCase()} · GEN #{ai.generation}
                  </div>
                </div>
              </div>
              <StatBlock stats={ai.stats} />
              <div className="divider" />
              <div className="mono tiny" style={{ color: "var(--ink-3)", marginBottom: 6 }}>
                HEALTH CONNECTORS
              </div>
              <button
                className="btn btn--ghost btn--sm"
                style={{ fontSize: 10, justifyContent: "flex-start", gap: 6 }}
                onClick={() => {
                  window.open(`/api/strava/auth?uid=${encodeURIComponent(player.uid)}`, "strava", "width=600,height=700");
                }}
                title="Connect Strava to sync your runs/walks → STA stat"
              >
                <span style={{ color: "var(--amber)", fontWeight: 700 }}>◆</span>
                Connect Strava
              </button>
              <div className="divider" />
              <div className="mono tiny" style={{ color: "var(--ink-3)", marginBottom: 6 }}>
                TRAINING QUEUE
              </div>
              <div className="row between">
                <span className="mono" style={{ fontSize: 12 }}>{ai.trainingQueue} gens pending</span>
                <Chip variant="mint" dot>Running</Chip>
              </div>
              <div className="quest-item__progress" style={{ marginTop: 6 }}>
                <div className="quest-item__progress-fill" style={{ width: "62%" }} />
              </div>
            </div>

            <SectionTitle link="View all →">Latest replay</SectionTitle>
            <div className="card" style={{ cursor: "pointer" }} onClick={() => onNav("replays")}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="mono tiny" style={{ color: "var(--mint)" }}>
                  WIN · 2nd PLACE
                </span>
                <span className="mono tiny" style={{ color: "var(--ink-3)" }}>4m ago</span>
              </div>
              <div className="card__title" style={{ fontSize: 14, marginBottom: 4 }}>
                Neon Lab · Tier {ai.tier}
              </div>
              <div className="mono tiny" style={{ color: "var(--ink-2)" }}>
                Survived 2:14 · 3 KOs · Treasure secured
              </div>
              <div className="row" style={{ marginTop: 10, gap: 4 }}>
              </div>
            </div>

            {/* Brain fitness overview — compact sparkline per trained skill */}
            <SectionTitle>Brain fitness</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(window.dataLayer?.SKILL_DEFS || []).filter(d => d.isReal).map((def) => {
                const key = window.skillTree?.brainKey(def.id, 1);
                const brain = ai._brains?.[key];
                const fitness = brain?.meta?.fitness;
                const gen = brain?.meta?.gen;
                const mastered = brain?.meta?.mastered;
                return (
                  <div key={def.id} className="row between" style={{ padding: "4px 8px", background: "var(--bg-1)", borderRadius: 6, border: "1px solid var(--line-soft)" }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 14, width: 20, textAlign: "center", color: mastered ? "var(--amber)" : "var(--mint)" }}>
                        {def.glyph}
                      </span>
                      <span className="mono tiny" style={{ color: "var(--ink-1)" }}>{def.name}</span>
                    </div>
                    <span className="mono tiny" style={{ color: fitness ? (mastered ? "var(--amber)" : "var(--mint)") : "var(--ink-3)" }}>
                      {fitness ? `${fitness.toFixed(2)} · gen ${gen || "?"}` : "untrained"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { HomeScreen, MiniMaze, NextMatchCountdown });
