/* ============================================================
   BRAINWORK ROYALE — SIMULATION
   Pure deterministic battle sim (no rendering).
   Used by live battle (run frame-by-frame) and replays
   (run once + snapshot every tick).
   ============================================================ */

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
  return { grid, cols, rows, treasure: [ccx, ccy] };
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
const AGENT_NAMES = ["ALBRT-7", "VEX-22", "PYTH-13", "NOMAD-9", "GLITCH", "ORACLE", "RUST-4", "PRISM"];
const NON_YOU_CLASSES = ["polar", "angel", "rainbow", "helmet", "engineer", "polar", "angel"];

function createBattleSim(seed, you) {
  const cols = 21, rows = 15; // smaller for 3D performance
  const maze = genMaze(cols, rows, seed);
  const { grid, treasure } = maze;

  const spawnPool = [
    [1, 1], [cols - 2, 1], [1, rows - 2], [cols - 2, rows - 2],
    [Math.floor(cols / 2), 1], [Math.floor(cols / 2), rows - 2],
    [1, Math.floor(rows / 2)], [cols - 2, Math.floor(rows / 2)],
  ];

  const agents = [];
  for (let i = 0; i < 8; i++) {
    const [sx, sy] = spawnPool[i];
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
    const moveCooldown = Math.max(2, Math.floor(20 - effectiveSpeed * 0.15));
    const attackCooldownBase = Math.max(4, 8 - cdBonus);

    agents.push({
      id: i,
      name: i === 0 ? you.name : AGENT_NAMES[i],
      cls,
      color: c.color,
      isYou: i === 0,
      x: sx, y: sy,
      prevX: sx, prevY: sy,
      hp: baseHp,
      maxHp: baseHp,
      alive: true,
      cooldown: Math.floor(Math.random() * moveCooldown),
      moveCooldown,
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

  function step() {
    if (winner) return;
    tick++;

    for (const a of agents) {
      if (!a.alive) continue;
      a.cooldown--;
      a.attackCooldown = Math.max(0, a.attackCooldown - 1);

      let nearestEnemy = null, nearestD = Infinity;
      for (const b of agents) {
        if (b === a || !b.alive) continue;
        const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (d < nearestD && d <= a.vision) { nearestD = d; nearestEnemy = b; }
      }

      // adjacent combat
      if (nearestEnemy && Math.abs(a.x - nearestEnemy.x) + Math.abs(a.y - nearestEnemy.y) === 1) {
        // face enemy
        const dx = nearestEnemy.x - a.x, dy = nearestEnemy.y - a.y;
        a.facing = Math.atan2(dx, dy);
        if (a.attackCooldown === 0) {
          // Dodge — defender's dodgeChance (0–40) gates the hit
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

      if (a.cooldown > 0) continue;
      a.cooldown = a.moveCooldown;

      let goal;
      const aggressive = a.hp > a.maxHp * 0.35 && nearestEnemy && a.strength > 60;
      if (aggressive) {
        goal = [nearestEnemy.x, nearestEnemy.y];
      } else if (a.hp < a.maxHp * 0.3 && nearestEnemy) {
        const dx = a.x - nearestEnemy.x, dy = a.y - nearestEnemy.y;
        const gx = Math.max(1, Math.min(cols - 2, a.x + Math.sign(dx) * 4));
        const gy = Math.max(1, Math.min(rows - 2, a.y + Math.sign(dy) * 4));
        goal = [gx, gy];
      } else {
        goal = treasure;
      }

      if (!a.path || a.path.length < 2 || tick % 14 === 0) {
        a.path = bfsPath(grid, cols, rows, [a.x, a.y], goal);
      }

      if (a.path && a.path.length > 1) {
        const [nx, ny] = a.path[1];
        const blocked = agents.some((o) => o !== a && o.alive && o.x === nx && o.y === ny);
        if (!blocked) {
          a.prevX = a.x; a.prevY = a.y;
          a.facing = Math.atan2(nx - a.x, ny - a.y);
          a.x = nx; a.y = ny;
          a.lastMoveTick = tick;
          a.path.shift();
        } else {
          a.path = null;
        }
      }

      if (a.x === treasure[0] && a.y === treasure[1] && !treasureGrabbed) {
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

Object.assign(window, { genMaze, bfsPath, createBattleSim, buildReplay });
