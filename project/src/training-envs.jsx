/* ============================================================
   BRAINWORK ROYALE — TRAINING ENVIRONMENT REGISTRY
   One env per (skillId, level). Each env declares its own physics
   build, observation, action mapping, fitness, and termination.

   This is the contract the generalised trainer + renderer consume.
   To add a new skill: implement L1/L2/L3 envs, register them, and
   the rest of the system picks them up automatically.

   Env shape:
     {
       id, skillId, level,
       arch: { inputs, hidden, outputs },
       theoreticalMax,             // fitness threshold to call it "mastered"
       maxTicks,                   // physics steps per episode
       build(world): envState,     // create bodies, return state
       observe(envState): number[],
       act(envState, output: number[]): void,
       envStep(envState, tick): void,
       done(envState, tick): bool,
       fitness(envState, tick, alive): number,
       snapshot(envState): { bodies: {name: {x,y,z,qx,qy,qz,qw}}, props: [...] },
       props: [{ type, name, color, ... }],   // hint for renderer to add visuals once
     }

   Exposes window.trainingEnvs = { getEnv(skillId, level), envIds }.
   ============================================================ */

const PHYS_DT = 1 / 60;

// ---------- shared helpers reused across balance variants ----------

function _quatToPitchRoll(q) {
  const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
  const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  return { pitch, roll };
}

function _observeRagdoll(rag) {
  // 12 inputs: torso pitch, roll, 4 joint angles, 4 joint angular velocities,
  //            2 torso ang.velocity (x and z)
  const torso = rag.bodies.torso;
  const { pitch, roll } = _quatToPitchRoll(torso.rotation());
  const torsoAng = torso.angvel();

  const ja = (j) => j.angle?.() ?? 0;
  const jv = (b1, b2) => b2.angvel().x - b1.angvel().x;

  return [
    pitch, roll,
    ja(rag.joints.lHip), ja(rag.joints.rHip),
    ja(rag.joints.lKnee), ja(rag.joints.rKnee),
    jv(rag.bodies.torso, rag.bodies.lThigh),
    jv(rag.bodies.torso, rag.bodies.rThigh),
    jv(rag.bodies.lThigh, rag.bodies.lShin),
    jv(rag.bodies.rThigh, rag.bodies.rShin),
    torsoAng.x, torsoAng.z,
  ];
}

const TORQUE_SCALE = 4.5;
function _applyTorques(rag, out) {
  const apply = (body, t) => {
    const T = t * TORQUE_SCALE;
    body.applyTorqueImpulse({ x: T * PHYS_DT, y: 0, z: 0 }, true);
  };
  apply(rag.bodies.lThigh,  out[0]);
  apply(rag.bodies.rThigh,  out[1]);
  apply(rag.bodies.lShin,   out[2]);
  apply(rag.bodies.rShin,   out[3]);
}

function _snapshotRagdoll(rag, extra = {}) {
  const bodies = {};
  for (const [name, b] of Object.entries(rag.bodies)) {
    const t = b.translation(), r = b.rotation();
    bodies[name] = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }
  return { bodies, ...extra };
}

// Seeded pseudo-random so episodes are reproducible per genome
function _mkRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

// ============================================================
// BALANCE — three progressively harder courses
// ============================================================

// Common build: just spawn the ragdoll. brainEngine.createRagdoll is loaded
// at module-init time; envs reference window.brainEngine indirectly.
function _buildRagdollOnly(world) {
  const rag = window.brainEngine.createRagdoll(world);
  return { rag };
}

const FALLEN_Y = 0.55;

const balanceL1 = {
  id: "balance-L1",
  skillId: "balance",
  level: 1,
  name: "Balance · Flat ground",
  arch: { inputs: 12, hidden: 16, outputs: 4 },
  theoreticalMax: 5.0,
  maxTicks: 300,             // 5 s
  build: _buildRagdollOnly,
  observe: (env) => _observeRagdoll(env.rag),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: () => {},          // no perturbations
  done: (env) => env.rag.torsoTopY() < FALLEN_Y,
  fitness: (env, tick) => tick * PHYS_DT,
  snapshot: (env) => _snapshotRagdoll(env.rag),
  props: [],                  // no extra visuals
};

const balanceL2 = {
  id: "balance-L2",
  skillId: "balance",
  level: 2,
  name: "Balance · Lateral pushes",
  arch: { inputs: 12, hidden: 16, outputs: 4 },
  theoreticalMax: 8.0,
  maxTicks: 480,             // 8 s
  build(world) {
    const rag = window.brainEngine.createRagdoll(world);
    return { rag, nextPushAt: 40, pushCount: 0, rng: _mkRng(424242) };
  },
  observe: (env) => _observeRagdoll(env.rag),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep(env, tick) {
    if (tick >= env.nextPushAt) {
      // Lateral kick to the torso — sign alternates, magnitude small but real
      const sign = env.pushCount % 2 === 0 ? -1 : 1;
      env.rag.bodies.torso.applyImpulse(
        { x: sign * 0.6, y: 0, z: 0 }, true
      );
      env.pushCount += 1;
      env.nextPushAt = tick + 36 + Math.floor(env.rng() * 12); // every ~0.6–0.8 s
      env.lastPushSign = sign;
      env.lastPushTick = tick;
    }
  },
  done: (env) => env.rag.torsoTopY() < FALLEN_Y,
  fitness: (env, tick) => tick * PHYS_DT + env.pushCount * 0.15, // bonus for absorbing pushes
  snapshot(env) {
    return _snapshotRagdoll(env.rag, {
      // Visual cue: render a small arrow at the side that pushed recently
      cue: env.lastPushTick != null && (env.lastPushTick > 0)
        ? { kind: "push", sign: env.lastPushSign || 1, tick: env.lastPushTick }
        : null,
    });
  },
  props: [],
};

const balanceL3 = {
  id: "balance-L3",
  skillId: "balance",
  level: 3,
  name: "Balance · Random impulses",
  arch: { inputs: 12, hidden: 16, outputs: 4 },
  theoreticalMax: 10.0,
  maxTicks: 600,             // 10 s
  build(world) {
    const rag = window.brainEngine.createRagdoll(world);
    return { rag, nextPushAt: 60, pushCount: 0, rng: _mkRng(0xC0FFEE) };
  },
  observe: (env) => _observeRagdoll(env.rag),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep(env, tick) {
    if (tick >= env.nextPushAt) {
      // Large impulse in a random horizontal direction
      const theta = env.rng() * Math.PI * 2;
      const mag = 1.0 + env.rng() * 0.6;             // bigger than L2
      env.rag.bodies.torso.applyImpulse(
        { x: Math.cos(theta) * mag, y: 0, z: Math.sin(theta) * mag },
        true
      );
      env.pushCount += 1;
      env.nextPushAt = tick + 80 + Math.floor(env.rng() * 30); // every ~1.5 s ± randomness
      env.lastPushTheta = theta;
      env.lastPushTick = tick;
    }
  },
  done: (env) => env.rag.torsoTopY() < FALLEN_Y,
  fitness: (env, tick) => tick * PHYS_DT + env.pushCount * 0.25,
  snapshot(env) {
    return _snapshotRagdoll(env.rag, {
      cue: env.lastPushTick != null
        ? { kind: "push3d", theta: env.lastPushTheta || 0, tick: env.lastPushTick }
        : null,
    });
  },
  props: [],
};

// ============================================================
// PLACEHOLDERS — skill envs to build in future rounds
// ============================================================
function _placeholder(skillId, level) {
  return {
    id: `${skillId}-L${level}`,
    skillId, level,
    name: `${skillId} · L${level}`,
    placeholder: true,
    arch: { inputs: 12, hidden: 16, outputs: 4 },
    theoreticalMax: 1,
    maxTicks: 1,
    build: () => { throw new Error("env not implemented"); },
    observe: () => [],
    act: () => {},
    envStep: () => {},
    done: () => true,
    fitness: () => 0,
    snapshot: () => ({ bodies: {} }),
    props: [],
  };
}

const ENV_REGISTRY = {
  "balance-L1": balanceL1,
  "balance-L2": balanceL2,
  "balance-L3": balanceL3,
  // Placeholders so the UI can render "coming soon" without crashing
  "walk-L1":   _placeholder("walk", 1),
  "walk-L2":   _placeholder("walk", 2),
  "walk-L3":   _placeholder("walk", 3),
  "run-L1":    _placeholder("run", 1),
  "run-L2":    _placeholder("run", 2),
  "run-L3":    _placeholder("run", 3),
  "jump-L1":   _placeholder("jump", 1),
  "jump-L2":   _placeholder("jump", 2),
  "jump-L3":   _placeholder("jump", 3),
  "dodge-L1":  _placeholder("dodge", 1),
  "dodge-L2":  _placeholder("dodge", 2),
  "dodge-L3":  _placeholder("dodge", 3),
  "attack-L1": _placeholder("attack", 1),
  "attack-L2": _placeholder("attack", 2),
  "attack-L3": _placeholder("attack", 3),
  "combo-L1":  _placeholder("combo", 1),
  "combo-L2":  _placeholder("combo", 2),
  "combo-L3":  _placeholder("combo", 3),
};

function getEnv(skillId, level) {
  return ENV_REGISTRY[`${skillId}-L${level}`];
}

window.trainingEnvs = { getEnv, envIds: Object.keys(ENV_REGISTRY) };
