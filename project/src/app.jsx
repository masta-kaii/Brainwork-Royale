/* ============================================================
   BRAINWORK ROYALE — APP SHELL
   ============================================================ */

const { useState, useEffect, useRef, useMemo } = React;

// Pre-build a few replays so Replays tab isn't empty on first load.
function buildSeedReplays(ai, brains) {
  const demoBrain = null; // no pre-seeded brains — user starts from zero
  const seedAi = demoBrain && window.brainEngine?.brainFromJSON
    ? { ...ai, brain: window.brainEngine.brainFromJSON(demoBrain) }
    : ai;
  const seeds = [13371, 92024, 4815];
  return seeds.map((seed, i) => {
    const r = buildReplay(seed, seedAi, 600);
    return {
      ...r,
      id: `M-${seed.toString().padStart(4, "0")}`,
      mazeName: `NEON LAB #${seed.toString().padStart(4, "0")}`,
      startedAt: Date.now() - (1 + i) * 1000 * 60 * 18,
      endedAt: Date.now() - (1 + i) * 1000 * 60 * 18 + r.totalTicks * 320,
      ai: { name: ai.name, class: ai.class, generation: ai.generation - i * 3, tier: ai.tier },
    };
  });
}

function App({ user, initialState }) {
  const uid = user.uid;
  const [tab, setTab] = useState("home");
  const [profile, setProfile] = useState(initialState.profile);
  const [ai, setAi] = useState(initialState.character);
  const [quests, setQuests] = useState(initialState.quests);
  const [skills, setSkills] = useState(initialState.skills || {});
  const [brains, setBrains] = useState(initialState.brains || {});
  const [toast, setToast] = useState(null);
  const [battleSeed, setBattleSeed] = useState(8201);
  const [dailyGhosts, setDailyGhosts] = useState([]);
  const [replays, setReplays] = useState(() => buildSeedReplays(initialState.character, initialState.brains));
  const [classModal, setClassModal] = useState(false);

  // Maze brain state — the brain that learns to navigate mazes
  const [mazeBrain, setMazeBrain] = useState(() => {
    if (initialState.mazeBrain) return initialState.mazeBrain;
    return createFreshMazeBrain();
  });
  const [mazeTokens, setMazeTokens] = useState(3);  // starting tokens
  const [mazeGen, setMazeGen] = useState(0);
  const [mazeFitness, setMazeFitness] = useState(0);
  const [mazeTraining, setMazeTraining] = useState(false);

  // Load maze brain from Firestore on mount
  React.useEffect(() => {
    window.dataLayer?.loadMazeBrain?.(uid).then(saved => {
      if (saved && saved.weights) {
        setMazeBrain(saved);
        setMazeGen(saved.meta?.gen || 0);
        setMazeFitness(saved.meta?.fitness || 0);
      }
    }).catch(() => {});
  }, [uid]);

  // AI object passed to BattleScreen includes trained skills + maze brain
  const aiBrain = useMemo(() => {
    const keys = ["run-L3", "run-L2", "run-L1", "walk-L3", "walk-L2", "walk-L1", "balance-L3"];
    for (const key of keys) {
      const json = brains?.[key];
      if (json && window.brainEngine?.brainFromJSON) {
        try { return { ...window.brainEngine.brainFromJSON(json), _meta: { key, ...(json.meta || {}) } }; }
        catch (e) { /* ignore */ }
      }
    }
    return null;
  }, [brains]);

  const mazeBrainObj = useMemo(() => {
    if (mazeBrain && typeof window.mazeBrainFromJSON === 'function') {
      return window.mazeBrainFromJSON(mazeBrain);
    }
    return null;
  }, [mazeBrain]);

  const aiWithSkills = useMemo(() => ({ ...ai, skills, brain: aiBrain, mazeBrain: mazeBrainObj }), [ai, skills, aiBrain, mazeBrainObj]);

  // Composite "player" object used by HomeScreen + rail
  const player = useMemo(() => {
    const baseHandle = profile.displayName || user.displayName ||
      (user.email ? user.email.split("@")[0] : ("Guest-" + uid.slice(0, 6)));
    return {
      uid,
      email: user.email,
      isAnonymous: user.isAnonymous,
      handle: user.isAnonymous ? `${baseHandle} (guest)` : baseHandle,
      rank: profile.currency.rank,
      coins: profile.currency.coins,
      gems: profile.currency.gems,
    };
  }, [uid, user, profile]);

  // First-boot toast for guests so they know progress is ephemeral
  useEffect(() => {
    if (user.isAnonymous && !sessionStorage.getItem("guestWarned")) {
      sessionStorage.setItem("guestWarned", "1");
      setTimeout(() => showToast("Guest session · sign up to keep your progress"), 1200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open class picker for first-time wardens (no class chosen yet)
  useEffect(() => {
    const hasPicked = sessionStorage.getItem("classPicked_" + uid);
    if (!hasPicked && ai.class === (window.dataLayer?.DEFAULT_CHARACTER?.class || "engineer")) {
      sessionStorage.setItem("classPicked_" + uid, "1");
      setTimeout(() => setClassModal(true), 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Redirect to landing if signed out from another tab
  useEffect(() => {
    return window.firebase.onAuthStateChanged((u) => {
      if (!u) location.replace("/");
    });
  }, []);

  const signOut = async () => {
    try { await window.firebase.signOut(); } catch (e) { /* listener handles redirect */ }
    location.replace("/");
  };

  const showToast = (msg) => setToast(msg);

  // Apply any class the user picked on the landing page before signing in
  useEffect(() => {
    const pending = localStorage.getItem("pendingClass");
    if (pending && window.CLASSES && window.CLASSES[pending] && pending !== ai.class) {
      localStorage.removeItem("pendingClass");
      changeClass(pending, /*silent=*/ true);
    } else if (pending) {
      localStorage.removeItem("pendingClass");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeClass = (classId, silent) => {
    setAi((a) => ({ ...a, class: classId }));
    setProfile((p) => ({ ...p, currentClass: classId }));
    window.dataLayer?.setPlayerClass(uid, classId);
    if (!silent) showToast(`Switched to ${window.CLASSES?.[classId]?.name || classId}`);
    setClassModal(false);
  };

  // Train maze brain with GA — burns tokens for generations
  const trainMazeBrain = async () => {
    if (mazeTraining || mazeTokens <= 0) return;
    setMazeTraining(true);

    const POP = 30;
    const ELITE = 4;
    const seed = Date.now();

    // Build population from current brain
    let pop = [];
    const currentBrain = mazeBrainObj ? mazeBrainObj : (typeof window.makeMazeBrain === 'function' ? window.makeMazeBrain() : null);
    if (!currentBrain) { setMazeTraining(false); return; }

    pop.push({ brain: currentBrain, fitness: 0 });
    for (let i = 1; i < POP; i++) {
      pop.push({ brain: typeof window.mutateMazeBrain === 'function' ? window.mutateMazeBrain(currentBrain) : currentBrain, fitness: 0 });
    }

    const genCount = Math.min(mazeTokens, 10); // max 10 gens per click
    let bestFit = mazeFitness;
    let bestBrain = currentBrain;

    for (let g = 0; g < genCount; g++) {
      // Evaluate population on a fresh maze
      const maze = window.genMaze?.(21, 21, seed + g);
      if (!maze || !maze.grid) break;
      const exit = maze.exit || [maze.cols - 2, maze.rows - 2];
      const startX = (maze.start ? maze.start[0] : 1) + 0.5;
      const startY = (maze.start ? maze.start[1] : 1) + 0.5;
      const startDist = Math.hypot(exit[0] - startX, exit[1] - startY);

      for (const p of pop) {
        let fitness = 0;
        // Run brain on maze for evaluation
        let agent = {
          x: startX, y: startY, facing: 0, speedPerTick: 0.13,
          _memory: [], _stuckTimer: 0,
          mazeBrain: p.brain,
        };
        let ticks = 0;

        while (ticks < 600 && agent._stuckTimer < 200) {
          const obs = typeof window.mazeObserve === 'function' ? window.mazeObserve(agent, maze) : [0,0,0,0,0,0,0,0];
          const out = typeof window.mazeForward === 'function' ? window.mazeForward(p.brain, obs) : [0,0,0,0];
          const turn = out[1] - out[0];
          const move = out[2] - out[3];

          // Memory
          if (!agent._memory) agent._memory = [];
          agent._memory.push([agent.x, agent.y]);
          if (agent._memory.length > 24) agent._memory.shift();

          agent.facing += Math.max(-0.3, Math.min(0.3, turn * 0.3));
          if (move > -0.2) {
            const step = 0.13 * Math.max(0.1, (move + 1) / 2);
            const px = agent.x, py = agent.y;
            agent.x += Math.cos(agent.facing) * step;
            agent.y += Math.sin(agent.facing) * step;
            // Wall collision
            const cx = Math.floor(agent.x), cy = Math.floor(agent.y);
            if (cx < 0 || cy < 0 || cx >= (maze.cols || 21) || cy >= (maze.rows || 21) || maze.grid[cy][cx] === 1) {
              agent.x = px; agent.y = py;
              agent._stuckTimer += 2;
            } else {
              agent._stuckTimer = Math.max(0, agent._stuckTimer - 1);
            }
          } else {
            agent._stuckTimer++;
          }

          // Check exit
          const cx = Math.floor(agent.x), cy = Math.floor(agent.y);
          if (cx === exit[0] && cy === exit[1]) break;
          ticks++;
        }

        const dist = Math.hypot(exit[0] - agent.x, exit[1] - agent.y);
        fitness = Math.max(0, (1 - dist / startDist) * 5) + (ticks < 600 ? (600 - ticks) / 600 * 3 : 0);
        p.fitness = fitness;
      }

      pop.sort((a, b) => b.fitness - a.fitness);
      if (pop[0].fitness > bestFit) {
        bestFit = pop[0].fitness;
        bestBrain = typeof window.cloneMazeBrain === 'function' ? window.cloneMazeBrain(pop[0].brain) : pop[0].brain;
      }

      // Breed
      const elites = pop.slice(0, ELITE).map(p => ({ brain: p.brain, fitness: 0 }));
      const next = [...elites];
      for (let i = elites.length; i < POP; i++) {
        const parent = pop[Math.floor(Math.random() * Math.min(4, pop.length))].brain;
        next.push({ brain: typeof window.mutateMazeBrain === 'function' ? window.mutateMazeBrain(parent) : parent, fitness: 0 });
      }
      pop = next;
    }

    // Update state
    const json = typeof window.mazeBrainToJSON === 'function' ? window.mazeBrainToJSON(bestBrain, { gen: mazeGen + genCount, fitness: bestFit }) : null;
    setMazeBrain(json);
    setMazeTokens(t => t - genCount);
    setMazeGen(g => g + genCount);
    setMazeFitness(bestFit);
    setMazeTraining(false);
    // Persist to Firestore
    if (json) window.dataLayer?.saveMazeBrain?.(uid, json);
    showToast(`Brain trained ${genCount} gens · fitness ${bestFit.toFixed(2)}`);
  };

  const completeQuest = (q) => {
    // Already completed or claimed
    if (q.rewardClaimed || q.status === "completed") {
      showToast(`${q.title} already completed today`);
      return;
    }
    if (q.kind === "quiz") {
      setTab("quests");
      window.dispatchEvent(new CustomEvent("open-quiz", { detail: q }));
      return;
    }
    // Non-quiz quests: one-click complete
    const newProgress = q.target;
    setQuests((qs) =>
      qs.map((qq) => (qq.id === q.id ? { ...qq, progress: newProgress, status: "completed" } : qq))
    );
    window.dataLayer?.updateQuestProgress(uid, q.id, newProgress, q.target);

    // Grant maze training tokens
    setMazeTokens(t => t + 2);

    if (q.rewardLabel === "coins") {
      const newCoins = profile.currency.coins + q.reward;
      setProfile((p) => ({ ...p, currency: { ...p.currency, coins: newCoins } }));
      window.dataLayer?.saveCurrency(uid, { coins: newCoins });
    }
    showToast(`✓ ${q.title} · +${q.reward} ${q.rewardLabel} · +2 brain tokens`);
  };

  const onQuestRewarded = (q) => {
    const map = { INT: "intelligence", STA: "stamina", SPD: "speed", STR: "strength" };
    const stat = map[q.rewardLabel];
    if (!stat) return;
    const newStats = { ...ai.stats, [stat]: Math.min(100, ai.stats[stat] + Math.floor(q.reward / 2)) };
    setAi((a) => ({ ...a, stats: newStats }));
    window.dataLayer?.saveCharacterStats(uid, newStats);
    window.dataLayer?.markQuestRewardClaimed(uid, q.id);

    // Grant maze training tokens on quest completion
    setMazeTokens(t => t + 2);
    showToast(`+${q.reward} ${q.rewardLabel} → ${ai.name} · +2 brain tokens`);
  };

  const onMatchComplete = (replay) => {
    setReplays((rs) => [replay, ...rs]);
    showToast("Match saved to Replays · open Replays to study");
  };

  // ---- Training handlers ----
  const onSpendCoins = (cost) => {
    const newCoins = Math.max(0, profile.currency.coins - cost);
    setProfile((p) => ({ ...p, currency: { ...p.currency, coins: newCoins } }));
    window.dataLayer?.saveCurrency(uid, { coins: newCoins });
  };

  const onSkillProgress = (skillId, { generation, level, leveledUp }) => {
    setSkills((sk) => ({
      ...sk,
      [skillId]: { ...(sk[skillId] || { id: skillId }), generation, level },
    }));
    const partial = { generation, level };
    if (level >= (window.dataLayer?.MAX_LEVEL || 3)) partial.masteredAt = window.firebase?.serverTimestamp?.();
    window.dataLayer?.saveSkill(uid, skillId, partial);

    if (leveledUp) {
      const def = (window.dataLayer?.SKILL_DEFS || []).find((s) => s.id === skillId);
      const isMastered = level >= (window.dataLayer?.MAX_LEVEL || 3);
      showToast(`${def?.name || skillId} ${isMastered ? "MASTERED" : `→ L${level}`}`);

      // Bump the warden's stat on skill level-up so training feeds into battle.
      // stat mapping: balance→STA, walk→STA, run→SPD, jump→STA, dodge→SPD, attack→STR, combo→STR
      const statMap = {
        balance: "stamina", walk: "stamina", run: "speed",
        jump: "stamina", dodge: "speed", attack: "strength", combo: "strength",
      };
      const statKey = statMap[skillId];
      if (statKey) {
        const boost = level >= (window.dataLayer?.MAX_LEVEL || 3) ? 6 : 2;
        setAi((a) => {
          const newStats = { ...a.stats, [statKey]: Math.min(100, a.stats[statKey] + boost) };
          window.dataLayer?.saveCharacterStats(uid, newStats);
          return { ...a, stats: newStats };
        });
      }
    }
  };

  const MAX = window.dataLayer?.MAX_LEVEL || 3;
  const masteredCount = Object.values(skills).filter((s) => s.level >= MAX).length;

  const navItems = [
    { id: "home", label: "Command Deck", glyph: "◉" },
    { id: "quests", label: "Quests", glyph: "★", count: quests.filter(q => q.progress < q.target).length },
    { id: "training", label: "Training", glyph: "✦", count: masteredCount > 0 ? `${masteredCount}★` : null },
    { id: "battle", label: "Battle", glyph: "▶", count: "LIVE", live: true },
    { id: "daily", label: "Daily Maze", glyph: "🗓", count: "1/day", live: true },
    { id: "race", label: "Race", glyph: "»", count: "LIVE", live: true },
    { id: "replays", label: "Replays", glyph: "◷", count: replays.length },
    { id: "brain", label: "Brain", glyph: "❖", count: `G${ai.generation}` },
  ];

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail__logo">
          <div className="rail__logo-mark">B</div>
          <div className="rail__logo-text">
            BRAINWORK
            <small>ROYALE</small>
          </div>
        </div>

        <nav className="rail__nav">
          <div className="rail__nav-label">Main</div>
          {navItems.map((n) => (
            <div
              key={n.id}
              className={`rail-item ${tab === n.id ? "is-active" : ""}`}
              onClick={() => setTab(n.id)}
            >
              <span className="rail-item__dot" />
              {n.label}
              {n.count != null && (
                <span className="rail-item__count" style={n.live ? { color: "var(--magenta)" } : null}>
                  {n.count}
                </span>
              )}
            </div>
          ))}

          <div className="rail__nav-label">Meta</div>
          <div className="rail-item" onClick={() => setClassModal(true)}>
            <span className="rail-item__dot" />Change class
          </div>
          <div className="rail-item"><span className="rail-item__dot" />Leaderboard</div>
          <div className="rail-item" onClick={signOut} title={`Sign out ${player.email || ''}`}>
            <span className="rail-item__dot" />Sign out
          </div>
        </nav>

        <div className="rail__footer">
          <div className="player-card">
            <div style={{ width: 36, flexShrink: 0 }}>
              <BearPortrait cls={ai.class} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="player-card__name">{player.handle}</div>
              <div className="player-card__rank">{player.rank}</div>
            </div>
          </div>
          <div className="row between" style={{ padding: "0 4px", fontSize: 11 }}>
            <span className="mono"><span style={{ color: "var(--amber)" }}>◈</span> {player.coins.toLocaleString()}</span>
            <span className="mono"><span style={{ color: "var(--magenta)" }}>◆</span> {player.gems}</span>
          </div>
        </div>
      </aside>

      <main className="app__main">
        <div className="app__content">
          {tab === "home" && (
            <HomeScreen
              player={player}
              ai={{ ...ai, _brains: brains }}
              dailyQuests={quests.slice(0, 4)}
              completeQuest={completeQuest}
              latestReplay={replays[0]}
              onNav={setTab}
              onStartBattle={() => {
                setBattleSeed(Math.floor(Math.random() * 90000) + 1000);
                setTab("battle");
              }}
              onStartDaily={() => {
                const dateKey = window.dailyMazeSeed?.() || String(new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate());
                window.dataLayer?.loadDailyRuns?.(dateKey).then(runs => {
                  setDailyGhosts(runs || []);
                  setTab("daily");
                }).catch(() => {
                  setDailyGhosts([]);
                  setTab("daily");
                });
              }}
              onTrainBrain={trainMazeBrain}
              mazeTokens={mazeTokens}
              mazeGen={mazeGen}
              mazeFitness={mazeFitness}
            />
          )}
          {tab === "quests" && (
            <QuestsScreen
              quests={quests}
              setQuests={setQuests}
              onReward={onQuestRewarded}
              onToast={showToast}
            />
          )}
          {tab === "training" && (
            <TrainingScreen
              uid={uid}
              ai={ai}
              skills={skills}
              brains={brains}
              profile={profile}
              onSkillProgress={onSkillProgress}
              onSpendCoins={onSpendCoins}
              onBrainSaved={(key, json) => {
                if (json) {
                  setBrains((b) => ({ ...b, [key]: json }));
                  window.dataLayer?.saveBrain?.(uid, key, json);
                } else {
                  setBrains((b) => { const n = { ...b }; delete n[key]; return n; });
                  window.dataLayer?.deleteBrain?.(uid, key);
                }
              }}
              onToast={showToast}
            />
          )}
          {tab === "battle" && (
            <BattleScreen
              ai={aiWithSkills}
              seed={battleSeed}
              mode="battle"
              onReseed={() => setBattleSeed((s) => s + 1)}
              onToast={showToast}
              onMatchComplete={onMatchComplete}
            />
          )}
          {tab === "daily" && (
            <BattleScreen
              ai={{ ...aiWithSkills, _ghostRuns: dailyGhosts }}
              seed={window.dailyMazeSeed?.() || 20260518}
              mode="daily"
              onReseed={() => {}}
              onToast={showToast}
              onMatchComplete={(replay) => {
                onMatchComplete(replay);
                // Save daily run to Firestore
                const dateKey = window.dailyMazeSeed?.() || String(new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate());
                const playerAgent = replay.agents?.find(a => a.isYou);
                const placement = replay.agents
                  ? replay.agents.filter(a => a.alive !== false).sort((a, b) => (b.hp || 0) - (a.hp || 0)).findIndex(a => a.isYou) + 1
                  : "?";
                window.dataLayer?.saveDailyRun?.(uid, dateKey, {
                  name: ai.name, class: ai.class,
                  ticks: replay.totalTicks, placement,
                  fitness: playerAgent?.hp || 0,
                  mazeBrainWeights: mazeBrain,  // save maze brain so others can race your ghost
                });
                showToast(`Daily run saved · placed #${placement}`);
              }}
            />
          )}
          {tab === "race" && (
            <BattleScreen
              ai={aiWithSkills}
              seed={battleSeed + 9000}
              mode="race"
              onReseed={() => setBattleSeed((s) => s + 1)}
              onToast={showToast}
              onMatchComplete={onMatchComplete}
            />
          )}
          {tab === "replays" && (
            <ReplaysScreen replays={replays} ai={ai} />
          )}
          {tab === "brain" && (
            <BrainScreen ai={ai} />
          )}
        </div>
      </main>

      <nav className="bottom-nav">
        {navItems.map((n) => (
          <div
            key={n.id}
            className={`bottom-nav__item ${tab === n.id ? "is-active" : ""}`}
            onClick={() => setTab(n.id)}
          >
            <span className="bottom-nav__glyph">{n.glyph}</span>
            <span>{n.label.split(" ")[0]}</span>
          </div>
        ))}
      </nav>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {classModal && (
        <ClassPickerModal
          activeClass={ai.class}
          onPick={(id) => changeClass(id, false)}
          onClose={() => setClassModal(false)}
        />
      )}
    </div>
  );
}

function ClassPickerModal({ activeClass, onPick, onClose }) {
  const list = window.CLASS_LIST || Object.values(window.CLASSES || {});
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="class-picker"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="class-picker__head">
          <div>
            <div className="mono tiny" style={{ color: "var(--mint)", letterSpacing: "0.2em" }}>
              CHOOSE YOUR AVATAR CLASS
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--ink-0)" }}>
              Pick a bear
            </div>
          </div>
          <button className="overlay__close" style={{ position: "static", width: 32, height: 32 }} onClick={onClose}>×</button>
        </div>
        <div className="class-picker__grid">
          {list.map((c) => (
            <div
              key={c.id}
              className={`class-picker__card ${activeClass === c.id ? "is-active" : ""}`}
              onClick={() => onPick(c.id)}
            >
              <div style={{ width: 64, margin: "0 auto 6px" }}>
                <BearPortrait cls={c.id} />
              </div>
              <div className="class-picker__name">{c.name.replace(" Bear", "")}</div>
              <div className="mono tiny" style={{ color: "var(--ink-3)", letterSpacing: "0.1em" }}>{c.role.toUpperCase()}</div>
              <div className="mono tiny" style={{ color: "var(--ink-2)", marginTop: 6, lineHeight: 1.4 }}>{c.ability}</div>
              {activeClass === c.id && (
                <div className="mono tiny" style={{ color: "var(--mint)", marginTop: 6, letterSpacing: "0.2em" }}>● ACTIVE</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function mountApp(user, initialState) {
  const rootEl = document.getElementById("root");
  while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App user={user} initialState={initialState} />);
}

async function ensureUserDoc(user) {
  const { db, doc, getDoc, setDoc, serverTimestamp } = window.firebase;
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      role: "player",
      email: user.email || "",
      displayName: user.displayName || (user.email || "").split("@")[0] || "warden",
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("ensureUserDoc failed", e);
  }
}

// Fallback state if Firestore is unreachable / rules block us — the UI
// still renders so the user isn't stuck on the boot screen forever.
function offlineFallbackState(user) {
  const dl = window.dataLayer;
  const fallbackSkills = {};
  (dl?.SKILL_DEFS || []).forEach((d) => {
    fallbackSkills[d.id] = { id: d.id, level: 0, generation: 0, masteredAt: null };
  });
  return {
    profile: {
      currency: { ...(dl ? dl.DEFAULT_CURRENCY : { coins: 0, gems: 0, rank: "BRONZE I" }) },
      currentClass: "engineer",
      displayName: user.displayName || (user.email || "").split("@")[0] || "warden",
      email: user.email || "",
    },
    character: dl ? { ...dl.DEFAULT_CHARACTER } : { name: "Berok 1", class: "engineer", tier: "Bronze", generation: 1, trainingQueue: 0, stats: { speed: 50, stamina: 50, intelligence: 50, strength: 50 } },
    quests: dl ? dl.DEFAULT_QUESTS.map((q) => ({ ...q, status: "active", rewardClaimed: false })) : [],
    skills: fallbackSkills,
    brains: {},
    mazeBrain: null,  // fresh user — no maze brain yet
  };
}

// Create a fresh random maze brain for new users.
// Training tokens are earned via quizzes and spent on brain evolution.
function createFreshMazeBrain() {
  if (typeof window.makeMazeBrain === 'function') {
    return window.mazeBrainToJSON(window.makeMazeBrain(), { gen: 0, fitness: 0 });
  }
  return null;
}

function refreshDailyQuests(state, uid) {
  if (!uid || !state?.quests?.length || !window.dataLayer) return;
  const today = new Date().toISOString().slice(0, 10);
  const lastReset = sessionStorage.getItem(`questReset_${uid}`);
  if (lastReset === today) return; // already refreshed today
  sessionStorage.setItem(`questReset_${uid}`, today);

  // Reset any quest that was completed on a previous day
  state.quests.forEach((q) => {
    if (q.status === "completed") {
      q.status = "active";
      q.progress = 0;
      q.rewardClaimed = false;
      q.completedAt = null;
    }
  });
}

function boot() {
  window.setBootProgress(10);

  if (!window.firebase) {
    window.setBootStatus("WAITING FOR FIREBASE SDK…");
    window.addEventListener("firebase-ready", boot, { once: true });
    return;
  }
  window.setBootProgress(30);
  window.setBootStatus("FIREBASE READY · CHECKING AUTH…");

  // Auth timeout: if onAuthStateChanged doesn't fire within 15s, surface
  // the error instead of hanging forever. Common causes: wrong API key,
  // unauthorized domain, network blocking googleapis.com.
  const AUTH_TIMEOUT = 15000;
  const authTimer = setTimeout(() => {
    const msg = window._bootFailed
      ? "AUTH TIMED OUT — see error above"
      : "AUTH TIMED OUT — Firebase auth did not respond. Check: 1) apiKey matches Firebase console 2) authDomain is in Authorized Domains 3) Authentication is enabled in Firebase console 4) googleapis.com is not blocked";
    window.setBootStatus(msg, true);
  }, AUTH_TIMEOUT);

  window.setBootStatus("WAITING FOR AUTH STATE…");
  const unsub = window.firebase.onAuthStateChanged(async (user) => {
    clearTimeout(authTimer);
    unsub();
    window.setBootProgress(50);

    if (!user) {
      window.setBootStatus("NO USER · REDIRECTING TO LANDING…");
      setTimeout(() => { location.replace("/"); }, 600);
      return;
    }
    window.setBootProgress(60);
    window.setBootStatus(`WARDEN FOUND · ${user.email || user.uid.slice(0, 8) + "…"}`);

    window.setBootStatus("SYNCING PROFILE…");
    await ensureUserDoc(user);
    window.setBootProgress(70);

    let initialState;
    try {
      if (window.dataLayer) {
        window.setBootStatus("SEEDING FIRST-TIME DATA…");
        await window.dataLayer.seedFirstTimeUser(user.uid);
        window.setBootProgress(80);
        window.setBootStatus("LOADING WARDEN DATA…");
        initialState = await window.dataLayer.loadPlayerState(user.uid);
        window.setBootProgress(95);
      } else {
        window.setBootStatus("DATA LAYER MISSING · USING OFFLINE FALLBACK");
        initialState = offlineFallbackState(user);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      window.setBootStatus(`FIRESTORE ERROR · ${msg}`, true);
      console.warn("loadPlayerState failed, using fallback", e);
      initialState = offlineFallbackState(user);
    }
    window.setBootStatus("MOUNTING APP…");
    window.setBootProgress(100);

    // Client-side daily quest refresh — reset quests that were completed
    // yesterday so they're fresh for today. (Server-side reset is handled
    // by the dailyQuestReset Cloud Function once on Blaze.)
    refreshDailyQuests(initialState, user.uid);

    mountApp(user, initialState);
  });
}

if (window.PEP_READY) boot();
else window.addEventListener("app-ready", boot, { once: true });
