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

const DEFAULT_CURRENCY = { coins: 0, gems: 0, rank: "BRONZE I" };

const DEFAULT_CHARACTER = {
  name: "ALBRT-7",
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
  const [uSnap, cSnap, qSnap] = await Promise.all([
    f.getDoc(userRef(uid)),
    f.getDoc(characterRef(uid)),
    f.getDocs(questsCol(uid)),
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

  return { profile, character, quests };
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
// Expose
// ============================================================
window.dataLayer = {
  DEFAULT_CHARACTER, DEFAULT_QUESTS, DEFAULT_CURRENCY,
  seedFirstTimeUser,
  loadPlayerState,
  saveCurrency,
  saveCharacter,
  saveCharacterStats,
  updateQuestProgress,
  markQuestRewardClaimed,
  setPlayerClass,
};
