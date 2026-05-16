/* ============================================================
   BRAINWORK ROYALE — TRAINING CENTER
   AI Warehouse-style: pick a skill, spend coins to run more
   "generations", watch the agent practice. Trained skill levels
   feed into sim.jsx and actually change battle outcomes.

   NOTE: the "generation count" is mocked for now — we don't run
   real NEAT in the browser yet. The data layer is shaped so a
   future round can plug in actual neataptic / TF.js training.
   ============================================================ */

function TrainingScreen({ uid, ai, skills, profile, onSkillProgress, onSpendCoins, onToast }) {
  const SKILL_DEFS = window.dataLayer?.SKILL_DEFS || [];
  const LEVEL_GENS = window.dataLayer?.LEVEL_GENS || [0, 50, 200, 500];
  const TRAINING_PACKS = window.dataLayer?.TRAINING_PACKS || [];
  const MAX_LEVEL = window.dataLayer?.MAX_LEVEL || 3;

  const [activeId, setActiveId] = React.useState(SKILL_DEFS[0]?.id || "walk");
  const [training, setTraining] = React.useState(null); // { skillId, fromGens, toGens, startedAt, durationMs }
  const stageRef = React.useRef(null);
  const sceneRef = React.useRef(null);

  const activeDef = SKILL_DEFS.find((s) => s.id === activeId) || SKILL_DEFS[0];
  const activeSkill = skills?.[activeId] || { id: activeId, level: 0, generation: 0 };

  // Build the 3D training scene once, swap animation when active skill changes.
  React.useEffect(() => {
    if (!stageRef.current) return;
    sceneRef.current = window.createTrainingScene(stageRef.current, ai.class);
    sceneRef.current.setSkill("Idle 01", 1);

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
  }, [ai.class]);

  // Swap the practice animation when the selected skill changes
  React.useEffect(() => {
    if (!sceneRef.current || !activeDef) return;
    sceneRef.current.setSkill(activeDef.anim, 1.0);
    sceneRef.current.setProgress(0);
  }, [activeId, activeDef]);

  // Drive the training animation (speed ramp + progress ring) while a pack is running
  React.useEffect(() => {
    if (!training || !sceneRef.current) return;
    let raf;
    const startedAt = training.startedAt;
    const tick = () => {
      const now = performance.now();
      const t = Math.min(1, (now - startedAt) / training.durationMs);
      sceneRef.current?.setProgress(t);
      // Speed ramps from 0.45x → 1.25x to feel like the AI gets better
      sceneRef.current?.setSpeed(0.45 + t * 0.8);
      if (t < 1) raf = requestAnimationFrame(tick);
      else finishTraining();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training]);

  function finishTraining() {
    if (!training) return;
    const { skillId, fromGens, toGens } = training;
    const newLevel = window.dataLayer.levelForGens(toGens);
    const oldLevel = window.dataLayer.levelForGens(fromGens);
    onSkillProgress(skillId, { generation: toGens, level: newLevel, leveledUp: newLevel > oldLevel });
    setTraining(null);
    if (sceneRef.current) {
      sceneRef.current.setProgress(0);
      sceneRef.current.setSpeed(1);
    }
  }

  function buyPack(pack) {
    if (training) return; // ignore during in-flight training
    if (profile.currency.coins < pack.cost) {
      onToast(`⚠ Not enough coins · need ${pack.cost}, have ${profile.currency.coins}`);
      return;
    }
    onSpendCoins(pack.cost);
    const fromGens = activeSkill.generation || 0;
    const toGens = fromGens + pack.gens;
    setTraining({
      skillId: activeId,
      fromGens,
      toGens,
      startedAt: performance.now(),
      // Visual duration: scaled by pack size, capped so big packs don't drag forever.
      durationMs: Math.min(5500, 1500 + pack.gens * 8),
    });
    onToast(`Training ${activeDef.name} · ${pack.gens} gens…`);
  }

  const meta = (
    <>
      <span><span className="dot" />{Object.values(skills || {}).filter((s) => s.level >= MAX_LEVEL).length} mastered</span>
      <span>{profile.currency.coins.toLocaleString()} coins</span>
    </>
  );

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
                    onClick={() => setActiveId(def.id)}
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
              Training simulations are illustrative. Real NEAT runs land
              once the project moves to a build pipeline — your skill
              levels carry over.
            </div>
          </div>

          {/* RIGHT — arena + train controls */}
          <div className="training-main">
            <div className="training-stage">
              <div ref={stageRef} className="three-mount" />

              <div className="training-hud">
                <div className="training-hud__tag">
                  <span className="chip__dot" style={{ background: training ? "var(--mint)" : "var(--ink-3)", animation: training ? "pulse 1.4s infinite" : "none" }} />
                  {training ? `TRAINING · ${activeDef.name.toUpperCase()}` : `READY · ${activeDef.name.toUpperCase()}`}
                </div>
                <div className="training-hud__tag">
                  GEN {training ? Math.floor(training.fromGens + (training.toGens - training.fromGens) * ((performance.now() - training.startedAt) / training.durationMs)) : activeSkill.generation}
                </div>
              </div>
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
                  const disabled = !!training || !afford;
                  return (
                    <button
                      key={p.id}
                      className={`training-pack ${disabled ? "is-disabled" : ""}`}
                      onClick={() => buyPack(p)}
                      disabled={disabled}
                      title={!afford ? `Need ${p.cost - profile.currency.coins} more coins` : ""}
                    >
                      <div className="training-pack__label">{p.label}</div>
                      <div className="training-pack__gens">+{p.gens} gens</div>
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
