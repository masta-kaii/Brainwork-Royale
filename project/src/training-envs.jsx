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
