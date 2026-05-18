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
  // Higher damping so the ragdoll settles quickly instead of swinging forever
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.8)
    .setAngularDamping(2.5);
  const body = world.createRigidBody(bodyDesc);
  const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
    .setDensity(density)
    .setFriction(1.5)
    .setRestitution(0.0);
  world.createCollider(colDesc, body);
  return body;
}

// Builds the humanoid + joints. Returns refs we need each tick.
// 7 bodies: torso, 2 thighs, 2 shins, 2 feet (passive).
// 6 joints: 2 hips + 2 knees (brain-driven), 2 ankles (passive, dangle).
function createRagdoll(world, originX = 0, originZ = 0) {
  const RAPIER = window.RAPIER;

  // Try to match PEP-Smol model skeleton. If bone positions are available
  // (extracted in scene3d.jsx), use them. Otherwise fall back to defaults.
  const bp = window._pepBonePositions || {};
  const hasBones = bp["Hips"] || bp["mixamorig:Hips"] || false;

  // Default PEP-Smol proportions (short, wide, chubby bear)
  const TORSO_HALF = 0.26, TORSO_R = 0.22;
  const THIGH_HALF = 0.16, THIGH_R = 0.12;
  const SHIN_HALF  = 0.15, SHIN_R  = 0.11;
  const FOOT_HALF  = 0.08, FOOT_R  = 0.07;
  const HIP_DX  = 0.16;

  // If we have bone data, use it to position bodies precisely
  let TORSO_Y, THIGH_Y, SHIN_Y, FOOT_Y;
  if (hasBones) {
    // Find hip/spine bone — try multiple naming conventions
    const hip = bp["Hips"] || bp["mixamorig:Hips"] || bp["Spine"] || bp["mixamorig:Spine"]
      || bp["Root"] || bp["Armature"] || Object.values(bp).find(p => p.y > 1 && p.y < 2.5) || { y: 1.72 };
    const lThighBone = bp["Left_Thigh-Local"] || bp["LeftUpLeg"] || bp["mixamorig:LeftUpLeg"]
      || bp["Left_Thigh"] || Object.values(bp).find(p => p.x < -0.1 && p.y > 0.8 && p.y < 1.4) || { y: 1.16 };
    const rThighBone = bp["Right_Thigh-Local"] || bp["RightUpLeg"] || bp["mixamorig:RightUpLeg"]
      || bp["Right_Thigh"] || Object.values(bp).find(p => p.x > 0.1 && p.y > 0.8 && p.y < 1.4) || { y: 1.16 };
    const lLegBone = bp["Left_Leg-Local"] || bp["LeftLeg"] || bp["mixamorig:LeftLeg"]
      || bp["Left_Leg"] || Object.values(bp).find(p => p.x < -0.1 && p.y > 0.2 && p.y < 0.8) || { y: 0.42 };
    const rLegBone = bp["Right_Leg-Local"] || bp["RightLeg"] || bp["mixamorig:RightLeg"]
      || bp["Right_Leg"] || Object.values(bp).find(p => p.x > 0.1 && p.y > 0.2 && p.y < 0.8) || { y: 0.42 };
    const lFootBone = bp["Left_Foot-Local"] || bp["LeftFoot"] || bp["mixamorig:LeftFoot"]
      || bp["Left_Foot"] || Object.values(bp).find(p => p.x < -0.1 && p.y < 0.2) || { y: 0.08 };
    const rFootBone = bp["Right_Foot-Local"] || bp["RightFoot"] || bp["mixamorig:RightFoot"]
      || bp["Right_Foot"] || Object.values(bp).find(p => p.x > 0.1 && p.y < 0.2) || { y: 0.08 };

    TORSO_Y = hip.y;
    THIGH_Y = (lThighBone.y + rThighBone.y) / 2;
    SHIN_Y = (lLegBone.y + rLegBone.y) / 2;
    FOOT_Y = (lFootBone.y + rFootBone.y) / 2;
  } else {
    // Fallback computed positions
    FOOT_Y  = FOOT_R + 0.01;
    SHIN_Y  = FOOT_Y + FOOT_R + SHIN_HALF + SHIN_R + 0.01;
    THIGH_Y = SHIN_Y + SHIN_HALF + SHIN_R + THIGH_HALF + THIGH_R;
    TORSO_Y = THIGH_Y + THIGH_HALF + THIGH_R + TORSO_HALF + TORSO_R;
  }

  const torso  = _capsuleBody(world, originX,           TORSO_Y, originZ, TORSO_HALF, TORSO_R, 1.2);
  const lThigh = _capsuleBody(world, originX - HIP_DX,  THIGH_Y, originZ, THIGH_HALF, THIGH_R, 1.0);
  const rThigh = _capsuleBody(world, originX + HIP_DX,  THIGH_Y, originZ, THIGH_HALF, THIGH_R, 1.0);
  const lShin  = _capsuleBody(world, originX - HIP_DX,  SHIN_Y,  originZ, SHIN_HALF,  SHIN_R,  0.9);
  const rShin  = _capsuleBody(world, originX + HIP_DX,  SHIN_Y,  originZ, SHIN_HALF,  SHIN_R,  0.9);
  // Feet — small flat capsules. Brain doesn't see/control them; ankle joints
  // are passive (limits but no motor). This adds realistic ground contact
  // and prevents the shin from spinning recklessly.
  const lFoot  = _capsuleBody(world, originX - HIP_DX,  FOOT_Y,  originZ + 0.02, FOOT_HALF, FOOT_R, 1.1);
  const rFoot  = _capsuleBody(world, originX + HIP_DX,  FOOT_Y,  originZ + 0.02, FOOT_HALF, FOOT_R, 1.1);

  // ---- Joints ----
  // Revolute joints around the X axis (pitch) — front/back swing.
  function mkHip(thigh, sign) {
    const anchor1 = { x: sign * HIP_DX, y: -TORSO_HALF - TORSO_R, z: 0 };
    const anchor2 = { x: 0, y: THIGH_HALF + THIGH_R, z: 0 };
    const axis = { x: 1, y: 0, z: 0 };
    const desc = RAPIER.JointData.revolute(anchor1, anchor2, axis);
    const j = world.createImpulseJoint(desc, torso, thigh, true);
    j.setLimits(-1.0, 1.0);
    return j;
  }
  function mkKnee(thigh, shin) {
    const anchor1 = { x: 0, y: -THIGH_HALF - THIGH_R, z: 0 };
    const anchor2 = { x: 0, y:  SHIN_HALF  + SHIN_R,  z: 0 };
    const axis = { x: 1, y: 0, z: 0 };
    const desc = RAPIER.JointData.revolute(anchor1, anchor2, axis);
    const j = world.createImpulseJoint(desc, thigh, shin, true);
    j.setLimits(-0.05, 1.6);
    return j;
  }
  function mkAnkle(shin, foot) {
    const anchor1 = { x: 0, y: -SHIN_HALF - SHIN_R, z: 0 };
    const anchor2 = { x: 0, y:  FOOT_R,             z: -0.02 };
    const axis = { x: 1, y: 0, z: 0 };
    const desc = RAPIER.JointData.revolute(anchor1, anchor2, axis);
    const j = world.createImpulseJoint(desc, shin, foot, true);
    j.setLimits(-0.5, 0.5);
    return j;
  }

  const lHip = mkHip(lThigh, -1);
  const rHip = mkHip(rThigh,  1);
  const lKnee = mkKnee(lThigh, lShin);
  const rKnee = mkKnee(rThigh, rShin);
  const lAnkle = mkAnkle(lShin, lFoot);   // passive — not exposed to brain
  const rAnkle = mkAnkle(rShin, rFoot);

  return {
    bodies: { torso, lThigh, rThigh, lShin, rShin, lFoot, rFoot },
    joints: { lHip, rHip, lKnee, rKnee, lAnkle, rAnkle },
    spawnY: TORSO_Y,
    feetY: FOOT_Y - FOOT_R - 0.02,
    torsoToFeet: TORSO_Y - (FOOT_Y - FOOT_R - 0.02),
    torsoHalf: TORSO_HALF,
    torsoRadius: TORSO_R,
    thighHalf: THIGH_HALF,
    thighRadius: THIGH_R,
    shinHalf: SHIN_HALF,
    shinRadius: SHIN_R,
    footHalf: FOOT_HALF,
    footRadius: FOOT_R,
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

  const ROOM_W = 10, ROOM_D = 10, ROOM_H = 4;
  const WALL_DEPTH = 0.5;  // thicker walls prevent tunneling

  // Thick solid floor — prevents feet from pushing through
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.4, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(ROOM_W, 0.4, ROOM_D).setFriction(1.2).setRestitution(0.0), floorBody);

  // Thick walls — 4 sides, high friction
  for (const [x, z] of [[0, -ROOM_D], [0, ROOM_D], [-ROOM_W, 0], [ROOM_W, 0]]) {
    const isX = z === 0;
    const w = isX ? WALL_DEPTH : ROOM_W;
    const d = isX ? ROOM_D : WALL_DEPTH;
    const wBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, ROOM_H / 2, z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(w, ROOM_H / 2, d).setFriction(1.0).setRestitution(0.0), wBody);
  }

  return world;
}

function evalEnv(env, brain, opts = {}) {
  const { worldFactory = makeWorld, recordTrace = false } = opts;
  const world = worldFactory();
  const envState = env.build(world);
  if (env.buildProps) {
    envState.props = env.buildProps(world);
  }

  // Warmup: run N physics ticks with zero brain output so the ragdoll
  // can settle from its spawn pose. Noisy initial weights would
  // otherwise knock it over before the timed episode begins.
  const warmupTicks = env.warmupTicks || 0;
  const zeros = new Array(env.arch?.outputs || 4).fill(0);
  for (let w = 0; w < warmupTicks; w++) {
    env.act(envState, zeros);
    world.step();
  }

  const trace = recordTrace ? [env.snapshot(envState)] : null;
  let ticks = 0;
  let alive = true;

  while (ticks < env.maxTicks && alive) {
    env.envStep(envState, ticks, world);
    const obs = env.observe(envState);
    const out = forward(brain, obs);
    env.act(envState, out);
    world.step();
    ticks++;
    if (recordTrace && ticks % TRACE_EVERY === 0) trace.push(env.snapshot(envState));
    if (env.done(envState, ticks)) alive = false;
  }

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

// Parallel batch evaluation — runs N independent brains step-locked in
// their own physics worlds. Used by the "population view" so you see
// multiple bears attempting the same env simultaneously.
function evalEnvBatch(env, brains, opts = {}) {
  const { worldFactory = makeWorld, recordTrace = false } = opts;
  const states = brains.map((brain) => {
    const world = worldFactory();
    const envState = env.build(world);
    if (env.buildProps) envState.props = env.buildProps(world);
    return {
      world, envState, brain,
      alive: true,
      ticks: 0,
      trace: recordTrace ? [env.snapshot(envState)] : null,
    };
  });

  // Warmup: run N physics ticks with zero brain output so each ragdoll
  // settles from its spawn pose before the timed episode begins.
  const warmupTicks = env.warmupTicks || 0;
  const zeros = new Array(env.arch?.outputs || 4).fill(0);
  for (const s of states) {
    for (let w = 0; w < warmupTicks; w++) {
      env.act(s.envState, zeros);
      s.world.step();
    }
  }

  // All brains step in lockstep. A brain that "dies" (env.done) stops
  // stepping but its world is kept alive so the others keep going.
  let anyAlive = true;
  while (anyAlive) {
    anyAlive = false;
    for (const s of states) {
      if (!s.alive) continue;
      env.envStep(s.envState, s.ticks, s.world);
      const obs = env.observe(s.envState);
      const out = forward(s.brain, obs);
      env.act(s.envState, out);
      s.world.step();
      s.ticks++;
      if (recordTrace && s.ticks % TRACE_EVERY === 0) s.trace.push(env.snapshot(s.envState));
      if (env.done(s.envState, s.ticks) || s.ticks >= env.maxTicks) {
        s.alive = false;
      } else {
        anyAlive = true;
      }
    }
  }

  const results = states.map((s) => {
    const finalAlive = s.ticks < env.maxTicks && !env.done(s.envState, s.ticks);
    const fitness = env.fitness(s.envState, s.ticks, finalAlive);
    if (s.envState.rag) destroyRagdoll(s.world, s.envState.rag);
    s.world.free?.();
    return { fitness, ticks: s.ticks, trace: s.trace };
  });
  return results;
}

// ============================================================
// Trainer — sequential evaluation, elitist GA, callbacks for UI.
// Now env-driven: caller passes the training env spec.
// ============================================================
function startTrainer({
  env,                       // env spec from training-envs.getEnv(skill, level)
  population: popOverride = null,
  visPopulation = 1,
  seedBrain = null,
  onGenerationDone = null,   // ({ gen, bestFitness, avgFitness, stdFitness, bestBrain, traces[], env })
}) {
  if (!env) throw new Error("startTrainer requires { env }");
  const arch = env.arch || DEFAULT_ARCH;
  // Per-env tuning hooks — Walk uses these to dial up population, soften
  // mutation, and bump elitism so good gaits don't get smashed away.
  const cfg = env.trainerConfig || {};
  const population = popOverride ?? cfg.population ?? 16;
  const mutationRate = cfg.mutationRate ?? 0.18;
  const mutationSigma = cfg.sigma ?? 0.45;
  const elitism = cfg.elitism ?? 4;

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
    for (let i = 0; i < pop.length; i++) {
      if (stopped) return null;
      const res = evalEnv(env, pop[i].brain, { recordTrace: false });
      pop[i].fitness = res.fitness;
      // Yield to the UI between evaluations
      await new Promise((r) => setTimeout(r, 0));
    }
    pop.sort((a, b) => b.fitness - a.fitness);

    // Record traces for the top-K brains so the renderer can show
    // multiple bears side by side. Falls back to single-brain re-eval
    // when visPopulation == 1.
    const visN = Math.max(1, Math.min(pop.length, visPopulation));
    let traces;
    if (visN > 1) {
      const topBrains = pop.slice(0, visN).map((p) => p.brain);
      const batch = evalEnvBatch(env, topBrains, { recordTrace: true });
      traces = batch.map((r) => r.trace);
    } else {
      const bestRes = evalEnv(env, pop[0].brain, { recordTrace: true });
      pop[0].fitness = bestRes.fitness;
      traces = [bestRes.trace];
    }

    const bestFitness = pop[0].fitness;
    const avgFitness = pop.reduce((s, p) => s + p.fitness, 0) / pop.length;
    const variance = pop.reduce((s, p) => s + Math.pow(p.fitness - avgFitness, 2), 0) / pop.length;
    const stdFitness = Math.sqrt(variance);
    const bestBrain = cloneBrain(pop[0].brain);

    onGenerationDone?.({ gen, bestFitness, avgFitness, stdFitness, bestBrain, traces, env });

    // Breed: keep top-N elite, rest are mutated copies of the top 4
    const elite = pop.slice(0, elitism).map((p) => ({ brain: cloneBrain(p.brain), fitness: 0 }));
    const next = [...elite];
    const parentPool = pop.slice(0, Math.min(4, pop.length));
    for (let i = elite.length; i < pop.length; i++) {
      const parent = parentPool[Math.floor(Math.random() * parentPool.length)].brain;
      next.push({ brain: mutate(parent, { rate: mutationRate, sigma: mutationSigma }), fitness: 0 });
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
  evalEnv, evalEnvBatch, evalBalance, startTrainer,
  // Constants exposed for the renderer
  PHYS_DT, TRACE_EVERY,
};
