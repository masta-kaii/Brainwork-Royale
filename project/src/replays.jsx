/* ============================================================
   BRAINWORK ROYALE — REPLAYS
   List of completed matches + scrubbable replay viewer.
   Fast-forward and per-event jump for studying AI behavior.
   ============================================================ */

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ReplayViewer({ replay, onClose }) {
  const stageRef = React.useRef(null);
  const sceneRef = React.useRef(null);

  const [paused, setPaused] = React.useState(false);
  const [speed, setSpeed] = React.useState(2);
  const [hintFaded, setHintFaded] = React.useState(false);
  // tickFloat is the "playhead" in tick-units (continuous)
  const tickFloatRef = React.useRef(0);
  const [tickInt, setTickInt] = React.useState(0);
  const scrubbingRef = React.useRef(false);

  const total = replay.totalTicks || (replay.snaps.length - 1);

  const resetCamera = React.useCallback(() => {
    sceneRef.current?.resetCamera();
  }, []);

  React.useEffect(() => {
    setHintFaded(false);
    const id = setTimeout(() => setHintFaded(true), 4500);
    return () => clearTimeout(id);
  }, [replay]);

  // Init scene
  React.useEffect(() => {
    if (!stageRef.current) return;
    sceneRef.current = createScene3D(stageRef.current);
    sceneRef.current.setReplay(replay);
    tickFloatRef.current = 0;
    setTickInt(0);
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [replay]);

  // Loop
  React.useEffect(() => {
    let raf;
    let last = performance.now();
    let hudT = 0;
    const TICK_DUR_MS = 220; // visual tick duration in replay (base)
    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const scene = sceneRef.current;
      if (!scene) return;

      if (!paused && !scrubbingRef.current) {
        // advance tickFloat
        tickFloatRef.current += (dt * 1000 / TICK_DUR_MS) * speed;
        if (tickFloatRef.current >= total) {
          tickFloatRef.current = total;
          setPaused(true);
        }
      }

      const tickIdx = Math.floor(tickFloatRef.current);
      const frac = tickFloatRef.current - tickIdx;
      scene.renderFrame(dt, { tickIndex: tickIdx, fractional: frac });

      hudT += dt;
      if (hudT > 0.1) {
        hudT = 0;
        setTickInt(tickIdx);
      }
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, speed, total]);

  const setScrub = (t) => {
    tickFloatRef.current = Math.max(0, Math.min(total, t));
    setTickInt(Math.floor(tickFloatRef.current));
  };

  const jumpToEvent = (e) => {
    setScrub(Math.max(0, e.t - 2));
    setPaused(false);
  };

  const winner = replay.winnerId != null
    ? replay.agents.find((a) => a.id === replay.winnerId)
    : null;

  // Build a sparse stat strip of "what's happening per tick" for the timeline.
  // Only the high-signal events get dots; routine hits/dodges/boosts would
  // pack the scrubber wall-to-wall with grey.
  const eventDots = React.useMemo(() => {
    const SHOWN = new Set(["ko", "treasure", "last", "spike"]);
    return replay.events.filter((e) => SHOWN.has(e.kind)).map((e) => ({
      pct: (e.t / total) * 100,
      color: e.kind === "ko" ? "var(--magenta)" :
             e.kind === "treasure" ? "var(--amber)" :
             e.kind === "last" ? "var(--mint)" :
             e.kind === "spike" ? "var(--magenta)" :
             "var(--ink-3)",
      kind: e.kind,
    }));
  }, [replay, total]);

  // Pull last few events up to current tick for context
  const visibleEvents = replay.events.filter((e) => e.t <= tickInt).slice(-8).reverse();

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="replay-viewer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="replay-viewer__head">
          <div>
            <div className="mono tiny" style={{ color: "var(--mint)", letterSpacing: "0.2em" }}>
              REPLAY · {replay.mazeName}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--ink-0)" }}>
              Match {replay.id}
              {winner && (
                <span style={{ marginLeft: 12, color: winner.color, fontSize: 14 }}>
                  ★ {winner.name}
                </span>
              )}
            </div>
          </div>
          <button className="overlay__close" style={{ position: "static", width: 32, height: 32 }} onClick={onClose}>×</button>
        </div>

        <div className="replay-viewer__body">
          <div className="replay-stage">
            <div
              ref={stageRef}
              className="three-mount"
              onDoubleClick={resetCamera}
            />

            <button
              className="cam-ctl"
              onClick={resetCamera}
              title="Reset view"
              aria-label="Reset view"
            >↺</button>
            <div className={`cam-hint ${hintFaded ? "is-faded" : ""}`}>
              <kbd>DRAG</kbd> rotate · <kbd>SCROLL</kbd> zoom · <kbd>DBL-CLK</kbd> reset
            </div>

            {/* HUD: current tick + tag */}
            <div className="battle-hud" style={{ pointerEvents: "none" }}>
              <div className="battle-hud__top">
                <span className="battle-hud__tag">
                  TICK {tickInt} / {total}
                </span>
                <span className="battle-hud__tag">
                  {paused ? "PAUSED" : `${speed}× PLAYBACK`}
                </span>
              </div>
            </div>
          </div>

          {/* Side: event log + study notes */}
          <div className="replay-side">
            <div className="card" style={{ padding: 12 }}>
              <div className="card__label">Event log · click to jump</div>
              <div style={{ display: "grid", gap: 3, maxHeight: 280, overflowY: "auto", fontFamily: "var(--font-display)", fontSize: 11 }}>
                {visibleEvents.map((e, i) => {
                  const from = e.from != null && e.from >= 0 ? replay.agents[e.from] : null;
                  const to = e.to != null ? replay.agents[e.to] : null;
                  return (
                    <div
                      key={`${e.t}-${i}`}
                      className="event-row"
                      onClick={() => jumpToEvent(e)}
                    >
                      <span style={{ color: "var(--ink-3)", width: 32 }}>t{e.t}</span>
                      {e.kind === "hit" && from && to && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span style={{ color: "var(--ink-2)" }}>→</span>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span style={{ color: "var(--magenta)", marginLeft: "auto" }}>−{e.dmg}</span>
                        </>
                      )}
                      {e.kind === "dodge" && from && to && (
                        <>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span style={{ color: "var(--mint)" }}>↺ dodges</span>
                          <span style={{ color: from.color }}>{from.name}</span>
                        </>
                      )}
                      {e.kind === "spike" && to && (
                        <>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span style={{ color: "var(--magenta)" }}>▴ spike</span>
                          <span style={{ color: "var(--magenta)", marginLeft: "auto" }}>−{e.dmg}</span>
                        </>
                      )}
                      {e.kind === "boost" && to && (
                        <>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span style={{ color: "var(--mint)" }}>» boost</span>
                        </>
                      )}
                      {e.kind === "slow" && to && (
                        <>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span style={{ color: "var(--ink-2)" }}>~ slow</span>
                        </>
                      )}
                      {e.kind === "jump" && to && (
                        <>
                          <span style={{ color: to.color }}>{to.name}</span>
                          <span style={{ color: "var(--amber)" }}>↟ jump</span>
                        </>
                      )}
                      {e.kind === "ko" && to && (
                        <>
                          {from
                            ? <>
                                <span style={{ color: from.color }}>{from.name}</span>
                                <span style={{ color: "var(--magenta)" }}>KO'd</span>
                                <span style={{ color: to.color }}>{to.name}</span>
                              </>
                            : <>
                                <span style={{ color: to.color }}>{to.name}</span>
                                <span style={{ color: "var(--magenta)" }}>fell to spikes</span>
                              </>
                          }
                        </>
                      )}
                      {e.kind === "treasure" && from && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span style={{ color: "var(--amber)" }}>★ treasure</span>
                        </>
                      )}
                      {e.kind === "last" && from && (
                        <>
                          <span style={{ color: from.color }}>{from.name}</span>
                          <span style={{ color: "var(--mint)" }}>last standing</span>
                        </>
                      )}
                    </div>
                  );
                })}
                {visibleEvents.length === 0 && (
                  <div style={{ color: "var(--ink-3)" }}>Match start — agents spawning…</div>
                )}
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="card__label">Agents</div>
              <div style={{ display: "grid", gap: 4 }}>
                {replay.agents.map((a) => {
                  const snap = replay.snaps[Math.min(tickInt, replay.snaps.length - 1)][a.id];
                  return (
                    <div
                      key={a.id}
                      className={`agent-row ${!snap.alive ? "is-dead" : ""} ${a.isYou ? "is-you" : ""}`}
                    >
                      <div className="agent-row__rank">#{a.id + 1}</div>
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="agent-row__color" style={{ background: a.color }} />
                          <span className="agent-row__name">{a.name}</span>
                        </div>
                        <div className="agent-row__class">{CLASSES[a.cls].role}</div>
                        <div className="agent-row__hp">
                          <div
                            className={`agent-row__hp-fill ${snap.hp / a.maxHp < 0.25 ? "crit" : snap.hp / a.maxHp < 0.5 ? "warn" : ""}`}
                            style={{ width: `${Math.max(0, (snap.hp / a.maxHp) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "var(--ink-0)", fontWeight: 700 }}>
                          {Math.max(0, Math.round(snap.hp))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Scrubber + transport */}
        <div className="replay-transport">
          <button
            className={`battle-ctrl ${paused ? "" : "is-on"}`}
            onClick={() => setPaused((p) => !p)}
            title="Play/Pause"
          >{paused ? "▶" : "❚❚"}</button>

          <div className="replay-scrub">
            {/* event dots overlay */}
            <div className="replay-scrub__events">
              {eventDots.map((d, i) => (
                <div
                  key={i}
                  className="replay-scrub__dot"
                  style={{ left: `${d.pct}%`, background: d.color }}
                  title={d.kind}
                />
              ))}
            </div>
            <input
              type="range"
              min="0" max={total} step="1"
              value={tickInt}
              onPointerDown={() => { scrubbingRef.current = true; }}
              onPointerUp={() => { scrubbingRef.current = false; }}
              onChange={(e) => setScrub(parseInt(e.target.value, 10))}
              className="replay-scrub__input"
            />
          </div>

          <span className="mono tiny" style={{ color: "var(--ink-2)", minWidth: 70, textAlign: "right" }}>
            T {tickInt} / {total}
          </span>

          <div className="battle-speed">
            {[1, 2, 4, 8].map((s) => (
              <button
                key={s}
                className={`battle-speed__btn ${speed === s ? "is-on" : ""}`}
                onClick={() => setSpeed(s)}
              >{s}×</button>
            ))}
          </div>

          <button className="battle-ctrl" onClick={() => setScrub(0)} title="Restart">⏮</button>
        </div>
      </div>
    </div>
  );
}

function ReplayCard({ replay, onOpen }) {
  const winner = replay.winnerId != null ? replay.agents.find((a) => a.id === replay.winnerId) : null;
  const youAgent = replay.agents.find((a) => a.isYou);
  const youWon = winner && winner.id === youAgent.id;
  // find your placement
  const lastSnap = replay.snaps[replay.snaps.length - 1];
  const placements = lastSnap
    .map((s, i) => ({ ...s, id: i }))
    .sort((a, b) => (b.alive - a.alive) || (b.hp - a.hp));
  const youPlacement = placements.findIndex((p) => p.id === youAgent.id) + 1;

  // Maze preview thumbnail (CSS grid)
  const { grid, cols, rows } = replay.maze;

  return (
    <div className="replay-card" onClick={onOpen}>
      <div className="replay-card__thumb" style={{ aspectRatio: `${cols} / ${rows}` }}>
        <div
          className="replay-card__maze"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {grid.flatMap((row, y) =>
            row.map((c, x) => (
              <div
                key={`${x}-${y}`}
                className={`replay-card__cell ${c === 1 ? "is-wall" : ""}`}
              />
            ))
          )}
        </div>
        {/* agent dots layer */}
        <div className="replay-card__agents">
          {replay.agents.map((a, i) => {
            const s = lastSnap[i];
            return (
              <div
                key={i}
                className="replay-card__agent"
                style={{
                  left: `${(s.x / (cols - 1)) * 100}%`,
                  top: `${(s.y / (rows - 1)) * 100}%`,
                  background: a.color,
                  opacity: s.alive ? 1 : 0.25,
                  outline: a.isYou ? "1.5px solid #fff" : "none",
                }}
              />
            );
          })}
          <div
            className="replay-card__treasure"
            style={{
              left: `${(replay.treasure[0] / (cols - 1)) * 100}%`,
              top: `${(replay.treasure[1] / (rows - 1)) * 100}%`,
            }}
          />
        </div>
        <div className="replay-card__overlay">
          <span className="mono tiny" style={{
            color: youWon ? "var(--mint)" : youPlacement <= 3 ? "var(--amber)" : "var(--magenta)",
            background: "oklch(0 0 0 / 0.6)",
            padding: "3px 7px",
            borderRadius: 6,
            letterSpacing: "0.1em",
            backdropFilter: "blur(4px)",
          }}>
            {youWon ? "WIN" : `#${youPlacement}`}
          </span>
        </div>
      </div>
      <div className="replay-card__body">
        <div className="row between" style={{ marginBottom: 4 }}>
          <span className="mono" style={{ color: "var(--ink-0)", fontWeight: 700, fontSize: 13 }}>
            {replay.id}
          </span>
          <span className="mono tiny" style={{ color: "var(--ink-3)" }}>
            {timeAgo(replay.endedAt || replay.startedAt)}
          </span>
        </div>
        <div className="mono tiny" style={{ color: "var(--ink-2)", marginBottom: 6 }}>
          {replay.mazeName}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Chip>Gen {replay.ai.generation}</Chip>
          <Chip>{replay.totalTicks} ticks</Chip>
          {winner && (
            <Chip variant={youWon ? "mint" : "magenta"} dot>
              ★ {winner.name}
            </Chip>
          )}
        </div>
      </div>
    </div>
  );
}

function timeAgo(ms) {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function ReplaysScreen({ replays, ai }) {
  const [open, setOpen] = React.useState(null);
  const [filter, setFilter] = React.useState("all");

  const youId = 0;
  const filtered = replays.filter((r) => {
    if (filter === "wins") return r.winnerId === youId;
    if (filter === "losses") return r.winnerId !== youId;
    return true;
  });

  return (
    <>
      <PageHeader
        eyebrow="Past matches · scrubbable · fast-forwardable"
        title="Replays"
        meta={<span>{replays.length} saved · study mode</span>}
      />
      <div className="page-body">
        <div className="quest-tabs">
          {[["all", "All"], ["wins", "Wins"], ["losses", "Losses"]].map(([id, lbl]) => (
            <div
              key={id}
              className={`quest-tab ${filter === id ? "is-active" : ""}`}
              onClick={() => setFilter(id)}
            >{lbl}</div>
          ))}
        </div>

        <div className="card card--inset" style={{ marginBottom: 16 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="card__label">Study mode</div>
              <div className="mono tiny" style={{ color: "var(--ink-2)", lineHeight: 1.5, maxWidth: 560 }}>
                Replays are deterministic from the match seed. Scrub to any tick,
                fast-forward to skip lulls, or click events on the timeline to jump.
                Use this to see how your brain's decisions changed over generations.
              </div>
            </div>
            <Chip variant="mint" dot>{replays.length} matches stored</Chip>
          </div>
        </div>

        <div className="replays-grid">
          {filtered.map((r) => (
            <ReplayCard key={r.id} replay={r} onOpen={() => setOpen(r)} />
          ))}
          {filtered.length === 0 && (
            <div style={{
              gridColumn: "1 / -1",
              padding: 40,
              textAlign: "center",
              color: "var(--ink-3)",
              border: "1px dashed var(--line)",
              borderRadius: "var(--r-lg)",
              background: "var(--bg-1)",
            }}>
              <div className="mono tiny" style={{ letterSpacing: "0.2em", marginBottom: 6 }}>
                NO REPLAYS YET
              </div>
              <div>Watch a live battle — it'll appear here when it ends.</div>
            </div>
          )}
        </div>
      </div>

      {open && (
        <ReplayViewer replay={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

Object.assign(window, { ReplaysScreen, ReplayViewer, ReplayCard });
