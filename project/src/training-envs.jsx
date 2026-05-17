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

// Reduced from 4.5 — bigger torques caused the bear to flail every tick.
// With higher damping in createRagdoll, smaller torques still produce
// visible motion but feel less reckless.
const TORQUE_SCALE = 2.2;
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

function _snapshotRagdoll(rag, extra = {}, props = null) {
  const bodies = {};
  for (const [name, b] of Object.entries(rag.bodies)) {
    const t = b.translation(), r = b.rotation();
    bodies[name] = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }
  // Joint angles per tick — used by the renderer's bone-driving so the
  // PEP-Smol model's actual leg bones rotate with the physics joints.
  const joints = {
    lHip:  rag.joints.lHip.angle?.()  ?? 0,
    rHip:  rag.joints.rHip.angle?.()  ?? 0,
    lKnee: rag.joints.lKnee.angle?.() ?? 0,
    rKnee: rag.joints.rKnee.angle?.() ?? 0,
  };
  let propsSnap = null;
  if (props) {
    propsSnap = {};
    for (const [name, body] of Object.entries(props)) {
      if (!body) continue;
      const t = body.translation(), r = body.rotation();
      propsSnap[name] = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
    }
  }
  return { bodies, joints, props: propsSnap, ...extra };
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
// PROP FACTORIES — physical objects shared across envs
// ============================================================

// Pendulum: a heavy ball hanging from a fixed anchor. Swings forever under
// gravity once we kick it with an initial impulse. The ball physically
// collides with the bear.
//
// anchorX, anchorZ — where the pivot sits in world space (the anchor body
// is fixed at y = anchorY).
// chainLen — vertical distance between anchor and ball when at rest
// ballRadius, ballMass — collider tuning
// initialKick — horizontal impulse magnitude applied at t=0 to start the swing
function _makePendulum(world, { anchorX, anchorY, anchorZ, chainLen, ballRadius = 0.18, ballMass = 4.0, initialKick = 1.8 }) {
  const RAPIER = window.RAPIER;
  // Fixed anchor (kinematic body so it doesn't move but can be joint target)
  const anchorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(anchorX, anchorY, anchorZ);
  const anchor = world.createRigidBody(anchorDesc);
  // (No collider on the anchor — it's invisible and doesn't need to collide)

  // Ball — dynamic, dangles below the anchor
  const ballDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(anchorX, anchorY - chainLen, anchorZ)
    .setLinearDamping(0.05);
  const ball = world.createRigidBody(ballDesc);
  const ballCol = RAPIER.ColliderDesc.ball(ballRadius)
    .setDensity(ballMass / ((4 / 3) * Math.PI * Math.pow(ballRadius, 3)))
    .setFriction(0.4)
    .setRestitution(0.2);
  world.createCollider(ballCol, ball);

  // Revolute joint along Z axis so it swings in the X-Y plane (sideways into the bear)
  const jointDesc = RAPIER.JointData.revolute(
    { x: 0, y: 0, z: 0 },               // local anchor on the fixed body
    { x: 0, y: chainLen, z: 0 },         // local anchor on the ball
    { x: 0, y: 0, z: 1 }                 // swing axis
  );
  world.createImpulseJoint(jointDesc, anchor, ball, true);

  // Initial kick to get it swinging — sideways impulse
  ball.applyImpulse({ x: initialKick * Math.sign(anchorX || 1), y: 0, z: 0 }, true);

  return { anchor, ball };
}

// Falling debris cube — a small dynamic box that spawns above the arena
// and drops under gravity. Hits the bear if positioned right.
function _spawnDebris(world, { x, y, z, size = 0.16, mass = 1.0 }) {
  const RAPIER = window.RAPIER;
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.0);
  const body = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.cuboid(size, size, size)
    .setDensity(mass / Math.pow(size * 2, 3))
    .setFriction(0.5)
    .setRestitution(0.3);
  world.createCollider(col, body);
  return body;
}

// ============================================================
// BALANCE — three progressively harder courses with REAL physical props
// ============================================================

function _buildRagdollOnly(world) {
  const rag = window.brainEngine.createRagdoll(world);
  return { rag };
}

const FALLEN_Y = 0.55;

const balanceL1 = {
  id: "balance-L1",
  skillId: "balance",
  level: 1,
  name: "Balance · Solid platform",
  arch: { inputs: 12, hidden: 16, outputs: 4 },
  theoreticalMax: 5.0,
  maxTicks: 300,             // 5 s
  build: _buildRagdollOnly,
  buildProps: () => ({}),     // no props
  propVisuals: [],
  observe: (env) => _observeRagdoll(env.rag),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: () => {},
  done: (env) => env.rag.torsoTopY() < FALLEN_Y,
  fitness: (env, tick) => tick * PHYS_DT,
  snapshot: (env) => _snapshotRagdoll(env.rag),
};

const balanceL2 = {
  id: "balance-L2",
  skillId: "balance",
  level: 2,
  name: "Balance · Swinging pendulum",
  arch: { inputs: 12, hidden: 16, outputs: 4 },
  theoreticalMax: 8.0,
  maxTicks: 480,             // 8 s
  build: _buildRagdollOnly,
  buildProps(world) {
    // Pendulum hangs to the LEFT side, swings sideways into the bear's torso level (~1.4 m).
    const p = _makePendulum(world, {
      anchorX: -1.2, anchorY: 2.6, anchorZ: 0,
      chainLen: 1.1, ballRadius: 0.20, ballMass: 5.0, initialKick: 2.4,
    });
    return { pendulumBall: p.ball, pendulumAnchor: p.anchor };
  },
  propVisuals: [
    { name: "pendulumBall",   geom: { type: "sphere",   radius: 0.20 },           color: 0xff5577, emissive: 0x661c2d },
    { name: "pendulumAnchor", geom: { type: "box",      size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
  ],
  observe: (env) => _observeRagdoll(env.rag),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: () => {},          // pendulum swings under gravity, no scripted step
  done: (env) => env.rag.torsoTopY() < FALLEN_Y,
  fitness: (env, tick) => tick * PHYS_DT,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const balanceL3 = {
  id: "balance-L3",
  skillId: "balance",
  level: 3,
  name: "Balance · Two pendulums + debris",
  arch: { inputs: 12, hidden: 16, outputs: 4 },
  theoreticalMax: 10.0,
  maxTicks: 600,             // 10 s
  build(world) {
    const rag = window.brainEngine.createRagdoll(world);
    return { rag, nextDebrisAt: 120, debrisCount: 0, debrisBodies: {}, rng: _mkRng(0xC0FFEE) };
  },
  buildProps(world) {
    // Left pendulum (shorter chain → faster period)
    const left = _makePendulum(world, {
      anchorX: -1.3, anchorY: 2.7, anchorZ: 0,
      chainLen: 1.0, ballRadius: 0.20, ballMass: 5.0, initialKick: 2.4,
    });
    // Right pendulum (longer chain → slower period, different phase)
    const right = _makePendulum(world, {
      anchorX: 1.3, anchorY: 2.9, anchorZ: 0,
      chainLen: 1.3, ballRadius: 0.22, ballMass: 6.0, initialKick: -2.2,
    });
    return {
      leftBall: left.ball, leftAnchor: left.anchor,
      rightBall: right.ball, rightAnchor: right.anchor,
    };
  },
  propVisuals: [
    { name: "leftBall",    geom: { type: "sphere", radius: 0.20 },           color: 0xff5577, emissive: 0x661c2d },
    { name: "leftAnchor",  geom: { type: "box",    size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
    { name: "rightBall",   geom: { type: "sphere", radius: 0.22 },           color: 0xff8b45, emissive: 0x6d3818 },
    { name: "rightAnchor", geom: { type: "box",    size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
  ],
  // Dynamic debris cubes — renderer creates a mesh per name on first sight
  dynamicPropFactory(name) {
    if (name.startsWith("debris")) {
      return { name, geom: { type: "box", size: [0.13, 0.13, 0.13] }, color: 0xffb84d, emissive: 0x6d4a14 };
    }
    return null;
  },
  observe: (env) => _observeRagdoll(env.rag),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep(env, tick, world) {
    // Spawn falling debris periodically from random horizontal position above the platform.
    if (tick >= env.nextDebrisAt) {
      const x = (env.rng() - 0.5) * 1.6;
      const z = (env.rng() - 0.5) * 1.6;
      const name = "debris" + env.debrisCount;
      const body = _spawnDebris(world, { x, y: 3.6, z, size: 0.13, mass: 1.2 });
      env.debrisBodies[name] = body;
      env.debrisCount += 1;
      env.nextDebrisAt = tick + 110 + Math.floor(env.rng() * 60); // every ~2 s ± randomness
    }
  },
  done: (env) => env.rag.torsoTopY() < FALLEN_Y,
  fitness: (env, tick) => tick * PHYS_DT,
  snapshot(env) {
    // Combine pendulum props with dynamically-spawned debris
    const combined = { ...env.props, ...env.debrisBodies };
    return _snapshotRagdoll(env.rag, {}, combined);
  },
};

// ============================================================
// WALK — locomotion toward a visible target cone
// Same body as Balance, but the brain has two extra inputs telling
// it where the goal is. Fitness is forward progress capped at the
// target distance, +bonus on reach.
// ============================================================

const WALK_ARCH = { inputs: 14, hidden: 20, outputs: 4 };

function _observeWalk(rag, target) {
  // 12 balance inputs (same shape as the balance observe) + 2 target offsets
  const base = _observeRagdoll(rag);
  const t = rag.bodies.torso.translation();
  // Normalize by 10 m so values stay roughly in [-1, 1]
  const dx = (target.x - t.x) / 10;
  const dz = (target.z - t.z) / 10;
  return [...base, dx, dz];
}

function _walkFitness(env, tick, alive) {
  const t = env.rag.bodies.torso.translation();
  const progress = Math.max(0, Math.min(t.z, env.targetZ));      // capped at target Z
  const reachedBonus = env.reached ? 3 : 0;
  const uprightBonus = alive ? 0.5 : 0;
  return progress + reachedBonus + uprightBonus;
}

function _walkDone(env) {
  if (env.rag.torsoTopY() < FALLEN_Y) return true;
  const t = env.rag.bodies.torso.translation();
  if (!env.reached) {
    const dist = Math.hypot(t.x - env.target.x, t.z - env.target.z);
    if (dist < 0.6) {
      env.reached = true;       // mark and let the episode keep running briefly so the bonus is recorded
    }
  }
  return false;
}

function _buildWalk(world, targetZ) {
  const rag = window.brainEngine.createRagdoll(world);
  return {
    rag,
    targetZ,
    target: { x: 0, y: 0.1, z: targetZ },
    reached: false,
    // Shaped-fitness accumulators — updated by _walkShapedFitness each
    // tick (see envStep wrapper below).
    forwardSum: 0,            // accumulated max(0, Δz_per_tick)
    sidewaysPenalty: 0,       // accumulated 0.3 * |torso.x| per tick
    upTicks: 0,               // ticks where torso stayed upright
    lastZ: null,
  };
}

// Per-tick shaping accumulator. Called from envStep so the running
// reward components stay current. Has to live OUTSIDE fitness() because
// fitness() is only called once at episode end.
function _walkShapingStep(env) {
  const t = env.rag.bodies.torso.translation();
  if (env.lastZ != null) {
    env.forwardSum += Math.max(0, t.z - env.lastZ);
  }
  env.lastZ = t.z;
  env.sidewaysPenalty += Math.abs(t.x) * 0.01;   // ~0.3 / tick at |x|=30
  if (env.rag.torsoTopY() >= FALLEN_Y) env.upTicks += 1;
}

function _walkFitnessShaped(env, tick, alive) {
  // Total reward components:
  //  - cumulative forward progress (rewards continuous motion, not just
  //    final position)
  //  - sideways drift penalty (encourages straight-line walking)
  //  - upright bonus scaled by fraction of episode survived
  //  - reach bonus only if the bear got there
  const reachBonus = env.reached ? 3 : 0;
  const uprightBonus = (env.upTicks / Math.max(1, env.maxTicks || tick)) * 1.5;
  return env.forwardSum + reachBonus + uprightBonus - env.sidewaysPenalty;
}

// Static target-cone visual — same for all walk levels, just at different Z
function _walkPropVisuals(targetZ) {
  return [
    { name: "target", geom: { type: "cone", radius: 0.32, height: 0.9 },
      color: 0x5df2d6, emissive: 0x2a8a7a, static: { x: 0, y: 0.55, z: targetZ } },
    // A short marker line on the ground so the path is visible
    { name: "startMarker", geom: { type: "box", size: [0.6, 0.02, 0.06] },
      color: 0x5df2d6, emissive: 0x2a8a7a, static: { x: 0, y: 0.16, z: 0 } },
    { name: "endMarker", geom: { type: "box", size: [0.6, 0.02, 0.06] },
      color: 0xffb84d, emissive: 0x6d4a14, static: { x: 0, y: 0.16, z: targetZ } },
  ];
}

const _walkTrainerConfig = {
  population: 32, mutationRate: 0.12, sigma: 0.35, elitism: 6,
};
const _walkWarmup = 20;

const walkL1 = {
  id: "walk-L1",
  skillId: "walk",
  level: 1,
  name: "Walk · Straight path",
  arch: WALK_ARCH,
  theoreticalMax: 3 + 3.5 + 1.5,
  maxTicks: 480,
  warmupTicks: _walkWarmup,
  trainerConfig: _walkTrainerConfig,
  cameraView: { position: [3.2, 1.8, 1.8], lookAt: [0, 0.9, 1.5] },
  build: (world) => { const e = _buildWalk(world, 3); e.maxTicks = 480; return e; },
  buildProps: () => ({}),
  propVisuals: _walkPropVisuals(3),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _walkDone,
  fitness: _walkFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const walkL2 = {
  id: "walk-L2",
  skillId: "walk",
  level: 2,
  name: "Walk · Path with pendulum",
  arch: WALK_ARCH,
  theoreticalMax: 5 + 3.5 + 1.5,
  maxTicks: 600,
  warmupTicks: _walkWarmup,
  trainerConfig: _walkTrainerConfig,
  cameraView: { position: [4.0, 2.0, 2.5], lookAt: [0, 0.9, 2.5] },
  build: (world) => { const e = _buildWalk(world, 5); e.maxTicks = 600; return e; },
  buildProps(world) {
    const p = _makePendulum(world, {
      anchorX: -1.2, anchorY: 2.6, anchorZ: 2.5,
      chainLen: 1.1, ballRadius: 0.20, ballMass: 5.0, initialKick: 2.2,
    });
    return { pendulumBall: p.ball, pendulumAnchor: p.anchor };
  },
  propVisuals: [
    ..._walkPropVisuals(5),
    { name: "pendulumBall",   geom: { type: "sphere", radius: 0.20 },         color: 0xff5577, emissive: 0x661c2d },
    { name: "pendulumAnchor", geom: { type: "box", size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
  ],
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _walkDone,
  fitness: _walkFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const walkL3 = {
  id: "walk-L3",
  skillId: "walk",
  level: 3,
  name: "Walk · Path with two pendulums",
  arch: WALK_ARCH,
  theoreticalMax: 7 + 3.5 + 1.5,
  maxTicks: 720,
  warmupTicks: _walkWarmup,
  trainerConfig: _walkTrainerConfig,
  cameraView: { position: [4.5, 2.2, 3.5], lookAt: [0, 0.9, 3.5] },
  build: (world) => { const e = _buildWalk(world, 7); e.maxTicks = 720; return e; },
  buildProps(world) {
    // Two pendulums along the path at different Z and opposite sides
    const a = _makePendulum(world, {
      anchorX: -1.2, anchorY: 2.6, anchorZ: 2.5,
      chainLen: 1.0, ballRadius: 0.20, ballMass: 5.0, initialKick: 2.4,
    });
    const b = _makePendulum(world, {
      anchorX:  1.3, anchorY: 2.8, anchorZ: 5.0,
      chainLen: 1.2, ballRadius: 0.22, ballMass: 6.0, initialKick: -2.0,
    });
    return {
      pendulumAball: a.ball, pendulumAanchor: a.anchor,
      pendulumBball: b.ball, pendulumBanchor: b.anchor,
    };
  },
  propVisuals: [
    ..._walkPropVisuals(7),
    { name: "pendulumAball",   geom: { type: "sphere", radius: 0.20 },         color: 0xff5577, emissive: 0x661c2d },
    { name: "pendulumAanchor", geom: { type: "box", size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
    { name: "pendulumBball",   geom: { type: "sphere", radius: 0.22 },         color: 0xff8b45, emissive: 0x6d3818 },
    { name: "pendulumBanchor", geom: { type: "box", size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
  ],
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _walkDone,
  fitness: _walkFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

// ============================================================
// RUN — same locomotion task as Walk, but speed is rewarded.
// Same body + observation shape as Walk; the only difference is
// the fitness function adds a "finish faster = more bonus" term,
// and the targets are longer with tighter time budgets. The brain
// naturally learns a more aggressive gait because there's less
// time to cover more ground.
// ============================================================

const RUN_ARCH = WALK_ARCH; // 14, 20, 4 — same shape

// Run uses the same per-tick shaping as Walk. The only difference is
// that reaching the target faster adds a speed bonus, so the brain
// learns a more aggressive gait under a tighter time budget.
const _runTrainerConfig = {
  population: 32, mutationRate: 0.12, sigma: 0.35, elitism: 6,
};
const _runWarmup = 20;

function _buildRun(world, targetZ, maxTicks) {
  const rag = window.brainEngine.createRagdoll(world);
  return {
    rag, targetZ, maxTicks,
    target: { x: 0, y: 0.1, z: targetZ },
    reached: false,
    reachedAtTick: null,
    forwardSum: 0,
    sidewaysPenalty: 0,
    upTicks: 0,
    lastZ: null,
  };
}

function _runFitnessShaped(env, tick, alive) {
  const reachBonus = env.reached ? 3 : 0;
  const speedBonus = env.reached && env.reachedAtTick != null
    ? 5 * Math.max(0, (env.maxTicks - env.reachedAtTick) / env.maxTicks)
    : 0;
  const uprightBonus = (env.upTicks / Math.max(1, env.maxTicks || tick)) * 1.5;
  return env.forwardSum + reachBonus + speedBonus + uprightBonus - env.sidewaysPenalty;
}

function _runDone(env, tick) {
  if (env.rag.torsoTopY() < FALLEN_Y) return true;
  if (!env.reached) {
    const t = env.rag.bodies.torso.translation();
    const dist = Math.hypot(t.x - env.target.x, t.z - env.target.z);
    if (dist < 0.6) {
      env.reached = true;
      env.reachedAtTick = tick;
    }
  }
  return false;
}

// Track-style visuals — amber accent so Run reads as "speed track" vs the
// mint walk arrows. Chevrons along the path hint at direction.
function _runPropVisuals(targetZ) {
  const props = [
    { name: "target", geom: { type: "cone", radius: 0.32, height: 0.9 },
      color: 0xffb84d, emissive: 0x6d4a14, static: { x: 0, y: 0.55, z: targetZ } },
    { name: "startMarker", geom: { type: "box", size: [0.8, 0.02, 0.08] },
      color: 0xffb84d, emissive: 0x6d4a14, static: { x: 0, y: 0.16, z: 0 } },
    { name: "endMarker", geom: { type: "box", size: [0.8, 0.02, 0.08] },
      color: 0x5df2d6, emissive: 0x2a8a7a, static: { x: 0, y: 0.16, z: targetZ } },
  ];
  // Chevron strips every 1 m along the path
  for (let z = 1; z < targetZ; z += 1) {
    props.push({
      name: "chev_l" + z, geom: { type: "box", size: [0.18, 0.02, 0.06] },
      color: 0xffb84d, emissive: 0x6d4a14,
      static: { x: -0.25, y: 0.165, z, rotY: Math.PI / 6 },
    });
    props.push({
      name: "chev_r" + z, geom: { type: "box", size: [0.18, 0.02, 0.06] },
      color: 0xffb84d, emissive: 0x6d4a14,
      static: { x: 0.25, y: 0.165, z, rotY: -Math.PI / 6 },
    });
  }
  return props;
}

const runL1 = {
  id: "run-L1",
  skillId: "run",
  level: 1,
  name: "Run · Sprint track",
  arch: RUN_ARCH,
  theoreticalMax: 5 + 3 + 5 + 1.5,              // target + reachBonus + maxSpeed + upright
  maxTicks: 320,                             // ~5.3 s — must be fast
  warmupTicks: _runWarmup,
  trainerConfig: _runTrainerConfig,
  cameraView: { position: [4.0, 1.8, 2.5], lookAt: [0, 0.9, 2.5] },
  build: (world) => _buildRun(world, 5, 320),
  buildProps: () => ({}),
  propVisuals: _runPropVisuals(5),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _runDone,
  fitness: _runFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const runL2 = {
  id: "run-L2",
  skillId: "run",
  level: 2,
  name: "Run · Sprint + obstacle",
  arch: RUN_ARCH,
  theoreticalMax: 7 + 3 + 5 + 1.5,
  maxTicks: 420,                             // ~7 s
  warmupTicks: _runWarmup,
  trainerConfig: _runTrainerConfig,
  cameraView: { position: [4.5, 1.9, 3.5], lookAt: [0, 0.9, 3.5] },
  build: (world) => _buildRun(world, 7, 420),
  buildProps(world) {
    const p = _makePendulum(world, {
      anchorX: -1.2, anchorY: 2.6, anchorZ: 3.5,
      chainLen: 1.1, ballRadius: 0.20, ballMass: 5.0, initialKick: 2.2,
    });
    return { pendulumBall: p.ball, pendulumAnchor: p.anchor };
  },
  propVisuals: [
    ..._runPropVisuals(7),
    { name: "pendulumBall",   geom: { type: "sphere", radius: 0.20 },         color: 0xff5577, emissive: 0x661c2d },
    { name: "pendulumAnchor", geom: { type: "box", size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
  ],
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _runDone,
  fitness: _runFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const runL3 = {
  id: "run-L3",
  skillId: "run",
  level: 3,
  name: "Run · Sprint with two obstacles",
  arch: RUN_ARCH,
  theoreticalMax: 9 + 3 + 5 + 1.5,
  maxTicks: 540,                             // 9 s
  warmupTicks: _runWarmup,
  trainerConfig: _runTrainerConfig,
  cameraView: { position: [5.0, 2.0, 4.5], lookAt: [0, 0.9, 4.5] },
  build: (world) => _buildRun(world, 9, 540),
  buildProps(world) {
    const a = _makePendulum(world, {
      anchorX: -1.2, anchorY: 2.6, anchorZ: 3.0,
      chainLen: 1.0, ballRadius: 0.20, ballMass: 5.0, initialKick: 2.4,
    });
    const b = _makePendulum(world, {
      anchorX:  1.3, anchorY: 2.8, anchorZ: 6.0,
      chainLen: 1.2, ballRadius: 0.22, ballMass: 6.0, initialKick: -2.0,
    });
    return {
      pendulumAball: a.ball, pendulumAanchor: a.anchor,
      pendulumBball: b.ball, pendulumBanchor: b.anchor,
    };
  },
  propVisuals: [
    ..._runPropVisuals(9),
    { name: "pendulumAball",   geom: { type: "sphere", radius: 0.20 },         color: 0xff5577, emissive: 0x661c2d },
    { name: "pendulumAanchor", geom: { type: "box", size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
    { name: "pendulumBball",   geom: { type: "sphere", radius: 0.22 },         color: 0xff8b45, emissive: 0x6d3818 },
    { name: "pendulumBanchor", geom: { type: "box", size: [0.15, 0.10, 0.15] }, color: 0x8b91b8, emissive: 0x2a3155 },
  ],
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _runDone,
  fitness: _runFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

// ============================================================
// JUMP — clear a hurdle on the way to the target
// Same body + arch as Walk. A static box wall sits across the path
// at hurdle height; the bear must lift its body over it. Limits
// progress because the bear can't physically squeeze around it.
// ============================================================

function _makeHurdle(world, { x, z, width = 1.8, height = 0.18, depth = 0.12 }) {
  const RAPIER = window.RAPIER;
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, height / 2 + 0.16, z);
  const body = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
    .setFriction(0.8).setRestitution(0.0);
  world.createCollider(col, body);
  return body;
}

function _buildJump(world, targetZ, maxTicks) {
  const rag = window.brainEngine.createRagdoll(world);
  return {
    rag, targetZ, maxTicks,
    target: { x: 0, y: 0.1, z: targetZ },
    reached: false,
    reachedAtTick: null,
    forwardSum: 0,
    sidewaysPenalty: 0,
    upTicks: 0,
    lastZ: null,
  };
}

function _jumpVisuals(targetZ, hurdleZs) {
  const props = [
    { name: "target", geom: { type: "cone", radius: 0.32, height: 0.9 },
      color: 0xff8b45, emissive: 0x6d3818, static: { x: 0, y: 0.55, z: targetZ } },
    { name: "startMarker", geom: { type: "box", size: [0.8, 0.02, 0.08] },
      color: 0xff8b45, emissive: 0x6d3818, static: { x: 0, y: 0.16, z: 0 } },
  ];
  hurdleZs.forEach((z, i) => {
    props.push({
      name: "hurdle" + i, geom: { type: "box", size: [0.9, 0.18, 0.06] },
      color: 0xff8b45, emissive: 0x6d3818,
    });
  });
  return props;
}

function _buildJumpProps(world, hurdleZs) {
  const out = {};
  hurdleZs.forEach((z, i) => { out["hurdle" + i] = _makeHurdle(world, { x: 0, z }); });
  return out;
}

const _jumpTrainerConfig = {
  population: 32, mutationRate: 0.12, sigma: 0.35, elitism: 6,
};
const _jumpWarmup = 20;

const jumpL1 = {
  id: "jump-L1", skillId: "jump", level: 1, name: "Jump · One hurdle",
  arch: WALK_ARCH, theoreticalMax: 4 + 3.5 + 1.5, maxTicks: 540,
  warmupTicks: _jumpWarmup,
  trainerConfig: _jumpTrainerConfig,
  cameraView: { position: [4, 1.9, 2], lookAt: [0, 0.9, 2] },
  build: (world) => _buildJump(world, 4, 540),
  buildProps: (world) => _buildJumpProps(world, [2]),
  propVisuals: _jumpVisuals(4, [2]),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env),
  done: _walkDone,
  fitness: _walkFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};
const jumpL2 = {
  id: "jump-L2", skillId: "jump", level: 2, name: "Jump · Two hurdles",
  arch: WALK_ARCH, theoreticalMax: 6 + 3.5 + 1.5, maxTicks: 660,
  warmupTicks: _jumpWarmup,
  trainerConfig: _jumpTrainerConfig,
  cameraView: { position: [4.5, 2.0, 3], lookAt: [0, 0.9, 3] },
  build: (world) => _buildJump(world, 6, 660),
  buildProps: (world) => _buildJumpProps(world, [2, 4]),
  propVisuals: _jumpVisuals(6, [2, 4]),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env), done: _walkDone, fitness: _walkFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};
const jumpL3 = {
  id: "jump-L3", skillId: "jump", level: 3, name: "Jump · Three hurdles",
  arch: WALK_ARCH, theoreticalMax: 8 + 3.5 + 1.5, maxTicks: 780,
  warmupTicks: _jumpWarmup,
  trainerConfig: _jumpTrainerConfig,
  cameraView: { position: [5, 2.2, 4], lookAt: [0, 0.9, 4] },
  build: (world) => _buildJump(world, 8, 780),
  buildProps: (world) => _buildJumpProps(world, [2, 4, 6]),
  propVisuals: _jumpVisuals(8, [2, 4, 6]),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env) => _walkShapingStep(env), done: _walkDone, fitness: _walkFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

// ============================================================
// DODGE — avoid incoming projectiles. Fitness = HP remaining + time alive.
// Each tick checks distance from torso to each projectile; close contact
// drains hp. Brain output drives torso lateral lean to evade.
// ============================================================

function _spawnProjectile(world, { x, y, z, vx, vy, vz, radius = 0.15, mass = 1.5 }) {
  const RAPIER = window.RAPIER;
  const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
    .setLinvel(vx, vy, vz).setLinearDamping(0.0);
  const body = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.ball(radius)
    .setDensity(mass / ((4 / 3) * Math.PI * Math.pow(radius, 3)))
    .setFriction(0.3).setRestitution(0.3);
  world.createCollider(col, body);
  return body;
}

function _buildDodge(world, maxTicks, interval) {
  const rag = window.brainEngine.createRagdoll(world);
  return {
    rag, maxTicks, hp: 100, nextProjectileAt: 60, interval,
    target: { x: 0, y: 1.2, z: 0 },           // not used for fitness but observe wants something
    projectileBodies: {}, projectileCount: 0,
    rng: _mkRng(0xDEAD),
  };
}

function _dodgeObs(env) {
  // Substitute "target" obs with nearest projectile dx/dz so the brain
  // knows what to avoid. Other inputs same as walk's balance subset.
  const base = _observeRagdoll(env.rag);
  const t = env.rag.bodies.torso.translation();
  let nearestDx = 0, nearestDz = 0, nearestD = Infinity;
  for (const body of Object.values(env.projectileBodies)) {
    const p = body.translation();
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    if (d < nearestD) { nearestD = d; nearestDx = (p.x - t.x) / 5; nearestDz = (p.z - t.z) / 5; }
  }
  return [...base, nearestDx, nearestDz];
}

function _dodgeStep(env, tick, world) {
  // Spawn projectiles toward the bear at fixed cadence
  if (tick >= env.nextProjectileAt) {
    const theta = env.rng() * Math.PI * 2;
    const r = 3.5;
    const sx = Math.cos(theta) * r, sz = Math.sin(theta) * r;
    const speed = 4.0;
    const name = "proj" + env.projectileCount;
    env.projectileBodies[name] = _spawnProjectile(world, {
      x: sx, y: 1.2, z: sz,
      vx: -Math.cos(theta) * speed, vy: 0, vz: -Math.sin(theta) * speed,
    });
    env.projectileCount += 1;
    env.nextProjectileAt = tick + env.interval;
  }
  // Damage on close contact
  const t = env.rag.bodies.torso.translation();
  for (const body of Object.values(env.projectileBodies)) {
    const p = body.translation();
    const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
    if (d < 0.35) { env.hp -= 4; }
  }
}

function _dodgeDone(env) {
  return env.rag.torsoTopY() < FALLEN_Y || env.hp <= 0;
}
function _dodgeFitness(env, tick) {
  return (tick * PHYS_DT) + Math.max(0, env.hp) * 0.05;
}

const _dodgeTrainerConfig = {
  population: 32, mutationRate: 0.12, sigma: 0.35, elitism: 6,
};
const _dodgeWarmup = 20;

const dodgeL1 = {
  id: "dodge-L1", skillId: "dodge", level: 1, name: "Dodge · One projectile",
  arch: WALK_ARCH, theoreticalMax: 8 + 5, maxTicks: 480,
  warmupTicks: _dodgeWarmup,
  trainerConfig: _dodgeTrainerConfig,
  cameraView: { position: [3.5, 2.0, 3.5], lookAt: [0, 0.9, 0] },
  build: (world) => _buildDodge(world, 480, 180),
  buildProps: () => ({}),
  propVisuals: [],
  dynamicPropFactory: (n) => n.startsWith("proj") ? { geom: { type: "sphere", radius: 0.15 }, color: 0xff5577, emissive: 0x661c2d } : null,
  observe: _dodgeObs,
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: _dodgeStep, done: _dodgeDone, fitness: _dodgeFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.projectileBodies),
};
const dodgeL2 = {
  id: "dodge-L2", skillId: "dodge", level: 2, name: "Dodge · Volley",
  arch: WALK_ARCH, theoreticalMax: 10 + 5, maxTicks: 600,
  warmupTicks: _dodgeWarmup,
  trainerConfig: _dodgeTrainerConfig,
  cameraView: { position: [4, 2.2, 4], lookAt: [0, 0.9, 0] },
  build: (world) => _buildDodge(world, 600, 90),
  buildProps: () => ({}),
  propVisuals: [],
  dynamicPropFactory: (n) => n.startsWith("proj") ? { geom: { type: "sphere", radius: 0.15 }, color: 0xff5577, emissive: 0x661c2d } : null,
  observe: _dodgeObs,
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: _dodgeStep, done: _dodgeDone, fitness: _dodgeFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.projectileBodies),
};
const dodgeL3 = {
  id: "dodge-L3", skillId: "dodge", level: 3, name: "Dodge · Continuous wave",
  arch: WALK_ARCH, theoreticalMax: 12 + 5, maxTicks: 720,
  warmupTicks: _dodgeWarmup,
  trainerConfig: _dodgeTrainerConfig,
  cameraView: { position: [4.5, 2.4, 4.5], lookAt: [0, 0.9, 0] },
  build: (world) => _buildDodge(world, 720, 50),
  buildProps: () => ({}),
  propVisuals: [],
  dynamicPropFactory: (n) => n.startsWith("proj") ? { geom: { type: "sphere", radius: 0.15 }, color: 0xff5577, emissive: 0x661c2d } : null,
  observe: _dodgeObs,
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: _dodgeStep, done: _dodgeDone, fitness: _dodgeFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.projectileBodies),
};

// ============================================================
// ATTACK — reach + strike a dummy. Same locomotion task as Walk
// but the "target" is a physical capsule dummy. Contact = score.
// ============================================================

function _spawnDummy(world, { x, y, z }) {
  const RAPIER = window.RAPIER;
  // Kinematic so it doesn't fall or get pushed — but reports contact
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
  const body = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.capsule(0.25, 0.18).setFriction(0.5);
  world.createCollider(col, body);
  return body;
}

function _buildAttack(world, maxTicks, dummies) {
  const rag = window.brainEngine.createRagdoll(world);
  return {
    rag, maxTicks, dummies,                // {name: {x,y,z}}
    target: dummies[Object.keys(dummies)[0]] || { x: 0, y: 0.6, z: 1.5 },
    hits: 0, hitTicks: {},
    forwardSum: 0,
    sidewaysPenalty: 0,
    upTicks: 0,
    lastZ: null,
  };
}

function _attackFitnessShaped(env, tick, alive) {
  const reachBonus = env.reached ? 3 : 0;
  const uprightBonus = (env.upTicks / Math.max(1, env.maxTicks || tick)) * 1.5;
  return env.forwardSum + reachBonus + env.hits * 2 + uprightBonus - env.sidewaysPenalty;
}

// Mark the nearest dummy as "reached" when the bear is close enough.
// Uses the same logic as _walkDone so the shaped fitness sees it.
function _attackDone(env) {
  if (env.rag.torsoTopY() < FALLEN_Y) return true;
  if (!env.reached) {
    const t = env.rag.bodies.torso.translation();
    const dist = Math.hypot(t.x - env.target.x, t.z - env.target.z);
    if (dist < 0.6) env.reached = true;
  }
  return false;
}

const _attackTrainerConfig = {
  population: 32, mutationRate: 0.12, sigma: 0.35, elitism: 6,
};
const _attackWarmup = 20;

function _attackStep(env, tick) {
  const t = env.rag.bodies.torso.translation();
  for (const [name, pos] of Object.entries(env.dummies)) {
    const d = Math.hypot(pos.x - t.x, pos.z - t.z);
    if (d < 0.6) {
      // Hit registered (rate-limited per dummy)
      if ((env.hitTicks[name] || -100) < tick - 30) {
        env.hitTicks[name] = tick;
        env.hits += 1;
      }
    }
  }
}

function _dummyVisuals(dummies, color = 0xff5577, em = 0x661c2d) {
  return Object.entries(dummies).map(([name, p]) => ({
    name, geom: { type: "capsule", radius: 0.18, halfHeight: 0.25 },
    color, emissive: em, static: { x: p.x, y: p.y, z: p.z },
  }));
}

const attackL1 = {
  id: "attack-L1", skillId: "attack", level: 1, name: "Attack · One dummy",
  arch: WALK_ARCH, theoreticalMax: 2 + 6 + 1.5, maxTicks: 480,
  warmupTicks: _attackWarmup,
  trainerConfig: _attackTrainerConfig,
  cameraView: { position: [3.5, 1.8, 1.8], lookAt: [0, 0.9, 1] },
  build: (world) => _buildAttack(world, 480, { d1: { x: 0, y: 0.6, z: 2 } }),
  buildProps(world) { return { d1: _spawnDummy(world, { x: 0, y: 0.6, z: 2 }) }; },
  propVisuals: _dummyVisuals({ d1: { x: 0, y: 0.6, z: 2 } }),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env, tick, world) => { _attackStep(env, tick); _walkShapingStep(env); },
  done: _attackDone, fitness: _attackFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};
const attackL2 = {
  id: "attack-L2", skillId: "attack", level: 2, name: "Attack · Mid-range",
  arch: WALK_ARCH, theoreticalMax: 4 + 8 + 1.5, maxTicks: 600,
  warmupTicks: _attackWarmup,
  trainerConfig: _attackTrainerConfig,
  cameraView: { position: [4, 1.9, 2.5], lookAt: [0, 0.9, 2] },
  build: (world) => _buildAttack(world, 600, { d1: { x: 0, y: 0.6, z: 4 } }),
  buildProps(world) { return { d1: _spawnDummy(world, { x: 0, y: 0.6, z: 4 }) }; },
  propVisuals: _dummyVisuals({ d1: { x: 0, y: 0.6, z: 4 } }),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env, tick, world) => { _attackStep(env, tick); _walkShapingStep(env); },
  done: _attackDone, fitness: _attackFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};
const attackL3 = {
  id: "attack-L3", skillId: "attack", level: 3, name: "Attack · Range",
  arch: WALK_ARCH, theoreticalMax: 6 + 10 + 1.5, maxTicks: 720,
  warmupTicks: _attackWarmup,
  trainerConfig: _attackTrainerConfig,
  cameraView: { position: [4.5, 2.0, 3.5], lookAt: [0, 0.9, 3] },
  build: (world) => _buildAttack(world, 720, { d1: { x: 0, y: 0.6, z: 6 } }),
  buildProps(world) { return { d1: _spawnDummy(world, { x: 0, y: 0.6, z: 6 }) }; },
  propVisuals: _dummyVisuals({ d1: { x: 0, y: 0.6, z: 6 } }),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: (env, tick, world) => { _attackStep(env, tick); _walkShapingStep(env); },
  done: _attackDone, fitness: _attackFitnessShaped,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

// ============================================================
// COMBO — multiple dummies in a row. Hit them sequentially.
// ============================================================
const combo1 = { d1: { x: -0.6, y: 0.6, z: 2 }, d2: { x: 0.6, y: 0.6, z: 2 } };
const combo2 = { d1: { x: -0.8, y: 0.6, z: 2 }, d2: { x: 0.8, y: 0.6, z: 3 }, d3: { x: -0.4, y: 0.6, z: 4 } };
const combo3 = { d1: { x: -1.0, y: 0.6, z: 2 }, d2: { x: 1.0, y: 0.6, z: 3 }, d3: { x: -0.8, y: 0.6, z: 4 }, d4: { x: 0.6, y: 0.6, z: 5 } };

function _comboEnv(id, level, dummies, name, maxTicks, theoreticalMax) {
  const lastZ = Math.max(...Object.values(dummies).map((d) => d.z));
  return {
    id, skillId: "combo", level, name,
    arch: WALK_ARCH, theoreticalMax, maxTicks,
    warmupTicks: _attackWarmup,
    trainerConfig: _attackTrainerConfig,
    cameraView: { position: [4, 2.0, lastZ / 2 + 1], lookAt: [0, 0.9, lastZ / 2] },
    build: (world) => {
      const rag = window.brainEngine.createRagdoll(world);
      return {
        rag, maxTicks, dummies, target: dummies.d1,
        hits: 0, hitTicks: {}, props: {},
        reached: false,
        forwardSum: 0, sidewaysPenalty: 0, upTicks: 0, lastZ: null,
      };
    },
    buildProps(world) {
      const props = {};
      for (const [n, p] of Object.entries(dummies)) props[n] = _spawnDummy(world, p);
      return props;
    },
    propVisuals: _dummyVisuals(dummies, 0xff8b45, 0x6d3818),
    observe: (env) => _observeWalk(env.rag, env.target),
    act: (env, out) => _applyTorques(env.rag, out),
    envStep: (env, tick, world) => { _attackStep(env, tick); _walkShapingStep(env); },
    done: _attackDone, fitness: _attackFitnessShaped,
    snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
  };
}
const comboL1 = _comboEnv("combo-L1", 1, combo1, "Combo · 2-hit", 540, 2 + 6 + 1.5);
const comboL2 = _comboEnv("combo-L2", 2, combo2, "Combo · 3-hit", 660, 4 + 9 + 1.5);
const comboL3 = _comboEnv("combo-L3", 3, combo3, "Combo · 4-hit", 780, 5 + 12 + 1.5);

// All 21 envs are real — no placeholders remaining.

const ENV_REGISTRY = {
  "balance-L1": balanceL1,
  "balance-L2": balanceL2,
  "balance-L3": balanceL3,
  "walk-L1":    walkL1,
  "walk-L2":    walkL2,
  "walk-L3":    walkL3,
  "run-L1":     runL1,
  "run-L2":     runL2,
  "run-L3":     runL3,
  "jump-L1":    jumpL1,
  "jump-L2":    jumpL2,
  "jump-L3":    jumpL3,
  "dodge-L1":   dodgeL1,
  "dodge-L2":   dodgeL2,
  "dodge-L3":   dodgeL3,
  "attack-L1":  attackL1,
  "attack-L2":  attackL2,
  "attack-L3":  attackL3,
  "combo-L1":   comboL1,
  "combo-L2":   comboL2,
  "combo-L3":   comboL3,
};

function getEnv(skillId, level) {
  return ENV_REGISTRY[`${skillId}-L${level}`];
}

window.trainingEnvs = { getEnv, envIds: Object.keys(ENV_REGISTRY) };
