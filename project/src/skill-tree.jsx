/* ============================================================
   BRAINWORK ROYALE — SKILL TREE
   Declarative prerequisite graph + helpers. The UI uses this to
   lock skills behind prereqs and to show "Master X L3 first" tooltips.

   Mastery key in firestore: brains["{skillId}-L{level}"].meta.mastered
   A skill is unlocked once its prereq's L3 is mastered.

   Exposes on window.skillTree.
   ============================================================ */

const SKILL_TREE = {
  balance: {
    id: "balance",
    name: "Balance",
    glyph: "⊥",
    prereq: null,             // foundation
    blurb: "Stay upright. Foundation for everything that follows.",
    isReal: true,
    levels: [
      { level: 1, label: "Flat ground",     desc: "Stand still on a stable platform." },
      { level: 2, label: "Lateral pushes",  desc: "Resist small impulses from the side." },
      { level: 3, label: "Random impulses", desc: "React to large random pushes for 10 s." },
    ],
  },
  walk: {
    id: "walk",
    name: "Walk",
    glyph: "▸",
    prereq: "balance",
    blurb: "Move forward without falling. Needs Balance mastered.",
    isReal: true,             // env ships in next round (placeholder this round)
    levels: [
      { level: 1, label: "Straight path",       desc: "Reach a target 8 m away on flat ground." },
      { level: 2, label: "Narrow path",         desc: "Stay on a 1 m-wide walkway with drops on either side." },
      { level: 3, label: "Stepped terrain",     desc: "Climb a few small steps and turn around a corner." },
    ],
  },
  run: {
    id: "run",
    name: "Run",
    glyph: "»",
    prereq: "walk",
    blurb: "Sprint at speed without losing balance.",
    isReal: true,
    levels: [
      { level: 1, label: "Sprint track",       desc: "Cover 15 m as fast as possible." },
      { level: 2, label: "Uneven ground",      desc: "Run over a bumpy surface without falling." },
      { level: 3, label: "Hurdle track",       desc: "Sprint and step over 2 low hurdles." },
    ],
  },
  jump: {
    id: "jump",
    name: "Jump",
    glyph: "↟",
    prereq: "run",
    blurb: "Launch and land safely. Needs sustained Run.",
    isReal: true,
    levels: [
      { level: 1, label: "Short gap",     desc: "Leap a 0.4 m gap between platforms." },
      { level: 2, label: "Wide gap",      desc: "Leap a 0.8 m gap." },
      { level: 3, label: "Parkour",       desc: "Three-platform sequence with mixed gap widths." },
    ],
  },
  dodge: {
    id: "dodge",
    name: "Dodge",
    glyph: "↪",
    prereq: "walk",
    blurb: "Move out of the way of incoming threats.",
    isReal: true,
    levels: [
      { level: 1, label: "One projectile",   desc: "Avoid a single slow projectile from the front." },
      { level: 2, label: "Three projectiles", desc: "Sidestep a staggered volley from random angles." },
      { level: 3, label: "Continuous wave",  desc: "Survive 8 s of constant projectiles." },
    ],
  },
  attack: {
    id: "attack",
    name: "Attack",
    glyph: "✦",
    prereq: "balance",
    blurb: "Strike a target without falling over.",
    isReal: true,
    levels: [
      { level: 1, label: "Stationary dummy", desc: "Hit a fixed dummy 1 m away." },
      { level: 2, label: "Moving dummy",     desc: "Hit a dummy circling at 1 m radius." },
      { level: 3, label: "Three dummies",    desc: "Hit all three dummies appearing at random angles." },
    ],
  },
  combo: {
    id: "combo",
    name: "Combo",
    glyph: "⨯",
    prereq: "attack",
    blurb: "Chain attacks within tight timing windows.",
    isReal: true,
    levels: [
      { level: 1, label: "2-hit combo",  desc: "Strike one dummy twice in 1 s." },
      { level: 2, label: "3-hit combo",  desc: "Strike one dummy three times in 1.5 s." },
      { level: 3, label: "Spread combo", desc: "Strike three separate dummies within 3 s." },
    ],
  },
};

const SKILL_ORDER = ["balance", "walk", "run", "jump", "dodge", "attack", "combo"];

// Brain doc key for a given (skillId, level)
function brainKey(skillId, level) {
  return `${skillId}-L${level}`;
}

// Did the user master a specific level? Reads brains map from app state.
function isLevelMastered(brains, skillId, level) {
  const b = brains?.[brainKey(skillId, level)];
  return !!(b && b.meta && b.meta.mastered);
}

// Is the SKILL ITSELF unlocked? Yes iff its prereq's L3 is mastered (or no prereq).
function isUnlocked(brains, skillId) {
  const def = SKILL_TREE[skillId];
  if (!def) return false;
  if (!def.prereq) return true;
  return isLevelMastered(brains, def.prereq, 3);
}

// What's the highest level the user can currently TRAIN for this skill?
// L1 is always trainable once the skill is unlocked. L2 trainable once L1 mastered. L3 once L2 mastered.
function highestTrainableLevel(brains, skillId) {
  if (!isUnlocked(brains, skillId)) return 0;
  if (isLevelMastered(brains, skillId, 2)) return 3;
  if (isLevelMastered(brains, skillId, 1)) return 2;
  return 1;
}

// Convenience: the prereq skill's display name, for tooltips
function prereqName(skillId) {
  const def = SKILL_TREE[skillId];
  if (!def?.prereq) return null;
  return SKILL_TREE[def.prereq]?.name || def.prereq;
}

window.skillTree = {
  SKILL_TREE, SKILL_ORDER,
  brainKey,
  isLevelMastered,
  isUnlocked,
  highestTrainableLevel,
  prereqName,
};
