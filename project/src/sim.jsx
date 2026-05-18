/* ============================================================
   BRAINWORK ROYALE — SIMULATION
   Pure deterministic battle sim (no rendering).
   Used by live battle (run frame-by-frame) and replays
   (run once + snapshot every tick).
   ============================================================ */

// Obstacle catalog — placed on otherwise-walkable cells. Replay
// reads these straight off maze.obstacles so format is unchanged.
const OBSTACLE_TYPES = {
  SPIKE:  "spike",    // -8 hp on entry (cooldown per agent)
  SPEED:  "speed",    // boost: half move cooldown for N ticks
  SLOW:   "slow",     // 2x move cooldown for N ticks
  JUMP:   "jump",     // skip cells in facing dir; Jump skill = farther
  HURDLE: "hurdle",   // race-style low bar — auto-clears 1 cell forward;
                      //   Jump skill L1+ → 2 cells (faster crossing)
};

// ---------- Maze generation (recursive backtracker) ----------
function genMaze(cols, rows, seed) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const W = Math.floor((cols - 1) / 2);
  const H = Math.floor((rows - 1) / 2);
  const visited = Array.from({ length: H }, () => Array(W).fill(false));
  const cellTo = (cx, cy) => [cx * 2 + 1, cy * 2 + 1];

  const stack = [[0, 0]];
  visited[0][0] = true;
  const [sx, sy] = cellTo(0, 0);
  grid[sy][sx] = 0;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    let moved = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !visited[ny][nx]) {
        const [gx1, gy1] = cellTo(cx, cy);
        const [gx2, gy2] = cellTo(nx, ny);
        grid[(gy1 + gy2) / 2][(gx1 + gx2) / 2] = 0;
        grid[gy2][gx2] = 0;
        visited[ny][nx] = true;
        stack.push([nx, ny]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  // Center plaza for treasure
  const ccx = Math.floor(cols / 2), ccy = Math.floor(rows / 2);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = ccx + dx, y = ccy + dy;
      if (x >= 1 && x < cols - 1 && y >= 1 && y < rows - 1) grid[y][x] = 0;
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = 1 + Math.floor(rand() * (cols - 2));
    const y = 1 + Math.floor(rand() * (rows - 2));
    if (grid[y][x] === 1) grid[y][x] = 0;
  }

  // ---- Obstacles ----
  // Initialize a parallel grid; null = nothing on this cell.
  const obstacles = Array.from({ length: rows }, () => Array(cols).fill(null));

  // Eligible cells: open floor, not the treasure plaza, not the
  // 4 corner-ish spawn cells (avoid spawn-kill).
  const isPlazaOrSpawn = (x, y) => {
    if (Math.abs(x - ccx) <= 2 && Math.abs(y - ccy) <= 2) return true;
    const corners = [[1, 1], [cols - 2, 1], [1, rows - 2], [cols - 2, rows - 2]];
    return corners.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) <= 1);
  };

  const openCells = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (grid[y][x] === 0 && !isPlazaOrSpawn(x, y)) openCells.push([x, y]);
    }
  }

  // Distribution per match: tuned for a 21x15 maze (~120 open cells)
  const pickCount = (max) => Math.max(1, Math.floor(rand() * max));
  const placements = [
    [OBSTACLE_TYPES.SPIKE, pickCount(4) + 2],   // 2–5 spikes
    [OBSTACLE_TYPES.SPEED, pickCount(3) + 2],   // 2–4 speed pads
    [OBSTACLE_TYPES.SLOW,  pickCount(3) + 1],   // 1–3 slow puddles
    [OBSTACLE_TYPES.JUMP,  pickCount(3) + 1],   // 1–3 jump pads
  ];
  for (const [type, count] of placements) {
    for (let i = 0; i < count && openCells.length > 0; i++) {
      const idx = Math.floor(rand() * openCells.length);
      const [x, y] = openCells.splice(idx, 1)[0];
      obstacles[y][x] = { type };
    }
  }

  return { grid, cols, rows, treasure: [ccx, ccy], obstacles };
}

// ---------- BFS pathfinding ----------
function bfsPath(grid, cols, rows, start, goal) {
  const key = (x, y) => y * cols + x;
  const prev = new Map();
  const q = [start];
  const visited = new Set([key(start[0], start[1])]);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal[0] && y === goal[1]) {
      const path = [[x, y]];
      let cur = key(x, y);
      while (prev.has(cur)) {
        cur = prev.get(cur);
        const py = Math.floor(cur / cols), px = cur - py * cols;
        path.unshift([px, py]);
      }
      return path;
    }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (grid[ny][nx] === 1) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      visited.add(k);
      prev.set(k, key(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

// ---------- Battle simulation ----------
const AGENT_NAMES = ["Berok 1", "Berok 2", "Berok 3", "Berok 4", "Berok 5", "Berok 6", "Berok 7", "Berok 8"];
const NON_YOU_CLASSES = ["polar", "angel", "rainbow", "helmet", "engineer", "polar", "angel"];

// ---------- Race-track generator (open vertical corridor) ----------
// Used by the Race mode. Different shape (tall + narrow) from genMaze
// but returns the same { grid, cols, rows, treasure, obstacles } shape
// so scene3d.jsx and replays can render it transparently.
function genRaceTrack(cols, rows, seed) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  // Border walls only
  for (let x = 0; x < cols; x++) { grid[0][x] = 1; grid[rows - 1][x] = 1; }
  for (let y = 0; y < rows; y++) { grid[y][0] = 1; grid[y][cols - 1] = 1; }
  // Finish line at the top center — reuses the existing "treasure" mechanic
  const treasure = [Math.floor(cols / 2), 1];

  // Obstacles — denser than battle, biased toward jump pads + spikes
  const obstacles = Array.from({ length: rows }, () => Array(cols).fill(null));
  const eligible = [];
  for (let y = 3; y < rows - 3; y++) {
    for (let x = 1; x < cols - 1; x++) eligible.push([x, y]);
  }
  const place = (type, count) => {
    for (let i = 0; i < count && eligible.length; i++) {
      const idx = Math.floor(rand() * eligible.length);
      const [x, y] = eligible.splice(idx, 1)[0];
      obstacles[y][x] = { type };
    }
  };
  // Race-flavoured obstacle mix — hurdles dominate, fewer punishing spikes
  place(OBSTACLE_TYPES.HURDLE, Math.floor(rand() * 4) + 5); // 5–8 hurdles
  place(OBSTACLE_TYPES.SPIKE,  Math.floor(rand() * 3) + 2); // 2–4 spikes
  place(OBSTACLE_TYPES.JUMP,   Math.floor(rand() * 3) + 2); // 2–4 jump pads
  place(OBSTACLE_TYPES.SLOW,   Math.floor(rand() * 3) + 2); // 2–4 slow puddles
  place(OBSTACLE_TYPES.SPEED,  Math.floor(rand() * 4) + 4); // 4–7 speed pads

  return { grid, cols, rows, treasure, obstacles, isRace: true };
}

// ---------- Spawn pool helpers ----------
function defaultBattleSpawns(cols, rows) {
  return [
    [1, 1], [cols - 2, 1], [1, rows - 2], [cols - 2, rows - 2],
    [Math.floor(cols / 2), 1], [Math.floor(cols / 2), rows - 2],
    [1, Math.floor(rows / 2)], [cols - 2, Math.floor(rows / 2)],
  ];
}
function defaultRaceSpawns(cols, rows, n) {
  const startY = rows - 2;
  const spacing = Math.max(1, Math.floor((cols - 2) / n));
  return Array.from({ length: n }, (_, i) =>
    [Math.min(cols - 2, 1 + i * spacing + Math.floor(spacing / 2)), startY]
  );
}

function createBattleSim(seed, you, opts) {
  const cols = opts?.cols ?? 21;
  const rows = opts?.rows ?? 15;
  const mazeGen = opts?.mazeGen ?? genMaze;
  const numAgents = opts?.numAgents ?? 8;
  const botBrains = opts?.botBrains || [];   // pre-loaded brain JSONs for opposing agents
  const maze = mazeGen(cols, rows, seed);
  const { grid, treasure, obstacles } = maze;
  const spawnPool = opts?.spawnPool ?? defaultBattleSpawns(cols, rows);

  const agents = [];
  for (let i = 0; i < numAgents; i++) {
    const [sx, sy] = spawnPool[i % spawnPool.length];
    if (grid[sy][sx] === 1) grid[sy][sx] = 0;
    const cls = i === 0 ? you.class : NON_YOU_CLASSES[i - 1];
    const c = CLASSES[cls];
    const baseHp = 100;

    // Skill bonuses — only apply to the player's agent. Skills come
    // in as you.skills = { run: { level, ... }, ... } from Firestore.
    let speedBonus = 0, stamBonus = 0, strBonus = 0, cdBonus = 0, dodgeChance = 0;
    if (i === 0 && you.skills) {
      const s = you.skills;
      speedBonus  = (s.run?.level || 0) * 8 + (s.dodge?.level || 0) * 4;
      stamBonus   = (s.walk?.level || 0) * 8 + (s.jump?.level || 0) * 4;
      strBonus    = (s.attack?.level || 0) * 6 + (s.combo?.level || 0) * 8;
      cdBonus     = (s.combo?.level || 0);
      dodgeChance = Math.min(40, (s.dodge?.level || 0) * 12);
    }

    const effectiveSpeed = c.stats.speed + speedBonus;
    // Cells advanced per tick (sim runs at 100 ms ticks). Tuned so default
    // speed (50) yields ~2.5 cells/sec and max-trained Run gives ~3.7.
    const speedPerTick = Math.max(0.08, effectiveSpeed * 0.005);
    const attackCooldownBase = Math.max(4, 8 - cdBonus);

    // Bot agents get a brain too — the player's trained brain goes to the
    // player, and any pre-loaded bot brains are cycled through opponents.
    // A bot with a brain moves faster (brainBoost) just like the player.
    const agentBrain = i === 0
      ? (you.brain || null)
      : (botBrains[(i - 1) % botBrains.length] || null);

    agents.push({
      id: i,
      name: i === 0 ? you.name : AGENT_NAMES[i],
      cls,
      color: c.color,
      isYou: i === 0,
      // Reference to an exported brain JSON. If a trained locomotion
      // brain is attached we run inference each step and use its output
      // magnitude to modulate move cooldown — the trained bear visibly
      // moves more decisively than an untrained one. Bot agents cycle
      // through any pre-loaded bot brains.
      brain: agentBrain,
      brainBoost: 1.0,                              // updated each tick if brain present
      x: sx, y: sy,                 // continuous floats
      prevX: sx, prevY: sy,
      lastCellX: sx, lastCellY: sy, // for obstacle-on-entry detection
      hp: baseHp,
      maxHp: baseHp,
      alive: true,
      speedPerTick,
      radius: 0.35,
      strength: c.stats.strength + strBonus,
      vision: 4 + Math.floor(c.stats.intelligence / 20),
      stamina: c.stats.stamina + stamBonus,
      attackCooldownBase,
      dodgeChance, // 0–40
      path: null,
      attackCooldown: 0,
      lastDamageAt: -100,
      lastAttackAt: -100,
      lastMoveTick: 0,
      facing: 0, // radians
    });
  }

  let tick = 0;
  let winner = null;
  let treasureGrabbed = false;
  const events = [];

  // ---- Continuous-movement step ----
  // Agents have float (x, y). Each tick they advance toward path[1] by
  // their speed (cells/tick). Combat, treasure, and obstacles all use
  // distance / floor-cell checks instead of integer equality. Sim runs
  // ~10 ticks/sec (battle.jsx tunes TICK_MS); each tick is small so
  // movement reads continuous to the renderer.
  function step() {
    if (winner) return;
    tick++;

    for (const a of agents) {
      if (!a.alive) continue;
      a.attackCooldown = Math.max(0, a.attackCooldown - 1);

      // Find nearest enemy (within vision)
      let nearestEnemy = null, nearestD = Infinity;
      for (const b of agents) {
        if (b === a || !b.alive) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < nearestD && d <= a.vision) { nearestD = d; nearestEnemy = b; }
      }

      // ---- Combat — engage when within striking range ----
      if (nearestEnemy && nearestD < 1.2) {
        const dx = nearestEnemy.x - a.x, dy = nearestEnemy.y - a.y;
        a.facing = Math.atan2(dx, dy);
        if (a.attackCooldown === 0) {
          if (nearestEnemy.dodgeChance && Math.random() * 100 < nearestEnemy.dodgeChance) {
            a.attackCooldown = a.attackCooldownBase || 8;
            a.lastAttackAt = tick;
            events.push({ t: tick, kind: "dodge", from: a.id, to: nearestEnemy.id });
          } else {
            const dmg = 6 + Math.floor(a.strength * 0.18);
            nearestEnemy.hp -= dmg;
            nearestEnemy.lastDamageAt = tick;
            a.attackCooldown = a.attackCooldownBase || 8;
            a.lastAttackAt = tick;
            events.push({ t: tick, kind: "hit", from: a.id, to: nearestEnemy.id, dmg });
            if (nearestEnemy.hp <= 0) {
              nearestEnemy.alive = false;
              events.push({ t: tick, kind: "ko", from: a.id, to: nearestEnemy.id });
            }
          }
        }
        continue;
      }

      // ---- Pick a goal cell ----
      let goal;
      const aggressive = a.hp > a.maxHp * 0.35 && nearestEnemy && a.strength > 60;
      if (aggressive) {
        goal = [Math.floor(nearestEnemy.x), Math.floor(nearestEnemy.y)];
      } else if (a.hp < a.maxHp * 0.3 && nearestEnemy) {
        const dx = a.x - nearestEnemy.x, dy = a.y - nearestEnemy.y;
        const gx = Math.max(1, Math.min(cols - 2, Math.floor(a.x) + Math.sign(dx) * 4));
        const gy = Math.max(1, Math.min(rows - 2, Math.floor(a.y) + Math.sign(dy) * 4));
        goal = [gx, gy];
      } else {
        goal = treasure;
      }

      // ---- Refresh path from the agent's current cell ----
      const cellX = Math.floor(a.x), cellY = Math.floor(a.y);
      if (!a.path || a.path.length < 2 || tick % 12 === 0) {
        a.path = bfsPath(grid, cols, rows, [cellX, cellY], goal);
      }

      // ---- Brain inference (any agent with a trained brain attached) ----
      // The exported locomotion brain runs forward with a synthesized
      // observation; its output magnitude becomes a speed multiplier so
      // a trained bear visibly moves with more conviction than an untrained one.
      if (a.brain && a.path && a.path.length > 1) {
        const fe = window.brainEngine?.forward;
        if (fe) {
          // 12 zeros (no physics torso/joint info in battle) + 2 target offsets
          const [wx0, wy0] = a.path[1];
          const inputs = new Array(a.brain.arch.inputs).fill(0);
          if (inputs.length >= 14) {
            inputs[12] = (wx0 - a.x) / 10;
            inputs[13] = (wy0 - a.y) / 10;
          }
          const out = fe(a.brain, inputs);
          let mag = 0;
          for (const o of out) mag += Math.abs(o);
          mag /= out.length || 1;
          // Map [0..1] → [1.0..1.5] — modest, observable speed bonus
          a.brainBoost = 1.0 + Math.min(0.5, mag * 0.5);
        }
      }

      // ---- Advance toward the next waypoint ----
      if (a.path && a.path.length > 1) {
        let stepDist = a.speedPerTick * (a.brainBoost || 1);
        if ((a.boostUntil || 0) > tick) stepDist *= 2;
        if ((a.slowUntil || 0)  > tick) stepDist *= 0.5;

        const [wx, wy] = a.path[1];
        const dx = wx - a.x, dy = wy - a.y;
        const dist = Math.hypot(dx, dy);
        a.prevX = a.x; a.prevY = a.y;

        if (dist <= stepDist) {
          // Reached waypoint — snap + advance the path
          a.x = wx; a.y = wy;
          a.path.shift();
        } else {
          a.x += (dx / dist) * stepDist;
          a.y += (dy / dist) * stepDist;
        }
        if (dx !== 0 || dy !== 0) a.facing = Math.atan2(dx, dy);
        a.lastMoveTick = tick;
      }

      // ---- Obstacle effect when crossing into a new cell ----
      const newCellX = Math.floor(a.x), newCellY = Math.floor(a.y);
      if (newCellX !== a.lastCellX || newCellY !== a.lastCellY) {
        a.lastCellX = newCellX;
        a.lastCellY = newCellY;
        const ob = obstacles?.[newCellY]?.[newCellX];
        if (ob) {
          switch (ob.type) {
            case OBSTACLE_TYPES.SPIKE: {
              if ((a.lastSpikeAt || -100) < tick - 10) {
                const dmg = 8;
                a.hp -= dmg;
                a.lastSpikeAt = tick;
                a.lastDamageAt = tick;
                events.push({ t: tick, kind: "spike", to: a.id, dmg });
                if (a.hp <= 0) {
                  a.alive = false;
                  events.push({ t: tick, kind: "ko", from: -1, to: a.id });
                }
              }
              break;
            }
            case OBSTACLE_TYPES.SPEED: {
              a.boostUntil = tick + 12;
              events.push({ t: tick, kind: "boost", to: a.id });
              break;
            }
            case OBSTACLE_TYPES.SLOW: {
              a.slowUntil = tick + 9;
              events.push({ t: tick, kind: "slow", to: a.id });
              break;
            }
            case OBSTACLE_TYPES.JUMP: {
              const jumpDist = (a.isYou && (you.skills?.jump?.level || 0) >= 1) ? 3 : 2;
              const fx = Math.round(Math.sin(a.facing));
              const fy = Math.round(Math.cos(a.facing));
              let landedX = newCellX, landedY = newCellY;
              for (let s = 1; s <= jumpDist; s++) {
                const tx = newCellX + fx * s, ty = newCellY + fy * s;
                if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) break;
                if (grid[ty][tx] === 1) break;
                landedX = tx; landedY = ty;
              }
              if (landedX !== newCellX || landedY !== newCellY) {
                a.x = landedX; a.y = landedY;
                a.lastCellX = landedX; a.lastCellY = landedY;
                a.path = null;
                events.push({ t: tick, kind: "jump", to: a.id });
              }
              break;
            }
            case OBSTACLE_TYPES.HURDLE: {
              // Auto-clear: agent skips 1 cell forward (2 if trained Jump).
              // Difference from JUMP: smaller hop, no random "free 3-cell teleport"
              // — feels like an athletic hurdle clearance in a race.
              const hurdleDist = (a.isYou && (you.skills?.jump?.level || 0) >= 1) ? 2 : 1;
              const fx = Math.round(Math.sin(a.facing));
              const fy = Math.round(Math.cos(a.facing));
              let landedX = newCellX, landedY = newCellY;
              for (let s = 1; s <= hurdleDist; s++) {
                const tx = newCellX + fx * s, ty = newCellY + fy * s;
                if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) break;
                if (grid[ty][tx] === 1) break;
                landedX = tx; landedY = ty;
              }
              if (landedX !== newCellX || landedY !== newCellY) {
                a.x = landedX; a.y = landedY;
                a.lastCellX = landedX; a.lastCellY = landedY;
                a.path = null;
                events.push({ t: tick, kind: "hurdle", to: a.id });
              }
              break;
            }
          }
        }
      }

      // ---- Treasure / finish-line pickup (distance-based) ----
      if (!treasureGrabbed && Math.hypot(a.x - treasure[0], a.y - treasure[1]) < 0.7) {
        treasureGrabbed = true;
        winner = a;
        events.push({ t: tick, kind: "treasure", from: a.id });
      }
    }

    const alive = agents.filter((a) => a.alive);
    if (alive.length === 1 && !winner) {
      winner = alive[0];
      events.push({ t: tick, kind: "last", from: winner.id });
    }
  }

  return {
    maze, agents, step, events,
    cols, rows, treasure,
    get tick() { return tick; },
    get winner() { return winner; },
    get treasureGrabbed() { return treasureGrabbed; },
  };
}

// Race mode factory — same engine, different map + spawn shape
function createRaceSim(seed, you, extraOpts = {}) {
  const cols = 9, rows = 30;
  return createBattleSim(seed, you, {
    cols, rows,
    mazeGen: genRaceTrack,
    numAgents: 6,
    spawnPool: defaultRaceSpawns(cols, rows, 6),
    ...extraOpts,
  });
}

// Daily maze factory — deterministic from UTC date, uses ghost opponents.
// Ghosts are loaded from Firestore (or simulated locally if none exist).
function createDailySim(you, ghostRuns) {
  const seed = dailyMazeSeed();
  const cols = 21, rows = 21;
  const maze = genMaze(cols, rows, seed);
  maze._seed = seed;

  // Build ghost brains from stored runs
  const ghostBrains = (ghostRuns || []).map(r => {
    try { return window.brainEngine?.brainFromJSON?.(r) || null; }
    catch (e) { return null; }
  }).filter(Boolean);

  // Fill remaining slots with random bot brains
  const numGhosts = Math.max(1, Math.min(15, ghostBrains.length || 7));
  const botBrains = Array.from({ length: numGhosts }, (_, i) =>
    ghostBrains[i] || window.brainEngine?.makeBrain?.(window.brainEngine?.DEFAULT_ARCH) || null
  );

  return createBattleSim(seed, you, {
    cols, rows,
    mazeGen: (c, r, s) => maze,
    numAgents: botBrains.length + 1,
    spawnPool: defaultBattleSpawns(cols, rows),
    botBrains,
  });
}

// Daily maze seed from UTC date (same for all players)
function dailyMazeSeed() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// Run a sim to completion (or maxTicks) and produce a replay record:
// - per-tick snapshots of every agent's pos/hp/state
function buildReplay(seed, you, maxTicks = 800) {
  const sim = createBattleSim(seed, you);
  const snaps = [];
  // initial
  const snap = () => {
    snaps.push(sim.agents.map((a) => ({
      x: a.x, y: a.y, prevX: a.prevX, prevY: a.prevY,
      hp: a.hp, alive: a.alive, facing: a.facing,
      lastDamageAt: a.lastDamageAt, lastAttackAt: a.lastAttackAt,
      lastMoveTick: a.lastMoveTick,
    })));
  };
  snap();
  while (!sim.winner && sim.tick < maxTicks) {
    sim.step();
    snap();
  }
  return {
    seed,
    maze: sim.maze,
    treasure: sim.treasure,
    cols: sim.cols, rows: sim.rows,
    agents: sim.agents.map((a) => ({
      id: a.id, name: a.name, cls: a.cls, color: a.color,
      isYou: a.isYou, maxHp: a.maxHp,
    })),
    snaps,
    events: sim.events,
    totalTicks: sim.tick,
    winnerId: sim.winner ? sim.winner.id : null,
  };
}

Object.assign(window, {
  genMaze, genRaceTrack, bfsPath,
  createBattleSim, createRaceSim, createDailySim,
  dailyMazeSeed,
  buildReplay,
});
