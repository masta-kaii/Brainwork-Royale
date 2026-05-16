/* ============================================================
   BRAINWORK ROYALE — CLOUD FUNCTIONS
   Server-side logic that can't run in the browser:
     - User initialization on signup
     - Quest verification (anti-cheat / API-verified data)
     - Match scheduling + resolution (server-authoritative)
     - Daily quest reset (scheduled)
     - Admin: base model versioning

   ---- Local dev ----
     firebase emulators:start
   ---- Deploy ----
     firebase deploy --only functions

   2nd-gen functions require the Blaze (pay-as-you-go) plan.
   Free monthly quota still covers ~2M invocations — generous for a
   prototype. Scheduled functions in particular need Blaze.

   FILL IN any TODO blocks below as the game's logic firms up.
   ============================================================ */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

initializeApp();
const db = getFirestore();

// Helper — assert the caller is signed in, return uid
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in");
  }
  return request.auth.uid;
}

// Helper — assert the caller is an admin
async function requireAdmin(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only");
  }
}

// ============================================================
// onUserCreate
// Trigger: client creates /users/{uid} on signup. Bootstrap their
// character + brain docs server-side so initial state is canonical.
// ============================================================
export const onUserCreate = onDocumentCreated("users/{uid}", async (event) => {
  const uid = event.params.uid;
  logger.info(`Bootstrapping user ${uid}`);

  const batch = db.batch();
  batch.set(db.doc(`users/${uid}/character/default`), {
    name: "Newbie",
    class: "engineer",
    stats: { speed: 5, stamina: 5, intelligence: 5, strength: 5 },
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`users/${uid}/brain/active`), {
    baseModelVersion: "v1.0",
    weights: null,        // populated after the first training tick
    generation: 0,
    lastTrainedAt: FieldValue.serverTimestamp(),
  });
  batch.update(db.doc(`users/${uid}`), {
    stats: { wins: 0, losses: 0, totalQuests: 0, currentRank: "bronze" },
    currency: { coins: 0, gems: 0 },
  });
  await batch.commit();
});

// ============================================================
// submitQuestProof
// Called from the client when a player completes a quest. Verifies
// the proof, grants rewards, and marks the quest complete. Never
// trust client-reported success — verify here.
//   data: { questId, kind, payload }
//   returns: { ok, rewardCoins, rewardGens }
// ============================================================
export const submitQuestProof = onCall(async (request) => {
  const uid = requireAuth(request);
  const { questId, kind, payload } = request.data || {};

  // TODO: verify by kind
  //   "quiz"    -> recompute score from saved answer key
  //   "fitness" -> call Strava / Google Fit with stored OAuth token
  //   "focus"   -> validate timed-session signature
  //   "in-game" -> read /matches and confirm win count

  logger.info(`Quest submit uid=${uid} questId=${questId} kind=${kind}`);

  // Placeholder rewards — replace with rules from the design brief
  const rewardCoins = 100;
  const rewardGens = 5;

  await db.doc(`users/${uid}/quests/${questId}`).set({
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    rewardClaimed: true,
  }, { merge: true });

  await db.doc(`users/${uid}`).update({
    "currency.coins": FieldValue.increment(rewardCoins),
    "stats.totalQuests": FieldValue.increment(1),
  });

  return { ok: true, rewardCoins, rewardGens };
});

// ============================================================
// resolveMatch
// Server-authoritative match resolution. Client submits the seed
// + participants; server replays the deterministic sim with each
// participant's current brain weights and writes the result.
//   data: { matchId, participants, seed }
// ============================================================
export const resolveMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId, participants, seed } = request.data || {};

  // TODO:
  //  1. Load each participant's brain weights from /users/{id}/brain/active
  //  2. Run the deterministic sim with `seed`
  //  3. Compute placements + treasure winner
  //  4. Write /matches/{matchId} { seed, participants, results, timestamp }
  //  5. Write /matches/{matchId}/replay { participantBrains, mazeLayout }

  logger.info(`Match resolve requested by ${uid} for ${matchId}`);
  throw new HttpsError("unimplemented", "Match resolver not built yet");
});

// ============================================================
// dailyQuestReset
// Scheduled — every day at 00:00 UTC. Resets daily-cadence quests
// and grants streak multipliers.
// ============================================================
export const dailyQuestReset = onSchedule("every day 00:00", async () => {
  logger.info("Resetting daily quests");
  // TODO: query active daily quests across users and reset their state
});

// ============================================================
// publishBaseModel  (admin only)
// Upload a new base NN model that all new users inherit.
//   data: { version, weights, description }
// ============================================================
export const publishBaseModel = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const { version, weights, description } = request.data || {};

  await db.doc(`baseModels/${version}`).set({
    weights,
    description: description || "",
    releasedAt: FieldValue.serverTimestamp(),
    releasedBy: uid,
    active: true,
  });
  return { ok: true, version };
});
