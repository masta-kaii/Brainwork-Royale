/* ============================================================
   BRAINWORK ROYALE — TRAINING CENTER
   Skill-tree-driven training UI. Each skill has 3 levels, each
   level has its own physics course. Skills are gated behind
   their prereq's L3 mastery.

   Curriculum data lives in window.skillTree.
   Per-(skill, level) physics envs live in window.trainingEnvs.
   Real training runs through <SkillTrainer/>.
   ============================================================ */

function TrainingScreen({ uid, ai, brains, profile, onSpendCoins, onToast, onBrainSaved }) {
  const tree = window.skillTree?.SKILL_TREE || {};
  const SKILL_ORDER = window.skillTree?.SKILL_ORDER || [];
  const isUnlocked = window.skillTree?.isUnlocked || (() => false);
  const isLevelMastered = window.skillTree?.isLevelMastered || (() => false);
  const highestTrainable = window.skillTree?.highestTrainableLevel || (() => 0);
  const prereqName = window.skillTree?.prereqName || (() => null);
  const brainKey = window.skillTree?.brainKey || ((s, l) => `${s}-L${l}`);

  // Default-select Balance (first skill in order) at the highest trainable level.
  const [activeSkill, setActiveSkill] = React.useState("balance");
  const [activeLevel, setActiveLevel] = React.useState(1);

  // When the active skill changes, auto-pick highest trainable level for it
  React.useEffect(() => {
    const lvl = Math.max(1, highestTrainable(brains, activeSkill));
    setActiveLevel(lvl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSkill]);

  const masteredCount = Object.entries(tree).filter(([sid]) => isLevelMastered(brains, sid, 3)).length;
  const totalCount = SKILL_ORDER.length;

  const activeUnlocked = isUnlocked(brains, activeSkill);
  const activeDef = tree[activeSkill];

  // Demo toggle — persisted in sessionStorage so it survives navigation
  // within the session but resets on tab close. Lets you audit the whole
  // curriculum without grinding through prereqs.
  const [demoUnlock, setDemoUnlock] = React.useState(() => {
    if (typeof window === "undefined") return false;
    if (sessionStorage.getItem("DEMO_UNLOCK_ALL") === "1") {
      window.DEMO_UNLOCK_ALL = true;
      return true;
    }
    return !!window.DEMO_UNLOCK_ALL;
  });
  const toggleDemoUnlock = () => {
    const next = !demoUnlock;
    window.DEMO_UNLOCK_ALL = next;
    if (next) sessionStorage.setItem("DEMO_UNLOCK_ALL", "1");
    else      sessionStorage.removeItem("DEMO_UNLOCK_ALL");
    setDemoUnlock(next);
  };

  return (
    <>
      <PageHeader
        eyebrow="AI WAREHOUSE · curriculum training"
        title="Training"
        meta={
          <>
            <span><span className="dot" />{masteredCount} / {totalCount} skills mastered</span>
            <span>{profile.currency.coins.toLocaleString()} coins</span>
            <span
              onClick={toggleDemoUnlock}
              style={{
                cursor: "pointer",
                color: demoUnlock ? "var(--mint)" : "var(--ink-3)",
                border: "1px solid " + (demoUnlock ? "var(--mint)" : "var(--line)"),
                padding: "2px 8px", borderRadius: 4,
                fontSize: 10, letterSpacing: "0.1em",
              }}
              title="Bypass prereq locks so you can audit the whole curriculum"
            >
              {demoUnlock ? "★ DEMO: ALL UNLOCKED" : "DEMO UNLOCK"}
            </span>
          </>
        }
      />
      <div className="page-body">
        <div className="training-wrap">
          {/* LEFT — skill tree */}
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

            <SectionTitle>Curriculum</SectionTitle>
            <div className="skill-list">
              {SKILL_ORDER.map((sid) => {
                const def = tree[sid];
                if (!def) return null;
                const unlocked = isUnlocked(brains, sid);
                const lockedReason = !unlocked ? `Master ${prereqName(sid)} L3 first` : null;
                const mastered = isLevelMastered(brains, sid, 3);
                const active = sid === activeSkill;

                // Level pip summary
                const levelStates = [1, 2, 3].map((lvl) => ({
                  level: lvl,
                  mastered: isLevelMastered(brains, sid, lvl),
                  trainable: unlocked && (lvl === 1 || isLevelMastered(brains, sid, lvl - 1)),
                }));

                return (
                  <div
                    key={sid}
                    className={`skill-card ${active ? "is-active" : ""} ${mastered ? "is-mastered" : ""} ${!unlocked ? "is-locked" : ""}`}
                    onClick={() => unlocked && setActiveSkill(sid)}
                    title={lockedReason || ""}
                  >
                    <div className="skill-card__glyph">{!unlocked ? "🔒" : def.glyph}</div>
                    <div className="skill-card__body">
                      <div className="row between">
                        <div className="skill-card__name">{def.name}</div>
                        <div className="mono tiny" style={{ color: mastered ? "var(--mint)" : "var(--ink-3)" }}>
                          {mastered ? "MASTERED" : !unlocked ? "LOCKED" : ""}
                        </div>
                      </div>
                      <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
                        {lockedReason || def.blurb}
                      </div>
                      {unlocked && (
                        <div className="level-pips">
                          {levelStates.map((s) => (
                            <span
                              key={s.level}
                              className={`level-pip ${s.mastered ? "is-mastered" : s.trainable ? "is-open" : ""}`}
                              title={s.mastered ? "Mastered" : s.trainable ? "Trainable" : "Locked"}
                            >L{s.level}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mono tiny" style={{ color: "var(--ink-3)", marginTop: 12, lineHeight: 1.5 }}>
              Each level is a harder physics course. Master L3 to unlock the next skill in the curriculum.
            </div>
          </div>

          {/* RIGHT — level selector + trainer */}
          <div className="training-main">
            {!activeUnlocked ? (
              <div className="card" style={{ padding: 20 }}>
                <div className="card__label">Locked</div>
                <div className="mono tiny" style={{ color: "var(--ink-2)", marginTop: 8, lineHeight: 1.5 }}>
                  <b>{activeDef?.name}</b> is locked. Master <b>{prereqName(activeSkill)} Level 3</b> first.
                </div>
              </div>
            ) : (
              <>
                <div className="level-selector">
                  {[1, 2, 3].map((lvl) => {
                    const mastered = isLevelMastered(brains, activeSkill, lvl);
                    const trainable = lvl === 1 || isLevelMastered(brains, activeSkill, lvl - 1);
                    const cur = lvl === activeLevel;
                    return (
                      <button
                        key={lvl}
                        className={`level-btn ${cur ? "is-active" : ""} ${mastered ? "is-mastered" : ""} ${!trainable ? "is-disabled" : ""}`}
                        onClick={() => trainable && setActiveLevel(lvl)}
                        disabled={!trainable}
                        title={!trainable ? `Master L${lvl - 1} first` : ""}
                      >
                        <span className="level-btn__num">L{lvl}</span>
                        <span className="level-btn__label">{activeDef?.levels?.[lvl - 1]?.label}</span>
                        {mastered && <span className="level-btn__star">★</span>}
                      </button>
                    );
                  })}
                </div>

                {typeof SkillTrainer === "function" ? (
                  <SkillTrainer
                    key={`${activeSkill}-${activeLevel}`}    // remount on switch
                    uid={uid}
                    skillId={activeSkill}
                    level={activeLevel}
                    profile={profile}
                    brains={brains}
                    onSpendCoins={onSpendCoins}
                    onToast={onToast}
                    onBrainSaved={onBrainSaved}
                  />
                ) : (
                  <div className="card" style={{ padding: 20 }}>
                    <div className="card__label">Trainer not loaded</div>
                    <div className="mono tiny" style={{ color: "var(--ink-2)", marginTop: 8 }}>
                      The training module failed to register. Hard-refresh
                      (Ctrl/Cmd+Shift+R) and check DevTools console.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { TrainingScreen });
