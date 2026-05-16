/* ============================================================
   BRAINWORK ROYALE — LIVE BATTLE (3D)
   Real-time only. Sim ticks at fixed cadence. Visual smoothly
   interpolates between ticks. When match ends, full replay
   record is emitted to app for saving + later study.
   ============================================================ */

const TICK_MS = 320; // one sim tick every 320ms — feels alive but readable

function snapSim(sim) {
  return sim.agents.map((a) => ({
    x: a.x, y: a.y,
    hp: a.hp, alive: a.alive, facing: a.facing,
    lastDamageAt: a.lastDamageAt, lastAttackAt: a.lastAttackAt,
  }));
}

function BattleScreen({ ai, seed, onReseed, onToast, onMatchComplete }) {
  const stageRef = React.useRef(null);
  const sceneRef = React.useRef(null);
  const simRef = React.useRef(null);
  const replayRef = React.useRef(null);
  const startedAtRef = React.useRef(0);

  const [, force] = React.useReducer((x) => x + 1, 0);
  const [winner, setWinner] = React.useState(null);
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const completedRef = React.useRef(false);

  // Build sim + scene on mount / seed change
  React.useEffect(() => {
    if (!stageRef.current) return;

    // sim
    const sim = createBattleSim(seed, ai);
    simRef.current = sim;
    completedRef.current = false;

    // rolling replay
    const replay = {
      id: `M-${seed.toString().padStart(4, "0")}`,
      seed,
      startedAt: Date.now(),
      ai: { name: ai.name, class: ai.class, generation: ai.generation, tier: ai.tier },
      maze: sim.maze, treasure: sim.treasure,
      cols: sim.cols, rows: sim.rows,
      agents: sim.agents.map((a) => ({
        id: a.id, name: a.name, cls: a.cls, color: a.color,
        isYou: a.isYou, maxHp: a.maxHp,
      })),
      snaps: [snapSim(sim)],
      events: sim.events,
      totalTicks: 0,
      winnerId: null,
      mazeName: `NEON LAB #${seed.toString().padStart(4, "0")}`,
    };
    replayRef.current = replay;

    // scene
    sceneRef.current = createScene3D(stageRef.current);
    sceneRef.current.setReplay(replay);

    startedAtRef.current = performance.now();
    setWinner(null);
    setElapsedSec(0);

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [seed, ai.class]);

  // Animation loop
  React.useEffect(() => {
    let raf;
    let lastFrame = performance.now();
    let hudTimer = 0;

    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      const sim = simRef.current;
      const replay = replayRef.current;
      const scene = sceneRef.current;
      if (!sim || !replay || !scene) return;

      // Determine the float "tick time" since match start
      const elapsedMs = now - startedAtRef.current;
      const tickFloat = elapsedMs / TICK_MS;
      let tickIdx = Math.floor(tickFloat);
      let frac = tickFloat - tickIdx;

      // Advance sim until snaps[tickIdx+1] exists (or winner)
      while (sim.tick < tickIdx + 1 && !sim.winner) {
        sim.step();
        replay.snaps.push(snapSim(sim));
      }
      if (sim.winner && !completedRef.current) {
        completedRef.current = true;
        replay.totalTicks = sim.tick;
        replay.winnerId = sim.winner.id;
        replay.endedAt = Date.now();
        replay.events = sim.events.slice();
        setWinner(sim.winner);
        onMatchComplete?.(replay);
      }
      if (sim.winner) {
        // Freeze at final tick
        tickIdx = sim.tick;
        frac = 0;
      }

      scene.renderFrame(dt, { tickIndex: tickIdx, fractional: frac });

      // HUD ticker (5/s)
      hudTimer += dt;
      if (hudTimer > 0.2) {
        hudTimer = 0;
        setElapsedSec(Math.floor(elapsedMs / 1000));
        force();
      }
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sim = simRef.current;
  const aliveCount = sim ? sim.agents.filter((a) => a.alive).length : 0;
  const totalCount = sim ? sim.agents.length : 8;
  const recentEvents = sim ? sim.events.slice(-3).reverse() : [];

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <>
      <PageHeader
        eyebrow={`LIVE · Match #${seed.toString().padStart(4, "0")} · Tier ${ai.tier}`}
        title="Battle"
        meta={
          <>
            <span><span className="dot" />REAL-TIME · {fmtTime(elapsedSec)}</span>
            <span>{aliveCount}/{totalCount} alive</span>
          </>
        }
      />
      <div className="page-body">
        <div className="battle-wrap">
          <div className="battle-stage battle-stage--3d">
            <div ref={stageRef} className="three-mount" />

            {/* Top HUD strip */}
            <div className="battle-hud">
              <div className="battle-hud__top">
                <span className="battle-hud__tag">
                  <span className="chip__dot" style={{ background: "var(--magenta)", animation: "pulse 1.4s infinite" }} />
                  LIVE · NEON LAB · MAZE #{seed.toString().padStart(4, "0")}
                </span>
                <span className="battle-hud__tag">
                  T+{fmtTime(elapsedSec)} · {aliveCount} ALIVE
                </span>
              </div>

              {/* Live event ticker bottom */}
              <div className="live-ticker">
                {recentEvents.map((e, i) => {
                  const from = sim.agents[e.from];
                  const to = e.to != null ? sim.agents[e.to] : null;
                  return (
                    <div key={`${e.t}-${i}`} className="live-ticker__item" style={{ opacity: 1 - i * 0.3 }}>
                      <span className="mono tiny" style={{ color: "var(--ink-3)" }}>t{e.t}</span>
                      {e.kind === "hit" && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span className="mono tiny" style={{ color: "var(--ink-2)" }}>hits</span>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span className="mono tiny" style={{ color: "var(--magenta)" }}>−{e.dmg}</span>
                        </>
                      )}
                      {e.kind === "ko" && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span className="mono tiny" style={{ color: "var(--magenta)" }}>knocked out</span>
                          <span style={{ color: to.color }}>{to.name}</span>
                        </>
                      )}
                      {e.kind === "treasure" && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span className="mono tiny" style={{ color: "var(--amber)" }}>secured treasure</span>
                        </>
                      )}
                      {e.kind === "last" && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span className="mono tiny" style={{ color: "var(--mint)" }}>is the last AI standing</span>
                        </>
                      )}
                    </div>
                  );
                })}
                {recentEvents.length === 0 && (
                  <div className="live-ticker__item">
                    <span className="mono tiny" style={{ color: "var(--ink-3)" }}>
                      Match in progress — agents scouting…
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Winner overlay */}
            {winner && (
              <div className="battle-overlay">
                <div className="battle-overlay__panel">
                  <div className="mono tiny" style={{ color: "var(--mint)", letterSpacing: "0.2em" }}>
                    {sim.events[sim.events.length - 1]?.kind === "treasure"
                      ? "TREASURE SECURED"
                      : "LAST AI STANDING"}
                  </div>
                  <div className="overlay-winner">{winner.name}</div>
                  <div className="mono tiny" style={{ color: "var(--ink-2)", marginBottom: 16 }}>
                    {CLASSES[winner.cls].name.toUpperCase()} · {sim.tick} ticks · {fmtTime(elapsedSec)}
                  </div>
                  <div className="row" style={{ justifyContent: "center", gap: 8, marginBottom: 18 }}>
                    <Chip variant="amber">+{winner.isYou ? 480 : 60} coins</Chip>
                    <Chip variant="mint">+{winner.isYou ? 12 : 2} gens</Chip>
                    <Chip>Saved to Replays</Chip>
                  </div>
                  <div className="row" style={{ justifyContent: "center", gap: 8 }}>
                    <button className="btn btn--primary" onClick={() => onReseed()}>
                      ↻ Queue next match
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Side panel — live leaderboard */}
          <div className="battle-side">
            <div className="card" style={{ padding: 12 }}>
              <div className="card__label">Live leaderboard</div>
              <div style={{ display: "grid", gap: 4 }}>
                {sim && [...sim.agents]
                  .sort((a, b) => (b.alive - a.alive) || (b.hp - a.hp))
                  .map((a, i) => (
                    <div
                      key={a.id}
                      className={`agent-row ${!a.alive ? "is-dead" : ""} ${a.isYou ? "is-you" : ""}`}
                    >
                      <div className="agent-row__rank">#{i + 1}</div>
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="agent-row__color" style={{ background: a.color }} />
                          <span className="agent-row__name">{a.name}</span>
                        </div>
                        <div className="agent-row__class">{CLASSES[a.cls].role}</div>
                        <div className="agent-row__hp">
                          <div
                            className={`agent-row__hp-fill ${a.hp / a.maxHp < 0.25 ? "crit" : a.hp / a.maxHp < 0.5 ? "warn" : ""}`}
                            style={{ width: `${Math.max(0, (a.hp / a.maxHp) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "var(--ink-0)", fontWeight: 700 }}>
                          {Math.max(0, Math.round(a.hp))}
                        </div>
                        <div style={{ color: "var(--ink-3)", fontSize: 9 }}>HP</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="card__label">Your AI</div>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 44, flexShrink: 0 }}>
                  <BearPortrait cls={ai.class} />
                </div>
                <div>
                  <div style={{ color: "var(--ink-0)", fontWeight: 700 }}>{ai.name}</div>
                  <div className="mono tiny" style={{ color: "var(--mint)" }}>
                    GEN #{ai.generation} · {CLASSES[ai.class].role}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <StatBlock stats={ai.stats} />
              </div>
              <div className="divider" />
              <div className="mono tiny" style={{ color: "var(--ink-3)", lineHeight: 1.5 }}>
                Live battles play in real time — no fast-forward.
                Study completed matches in <b style={{ color: "var(--mint)" }}>Replays</b> to see how your brain handled each tick.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { BattleScreen, snapSim, TICK_MS });
