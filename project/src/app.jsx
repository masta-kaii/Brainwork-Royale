/* ============================================================
   BRAINWORK ROYALE — APP SHELL
   ============================================================ */

const { useState, useEffect, useRef, useMemo } = React;

const DEFAULT_PLAYER = {
  rank: "PLATINUM III",
  coins: 4820,
  gems: 24,
};

const INITIAL_AI = {
  name: "ALBRT-7",
  class: "engineer",
  tier: "Platinum",
  generation: 247,
  trainingQueue: 12,
  stats: { speed: 62, stamina: 71, intelligence: 88, strength: 54 },
};

const INITIAL_DAILY_QUESTS = [
  { id: "q1", kind: "quiz", kindLabel: "Linear algebra · Quiz",
    glyph: "Σ", title: "Solve 10 algebra problems",
    progress: 6, target: 10, unit: "solved", reward: 8, rewardLabel: "INT" },
  { id: "q2", kind: "body", kindLabel: "Steps · Strava",
    glyph: "↑", title: "Walk 8,000 steps today",
    progress: 5200, target: 8000, unit: "steps", reward: 6, rewardLabel: "STA" },
  { id: "q3", kind: "mind", kindLabel: "Focus · 25 min Pomodoro",
    glyph: "◷", title: "One focus session",
    progress: 0, target: 1, unit: "session", reward: 12, rewardLabel: "gens" },
  { id: "q4", kind: "game", kindLabel: "In-game · Daily challenge",
    glyph: "✶", title: "Win 3 matches today",
    progress: 1, target: 3, unit: "wins", reward: 240, rewardLabel: "coins" },
];

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

function App({ user }) {
  const [tab, setTab] = useState("home");
  const [player] = useState(() => ({
    ...DEFAULT_PLAYER,
    uid: user.uid,
    email: user.email,
    handle: user.displayName || (user.email ? user.email.split("@")[0] : "warden"),
  }));
  const [ai, setAi] = useState(INITIAL_AI);

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
  const [quests, setQuests] = useState(INITIAL_DAILY_QUESTS);
  const [toast, setToast] = useState(null);
  const [battleSeed, setBattleSeed] = useState(8201);
  const [replays, setReplays] = useState(() => buildSeedReplays(INITIAL_AI));

  const showToast = (msg) => setToast(msg);

  const completeQuest = (q) => {
    if (q.kind === "quiz") {
      setTab("quests");
      window.dispatchEvent(new CustomEvent("open-quiz", { detail: q }));
      return;
    }
    setQuests((qs) =>
      qs.map((qq) =>
        qq.id === q.id ? { ...qq, progress: Math.min(qq.target, qq.progress + Math.ceil(qq.target * 0.25)) } : qq
      )
    );
    showToast(`+${q.reward} ${q.rewardLabel} earned`);
  };

  const onQuestRewarded = (q) => {
    const map = { INT: "intelligence", STA: "stamina", SPD: "speed", STR: "strength" };
    const stat = map[q.rewardLabel];
    setAi((a) => stat ? ({ ...a, stats: { ...a.stats, [stat]: Math.min(100, a.stats[stat] + Math.floor(q.reward / 2)) } }) : a);
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
          <div className="rail-item"><span className="rail-item__dot" />Shop</div>
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
    </div>
  );
}

function setBootStatus(msg) {
  const el = document.getElementById("boot-msg");
  if (el) el.textContent = msg;
}

function mountApp(user) {
  const rootEl = document.getElementById("root");
  while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App user={user} />);
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
    // Rules can reject in test mode or before deploy — render the app anyway,
    // it just means Firestore-backed features will fail until rules are live.
    console.warn("ensureUserDoc failed", e);
  }
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
    mountApp(user);
  });
}

if (window.PEP_READY) boot();
else window.addEventListener("app-ready", boot, { once: true });
