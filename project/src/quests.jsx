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

// Expanded quiz bank — shuffled per session, no repeats within a session
const QUIZ_BANK = [
  { subject: "Math", q: "What is 7 × 8?", options: ["54", "56", "64", "48"], correct: 1 },
  { subject: "Math", q: "What is 15% of 200?", options: ["25", "30", "35", "40"], correct: 1 },
  { subject: "Math", q: "√144 = ?", options: ["10", "11", "12", "14"], correct: 2 },
  { subject: "Math", q: "What is 2⁸?", options: ["128", "256", "512", "64"], correct: 1 },
  { subject: "Math", q: "What is 3³ + 4²?", options: ["43", "31", "25", "37"], correct: 0 },
  { subject: "Math", q: "If x + 7 = 15, x = ?", options: ["6", "7", "8", "9"], correct: 2 },
  { subject: "Math", q: "Area of circle with r=5? π≈3.14", options: ["62.8", "78.5", "31.4", "15.7"], correct: 1 },
  { subject: "Math", q: "LCM of 6 and 8?", options: ["12", "24", "48", "16"], correct: 1 },
  { subject: "Math", q: "Sum of angles in a triangle?", options: ["90°", "180°", "270°", "360°"], correct: 1 },
  { subject: "Math", q: "Solve: 3x - 7 = 14", options: ["5", "6", "7", "8"], correct: 2 },
  { subject: "Math", q: "Square root of 169?", options: ["11", "12", "13", "14"], correct: 2 },
  { subject: "Math", q: "If a=3, b=4, a²+b²=?", options: ["25", "7", "12", "49"], correct: 0 },
  { subject: "History", q: "WW2 ended in?", options: ["1943", "1944", "1945", "1946"], correct: 2 },
  { subject: "History", q: "First US President?", options: ["Jefferson", "Adams", "Washington", "Lincoln"], correct: 2 },
  { subject: "History", q: "Berlin Wall fell in?", options: ["1987", "1988", "1989", "1990"], correct: 2 },
  { subject: "History", q: "Colosseum built by?", options: ["Greek", "Roman", "Persian", "Ottoman"], correct: 1 },
  { subject: "History", q: "Who discovered penicillin?", options: ["Pasteur", "Fleming", "Koch", "Jenner"], correct: 1 },
  { subject: "History", q: "French Revolution began?", options: ["1776", "1789", "1799", "1804"], correct: 1 },
  { subject: "History", q: "Who wrote 'The Art of War'?", options: ["Confucius", "Sun Tzu", "Lao Tzu", "Mencius"], correct: 1 },
  { subject: "Geography", q: "Capital of France?", options: ["London", "Berlin", "Paris", "Madrid"], correct: 2 },
  { subject: "Geography", q: "Largest continent?", options: ["Africa", "Asia", "Europe", "N.America"], correct: 1 },
  { subject: "Geography", q: "Longest river?", options: ["Amazon", "Yangtze", "Nile", "Mississippi"], correct: 2 },
  { subject: "Geography", q: "Capital of Japan?", options: ["Seoul", "Beijing", "Tokyo", "Bangkok"], correct: 2 },
  { subject: "Geography", q: "Most populous country?", options: ["USA", "India", "China", "Indonesia"], correct: 1 },
  { subject: "Science", q: "H₂O is?", options: ["Oxygen", "Hydrogen", "Water", "Helium"], correct: 2 },
  { subject: "Science", q: "Closest planet to Sun?", options: ["Venus", "Mercury", "Earth", "Mars"], correct: 1 },
  { subject: "Science", q: "Gas plants absorb?", options: ["Oxygen", "Nitrogen", "CO₂", "Hydrogen"], correct: 2 },
  { subject: "Science", q: "Speed of light ≈ ?", options: ["100k km/s", "200k km/s", "300k km/s", "400k km/s"], correct: 2 },
  { subject: "Science", q: "Bones in adult human?", options: ["186", "206", "226", "256"], correct: 1 },
  { subject: "Science", q: "Cell powerhouse?", options: ["Nucleus", "Ribosome", "Mitochondria", "Membrane"], correct: 2 },
  { subject: "Science", q: "Atomic number of Carbon?", options: ["4", "6", "8", "12"], correct: 1 },
];

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function QuizModal({ quest, onClose, onReward }) {
  const [step, setStep] = React.useState(0);
  const [answer, setAnswer] = React.useState(null);
  const [correctCount, setCorrectCount] = React.useState(0);
  const questionsRef = React.useRef(null);

  if (!questionsRef.current) {
    questionsRef.current = shuffleArray(QUIZ_BANK).slice(0, 5);
  }

  const TOTAL = questionsRef.current.length;
  const q = questionsRef.current[step];

  const pick = (i) => {
    if (answer != null) return;
    setAnswer(i);
    if (i === q.correct) setCorrectCount((c) => c + 1);
    setTimeout(() => {
      if (step + 1 >= TOTAL) {
        const score = correctCount + (i === q.correct ? 1 : 0);
        onReward({ ...quest, correct: score, total: TOTAL });
        onClose();
      } else {
        setStep((s) => s + 1);
        setAnswer(null);
      }
    }, 800);
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
