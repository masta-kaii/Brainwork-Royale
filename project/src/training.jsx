/* ============================================================
   BRAINWORK ROYALE — TRAINING CENTER (live trial loop)
   AI Warehouse-style: pick a skill, buy a session, watch the
   agent attempt the skill in real time — succeed and stumble
   in turn. Each trial advances the skill's generation count;
   fitness gauge fills toward the next level threshold.

   Notes
   ----
   - "Generations" are still simulated; this is a watchable
     mockup, not real NEAT. Data layer is shaped so a future
     round can plug in real neataptic / TF.js training.
   - Trial outcomes drive both the data (gens) and the visuals
     (clean anim vs. stumble cross-fade).
   ============================================================ */

const TRIAL_MS = 600;                    // one trial every 600 ms
const PACK_TRIAL_COUNT = { quick: 20, session: 80, marathon: 200 };

function trialSuccessChance(level, progressTowardNext) {
  // Base 35% chance, +18% per level, +up to 30% as we approach next-level
  const p = 0.35 + (level || 0) * 0.18 + (progressTowardNext || 0) * 0.3;
  return Math.max(0.05, Math.min(0.92, p));
}

function TrainingScreen({ uid, ai, skills, profile, onSkillProgress, onSpendCoins, onToast }) {
  const SKILL_DEFS = window.dataLayer?.SKILL_DEFS || [];
  const LEVEL_GENS = window.dataLayer?.LEVEL_GENS || [0, 50, 200, 500];
  const TRAINING_PACKS = window.dataLayer?.TRAINING_PACKS || [];
  const MAX_LEVEL = window.dataLayer?.MAX_LEVEL || 3;

  const [activeId, setActiveId] = React.useState(SKILL_DEFS[0]?.id || "walk");
  const [session, setSession] = React.useState(null); // { skillId, trialsRemaining, trialsTotal, gensEarned, packGens, startedAt }
  const [trialLog, setTrialLog] = React.useState([]); // recent { ok, t }
  const sessionRef = React.useRef(null);    // mirror of session for the interval handler
  const stageRef = React.useRef(null);
  const sceneRef = React.useRef(null);

  const activeDef = SKILL_DEFS.find((s) => s.id === activeId) || SKILL_DEFS[0];
  const activeSkill = skills?.[activeId] || { id: activeId, level: 0, generation: 0 };

  // Build the 3D training scene once per AI class
  React.useEffect(() => {
    if (!stageRef.current) return;
    sceneRef.current = window.createTrainingScene(stageRef.current, ai.class);
    sceneRef.current.setSkill("Idle 01", 1);
    sceneRef.current.setSkillCourse?.(activeId);

    let raf;
    let last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      sceneRef.current?.renderFrame(dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.class]);

  // Swap the practice animation + course when the selected skill changes
  React.useEffect(() => {
    if (!sceneRef.current || !activeDef) return;
    // Course rebuild is cheap and visually grounds the trial loop
    sceneRef.current.setSkillCourse?.(activeId);
    if (!session) {
      sceneRef.current.setSkill(activeDef.anim, 0.85);
      sceneRef.current.setProgress(0);
    }
  }, [activeId, activeDef, session]);

  // Trial loop — runs while a session is active. Every TRIAL_MS, run one trial.
  React.useEffect(() => {
    if (!session) return;
    sessionRef.current = session;
    // Play the skill anim at a speed scaled by current level (sells "getting better")
    const level = (skills?.[session.skillId]?.level || 0);
    sceneRef.current?.setSkill(activeDef.anim, 0.55 + level * 0.22);

    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;

      // Compute progress toward next level for this skill's CURRENT state
      const curSkill = skills?.[s.skillId] || { level: 0, generation: 0 };
      const lvl = curSkill.level || 0;
      const baseGens = LEVEL_GENS[lvl] || 0;
      const nextGens = LEVEL_GENS[Math.min(lvl + 1, MAX_LEVEL)] || 9999;
      const fromGens = (curSkill.generation || 0) + s.gensEarned;
      const progressTowardNext = (fromGens - baseGens) / Math.max(1, nextGens - baseGens);
      const chance = trialSuccessChance(lvl, progressTowardNext);

      const ok = Math.random() < chance;
      sceneRef.current?.markTrial(ok);

      // Each success contributes +1 gen; failures still chip in 0.3.
      const gensThisTrial = ok ? 1 : 0.3;
      const newGensEarned = s.gensEarned + gensThisTrial;

      // Update the gauge (fitness in [0..1] toward next-level threshold)
      const totalGensNow = (curSkill.generation || 0) + newGensEarned;
      const fitnessPct = Math.min(1, Math.max(0, (totalGensNow - baseGens) / Math.max(1, nextGens - baseGens)));
      sceneRef.current?.setProgress(fitnessPct);

      const remaining = s.trialsRemaining - 1;
      const finished = remaining <= 0;

      // Append to ticker (keep last 6)
      setTrialLog((log) => [{ ok, t: Date.now() }, ...log].slice(0, 6));

      // Update session state (and ref for next tick)
      const nextSession = {
        ...s,
        trialsRemaining: remaining,
        gensEarned: newGensEarned,
      };
      sessionRef.current = finished ? null : nextSession;
      setSession(finished ? null : nextSession);

      if (finished) {
        clearInterval(id);
        finalize(s.skillId, curSkill.generation || 0, newGensEarned);
      }
    }, TRIAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.startedAt]);

  function finalize(skillId, fromGens, gensEarned) {
    const newGens = Math.round(fromGens + gensEarned);
    const newLevel = window.dataLayer.levelForGens(newGens);
    const oldLevel = window.dataLayer.levelForGens(fromGens);
    onSkillProgress(skillId, {
      generation: newGens,
      level: newLevel,
      leveledUp: newLevel > oldLevel,
    });
    if (sceneRef.current) {
      sceneRef.current.setProgress(0);
      sceneRef.current.setSpeed(1);
      // Return to a clean idle posture between sessions
      sceneRef.current.setSkill(activeDef.anim, 0.85);
    }
  }

  function buyPack(pack) {
    if (session) return; // ignore mid-session
    if (profile.currency.coins < pack.cost) {
      onToast(`⚠ Not enough coins · need ${pack.cost}, have ${profile.currency.coins}`);
      return;
    }
    onSpendCoins(pack.cost);
    const trialsTotal = PACK_TRIAL_COUNT[pack.id] || 20;
    setTrialLog([]);
    setSession({
      skillId: activeId,
      trialsRemaining: trialsTotal,
      trialsTotal,
      gensEarned: 0,
      packGens: pack.gens,
      startedAt: performance.now(),
    });
    onToast(`Training ${activeDef.name} · ${trialsTotal} trials`);
  }

  const meta = (
    <>
      <span><span className="dot" />{Object.values(skills || {}).filter((s) => s.level >= MAX_LEVEL).length} mastered</span>
      <span>{profile.currency.coins.toLocaleString()} coins</span>
    </>
  );

  // Live HUD values
  const currentLvl = activeSkill.level || 0;
  const baseGens = LEVEL_GENS[currentLvl] || 0;
  const nextGens = LEVEL_GENS[Math.min(currentLvl + 1, MAX_LEVEL)] || 9999;
  const liveGens = (activeSkill.generation || 0) + (session?.gensEarned || 0);
  const livePct = currentLvl >= MAX_LEVEL ? 100
    : Math.min(100, Math.max(0, ((liveGens - baseGens) / Math.max(1, nextGens - baseGens)) * 100));
  const trialsLeft = session?.trialsRemaining ?? 0;
  const trialsDone = session ? session.trialsTotal - session.trialsRemaining : 0;

  return (
    <>
      <PageHeader
        eyebrow="AI WAREHOUSE · skill training"
        title="Training"
        meta={meta}
      />
      <div className="page-body">
        <div className="training-wrap">
          {/* LEFT — skill list */}
          <div className="training-side">
            <div className="card card--inset" style={{ marginBottom: 12 }}>
              <div className="card__label">Active AI</div>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 44, flexShrink: 0 }}>
                  <BearPortrait cls={ai.class} />
                </div>
                <div>
                  <div style={{ color: "var(--ink-0)", fontWeight: 700 }}>{ai.name}</div>
                  <div className="mono tiny" style={{ color: "var(--mint)" }}>
                    GEN #{ai.generation} · {(window.CLASSES?.[ai.class]?.role || ai.class).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>

            <SectionTitle>Skills</SectionTitle>
            <div className="skill-list">
              {SKILL_DEFS.map((def) => {
                const s = skills?.[def.id] || { level: 0, generation: 0 };
                const nextTarget = LEVEL_GENS[Math.min(s.level + 1, MAX_LEVEL)];
                const pct = s.level >= MAX_LEVEL
                  ? 100
                  : Math.min(100, Math.max(0, ((s.generation - LEVEL_GENS[s.level]) / (nextTarget - LEVEL_GENS[s.level])) * 100));
                const isActive = def.id === activeId;
                const mastered = s.level >= MAX_LEVEL;
                return (
                  <div
                    key={def.id}
                    className={`skill-card ${isActive ? "is-active" : ""} ${mastered ? "is-mastered" : ""}`}
                    onClick={() => !session && setActiveId(def.id)}
                  >
                    <div className="skill-card__glyph">{def.glyph}</div>
                    <div className="skill-card__body">
                      <div className="row between">
                        <div className="skill-card__name">{def.name}</div>
                        <div className="mono tiny" style={{ color: mastered ? "var(--mint)" : "var(--ink-3)" }}>
                          {mastered ? "MASTERED" : `L${s.level} / ${MAX_LEVEL}`}
                        </div>
                      </div>
                      <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
                        {s.generation} gens · +{def.stat.toUpperCase()}
                      </div>
                      <div className="quest-item__progress" style={{ marginTop: 4 }}>
                        <div className="quest-item__progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mono tiny" style={{ color: "var(--ink-3)", marginTop: 12, lineHeight: 1.5 }}>
              Each trial is a live attempt — successes ramp confidence, stumbles cost time. Train more to push past the next level threshold.
            </div>
          </div>

          {/* RIGHT — arena + train controls */}
          <div className="training-main">
            <div className="training-stage">
              <div ref={stageRef} className="three-mount" />

              <div className="training-hud">
                <div className="training-hud__tag">
                  <span className="chip__dot" style={{
                    background: session ? "var(--mint)" : "var(--ink-3)",
                    animation: session ? "pulse 1.4s infinite" : "none",
                  }} />
                  {session ? `LIVE TRAINING · ${activeDef.name.toUpperCase()}` : `READY · ${activeDef.name.toUpperCase()}`}
                </div>
                <div className="training-hud__tag">
                  GEN {Math.round(liveGens)}
                </div>
              </div>

              {/* Live trial ticker overlay on arena */}
              {session && (
                <div className="training-ticker">
                  <div className="training-ticker__row">
                    <span className="mono tiny" style={{ color: "var(--ink-2)" }}>
                      TRIAL {trialsDone} / {session.trialsTotal}
                    </span>
                    <div className="training-ticker__chips">
                      {trialLog.map((tr, i) => (
                        <span
                          key={i}
                          className={`training-ticker__chip ${tr.ok ? "ok" : "fail"}`}
                          style={{ opacity: 1 - i * 0.14 }}
                          title={tr.ok ? "success" : "stumble"}
                        >{tr.ok ? "✓" : "✗"}</span>
                      ))}
                    </div>
                  </div>
                  <div className="training-ticker__bar">
                    <div className="training-ticker__bar-fill" style={{ width: `${livePct}%` }} />
                  </div>
                  <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
                    Fitness toward L{Math.min(currentLvl + 1, MAX_LEVEL)} · {Math.floor(livePct)}%
                  </div>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <div>
                  <div className="card__title">{activeDef.name}</div>
                  <div className="mono tiny" style={{ color: "var(--ink-2)" }}>{activeDef.blurb}</div>
                </div>
                <div className="mono tiny" style={{ color: "var(--amber)" }}>
                  ◈ {profile.currency.coins.toLocaleString()}
                </div>
              </div>

              <div className="training-packs">
                {TRAINING_PACKS.map((p) => {
                  const afford = profile.currency.coins >= p.cost;
                  const disabled = !!session || !afford;
                  return (
                    <button
                      key={p.id}
                      className={`training-pack ${disabled ? "is-disabled" : ""}`}
                      onClick={() => buyPack(p)}
                      disabled={disabled}
                      title={!afford ? `Need ${p.cost - profile.currency.coins} more coins` : ""}
                    >
                      <div className="training-pack__label">{p.label}</div>
                      <div className="training-pack__gens">{PACK_TRIAL_COUNT[p.id] || 20} trials</div>
                      <div className="training-pack__cost">◈ {p.cost}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { TrainingScreen });
