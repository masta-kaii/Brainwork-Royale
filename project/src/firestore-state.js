/* ============================================================
   BRAINWORK ROYALE — FIRESTORE DATA LAYER
   Thin wrapper around window.firebase.* that the JSX screens
   call without dealing with refs/snapshots directly.

   Loaded after firebase.js but before any JSX file that uses it.
   Exposes window.dataLayer = { ... }.

   Schema (mirrors firestore.rules):
     /users/{uid}
       role, email, displayName, currentClass, createdAt
       currency: { coins, gems, rank }
     /users/{uid}/character/default
       name, class, tier, generation, trainingQueue, createdAt
       stats: { speed, stamina, intelligence, strength }
     /users/{uid}/quests/{questId}
       kind, kindLabel, glyph, title, target, unit, reward,
       rewardLabel, progress, status, rewardClaimed,
       createdAt, completedAt

   All writes are fire-and-forget: errors get console.warn'd and
   the UI keeps working off React state. The point of this layer
   is durability between sessions, not source-of-truth for the UI.
   ============================================================ */

// New users get a starter wallet so they can try training immediately.
// 2000 coins = 1 Quick set + 1 Full Session pack.
const DEFAULT_CURRENCY = { coins: 2000, gems: 0, rank: "BRONZE I" };

const DEFAULT_CHARACTER = {
  name: "Berok 1",
  class: "engineer",
  tier: "Bronze",
  generation: 1,
  trainingQueue: 0,
  stats: { speed: 50, stamina: 50, intelligence: 50, strength: 50 },
};

const DEFAULT_QUESTS = [
  { id: "q1", kind: "quiz", kindLabel: "Linear algebra · Quiz",
    glyph: "Σ", title: "Solve 10 algebra problems",
    progress: 0, target: 10, unit: "solved", reward: 8, rewardLabel: "INT" },
  { id: "q2", kind: "body", kindLabel: "Steps · Strava",
    glyph: "↑", title: "Walk 8,000 steps today",
    progress: 0, target: 8000, unit: "steps", reward: 6, rewardLabel: "STA" },
  { id: "q3", kind: "mind", kindLabel: "Focus · 25 min Pomodoro",
    glyph: "◷", title: "One focus session",
    progress: 0, target: 1, unit: "session", reward: 12, rewardLabel: "gens" },
  { id: "q4", kind: "game", kindLabel: "In-game · Daily challenge",
    glyph: "✶", title: "Win 3 matches today",
    progress: 0, target: 3, unit: "wins", reward: 240, rewardLabel: "coins" },
];

// ============================================================
// SKILL CATALOG — the static definitions. Persisted state per
// user lives at /users/{uid}/skills/{skillId}.
// ============================================================
const SKILL_DEFS = [
  // Balance is the first REAL training skill — actual neural-net evolves
  // through ragdoll physics. Other six are still on the simulated trial
  // loop until each gets its own physics environment.
  { id: "balance", name: "Balance", stat: "stamina",     anim: "Idle 01",          glyph: "⊥",  blurb: "[REAL TRAINING] Ragdoll learns to stand. Brain weights persist + export.", isReal: true },
  { id: "walk",   name: "Walk",   stat: "stamina",      anim: "Walk 01",          glyph: "▸",  blurb: "Smoother gait. +stamina." },
  { id: "run",    name: "Run",    stat: "speed",        anim: "Run 01",           glyph: "»",  blurb: "Faster locomotion. +speed in battle." },
  { id: "jump",   name: "Jump",   stat: "stamina",      anim: "Jump 01",          glyph: "↟",  blurb: "Recovers stamina. Will clear obstacles when those ship." },
  { id: "dodge",  name: "Dodge",  stat: "speed",        anim: "Dodge 01",         glyph: "↪",  blurb: "Chance to nullify incoming damage." },
  { id: "attack", name: "Attack", stat: "strength",     anim: "Attack 01",        glyph: "✦",  blurb: "Heavier hits. +strength." },
  { id: "combo",  name: "Combo",  stat: "strength",     anim: "Combo Attack 01",  glyph: "⨯",  blurb: "Faster attack rhythm + extra strength." },
];

// Cumulative generation thresholds for each level.
const LEVEL_GENS = [0, 50, 200, 500];   // L0, L1, L2, L3 (mastered)
const MAX_LEVEL = 3;

const TRAINING_PACKS = [
  { id: "quick",    label: "Quick set",    cost: 100, gens: 50 },
  { id: "session",  label: "Full session", cost: 350, gens: 200 },
  { id: "marathon", label: "Marathon",     cost: 800, gens: 500 },
];

function levelForGens(gens) {
  let lvl = 0;
  for (let i = LEVEL_GENS.length - 1; i >= 0; i--) {
    if (gens >= LEVEL_GENS[i]) { lvl = i; break; }
  }
  return lvl;
}

function fb() {
  if (!window.firebase) throw new Error("Firebase not ready");
  return window.firebase;
}

function userRef(uid) {
  const f = fb();
  return f.doc(f.db, "users", uid);
}
function characterRef(uid) {
  const f = fb();
  return f.doc(f.db, "users", uid, "character", "default");
}
function questRef(uid, questId) {
  const f = fb();
  return f.doc(f.db, "users", uid, "quests", questId);
}
function questsCol(uid) {
  const f = fb();
  return f.collection(f.db, "users", uid, "quests");
}
function skillRef(uid, skillId) {
  const f = fb();
  return f.doc(f.db, "users", uid, "skills", skillId);
}
function skillsCol(uid) {
  const f = fb();
  return f.collection(f.db, "users", uid, "skills");
}
function brainRef(uid, key) {
  const f = fb();
  return f.doc(f.db, "users", uid, "brains", key);
}
function brainsCol(uid) {
  const f = fb();
  return f.collection(f.db, "users", uid, "brains");
}

// ============================================================
// First-time setup. Idempotent: skips anything that already exists.
// Returns nothing — caller should re-read state after.
// ============================================================
async function seedFirstTimeUser(uid) {
  const f = fb();

  // 1. Ensure currency exists on user doc
  const uSnap = await f.getDoc(userRef(uid));
  if (uSnap.exists() && !uSnap.data().currency) {
    await f.setDoc(userRef(uid), { currency: DEFAULT_CURRENCY }, { merge: true });
  }

  // 2. Character / default — create if missing
  const cSnap = await f.getDoc(characterRef(uid));
  if (!cSnap.exists()) {
    await f.setDoc(characterRef(uid), {
      ...DEFAULT_CHARACTER,
      createdAt: f.serverTimestamp(),
    });
  }

  // 3. Daily quests — only seed if subcollection is empty
  const qSnap = await f.getDocs(questsCol(uid));
  if (qSnap.empty) {
    await Promise.all(DEFAULT_QUESTS.map((q) =>
      f.setDoc(questRef(uid, q.id), {
        ...q,
        status: "active",
        rewardClaimed: false,
        createdAt: f.serverTimestamp(),
      })
    ));
  }
}

// ============================================================
// Read everything the game needs at boot.
// Falls back to DEFAULT_* values if a doc is missing.
// ============================================================
async function loadPlayerState(uid) {
  const f = fb();
  const [uSnap, cSnap, qSnap, sSnap, bSnap] = await Promise.all([
    f.getDoc(userRef(uid)),
    f.getDoc(characterRef(uid)),
    f.getDocs(questsCol(uid)),
    f.getDocs(skillsCol(uid)),
    f.getDocs(brainsCol(uid)),
  ]);

  const userData = uSnap.exists() ? uSnap.data() : {};
  const profile = {
    currency: { ...DEFAULT_CURRENCY, ...(userData.currency || {}) },
    currentClass: userData.currentClass || DEFAULT_CHARACTER.class,
    displayName: userData.displayName || "",
    email: userData.email || "",
  };

  const character = cSnap.exists()
    ? { ...DEFAULT_CHARACTER, ...cSnap.data() }
    : { ...DEFAULT_CHARACTER };

  // Materialize quests as an array preserving the canonical order
  const questMap = {};
  qSnap.forEach((d) => { questMap[d.id] = d.data(); });
  const quests = DEFAULT_QUESTS.map((seed) => {
    const stored = questMap[seed.id];
    return stored ? { ...seed, ...stored, id: seed.id } : { ...seed, status: "active", rewardClaimed: false };
  });

  // Materialize skills as a map keyed by skill id; missing skills default to level 0
  const skillMap = {};
  sSnap.forEach((d) => { skillMap[d.id] = d.data(); });
  const skills = {};
  SKILL_DEFS.forEach((def) => {
    const stored = skillMap[def.id];
    const generation = stored?.generation || 0;
    skills[def.id] = {
      id: def.id,
      level: stored?.level != null ? stored.level : levelForGens(generation),
      generation,
      masteredAt: stored?.masteredAt || null,
    };
  });

  // Brains — each doc is the portable brain JSON ({ schema, arch, weights, meta })
  const brains = {};
  bSnap.forEach((d) => { brains[d.id] = d.data(); });

  return { profile, character, quests, skills, brains };
}

// ============================================================
// Writes — all fire-and-forget, errors get logged but don't throw.
// ============================================================
function warn(label, err) {
  console.warn(`[dataLayer] ${label} failed`, err && (err.code || err.message || err));
}

async function saveCurrency(uid, partial) {
  try {
    const f = fb();
    // Build a path-style update so we only touch fields we changed
    const updates = {};
    Object.entries(partial).forEach(([k, v]) => { updates[`currency.${k}`] = v; });
    await f.updateDoc(userRef(uid), updates);
  } catch (e) { warn("saveCurrency", e); }
}

async function saveCharacter(uid, partial) {
  try {
    const f = fb();
    await f.setDoc(characterRef(uid), partial, { merge: true });
  } catch (e) { warn("saveCharacter", e); }
}

async function saveCharacterStats(uid, stats) {
  try {
    const f = fb();
    await f.updateDoc(characterRef(uid), { stats });
  } catch (e) { warn("saveCharacterStats", e); }
}

async function updateQuestProgress(uid, questId, progress, target) {
  try {
    const f = fb();
    const patch = { progress };
    if (target != null && progress >= target) {
      patch.status = "completed";
      patch.completedAt = f.serverTimestamp();
    }
    // Rules block quest update from clients — this will fail until
    // Cloud Functions take over. We try anyway so it works in test mode.
    await f.updateDoc(questRef(uid, questId), patch);
  } catch (e) { warn(`updateQuestProgress(${questId})`, e); }
}

async function markQuestRewardClaimed(uid, questId) {
  try {
    const f = fb();
    await f.updateDoc(questRef(uid, questId), {
      rewardClaimed: true,
      status: "completed",
      completedAt: f.serverTimestamp(),
    });
  } catch (e) { warn(`markQuestRewardClaimed(${questId})`, e); }
}

async function setPlayerClass(uid, classId) {
  try {
    const f = fb();
    // Two writes — user doc + character doc. Not transactional but
    // both succeed almost always; on failure we just retry next boot.
    await Promise.all([
      f.updateDoc(userRef(uid), { currentClass: classId }),
      f.updateDoc(characterRef(uid), { class: classId }),
    ]);
  } catch (e) { warn("setPlayerClass", e); }
}

// ============================================================
// Persist a single skill after training. Idempotent — uses setDoc
// with merge so create-or-update both work.
// ============================================================
async function saveSkill(uid, skillId, partial) {
  try {
    const f = fb();
    await f.setDoc(skillRef(uid, skillId), {
      id: skillId,
      ...partial,
      lastTrainedAt: f.serverTimestamp(),
    }, { merge: true });
  } catch (e) { warn(`saveSkill(${skillId})`, e); }
}

// ---- Brain weights (real NN, portable JSON) ----
async function saveBrain(uid, key, brainJson) {
  try {
    const f = fb();
    // Monotonic save: only overwrite if the new brain is at least as good
    // as the previously persisted one. Prevents a noisy bad pack from
    // clobbering a hard-won brain.
    const newFit = brainJson?.meta?.fitness ?? -Infinity;
    const existing = await f.getDoc(brainRef(uid, key));
    if (existing.exists()) {
      const oldFit = existing.data()?.meta?.fitness ?? -Infinity;
      if (newFit < oldFit) {
        console.info(`[dataLayer] saveBrain(${key}) skipped — existing fitness ${oldFit.toFixed(2)} >= new ${newFit.toFixed(2)}`);
        return;
      }
    }
    await f.setDoc(brainRef(uid, key), {
      ...brainJson,
      updatedAt: f.serverTimestamp(),
    });
  } catch (e) { warn(`saveBrain(${key})`, e); }
}

async function loadBrain(uid, key) {
  try {
    const f = fb();
    const snap = await f.getDoc(brainRef(uid, key));
    return snap.exists() ? snap.data() : null;
  } catch (e) { warn(`loadBrain(${key})`, e); return null; }
}

async function deleteBrain(uid, key) {
  try {
    const f = fb();
    await f.deleteDoc(brainRef(uid, key));
  } catch (e) { warn(`deleteBrain(${key})`, e); }
}

// ============================================================
// Expose
// ============================================================
window.dataLayer = {
  DEFAULT_CHARACTER, DEFAULT_QUESTS, DEFAULT_CURRENCY,
  SKILL_DEFS, LEVEL_GENS, MAX_LEVEL, TRAINING_PACKS,
  levelForGens,
  seedFirstTimeUser,
  loadPlayerState,
  saveCurrency,
  saveCharacter,
  saveCharacterStats,
  updateQuestProgress,
  markQuestRewardClaimed,
  setPlayerClass,
  saveSkill,
  saveBrain,
  loadBrain,
  deleteBrain,
};
