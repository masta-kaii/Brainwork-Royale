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

function _snapshotRagdoll(rag, extra = {}, props = null) {
  const bodies = {};
  for (const [name, b] of Object.entries(rag.bodies)) {
    const t = b.translation(), r = b.rotation();
    bodies[name] = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }
  let propsSnap = null;
  if (props) {
    propsSnap = {};
    for (const [name, body] of Object.entries(props)) {
      if (!body) continue;
      const t = body.translation(), r = body.rotation();
      propsSnap[name] = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
    }
  }
  return { bodies, props: propsSnap, ...extra };
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
  };
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

const walkL1 = {
  id: "walk-L1",
  skillId: "walk",
  level: 1,
  name: "Walk · Straight path",
  arch: WALK_ARCH,
  theoreticalMax: 3 + 3.5,                   // target z + reach bonus + upright
  maxTicks: 480,                             // 8 s
  cameraView: { position: [3.2, 1.8, 1.8], lookAt: [0, 0.9, 1.5] },
  build: (world) => _buildWalk(world, 3),
  buildProps: () => ({}),
  propVisuals: _walkPropVisuals(3),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: () => {},
  done: _walkDone,
  fitness: _walkFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const walkL2 = {
  id: "walk-L2",
  skillId: "walk",
  level: 2,
  name: "Walk · Path with pendulum",
  arch: WALK_ARCH,
  theoreticalMax: 5 + 3.5,
  maxTicks: 600,                             // 10 s
  cameraView: { position: [4.0, 2.0, 2.5], lookAt: [0, 0.9, 2.5] },
  build: (world) => _buildWalk(world, 5),
  buildProps(world) {
    // Pendulum hangs over the path at z=2.5 (midway), swings sideways into the bear
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
  envStep: () => {},
  done: _walkDone,
  fitness: _walkFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const walkL3 = {
  id: "walk-L3",
  skillId: "walk",
  level: 3,
  name: "Walk · Path with two pendulums",
  arch: WALK_ARCH,
  theoreticalMax: 7 + 3.5,
  maxTicks: 720,                             // 12 s
  cameraView: { position: [4.5, 2.2, 3.5], lookAt: [0, 0.9, 3.5] },
  build: (world) => _buildWalk(world, 7),
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
  envStep: () => {},
  done: _walkDone,
  fitness: _walkFitness,
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

function _buildRun(world, targetZ, maxTicks) {
  const rag = window.brainEngine.createRagdoll(world);
  return {
    rag, targetZ, maxTicks,
    target: { x: 0, y: 0.1, z: targetZ },
    reached: false,
    reachedAtTick: null,
  };
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

// Fitness = progress + (reached ? speed bonus up to +5 : 0) + (alive ? 1 : 0)
// Speed bonus scales with how much time was left when finished.
function _runFitness(env, tick, alive) {
  const t = env.rag.bodies.torso.translation();
  const progress = Math.max(0, Math.min(t.z, env.targetZ));
  const speedBonus = env.reached && env.reachedAtTick != null
    ? 5 * Math.max(0, (env.maxTicks - env.reachedAtTick) / env.maxTicks)
    : 0;
  const aliveBonus = alive ? 1 : 0;
  return progress + speedBonus + aliveBonus;
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
  theoreticalMax: 5 + 5 + 1,                 // target + max speed bonus + alive
  maxTicks: 320,                             // ~5.3 s — must be fast
  cameraView: { position: [4.0, 1.8, 2.5], lookAt: [0, 0.9, 2.5] },
  build: (world) => _buildRun(world, 5, 320),
  buildProps: () => ({}),
  propVisuals: _runPropVisuals(5),
  observe: (env) => _observeWalk(env.rag, env.target),
  act: (env, out) => _applyTorques(env.rag, out),
  envStep: () => {},
  done: _runDone,
  fitness: _runFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const runL2 = {
  id: "run-L2",
  skillId: "run",
  level: 2,
  name: "Run · Sprint + obstacle",
  arch: RUN_ARCH,
  theoreticalMax: 7 + 5 + 1,
  maxTicks: 420,                             // ~7 s
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
  envStep: () => {},
  done: _runDone,
  fitness: _runFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
};

const runL3 = {
  id: "run-L3",
  skillId: "run",
  level: 3,
  name: "Run · Sprint with two obstacles",
  arch: RUN_ARCH,
  theoreticalMax: 9 + 5 + 1,
  maxTicks: 540,                             // 9 s
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
  envStep: () => {},
  done: _runDone,
  fitness: _runFitness,
  snapshot: (env) => _snapshotRagdoll(env.rag, {}, env.props),
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
  "walk-L1":    walkL1,
  "walk-L2":    walkL2,
  "walk-L3":    walkL3,
  "run-L1":     runL1,
  "run-L2":     runL2,
  "run-L3":     runL3,
  // Placeholders for skills still to ship in future rounds
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
