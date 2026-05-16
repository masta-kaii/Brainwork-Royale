/* ============================================================
   BRAINWORK ROYALE — BRAIN ENGINE
   Real ragdoll physics + tiny feed-forward NN + simple
   evolutionary trainer. Stage 0 goal: balance.

   Why not neataptic? CDN reliability + topology evolution is
   overkill for a 4-output balance task. The hand-rolled NN
   here is tiny (~40 LOC), portable (plain JSON weights), and
   matches the export contract we want for game engines.
   You can swap to neataptic / tfjs later without changing the
   exported brain JSON schema.

   Exposes on window:
     window.brainEngine = {
       isReady(),           — true once Rapier is initialised
       makeBrain(arch?),    — fresh random brain
       cloneBrain(b),
       mutate(b, opts?),
       forward(b, inputs),
       brainToJSON(b),      — portable export
       brainFromJSON(j),
       createRagdoll(world, opts), — Rapier multi-body humanoid
       evalBalance(brain, dtBudget) — episode runner; returns { fitness, trace }
       startTrainer(opts)   — high-level: returns a stateful trainer
     }
   ============================================================ */

// ============================================================
// Tiny feed-forward neural net
// ============================================================
const DEFAULT_ARCH = { inputs: 12, hidden: 16, outputs: 4 };

function _rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function _matrix(rows, cols, lo, hi) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => _rand(lo, hi))
  );
}
function _vec(n, lo, hi) {
  return Array.from({ length: n }, () => _rand(lo, hi));
}

function makeBrain(arch = DEFAULT_ARCH) {
  const { inputs, hidden, outputs } = arch;
  return {
    arch: { inputs, hidden, outputs, activation: "tanh" },
    w1: _matrix(hidden, inputs, -1, 1),
    b1: _vec(hidden, -0.1, 0.1),
    w2: _matrix(outputs, hidden, -1, 1),
    b2: _vec(outputs, -0.1, 0.1),
  };
}

function cloneBrain(b) {
  return {
    arch: { ...b.arch },
    w1: b.w1.map((r) => r.slice()),
    b1: b.b1.slice(),
    w2: b.w2.map((r) => r.slice()),
    b2: b.b2.slice(),
  };
}

function mutate(b, { rate = 0.15, sigma = 0.4 } = {}) {
  const c = cloneBrain(b);
  const m = (v) => (Math.random() < rate ? v + (Math.random() * 2 - 1) * sigma : v);
  c.w1 = c.w1.map((r) => r.map(m));
  c.b1 = c.b1.map(m);
  c.w2 = c.w2.map((r) => r.map(m));
  c.b2 = c.b2.map(m);
  return c;
}

function forward(b, x) {
  // h = tanh(w1·x + b1)
  const h = new Array(b.arch.hidden);
  for (let i = 0; i < b.arch.hidden; i++) {
    let s = b.b1[i];
    const row = b.w1[i];
    for (let j = 0; j < b.arch.inputs; j++) s += row[j] * x[j];
    h[i] = Math.tanh(s);
  }
  // y = tanh(w2·h + b2)
  const y = new Array(b.arch.outputs);
  for (let i = 0; i < b.arch.outputs; i++) {
    let s = b.b2[i];
    const row = b.w2[i];
    for (let j = 0; j < b.arch.hidden; j++) s += row[j] * h[j];
    y[i] = Math.tanh(s);
  }
  return y;
}

function brainToJSON(b, meta = {}) {
  return {
    schema: "brainwork-royale.brain.v1",
    arch: b.arch,
    weights: { w1: b.w1, b1: b.b1, w2: b.w2, b2: b.b2 },
    meta: { ...meta, exportedAt: Date.now() },
  };
}

function brainFromJSON(j) {
  return {
    arch: j.arch,
    w1: j.weights.w1, b1: j.weights.b1,
    w2: j.weights.w2, b2: j.weights.b2,
  };
}

// ============================================================
// Rapier ragdoll factory
// Capsule torso + 2 thighs + 2 shins, hinged at hips + knees.
// Feet are fixed colliders at the bottom of each shin (no joint).
// ============================================================
function isReady() { return !!window.RAPIER && !window.RAPIER_FAILED; }

function _capsuleBody(world, x, y, z, halfHeight, radius, density = 1.0) {
  const RAPIER = window.RAPIER;
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.1)
    .setAngularDamping(0.4);
  const body = world.createRigidBody(bodyDesc);
  const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
    .setDensity(density)
    .setFriction(0.9)
    .setRestitution(0.05);
  world.createCollider(colDesc, body);
  return body;
}

// Builds the 5-body humanoid + 4 joints. Returns refs we need each tick.
function createRagdoll(world, originX = 0, originZ = 0) {
  const RAPIER = window.RAPIER;
  // Body proportions (metres)
  const TORSO_HALF = 0.30, TORSO_R = 0.16;
  const THIGH_HALF = 0.22, THIGH_R = 0.10;
  const SHIN_HALF  = 0.22, SHIN_R  = 0.09;
  // Vertical positions for spawn pose (legs straight, torso upright)
  const SHIN_Y  = SHIN_HALF + SHIN_R + 0.02;                          // feet just above ground
  const THIGH_Y = SHIN_Y + SHIN_HALF + SHIN_R + THIGH_HALF + THIGH_R; // top of shin → centre of thigh
  // We want hip joint at top of thigh = THIGH_Y + THIGH_HALF + THIGH_R
  const HIP_Y   = THIGH_Y + THIGH_HALF + THIGH_R;
  const TORSO_Y = HIP_Y + TORSO_HALF + TORSO_R;
  const HIP_DX  = 0.13; // horizontal offset for each leg

  const torso  = _capsuleBody(world, originX,           TORSO_Y, originZ, TORSO_HALF, TORSO_R, 1.2);
  const lThigh = _capsuleBody(world, originX - HIP_DX,  THIGH_Y, originZ, THIGH_HALF, THIGH_R, 1.0);
  const rThigh = _capsuleBody(world, originX + HIP_DX,  THIGH_Y, originZ, THIGH_HALF, THIGH_R, 1.0);
  const lShin  = _capsuleBody(world, originX - HIP_DX,  SHIN_Y,  originZ, SHIN_HALF,  SHIN_R,  0.9);
  const rShin  = _capsuleBody(world, originX + HIP_DX,  SHIN_Y,  originZ, SHIN_HALF,  SHIN_R,  0.9);

  // Revolute joints around the X axis (pitch) — front/back swing.
  // anchor1/2 are local positions on each body in its own frame.
  function mkHip(thigh, sign) {
    const anchor1 = { x: sign * HIP_DX, y: -TORSO_HALF - TORSO_R, z: 0 }; // bottom-side of torso
    const anchor2 = { x: 0, y: THIGH_HALF + THIGH_R, z: 0 };               // top of thigh
    const axis = { x: 1, y: 0, z: 0 };
    const desc = RAPIER.JointData.revolute(anchor1, anchor2, axis);
    const j = world.createImpulseJoint(desc, torso, thigh, true);
    j.setLimits(-1.4, 1.4);                                                // ~80° each way
    return j;
  }
  function mkKnee(thigh, shin) {
    const anchor1 = { x: 0, y: -THIGH_HALF - THIGH_R, z: 0 };              // bottom of thigh
    const anchor2 = { x: 0, y:  SHIN_HALF  + SHIN_R,  z: 0 };              // top of shin
    const axis = { x: 1, y: 0, z: 0 };
    const desc = RAPIER.JointData.revolute(anchor1, anchor2, axis);
    const j = world.createImpulseJoint(desc, thigh, shin, true);
    j.setLimits(-0.05, 2.4);                                               // knee bends back only
    return j;
  }

  const lHip = mkHip(lThigh, -1);
  const rHip = mkHip(rThigh,  1);
  const lKnee = mkKnee(lThigh, lShin);
  const rKnee = mkKnee(rThigh, rShin);

  return {
    bodies: { torso, lThigh, rThigh, lShin, rShin },
    joints: { lHip, rHip, lKnee, rKnee },
    spawnY: TORSO_Y,
    // For the fitness check: head-of-torso current Y
    torsoTopY() {
      const t = torso.translation();
      return t.y + TORSO_HALF + TORSO_R;
    },
  };
}

function destroyRagdoll(world, rag) {
  const RAPIER = window.RAPIER;
  // Joints are auto-removed when their parent body is removed; we still
  // delete the bodies explicitly so the colliders go too.
  Object.values(rag.bodies).forEach((b) => world.removeRigidBody(b));
}

// ============================================================
// Episode runner — generalized: takes any env spec from the
// training-envs registry. The old evalBalance() wraps this.
// ============================================================
const PHYS_DT   = 1 / 60;
const TRACE_EVERY = 3;

// Build a fresh physics world with a static ground plane.
// Envs build everything else (ragdoll, platforms, targets, projectiles).
function makeWorld() {
  const RAPIER = window.RAPIER;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0);
  const ground = world.createRigidBody(groundDesc);
  const groundCol = RAPIER.ColliderDesc.cuboid(20, 0.05, 20).setFriction(0.95);
  world.createCollider(groundCol, ground);
  return world;
}

function evalEnv(env, brain, opts = {}) {
  const { worldFactory = makeWorld, recordTrace = false } = opts;
  const world = worldFactory();
  const envState = env.build(world);
  const trace = recordTrace ? [env.snapshot(envState)] : null;
  let ticks = 0;
  let alive = true;

  while (ticks < env.maxTicks && alive) {
    // 1. env-specific perturbation / scripted events
    env.envStep(envState, ticks);
    // 2. observe
    const obs = env.observe(envState);
    // 3. NN forward
    const out = forward(brain, obs);
    // 4. apply actions to bodies
    env.act(envState, out);
    // 5. physics step
    world.step();
    ticks++;
    if (recordTrace && ticks % TRACE_EVERY === 0) trace.push(env.snapshot(envState));
    // 6. termination check
    if (env.done(envState, ticks)) alive = false;
  }

  // Dispose physics bodies (best-effort — Rapier reclaims when world is freed)
  if (envState.rag) destroyRagdoll(world, envState.rag);
  world.free?.();

  const fitness = env.fitness(envState, ticks, alive);
  return { fitness, ticks, trace };
}

// Backwards-compat wrapper so any caller still using evalBalance keeps working.
function evalBalance(brain, opts = {}) {
  const env = window.trainingEnvs?.getEnv?.("balance", 1);
  if (!env) throw new Error("training-envs not loaded");
  return evalEnv(env, brain, opts);
}

// ============================================================
// Trainer — sequential evaluation, elitist GA, callbacks for UI.
// Now env-driven: caller passes the training env spec.
// ============================================================
function startTrainer({
  env,                       // env spec from training-envs.getEnv(skill, level)
  population = 16,
  seedBrain = null,
  onGenerationDone = null,   // ({ gen, bestFitness, avgFitness, bestBrain, bestTrace, env }) => void
}) {
  if (!env) throw new Error("startTrainer requires { env }");
  const arch = env.arch || DEFAULT_ARCH;

  // Initialise population. If we have a seed brain compatible with the env's
  // arch, use it; otherwise discard (different inputs/outputs) and start fresh.
  const seedCompatible = seedBrain
    && seedBrain.arch.inputs === arch.inputs
    && seedBrain.arch.outputs === arch.outputs;

  let pop = [];
  if (seedCompatible) {
    pop.push({ brain: cloneBrain(seedBrain), fitness: 0 });
    for (let i = 1; i < population; i++) {
      pop.push({ brain: mutate(seedBrain), fitness: 0 });
    }
  } else {
    for (let i = 0; i < population; i++) {
      pop.push({ brain: makeBrain(arch), fitness: 0 });
    }
  }
  let gen = 0;
  let stopped = false;

  async function runOneGeneration() {
    if (stopped) return null;
    gen++;
    let bestIdx = 0;
    for (let i = 0; i < pop.length; i++) {
      if (stopped) return null;
      const res = evalEnv(env, pop[i].brain, { recordTrace: false });
      pop[i].fitness = res.fitness;
      if (pop[i].fitness > pop[bestIdx].fitness) bestIdx = i;
      // Yield to the UI between evaluations
      await new Promise((r) => setTimeout(r, 0));
    }
    // Re-eval BEST with trace recording so we can visualize the winner
    const bestRes = evalEnv(env, pop[bestIdx].brain, { recordTrace: true });
    pop[bestIdx].fitness = bestRes.fitness;

    const bestFitness = pop[bestIdx].fitness;
    const avgFitness = pop.reduce((s, p) => s + p.fitness, 0) / pop.length;
    const bestBrain = cloneBrain(pop[bestIdx].brain);

    onGenerationDone?.({ gen, bestFitness, avgFitness, bestBrain, bestTrace: bestRes.trace, env });

    // Breed: keep top 4 elite, rest are mutated copies of top 2
    pop.sort((a, b) => b.fitness - a.fitness);
    const elite = pop.slice(0, 4).map((p) => ({ brain: cloneBrain(p.brain), fitness: 0 }));
    const next = [...elite];
    for (let i = elite.length; i < pop.length; i++) {
      const parent = pop[Math.floor(Math.random() * 2)].brain;
      next.push({ brain: mutate(parent, { rate: 0.18, sigma: 0.45 }), fitness: 0 });
    }
    pop = next;

    return { gen, bestFitness, avgFitness, bestBrain };
  }

  return {
    runOneGeneration,
    stop: () => { stopped = true; },
    get population() { return pop; },
    get currentGen() { return gen; },
  };
}

window.brainEngine = {
  // NN
  DEFAULT_ARCH, makeBrain, cloneBrain, mutate, forward,
  brainToJSON, brainFromJSON,
  // Physics
  isReady, makeWorld, createRagdoll, destroyRagdoll,
  // Episode + training
  evalEnv, evalBalance, startTrainer,
  // Constants exposed for the renderer
  PHYS_DT, TRACE_EVERY,
};
