/* ============================================================
   BRAINWORK ROYALE — QUESTS
   Browse + completion flow for in-game / quiz / real-world quests
   Includes interactive quiz modal.
   ============================================================ */

const ALL_QUESTS = [
  // In-game
  { id: "g1", kind: "game", kindLabel: "In-game", glyph: "✶", title: "Win 3 ranked matches", desc: "Win three matches at your current tier or higher.", progress: 1, target: 3, unit: "wins", reward: 240, rewardLabel: "coins", refresh: "Resets in 8h", cat: "ingame" },
  { id: "g2", kind: "game", kindLabel: "In-game", glyph: "⌬", title: "Defeat the Treasure Sentinel", desc: "Beat the boss bot that spawns over treasure on Friday rotation mazes.", progress: 0, target: 1, unit: "boss", reward: 80, rewardLabel: "gems", refresh: "Friday only", cat: "ingame" },
  { id: "g3", kind: "game", kindLabel: "In-game", glyph: "△", title: "Reach top 10 in any maze", desc: "Place in the top 10 of any 16-AI match.", progress: 0, target: 1, unit: "match", reward: 1, rewardLabel: "blueprint", refresh: "Daily", cat: "ingame" },

  // Quiz
  { id: "q1", kind: "quiz", kindLabel: "Quiz · Linear algebra", glyph: "Σ", title: "Solve 10 algebra problems", desc: "Adaptive quiz. Difficulty scales with your answer streak.", progress: 6, target: 10, unit: "solved", reward: 8, rewardLabel: "INT", refresh: "Daily", cat: "quiz" },
  { id: "q2", kind: "quiz", kindLabel: "Quiz · World history", glyph: "Ω", title: "Pass 5 history rounds", desc: "Five-question rounds. 4 of 5 to pass each.", progress: 2, target: 5, unit: "rounds", reward: 6, rewardLabel: "INT", refresh: "Daily", cat: "quiz" },
  { id: "q3", kind: "quiz", kindLabel: "Quiz · Python", glyph: "λ", title: "Code golf · 3 tasks", desc: "Solve three short Python problems under 80 chars.", progress: 0, target: 3, unit: "tasks", reward: 14, rewardLabel: "gens", refresh: "Daily", cat: "quiz" },

  // Real world
  { id: "r1", kind: "body", kindLabel: "Strava · Verified", glyph: "↑", title: "Walk 8,000 steps", desc: "Verified via Strava connection. Cheating gives small reward only.", progress: 5200, target: 8000, unit: "steps", reward: 6, rewardLabel: "STA", refresh: "Daily", cat: "real" },
  { id: "r2", kind: "body", kindLabel: "Strava · Verified", glyph: "≈", title: "Run 5km this week", desc: "Pace-agnostic. Total distance counts across the week.", progress: 3.2, target: 5, unit: "km", reward: 18, rewardLabel: "STA", refresh: "Weekly", cat: "real" },
  { id: "r3", kind: "mind", kindLabel: "Focus · Webcam optional", glyph: "◷", title: "25-min focus session", desc: "Pomodoro timer. Optional webcam attention check.", progress: 0, target: 1, unit: "session", reward: 12, rewardLabel: "gens", refresh: "3/day", cat: "real" },
  { id: "r4", kind: "mind", kindLabel: "Health API · Sleep", glyph: "☾", title: "Sleep 8 hours", desc: "Pulled from Apple Health. Full stamina at next match start.", progress: 7.1, target: 8, unit: "hr", reward: 1, rewardLabel: "recovery", refresh: "Nightly", cat: "real" },
];

// Sample quiz bank
const QUIZ_BANK = [
  {
    subject: "Linear algebra",
    q: "What is the determinant of [[2, 3], [1, 4]]?",
    options: ["5", "8", "11", "−5"],
    correct: 0, // 2*4 - 3*1 = 5
  },
  {
    subject: "Linear algebra",
    q: "The rank of an n×n invertible matrix is:",
    options: ["0", "1", "n−1", "n"],
    correct: 3,
  },
  {
    subject: "Linear algebra",
    q: "If A is 3×4 and B is 4×2, the product AB is:",
    options: ["3×2", "4×4", "Undefined", "2×3"],
    correct: 0,
  },
  {
    subject: "Linear algebra",
    q: "Eigenvalues of [[3, 0], [0, 5]]:",
    options: ["3 and 5", "0 and 8", "15 only", "−3 and −5"],
    correct: 0,
  },
];

function QuizModal({ quest, onClose, onReward }) {
  const [step, setStep] = React.useState(0);
  const [answer, setAnswer] = React.useState(null);
  const [correctCount, setCorrectCount] = React.useState(0);

  const TOTAL = 3;
  const q = QUIZ_BANK[step % QUIZ_BANK.length];

  const pick = (i) => {
    if (answer != null) return;
    setAnswer(i);
    if (i === q.correct) setCorrectCount((c) => c + 1);
    setTimeout(() => {
      if (step + 1 >= TOTAL) {
        onReward({ ...quest, correct: i === q.correct ? correctCount + 1 : correctCount, total: TOTAL });
        onClose();
      } else {
        setStep((s) => s + 1);
        setAnswer(null);
      }
    }, 1000);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay__panel" onClick={(e) => e.stopPropagation()}>
        <button className="overlay__close" onClick={onClose}>×</button>
        <div className="quiz-progress">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div key={i} className={`quiz-progress__step ${i < step ? "is-done" : ""} ${i === step ? "is-current" : ""}`} />
          ))}
        </div>
        <div className="quiz-meta">
          <Chip variant="amber">{q.subject}</Chip>
          <span>Question {step + 1} of {TOTAL}</span>
          <span style={{ marginLeft: "auto", color: "var(--mint)" }}>+{quest.reward} {quest.rewardLabel}</span>
        </div>
        <div className="quiz-q">{q.q}</div>
        <div className="quiz-options">
          {q.options.map((opt, i) => {
            let cls = "quiz-opt";
            if (answer != null) {
              if (i === q.correct) cls += " is-correct";
              else if (i === answer) cls += " is-wrong";
            }
            return (
              <div key={i} className={cls} onClick={() => pick(i)}>
                <div className="quiz-opt__letter">{String.fromCharCode(65 + i)}</div>
                <div>{opt}</div>
              </div>
            );
          })}
        </div>
        <div className="row between" style={{ marginTop: 18 }}>
          <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
            Streak builds reward multiplier · ESC to abandon
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestsScreen({ quests, setQuests, onReward, onToast }) {
  const [tab, setTab] = React.useState("all");
  const [activeQuiz, setActiveQuiz] = React.useState(null);

  React.useEffect(() => {
    const handler = (e) => setActiveQuiz(e.detail);
    window.addEventListener("open-quiz", handler);
    return () => window.removeEventListener("open-quiz", handler);
  }, []);

  const filtered = tab === "all" ? ALL_QUESTS : ALL_QUESTS.filter((q) => q.cat === tab);

  const handleClick = (q) => {
    if (q.cat === "quiz") {
      setActiveQuiz(q);
      return;
    }
    if (q.cat === "real") {
      onToast(`Verifying via ${q.kindLabel}... try again later`);
      return;
    }
    // in-game
    onToast(`Quest tracked. Win matches to progress.`);
  };

  const handleQuizDone = (q) => {
    const earned = Math.floor((q.correct / q.total) * q.reward);
    onReward({ ...q, reward: earned });
    onToast(`Quiz complete · ${q.correct}/${q.total} correct · +${earned} ${q.rewardLabel}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Daily + weekly objectives"
        title="Quests"
        meta={<span>Resets at 04:00 local · 7-day streak ×1.5</span>}
      />
      <div className="page-body">
        <div className="quest-tabs">
          {[
            ["all", "All"],
            ["ingame", "In-game"],
            ["quiz", "Quizzes"],
            ["real", "Real-world"],
          ].map(([id, label]) => (
            <div
              key={id}
              className={`quest-tab ${tab === id ? "is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Stat rewards summary strip */}
        <div className="card card--inset" style={{ marginBottom: 16 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="card__label">Today's reward pool</div>
              <div className="row" style={{ gap: 14, marginTop: 4 }}>
                <span className="mono" style={{ color: "var(--stat-intel)" }}>+14 INT</span>
                <span className="mono" style={{ color: "var(--stat-stamina)" }}>+24 STA</span>
                <span className="mono" style={{ color: "var(--mint)" }}>+38 gens</span>
                <span className="mono" style={{ color: "var(--amber)" }}>+340 coins</span>
              </div>
            </div>
            <Chip variant="mint" dot>3 of 10 complete</Chip>
          </div>
        </div>

        {filtered.map((q) => {
          const pct = Math.min(100, (q.progress / q.target) * 100);
          const done = q.progress >= q.target;
          return (
            <div className="quest-card-lg" key={q.id} onClick={() => handleClick(q)}>
              <div className={`quest-card-lg__icon quest-item__icon--${q.kind}`}>
                {q.glyph}
              </div>
              <div>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <Chip>{q.kindLabel}</Chip>
                  <Chip>{q.refresh}</Chip>
                  {done && <Chip variant="mint" dot>Complete</Chip>}
                </div>
                <div className="quest-card-lg__title">{q.title}</div>
                <div className="quest-card-lg__desc">{q.desc}</div>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ flex: 1, maxWidth: 280 }}>
                    <div className="quest-item__progress">
                      <div className="quest-item__progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="mono tiny" style={{ color: "var(--ink-2)" }}>
                    {q.progress}/{q.target} {q.unit}
                  </span>
                </div>
              </div>
              <div className="quest-card-lg__cta">
                <div className="mono" style={{ color: "var(--mint)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                  +{q.reward}
                </div>
                <div className="mono tiny" style={{ color: "var(--ink-3)", marginBottom: 8 }}>
                  {q.rewardLabel}
                </div>
                <button className="btn btn--sm">
                  {q.cat === "quiz" ? "Start" : q.cat === "real" ? "Verify" : "Track"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {activeQuiz && (
        <QuizModal
          quest={activeQuiz}
          onClose={() => setActiveQuiz(null)}
          onReward={handleQuizDone}
        />
      )}
    </>
  );
}

Object.assign(window, { QuestsScreen, QuizModal, ALL_QUESTS });
