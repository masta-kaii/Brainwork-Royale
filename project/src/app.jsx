/* ============================================================
   BRAINWORK ROYALE — APP SHELL
   ============================================================ */

const { useState, useEffect, useRef, useMemo } = React;

// Pre-build a few replays so Replays tab isn't empty on first load
function buildSeedReplays(ai) {
  const seeds = [13371, 92024, 4815];
  return seeds.map((seed, i) => {
    const r = buildReplay(seed, ai, 600);
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
  const [toast, setToast] = useState(null);
  const [battleSeed, setBattleSeed] = useState(8201);
  const [replays, setReplays] = useState(() => buildSeedReplays(initialState.character));
  const [classModal, setClassModal] = useState(false);

  // Composite "player" object used by HomeScreen + rail
  const player = useMemo(() => ({
    uid,
    email: user.email,
    handle: profile.displayName || user.displayName || (user.email ? user.email.split("@")[0] : "warden"),
    rank: profile.currency.rank,
    coins: profile.currency.coins,
    gems: profile.currency.gems,
  }), [uid, user, profile]);

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

  const completeQuest = (q) => {
    if (q.kind === "quiz") {
      setTab("quests");
      window.dispatchEvent(new CustomEvent("open-quiz", { detail: q }));
      return;
    }
    const newProgress = Math.min(q.target, q.progress + Math.ceil(q.target * 0.25));
    setQuests((qs) =>
      qs.map((qq) => (qq.id === q.id ? { ...qq, progress: newProgress } : qq))
    );
    window.dataLayer?.updateQuestProgress(uid, q.id, newProgress, q.target);

    // Coins quests pay out in coins on each tick — credit the user
    if (q.rewardLabel === "coins") {
      const newCoins = profile.currency.coins + q.reward;
      setProfile((p) => ({ ...p, currency: { ...p.currency, coins: newCoins } }));
      window.dataLayer?.saveCurrency(uid, { coins: newCoins });
    }
    showToast(`+${q.reward} ${q.rewardLabel} earned`);
  };

  const onQuestRewarded = (q) => {
    const map = { INT: "intelligence", STA: "stamina", SPD: "speed", STR: "strength" };
    const stat = map[q.rewardLabel];
    if (!stat) return;
    const newStats = { ...ai.stats, [stat]: Math.min(100, ai.stats[stat] + Math.floor(q.reward / 2)) };
    setAi((a) => ({ ...a, stats: newStats }));
    window.dataLayer?.saveCharacterStats(uid, newStats);
    window.dataLayer?.markQuestRewardClaimed(uid, q.id);
    showToast(`+${q.reward} ${q.rewardLabel} → ${ai.name}`);
  };

  const onMatchComplete = (replay) => {
    setReplays((rs) => [replay, ...rs]);
    showToast("Match saved to Replays · open Replays to study");
  };

  const navItems = [
    { id: "home", label: "Command Deck", glyph: "◉" },
    { id: "quests", label: "Quests", glyph: "★", count: quests.filter(q => q.progress < q.target).length },
    { id: "battle", label: "Battle", glyph: "▶", count: "LIVE", live: true },
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
              ai={ai}
              dailyQuests={quests.slice(0, 4)}
              completeQuest={completeQuest}
              latestReplay={replays[0]}
              onNav={setTab}
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
          {tab === "battle" && (
            <BattleScreen
              ai={ai}
              seed={battleSeed}
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

function setBootStatus(msg) {
  const el = document.getElementById("boot-msg");
  if (el) el.textContent = msg;
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
  return {
    profile: {
      currency: { ...(dl ? dl.DEFAULT_CURRENCY : { coins: 0, gems: 0, rank: "BRONZE I" }) },
      currentClass: "engineer",
      displayName: user.displayName || (user.email || "").split("@")[0] || "warden",
      email: user.email || "",
    },
    character: dl ? { ...dl.DEFAULT_CHARACTER } : { name: "ALBRT-7", class: "engineer", tier: "Bronze", generation: 1, trainingQueue: 0, stats: { speed: 50, stamina: 50, intelligence: 50, strength: 50 } },
    quests: dl ? dl.DEFAULT_QUESTS.map((q) => ({ ...q, status: "active", rewardClaimed: false })) : [],
  };
}

function boot() {
  if (!window.firebase) {
    setBootStatus("WAITING FOR FIREBASE…");
    window.addEventListener("firebase-ready", boot, { once: true });
    return;
  }
  setBootStatus("VERIFYING WARDEN ID…");
  const unsub = window.firebase.onAuthStateChanged(async (user) => {
    unsub();
    if (!user) {
      location.replace("/");
      return;
    }
    setBootStatus("SYNCING PROFILE…");
    await ensureUserDoc(user);

    let initialState;
    try {
      if (window.dataLayer) {
        await window.dataLayer.seedFirstTimeUser(user.uid);
        setBootStatus("LOADING WARDEN DATA…");
        initialState = await window.dataLayer.loadPlayerState(user.uid);
      } else {
        initialState = offlineFallbackState(user);
      }
    } catch (e) {
      console.warn("loadPlayerState failed, using fallback", e);
      initialState = offlineFallbackState(user);
    }
    mountApp(user, initialState);
  });
}

if (window.PEP_READY) boot();
else window.addEventListener("app-ready", boot, { once: true });
