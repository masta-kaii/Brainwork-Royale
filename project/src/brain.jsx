/* ============================================================
   BRAINWORK ROYALE — BRAIN
   AI profile: stat radar, generation timeline, neural net viz,
   behavior tags, training queue.
   ============================================================ */

// Behavior tags learned at each generation milestone
const BEHAVIOR_TAGS = {
  10:  ["Wanders", "Hits walls"],
  50:  ["Avoids walls", "Tracks treasure"],
  100: ["Tracks treasure", "Engages weakest enemy", "Hugs corridors"],
  150: ["Flees at low HP", "Predicts enemy paths", "Conserves stamina"],
  200: ["Baits chases", "Holds chokepoints", "Times treasure rush"],
  247: ["Reads ambush patterns", "Times treasure rush", "Counters Tanks", "Adaptive aggression"],
};

// Generation snapshots used by the timeline
const GEN_SNAPS = (() => {
  const out = [];
  let f = 5;
  for (let g = 1; g <= 247; g++) {
    f = Math.max(0, Math.min(100, f + (Math.random() - 0.4) * 3.5 + g * 0.03));
    out.push({ gen: g, fitness: f });
  }
  return out;
})();

function NeuralVizMini({ tick }) {
  // 3 layers: 12 inputs, 8 hidden, 5 outputs
  const layers = [12, 8, 5];
  const inputLabels = ["RAY-N", "RAY-NE", "RAY-E", "RAY-SE", "RAY-S", "RAY-SW", "RAY-W", "RAY-NW", "HP", "STA", "TREASURE-DIR", "ENEMY-D"];
  const outputLabels = ["MV-X", "MV-Y", "ATK", "DEF", "USE"];
  // Random connections precomputed
  const conns = React.useMemo(() => {
    const c = [];
    for (let l = 0; l < layers.length - 1; l++) {
      for (let i = 0; i < layers[l]; i++) {
        for (let j = 0; j < layers[l + 1]; j++) {
          // weight strength
          const w = Math.random() * 2 - 1;
          if (Math.abs(w) > 0.3) c.push({ from: [l, i], to: [l + 1, j], w });
        }
      }
    }
    return c;
  }, []);

  const W = 380, H = 220;
  const colX = (l) => (l / (layers.length - 1)) * (W - 60) + 30;
  const nodeY = (l, i) => {
    const n = layers[l];
    return (i / (n - 1 || 1)) * (H - 40) + 20;
  };

  // active firings change over tick
  const activeSet = React.useMemo(() => {
    const s = new Set();
    // randomize which inputs/outputs fire based on tick
    for (let i = 0; i < layers[0]; i++) {
      if ((Math.sin(tick * 0.07 + i) + 1) / 2 > 0.55) s.add(`0-${i}`);
    }
    for (let i = 0; i < layers[1]; i++) {
      if ((Math.sin(tick * 0.05 + i * 1.3) + 1) / 2 > 0.5) s.add(`1-${i}`);
    }
    for (let i = 0; i < layers[2]; i++) {
      if ((Math.sin(tick * 0.04 + i * 1.7) + 1) / 2 > 0.6) s.add(`2-${i}`);
    }
    return s;
  }, [tick]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* Connections */}
      {conns.map((c, idx) => {
        const x1 = colX(c.from[0]);
        const y1 = nodeY(c.from[0], c.from[1]);
        const x2 = colX(c.to[0]);
        const y2 = nodeY(c.to[0], c.to[1]);
        const active = activeSet.has(`${c.from[0]}-${c.from[1]}`) && activeSet.has(`${c.to[0]}-${c.to[1]}`);
        const opacity = Math.abs(c.w) * (active ? 0.9 : 0.18);
        const stroke = c.w > 0 ? "oklch(0.85 0.15 175)" : "oklch(0.7 0.22 0)";
        return (
          <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={stroke} strokeOpacity={opacity}
                strokeWidth={active ? 1.3 : 0.6} />
        );
      })}
      {/* Nodes */}
      {layers.map((n, l) => (
        Array.from({ length: n }).map((_, i) => {
          const cx = colX(l), cy = nodeY(l, i);
          const on = activeSet.has(`${l}-${i}`);
          return (
            <g key={`${l}-${i}`}>
              <circle cx={cx} cy={cy} r={on ? 6 : 4.5}
                      fill={on ? "oklch(0.85 0.15 175)" : "#1c2138"}
                      stroke={on ? "oklch(0.85 0.15 175)" : "#2a3052"}
                      strokeWidth="1" />
              {l === 0 && (
                <text x={cx - 8} y={cy + 3} fontSize="7" textAnchor="end"
                      fill="#8b91b8" fontFamily="JetBrains Mono">
                  {inputLabels[i]}
                </text>
              )}
              {l === 2 && (
                <text x={cx + 8} y={cy + 3} fontSize="7"
                      fill="#8b91b8" fontFamily="JetBrains Mono">
                  {outputLabels[i]}
                </text>
              )}
            </g>
          );
        })
      ))}
    </svg>
  );
}

function BrainScreen({ ai }) {
  const [selectedGen, setSelectedGen] = React.useState(ai.generation);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 180);
    return () => clearInterval(id);
  }, []);

  // pick the closest tag bucket
  const tagKeys = Object.keys(BEHAVIOR_TAGS).map(Number).sort((a, b) => a - b);
  let bucket = tagKeys[0];
  for (const k of tagKeys) if (k <= selectedGen) bucket = k;
  const tags = BEHAVIOR_TAGS[bucket];

  // sample snapshots for milestones
  const milestones = [1, 10, 50, 100, 150, 200, 247];

  return (
    <>
      <PageHeader
        eyebrow={`${ai.name} · base v1.2 · ${CLASSES[ai.class].name}`}
        title="Brain"
        meta={
          <>
            <span><span className="dot" />Training</span>
            <span>Gen #{ai.generation}</span>
            <span>{ai.trainingQueue} queued</span>
          </>
        }
      />
      <div className="page-body">

        {/* Top: stats radar + neural viz */}
        <div className="brain-grid">
          <div className="card">
            <div className="card__label">Body stats</div>
            <div className="row" style={{ alignItems: "flex-start", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
              <div className="radar-wrap">
                <StatRadar stats={ai.stats} color="oklch(0.85 0.15 175)" size={240} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <StatBlock stats={ai.stats} />
                <div className="divider" />
                <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
                  STAT BOOSTS THIS WEEK
                </div>
                <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <Chip variant="mint">+8 INT (quizzes)</Chip>
                  <Chip variant="mint">+6 STA (steps)</Chip>
                  <Chip variant="mint">+12 gens (focus)</Chip>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__label">Neural net · live preview</div>
            <div style={{ marginTop: 6, marginBottom: 12 }}>
              <NeuralVizMini tick={tick} />
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Chip>12 inputs · 8 hidden · 5 outputs</Chip>
              <Chip variant="mint">3,847 weights</Chip>
              <Chip variant="magenta">mutation rate 2.4%</Chip>
            </div>
            <div className="mono tiny" style={{ color: "var(--ink-3)", marginTop: 10 }}>
              Highlighted edges = currently firing. Mint = excitatory, magenta = inhibitory.
              Wire diagram is illustrative — real net has many more hidden units.
            </div>
          </div>
        </div>

        {/* Generation timeline */}
        <SectionTitle link="Open scrubber →">
          Generation timeline · Fitness over time
        </SectionTitle>
        <div className="card">
          <div className="row between" style={{ marginBottom: 8 }}>
            <div>
              <div className="mono tiny" style={{ color: "var(--ink-3)" }}>VIEWING</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)" }}>
                Generation #{selectedGen}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn--sm" onClick={() => setSelectedGen(Math.max(1, selectedGen - 10))}>−10</button>
              <button className="btn btn--sm" onClick={() => setSelectedGen(Math.min(ai.generation, selectedGen + 10))}>+10</button>
              <button className="btn btn--sm" onClick={() => setSelectedGen(ai.generation)}>LATEST</button>
            </div>
          </div>
          <div className="gen-timeline">
            {GEN_SNAPS.filter((_, i) => i % 4 === 0).map((s) => (
              <div
                key={s.gen}
                className={`gen-bar ${s.gen === selectedGen ? "is-current" : ""}`}
                style={{ height: `${5 + s.fitness * 0.95}%` }}
                onClick={() => setSelectedGen(s.gen)}
                title={`Gen ${s.gen} · fitness ${s.fitness.toFixed(1)}`}
              />
            ))}
          </div>
          <div className="row between mono tiny" style={{ color: "var(--ink-3)", marginTop: 8 }}>
            <span>Gen 1</span>
            <span>Gen 247 · NOW</span>
          </div>
        </div>

        {/* Behavior tag cloud + milestones */}
        <div className="brain-grid">
          <div className="card">
            <div className="card__label">Behavior signature · Gen #{selectedGen}</div>
            <div className="tag-cloud" style={{ marginTop: 8 }}>
              {tags.map((t, i) => (
                <span key={i} className="chip" style={{
                  color: "var(--mint)",
                  borderColor: "var(--mint-dim)",
                  background: "oklch(0.85 0.15 175 / 0.08)",
                  fontSize: 12,
                  padding: "6px 10px",
                }}>
                  ✓ {t}
                </span>
              ))}
            </div>
            <div className="divider" />
            <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
              Behaviors inferred from move-vector clustering across last 50 simulated matches.
            </div>
          </div>

          <div className="card">
            <div className="card__label">Training queue</div>
            <div className="row between" style={{ margin: "8px 0 12px" }}>
              <div>
                <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: "var(--ink-0)" }}>
                  {ai.trainingQueue}
                </div>
                <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
                  GENERATIONS PENDING
                </div>
              </div>
              <Chip variant="mint" dot>Running · Web Worker</Chip>
            </div>
            <div className="quest-item__progress">
              <div className="quest-item__progress-fill" style={{ width: "42%" }} />
            </div>
            <div className="divider" />
            <div className="mono tiny" style={{ color: "var(--ink-3)", marginBottom: 6 }}>
              SOURCES THIS BATCH
            </div>
            <div className="col" style={{ gap: 6 }}>
              <div className="row between mono tiny">
                <span>Focus sessions (×3)</span>
                <span style={{ color: "var(--mint)" }}>+9 gens</span>
              </div>
              <div className="row between mono tiny">
                <span>Quiz · linear algebra</span>
                <span style={{ color: "var(--mint)" }}>+2 gens</span>
              </div>
              <div className="row between mono tiny">
                <span>Daily streak bonus ×1.5</span>
                <span style={{ color: "var(--mint)" }}>+1 gen</span>
              </div>
            </div>
          </div>
        </div>

        {/* Milestones */}
        <SectionTitle>Brain milestones</SectionTitle>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}>
          {milestones.map((m) => {
            const tagBucket = tagKeys.filter((k) => k <= m).pop() ?? tagKeys[0];
            return (
              <div
                key={m}
                className="card"
                style={{
                  padding: 12,
                  cursor: "pointer",
                  borderColor: selectedGen === m ? "var(--mint)" : "var(--line-soft)",
                }}
                onClick={() => setSelectedGen(m)}
              >
                <div className="mono tiny" style={{ color: "var(--mint)", letterSpacing: "0.15em" }}>
                  GEN #{m}
                </div>
                <div className="mono" style={{ color: "var(--ink-0)", fontSize: 16, fontWeight: 700, margin: "4px 0" }}>
                  {Math.min(100, Math.round(5 + (m / 247) * 80))}.0
                </div>
                <div className="mono tiny" style={{ color: "var(--ink-3)" }}>
                  fitness
                </div>
                <div style={{ marginTop: 8, lineHeight: 1.4 }}>
                  {(BEHAVIOR_TAGS[tagBucket] || []).slice(0, 2).map((t, i) => (
                    <div key={i} className="mono tiny" style={{ color: "var(--ink-2)" }}>
                      ✓ {t}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { BrainScreen, NeuralVizMini, BEHAVIOR_TAGS });
