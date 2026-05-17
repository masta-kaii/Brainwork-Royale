/* ============================================================
   BRAINWORK ROYALE — RUNTIME SDK
   Portable browser-friendly module for loading + running an exported
   brain JSON in any JavaScript environment (web, Node, Three.js
   game, Phaser, custom engine).

   USAGE
   -----
   1) Train and export a brain JSON via the game's "↓ Export brain"
      button. You get a file like `bear-brain-walk-L3.json`.

   2) Drop this file (brainwork-runtime.js) into your game project.

   3) Import + use:
        import { loadBrain } from './brainwork-runtime.js';
        const brain = await loadBrain('./bear-brain-walk-L3.json');
        // ...each frame:
        const observation = sampleObservation();   // see arch comments
        const actions = brain.act(observation);
        applyActions(actions);

   OBSERVATION FORMAT (depends on which env the brain was trained on)
   -----------------------------------------------------------------
   For Balance L1/L2/L3 (12 inputs):
     [ torso_pitch, torso_roll,
       lHip_angle, rHip_angle, lKnee_angle, rKnee_angle,
       lHip_angvel, rHip_angvel, lKnee_angvel, rKnee_angvel,
       torso_angvel_x, torso_angvel_z ]
     All radians / rad·s. Pitch/roll clamped to [-π, π].

   For Walk / Run / Jump / Attack / Combo (14 inputs):
     [ ...12 balance inputs as above,
       (target.x - torso.x) / 10,    // normalized target offset
       (target.z - torso.z) / 10 ]

   For Dodge (14 inputs):
     [ ...12 balance inputs as above,
       (nearestProjectile.x - torso.x) / 5,
       (nearestProjectile.z - torso.z) / 5 ]

   OUTPUT FORMAT (4 floats in [-1, 1])
     [ lHip_torque, rHip_torque, lKnee_torque, rKnee_torque ]
   Scale to your engine's torque units (in the source training env we
   multiply by 2.2 Nm and apply as torque impulses around the X axis).

   META
   ----
   brain.meta carries everything we know about the brain:
     { skillId, level, envId, gen, fitness, mastered, exportedAt }
   Use it to gate gameplay (e.g. only let the AI sprint if
   meta.skillId === 'run' && meta.mastered === true).

   This module has zero dependencies and works in any modern JS runtime.
   ============================================================ */

const SCHEMA_VERSION = "brainwork-royale.brain.v1";

/**
 * Load a brain from a URL, file path, or already-parsed JSON object.
 * @param {string | object} src - URL, path, or a brain JSON object.
 * @returns {Promise<Brain>}
 */
export async function loadBrain(src) {
  let json;
  if (typeof src === "string") {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`loadBrain: ${res.status} fetching ${src}`);
    json = await res.json();
  } else if (src && typeof src === "object") {
    json = src;
  } else {
    throw new Error("loadBrain: expected URL string or parsed JSON object");
  }
  if (json.schema !== SCHEMA_VERSION) {
    console.warn(`brainwork-runtime: schema mismatch (got ${json.schema}, expected ${SCHEMA_VERSION}). Continuing anyway.`);
  }
  return new Brain(json);
}

/**
 * Synchronous variant when you already have the JSON in hand.
 */
export function brainFromJSON(json) {
  return new Brain(json);
}

class Brain {
  constructor(json) {
    this.schema = json.schema;
    this.arch = json.arch;
    this.weights = json.weights;
    this.meta = json.meta || {};
  }

  /**
   * Forward pass. Returns an array of `arch.outputs` floats in [-1, 1].
   * @param {number[]} inputs - length must equal arch.inputs
   * @returns {number[]}
   */
  act(inputs) {
    const { w1, b1, w2, b2 } = this.weights;
    const { inputs: nI, hidden: nH, outputs: nO } = this.arch;
    if (inputs.length !== nI) {
      throw new Error(`brain.act: expected ${nI} inputs, got ${inputs.length}`);
    }
    // h = tanh(w1·x + b1)
    const h = new Array(nH);
    for (let i = 0; i < nH; i++) {
      let s = b1[i];
      const row = w1[i];
      for (let j = 0; j < nI; j++) s += row[j] * inputs[j];
      h[i] = Math.tanh(s);
    }
    // y = tanh(w2·h + b2)
    const y = new Array(nO);
    for (let i = 0; i < nO; i++) {
      let s = b2[i];
      const row = w2[i];
      for (let j = 0; j < nH; j++) s += row[j] * h[j];
      y[i] = Math.tanh(s);
    }
    return y;
  }
}

// Default export for convenience: `import brainwork from './brainwork-runtime.js'`
export default { loadBrain, brainFromJSON };
