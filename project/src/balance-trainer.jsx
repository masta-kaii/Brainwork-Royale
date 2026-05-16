/* ============================================================
   BRAINWORK ROYALE — BALANCE TRAINER (Stage 0)
   Owns the training session for the Balance "skill":
     - mounts a ragdoll scene (scene3d.mountRagdollScene)
     - runs window.brainEngine.startTrainer({...})
     - plays the BEST genome's trace in the arena each generation
     - persists the best brain to /users/{uid}/brains/balance
   ============================================================ */

function BalanceTrainer({ uid, profile, brains, onSpendCoins, onToast, onBrainSaved }) {
  const stageRef = React.useRef(null);
  const sceneRef = React.useRef(null);
  const trainerRef = React.useRef(null);
  const lastBestRef = React.useRef({ brain: null, trace: null });
  const playbackRef = React.useRef({ trace: null, idx: 0, lastT: 0 });
  const [session, setSession] = React.useState(null); // { generationsRemaining, packId, packLabel }
  const [stats, setStats] = React.useState({ gen: 0, best: 0, avg: 0 });
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Wait for Rapier (or note it failed)
  React.useEffect(() => {
    if (window.RAPIER_FAILED) { setFailed(true); return; }
    if (window.brainEngine?.isReady?.()) {
      setReady(true);
    } else {
      const onR = () => {
        if (window.RAPIER_FAILED) setFailed(true);
        else setReady(true);
      };
      window.addEventListener("rapier-ready", onR, { once: true });
      return () => window.removeEventListener("rapier-ready", onR);
    }
  }, []);

  // Mount the 3D scene
  React.useEffect(() => {
    if (!stageRef.current || !ready || failed) return;
    sceneRef.current = window.mountRagdollScene(stageRef.current);

    // Show a static spawn pose right away so the arena isn't empty
    try {
      if (window.brainEngine?.isReady?.()) {
        const previewWorld = window.brainEngine.makeWorld();
        const rag = window.brainEngine.createRagdoll(previewWorld);
        previewWorld.step();
        const snap = {};
        for (const [name, b] of Object.entries(rag.bodies)) {
          const t = b.translation(), r = b.rotation();
          snap[name] = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
        }
        sceneRef.current.applySnapshot(snap);
        window.brainEngine.destroyRagdoll(previewWorld, rag);
        previewWorld.free?.();
      }
    } catch (e) {
      console.error("Preview ragdoll failed", e);
      setFailed(true);
    }

    let raf;
    let last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pb = playbackRef.current;
      if (pb.trace && pb.trace.length > 0) {
        pb.lastT += dt;
        const FRAME_MS = (window.brainEngine?.PHYS_DT || 1 / 60) * 3 * 1000;
        const target = Math.floor(pb.lastT * 1000 / FRAME_MS);
        if (target !== pb.idx) {
          pb.idx = Math.min(target, pb.trace.length - 1);
          sceneRef.current?.applySnapshot(pb.trace[pb.idx]);
          if (pb.idx >= pb.trace.length - 1) {
            sceneRef.current?.setFallen(true);
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
  }, [ready, failed]);

  // Run generations sequentially while a session is active
  React.useEffect(() => {
    if (!session || !trainerRef.current) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && session.generationsRemaining > 0) {
        const res = await trainerRef.current.runOneGeneration();
        if (!res || cancelled) break;
        setStats({ gen: res.gen, best: res.bestFitness, avg: res.avgFitness });
        playbackRef.current = { trace: lastBestRef.current.trace || [], idx: 0, lastT: 0 };
        sceneRef.current?.setFallen(false);
        session.generationsRemaining -= 1;
        setSession({ ...session });
        const playMs = Math.min(2200, (playbackRef.current.trace?.length || 0) * 50 + 400);
        await new Promise((r) => setTimeout(r, playMs));
      }
      if (!cancelled) {
        const best = lastBestRef.current.brain;
        if (best) {
          const json = window.brainEngine.brainToJSON(best, {
            stage: "balance",
            gen: stats.gen,
            fitness: stats.best,
          });
          onBrainSaved?.("balance", json);
        }
        setSession(null);
        onToast?.(`Balance training complete · gen ${stats.gen} · best ${stats.best.toFixed(2)}s`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.startedAt]);

  function startSession(packId, packLabel, generations, cost) {
    if (session) return;
    if (!ready) { onToast?.("Physics engine still loading…"); return; }
    if (profile.currency.coins < cost) {
      onToast?.(`Not enough coins · need ${cost}, have ${profile.currency.coins}`);
      return;
    }
    onSpendCoins(cost);
    const seed = brains?.balance ? window.brainEngine.brainFromJSON(brains.balance) : null;
    lastBestRef.current = { brain: null, trace: null };
    const t = window.brainEngine.startTrainer({
      population: 16,
      seedBrain: seed,
      onGenerationDone: ({ gen, bestFitness, avgFitness, bestBrain, bestTrace }) => {
        lastBestRef.current = { brain: bestBrain, trace: bestTrace };
      },
    });
    trainerRef.current = t;
    setStats({ gen: 0, best: 0, avg: 0 });
    setSession({
      packId, packLabel,
      generationsRemaining: generations,
      generationsTotal: generations,
      startedAt: performance.now(),
    });
    onToast?.(`Training Balance · ${generations} generations`);
  }

  // -------- All hooks above. Early returns below. --------

  if (failed) {
    const err = window.RAPIER_ERROR;
    const code = err?.message || String(err || "unknown");
    return (
      <div className="card" style={{ padding: 20 }}>
        <div className="card__label">Balance training unavailable</div>
        <div className="mono tiny" style={{ color: "var(--ink-2)", marginTop: 8, lineHeight: 1.6 }}>
          The Rapier physics engine failed to load
          {code === "init-timeout" ? " (timed out after 20s — slow network or CDN issue)" : ""}.
          <br /><br />
          Things to try:
          <ul style={{ margin: "8px 0 0 20px", padding: 0 }}>
            <li>Hard-refresh: Ctrl/Cmd + Shift + R</li>
            <li>Try a different browser (Chrome / Firefox / Safari latest)</li>
            <li>Open DevTools → Console and paste the red error here so we can pin it down</li>
          </ul>
          <div style={{ marginTop: 10, color: "var(--ink-3)" }}>
            Error: <span style={{ color: "var(--magenta)" }}>{code}</span>
          </div>
        </div>
      </div>
    );
  }

  // Pack definitions for this skill (small / medium / large generation counts)
  const PACKS = [
    { id: "quick",    label: "Quick set",    gens: 10,  cost: 100 },
    { id: "session",  label: "Full session", gens: 40,  cost: 350 },
    { id: "marathon", label: "Marathon",     gens: 100, cost: 800 },
  ];

  const sessionPctDone = session
    ? 1 - (session.generationsRemaining / session.generationsTotal)
    : 0;

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
            {session ? `LEARNING TO BALANCE` : ready ? `READY · BALANCE` : `BOOTING PHYSICS…`}
          </div>
          <div className="training-hud__tag">
            GEN {stats.gen}
          </div>
        </div>

        {session && (
          <div className="training-ticker">
            <div className="training-ticker__row">
              <span className="mono tiny" style={{ color: "var(--ink-2)" }}>
                BEST {stats.best.toFixed(2)}s · AVG {stats.avg.toFixed(2)}s
              </span>
              <span className="mono tiny" style={{ color: "var(--ink-3)" }}>
                {session.generationsTotal - session.generationsRemaining} / {session.generationsTotal}
              </span>
            </div>
            <div className="training-ticker__bar">
              <div className="training-ticker__bar-fill" style={{ width: `${sessionPctDone * 100}%` }} />
            </div>
            <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
              Each generation evaluates 16 brains. Best one's attempt is playing in the arena.
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div>
            <div className="card__title">Balance</div>
            <div className="mono tiny" style={{ color: "var(--ink-2)" }}>
              Real neuroevolution. Ragdoll learns to stay upright. Brain weights persist + export.
              {brains?.balance ? ` · loaded gen ${brains.balance.meta?.gen ?? "?"} (${(brains.balance.meta?.fitness ?? 0).toFixed?.(2)}s)` : ""}
            </div>
          </div>
          <div className="mono tiny" style={{ color: "var(--amber)" }}>
            ◈ {profile.currency.coins.toLocaleString()}
          </div>
        </div>

        <div className="training-packs">
          {PACKS.map((p) => {
            const afford = profile.currency.coins >= p.cost;
            const disabled = !!session || !ready || !afford;
            return (
              <button
                key={p.id}
                className={`training-pack ${disabled ? "is-disabled" : ""}`}
                onClick={() => startSession(p.id, p.label, p.gens, p.cost)}
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

Object.assign(window, { BalanceTrainer });
