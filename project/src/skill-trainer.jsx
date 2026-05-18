/* ============================================================
   BRAINWORK ROYALE — SKILL TRAINER (generic)
   Replaces the old balance-specific trainer. Takes (skillId,
   level) props, resolves the env from window.trainingEnvs, runs
   the GA, plays back the best genome's trace, persists weights
   to /users/{uid}/brains/{skillId}-L{level}.

   Hook-rules safe: all hooks declared at the top, early returns
   only afterwards.
   ============================================================ */

const SKILL_TRAINER_PACKS = [
  { id: "quick",    label: "Quick set",    gens: 10,  cost: 100 },
  { id: "session",  label: "Full session", gens: 40,  cost: 350 },
  { id: "marathon", label: "Marathon",     gens: 100, cost: 800 },
];

// Tiny canvas sparkline — last N best-fitness samples
function _drawSparkline(canvas, samples) {
  if (!canvas || !samples?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const lo = Math.min(...samples, 0);
  const hi = Math.max(...samples, lo + 0.001);
  const span = hi - lo;
  ctx.strokeStyle = "rgba(93, 242, 214, 0.85)";
  ctx.fillStyle = "rgba(93, 242, 214, 0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  samples.forEach((v, i) => {
    const x = (i / Math.max(1, samples.length - 1)) * w;
    const y = h - ((v - lo) / span) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
}

function SkillTrainer({ uid, skillId, level, profile, brains, onSpendCoins, onToast, onBrainSaved }) {
  const stageRef = React.useRef(null);
  const sceneRef = React.useRef(null);
  const trainerRef = React.useRef(null);
  const lastBestRef = React.useRef({ brain: null, traces: null, fitness: 0 });
  // Playback now holds an ARRAY of traces (one per visualised bear), all
  // advanced in lockstep so the population view stays synchronised.
  const playbackRef = React.useRef({ traces: null, idx: 0, lastT: 0 });
  const [session, setSession] = React.useState(null);
  const [stats, setStats] = React.useState({ gen: 0, best: 0, avg: 0, std: 0 });
  // Per-generation history for the sparkline (best fitness over time)
  const genHistoryRef = React.useRef([]);
  const sparklineRef = React.useRef(null);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const tree = window.skillTree?.SKILL_TREE?.[skillId];
  const env = window.trainingEnvs?.getEnv?.(skillId, level);
  const brainKey = window.skillTree?.brainKey(skillId, level);
  const existingBrain = brains?.[brainKey] || null;
  const isPlaceholder = !!env?.placeholder;

  // 1. Wait for Rapier
  React.useEffect(() => {
    if (window.RAPIER_FAILED) { setFailed(true); return; }
    if (window.brainEngine?.isReady?.()) { setReady(true); return; }
    const onR = () => {
      if (window.RAPIER_FAILED) setFailed(true);
      else setReady(true);
    };
    window.addEventListener("rapier-ready", onR, { once: true });
    return () => window.removeEventListener("rapier-ready", onR);
  }, []);

  // 2. Mount the 3D scene + spawn-pose preview
  React.useEffect(() => {
    if (!stageRef.current || !ready || failed || isPlaceholder) return;
    sceneRef.current = window.mountRagdollScene(stageRef.current);

    // Register the env's static prop visuals + dynamic factory so the
    // renderer can mirror pendulums, debris, etc. each frame.
    if (env && sceneRef.current?.setPropVisuals) {
      sceneRef.current.setPropVisuals(env.propVisuals || [], env.dynamicPropFactory || null);
    }
    // Apply per-env camera view if the env requested one (Walk uses a
    // side angle so the path forward is visible).
    if (env?.cameraView && sceneRef.current?.setView) {
      sceneRef.current.setView(env.cameraView);
    }

    // Show a static spawn pose so the arena isn't empty
    try {
      if (env && env.build) {
        const previewWorld = window.brainEngine.makeWorld();
        const envState = env.build(previewWorld);
        if (env.buildProps) envState.props = env.buildProps(previewWorld);
        previewWorld.step();
        const snap = env.snapshot(envState);
        // Apply the same spawn-pose snapshot to ALL bears in the population
        // so the arena shows the full lineup standing ready before training.
        const popN = sceneRef.current?.populationSize || 1;
        for (let i = 0; i < popN; i++) {
          sceneRef.current.applySnapshot(snap.bodies || snap, i);
          if (snap.joints && sceneRef.current.applyJointAngles) {
            sceneRef.current.applyJointAngles(snap.joints, i);
          }
        }
        if (snap.props && sceneRef.current.applyPropsSnapshot) {
          sceneRef.current.applyPropsSnapshot(snap.props);
        }
        if (envState.rag) window.brainEngine.destroyRagdoll(previewWorld, envState.rag);
        previewWorld.free?.();
      }
    } catch (e) {
      console.error("Preview env failed", e);
      setFailed(true);
    }

    let raf;
    let last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pb = playbackRef.current;
      const traces = pb.traces;
      if (traces && traces.length > 0) {
        pb.lastT += dt;
        const FRAME_MS = (window.brainEngine?.PHYS_DT || 1 / 60) * (window.brainEngine?.TRACE_EVERY || 3) * 1000;
        const target = Math.floor(pb.lastT * 1000 / FRAME_MS);
        if (target !== pb.idx) {
          pb.idx = target;
          // Advance every visualised bear in lockstep. Each trace can have
          // a different length (some bears fell earlier); pad with the last
          // frame so the surviving bears keep going.
          for (let i = 0; i < traces.length; i++) {
            const trace = traces[i];
            if (!trace || trace.length === 0) continue;
            const localIdx = Math.min(pb.idx, trace.length - 1);
            const frame = trace[localIdx];
            sceneRef.current?.applySnapshot(frame.bodies || frame, i);
            if (frame?.joints && sceneRef.current?.applyJointAngles) {
              sceneRef.current.applyJointAngles(frame.joints, i);
            }
            // Mark fallen on the per-bear basis when their trace ends
            if (localIdx >= trace.length - 1) sceneRef.current?.setFallen(true, i);
          }
          // Props + cue come from the first bear's trace (they're shared
          // env-level — pendulums etc. were built once per bear but the
          // top brain's run is the most relevant to watch).
          const lead = traces[0];
          if (lead) {
            const frame = lead[Math.min(pb.idx, lead.length - 1)];
            if (frame?.props && sceneRef.current?.applyPropsSnapshot) {
              sceneRef.current.applyPropsSnapshot(frame.props);
            }
            if (frame?.cue && sceneRef.current?.flashCue) {
              sceneRef.current.flashCue(frame.cue);
            }
          }
        }
      }
      sceneRef.current?.renderFrame(dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      trainerRef.current?.stop?.();
      trainerRef.current = null;
    };
    // Re-mount when the env changes (skill or level)
  }, [ready, failed, isPlaceholder, env?.id]);

  // 3. Run generations sequentially while a session is active
  React.useEffect(() => {
    if (!session || !trainerRef.current) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && session.generationsRemaining > 0) {
        const res = await trainerRef.current.runOneGeneration();
        if (!res || cancelled) break;
        setStats({ gen: res.gen, best: res.bestFitness, avg: res.avgFitness, std: res.stdFitness || 0 });
        genHistoryRef.current.push(res.bestFitness);
        if (genHistoryRef.current.length > 60) genHistoryRef.current.shift();
        _drawSparkline(sparklineRef.current, genHistoryRef.current);
        playbackRef.current = { traces: lastBestRef.current.traces || [], idx: 0, lastT: 0 };
        // Reset fallen state on every bear so the new gen plays from idle
        const popSize = sceneRef.current?.populationSize || 1;
        for (let i = 0; i < popSize; i++) sceneRef.current?.setFallen(false, i);
        session.generationsRemaining -= 1;
        setSession({ ...session });
        // Use the LONGEST trace to set playback duration (so the surviving
        // bear's full run is visible before the next gen kicks).
        const longest = (playbackRef.current.traces || []).reduce((m, t) => Math.max(m, t?.length || 0), 0);
        const playMs = Math.min(2200, longest * 50 + 400);
        await new Promise((r) => setTimeout(r, playMs));
      }
      if (!cancelled) {
        const best = lastBestRef.current.brain;
        if (best && env) {
          const mastered = stats.best >= (env.theoreticalMax || 1) * 0.8;
          const json = window.brainEngine.brainToJSON(best, {
            skillId, level,
            envId: env.id,
            gen: stats.gen,
            fitness: stats.best,
            mastered,
          });
          onBrainSaved?.(brainKey, json);
          if (mastered) {
            onToast?.(`${tree?.name} L${level} MASTERED · best ${stats.best.toFixed(2)}s · ` +
              (level < 3 ? `next: L${level + 1}` : "skill complete"));
          }
        }
        setSession(null);
        onToast?.(`${tree?.name} L${level} session done · gen ${stats.gen} · best ${stats.best.toFixed(2)}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.startedAt]);

  function startSession(pack) {
    if (session || !env || isPlaceholder) return;
    if (!ready) { onToast?.("Physics engine still loading…"); return; }
    if (profile.currency.coins < pack.cost) {
      onToast?.(`Not enough coins · need ${pack.cost}, have ${profile.currency.coins}`);
      return;
    }
    onSpendCoins(pack.cost);
    // Seed from saved brain (only if arch matches the new env)
    const seedJson = existingBrain;
    const seed = seedJson ? window.brainEngine.brainFromJSON(seedJson) : null;
    lastBestRef.current = { brain: null, traces: null, fitness: 0 };
    const visPop = sceneRef.current?.populationSize || 1;
    const t = window.brainEngine.startTrainer({
      env,
      population: 16,
      visPopulation: visPop,
      seedBrain: seed,
      onGenerationDone: ({ gen, bestFitness, avgFitness, bestBrain, traces }) => {
        lastBestRef.current = { brain: bestBrain, traces, fitness: bestFitness };
      },
    });
    trainerRef.current = t;
    setStats({ gen: 0, best: 0, avg: 0, std: 0 });
    genHistoryRef.current = [];
    setSession({
      generationsRemaining: pack.gens,
      generationsTotal: pack.gens,
      startedAt: performance.now(),
    });
    onToast?.(`Training ${tree?.name} L${level} · ${pack.gens} generations`);
  }

  // -------- All hooks above. Early returns below. --------

  if (failed) {
    const err = window.RAPIER_ERROR;
    const code = err?.message || String(err || "unknown");
    const isEmailObfuscation = /email[%-_]?(20)?protected/i.test(code);
    return (
      <div className="card" style={{ padding: 20 }}>
        <div className="card__label">Training unavailable</div>
        <div className="mono tiny" style={{ color: "var(--ink-2)", marginTop: 8, lineHeight: 1.6 }}>
          The Rapier physics engine failed to load.<br />
          {isEmailObfuscation ? (
            <>
              Your network is doing <b>email-obfuscation rewriting</b> on the
              CDN URL. Disable any privacy / anti-tracking browser extension
              for this site, or open the site in a clean incognito window.<br />
            </>
          ) : null}
          <span style={{ color: "var(--magenta)" }}>{code}</span>
        </div>
      </div>
    );
  }

  if (isPlaceholder) {
    return (
      <>
        <div className="training-stage" style={{ display: "grid", placeItems: "center" }}>
          <div style={{ textAlign: "center", padding: 32 }}>
            <div className="mono" style={{ color: "var(--mint)", letterSpacing: "0.2em", marginBottom: 8 }}>
              COMING SOON
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--ink-0)", marginBottom: 6 }}>
              {tree?.name} · Level {level}
            </div>
            <div className="mono tiny" style={{ color: "var(--ink-2)", maxWidth: 420, lineHeight: 1.5 }}>
              The training environment for this skill is the next round
              of work. The skill is unlocked — its physics course will
              ship soon. In the meantime, master deeper levels of
              earlier skills.
            </div>
          </div>
        </div>
      </>
    );
  }

  const pctDone = session
    ? 1 - (session.generationsRemaining / session.generationsTotal)
    : 0;
  const fitnessPctOfMax = env?.theoreticalMax ? (stats.best / env.theoreticalMax) * 100 : 0;
  const masteredSoFar = stats.best >= (env?.theoreticalMax || 1) * 0.8;

  return (
    <>
      <div className="training-stage">
        <div ref={stageRef} className="three-mount" />

        <div className="training-hud">
          <div className="training-hud__tag">
            <span className="chip__dot" style={{
              background: session ? "var(--mint)" : "var(--ink-3)",
              animation: session ? "pulse 1.4s infinite" : "none",
            }} />
            {session
              ? `LEARNING · ${(tree?.name || skillId).toUpperCase()} L${level}`
              : ready
                ? `READY · ${(tree?.name || skillId).toUpperCase()} L${level}`
                : `BOOTING PHYSICS…`}
          </div>
          <div className="training-hud__tag">
            GEN {stats.gen}
            {stats.best > 0 && <span style={{ color: "var(--mint)", marginLeft: 6 }}>↑{(stats.best - (lastBestRef.current?.fitness || 0)).toFixed(2)}</span>}
          </div>
        </div>
        {/* Physics indicator pinned bottom-right */}
        <div className="training-physics-tag">
          g = 9.81 m/s² ↓
        </div>

        {session && (
          <div className="training-ticker">
            <div className="training-ticker__row">
              <span className="mono tiny" style={{ color: "var(--ink-2)" }}>
                BEST {stats.best.toFixed(2)} · AVG {stats.avg.toFixed(2)} · σ {stats.std.toFixed(2)} · MAX {env?.theoreticalMax?.toFixed?.(1) || "?"}
              </span>
              <span className="mono tiny" style={{ color: masteredSoFar ? "var(--mint)" : "var(--ink-3)" }}>
                {masteredSoFar ? "★ MASTERED" : `${Math.floor(fitnessPctOfMax)}% to mastery`}
              </span>
            </div>
            <canvas ref={sparklineRef} className="training-sparkline" />
            <div className="training-ticker__bar">
              <div className="training-ticker__bar-fill" style={{ width: `${pctDone * 100}%` }} />
            </div>
            <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
              {session.generationsTotal - session.generationsRemaining} / {session.generationsTotal} generations
              {" · "} {env?.trainerConfig?.population ?? 16} brains evaluated per generation
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div>
            <div className="card__title">{tree?.name} · L{level}</div>
            <div className="mono tiny" style={{ color: "var(--ink-2)" }}>
              {tree?.levels?.[level - 1]?.desc}
              {existingBrain?.meta?.gen ? (
                <> · loaded gen {existingBrain.meta.gen} ({(existingBrain.meta.fitness ?? 0).toFixed?.(2)})</>
              ) : null}
              {existingBrain?.meta?.mastered ? " · ★ mastered" : null}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {existingBrain ? (
              <>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  disabled={!!session || !ready}
                  onClick={() => {
                    // Run the saved brain once with trace recording and feed
                    // it into the multi-bear playback. All 4 bears show the
                    // SAME brain so the learned gait is easy to read.
                    if (!env || !window.brainEngine) return;
                    try {
                      const b = window.brainEngine.brainFromJSON(existingBrain);
                      const res = window.brainEngine.evalEnv(env, b, { recordTrace: true });
                      const popN = sceneRef.current?.populationSize || 1;
                      const traces = Array.from({ length: popN }, () => res.trace);
                      playbackRef.current = { traces, idx: 0, lastT: 0 };
                      for (let i = 0; i < popN; i++) sceneRef.current?.setFallen(false, i);
                      onToast?.(`Replaying best brain · fitness ${res.fitness.toFixed(2)}`);
                    } catch (e) {
                      console.error("Play best brain failed", e);
                      onToast?.("Couldn't replay this brain");
                    }
                  }}
                  title="Re-run this saved brain in the arena (no coin cost)"
                >▶ Play best brain</button>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify(existingBrain, null, 2)],
                      { type: "application/json" }
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `bear-brain-${skillId}-L${level}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    onToast?.(`Exported bear-brain-${skillId}-L${level}.json`);
                  }}
                  title="Download this trained brain as portable JSON"
                >↓ Export brain</button>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "4px 8px", fontSize: 10, color: "var(--ink-3)" }}
                  disabled={!!session}
                  onClick={() => {
                    if (!confirm(`Reset saved brain for ${tree?.name} L${level}? This clears the trained weights so you can start fresh.`)) return;
                    onBrainSaved?.(brainKey, null);
                    onToast?.(`${tree?.name} L${level} brain reset`);
                  }}
                  title="Clear the saved brain for this skill (only needed if monotonic save got stuck on a bad brain)"
                >↺ Reset</button>
              </>
            ) : null}
            <div className="mono tiny" style={{ color: "var(--amber)", alignSelf: "center" }}>
              ◈ {profile.currency.coins.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="training-packs">
          {SKILL_TRAINER_PACKS.map((p) => {
            const afford = profile.currency.coins >= p.cost;
            const disabled = !!session || !ready || !afford;
            return (
              <button
                key={p.id}
                className={`training-pack ${disabled ? "is-disabled" : ""}`}
                onClick={() => startSession(p)}
                disabled={disabled}
                title={!ready ? "Physics still loading" : !afford ? `Need ${p.cost - profile.currency.coins} more coins` : ""}
              >
                <div className="training-pack__label">{p.label}</div>
                <div className="training-pack__gens">{p.gens} gens</div>
                <div className="training-pack__cost">◈ {p.cost}</div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { SkillTrainer });
