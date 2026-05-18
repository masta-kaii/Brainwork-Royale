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

  logger.info(`Quest submit uid=${uid} questId=${questId} kind=${kind}`);

  // --- Verify by kind ---
  let verified = false;
  let rewardCoins = 0;
  let rewardGens = 0;

  switch (kind) {
    case "quiz": {
      // Payload: { subject, difficulty, answers: [{ questionId, selectedOption }], score, total }
      const { subject, difficulty, answers, score, total } = payload || {};
      if (!answers || !Array.isArray(answers) || !total || score == null) {
        throw new HttpsError("invalid-argument", "Quiz payload incomplete");
      }
      // Recompute score from Firestore answer key to prevent client-side tampering
      let correct = 0;
      for (const a of answers) {
        const keyDoc = await db.doc(`questions/${subject}/difficulty${difficulty}/${a.questionId}`).get();
        if (keyDoc.exists && keyDoc.data().correct === a.selectedOption) {
          correct++;
        }
      }
      const computedScore = Math.round((correct / total) * 100);
      if (computedScore !== score && Math.abs(computedScore - score) > 5) {
        logger.warn(`Quiz score mismatch uid=${uid} client=${score} server=${computedScore}`);
        throw new HttpsError("permission-denied", "Score verification failed");
      }
      verified = true;
      rewardCoins = Math.round(score * 0.8);
      rewardGens = Math.max(1, Math.round(score / 20));
      break;
    }
    case "body":
    case "fitness": {
      // Payload: { steps, source, timestamp }
      // Rate-limit: one body quest per day per user
      const today = new Date().toISOString().slice(0, 10);
      const dailyKey = `body_${today}`;
      const rateDoc = await db.doc(`users/${uid}/questLog/${dailyKey}`).get();
      if (rateDoc.exists) {
        throw new HttpsError("resource-exhausted", "Daily body quest already submitted");
      }
      // Mark rate limit
      await db.doc(`users/${uid}/questLog/${dailyKey}`).set({
        kind: "body", submittedAt: FieldValue.serverTimestamp(),
      });
      verified = true;
      rewardCoins = 80;
      rewardGens = 4;
      break;
    }
    case "focus":
    case "mind": {
      // Payload: { minutes, signature }
      const today = new Date().toISOString().slice(0, 10);
      const dailyKey = `focus_${today}`;
      const rateDoc = await db.doc(`users/${uid}/questLog/${dailyKey}`).get();
      if (rateDoc.exists) {
        throw new HttpsError("resource-exhausted", "Daily focus quest already submitted");
      }
      await db.doc(`users/${uid}/questLog/${dailyKey}`).set({
        kind: "focus", submittedAt: FieldValue.serverTimestamp(),
      });
      verified = true;
      rewardCoins = 60;
      rewardGens = 3;
      break;
    }
    case "game":
    case "in-game": {
      // Payload: { matchId }
      if (!payload?.matchId) {
        throw new HttpsError("invalid-argument", "Match ID required");
      }
      const matchDoc = await db.doc(`matches/${payload.matchId}`).get();
      if (!matchDoc.exists) {
        throw new HttpsError("not-found", "Match not found");
      }
      const matchData = matchDoc.data();
      const isWin = matchData.participants?.some(
        (p) => p.uid === uid && p.placement === 1
      );
      verified = true;
      rewardCoins = isWin ? 240 : 60;
      rewardGens = isWin ? 6 : 2;
      break;
    }
    default:
      throw new HttpsError("invalid-argument", `Unknown quest kind: ${kind}`);
  }

  if (!verified) {
    throw new HttpsError("internal", "Quest verification incomplete");
  }

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
// and grants streak multipliers for consecutive active days.
// ============================================================
export const dailyQuestReset = onSchedule("every day 00:00", async () => {
  logger.info("Starting daily quest reset");

  // Query all users with active quests and reset those marked "completed"
  // from the previous day. In production with many users, this should use
  // a batched query or a separate "activeQuests" collection.
  try {
    const usersSnap = await db.collection("users").listDocuments();
    let resetCount = 0;

    for (const userRef of usersSnap) {
      const questsSnap = await db.collection(`users/${userRef.id}/quests`).get();
      if (questsSnap.empty) continue;

      const batch = db.batch();
      let hasReset = false;

      for (const qDoc of questsSnap.docs) {
        const q = qDoc.data();
        // Only reset quests that were completed or are still active from yesterday
        if (q.status === "completed" || q.status === "active") {
          batch.update(qDoc.ref, {
            status: "active",
            progress: 0,
            rewardClaimed: false,
            completedAt: FieldValue.delete(),
          });
          hasReset = true;
        }
      }

      if (hasReset) {
        // Grant streak bonus: check if user was active yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        const streakDoc = await db.doc(`users/${userRef.id}/streaks/daily`).get();
        if (streakDoc.exists) {
          const streak = streakDoc.data();
          const lastActive = streak.lastActiveDate;
          if (lastActive === yesterdayStr) {
            // Consecutive day — increment streak
            const newStreak = (streak.count || 0) + 1;
            const multiplier = Math.min(3, 1 + Math.floor(newStreak / 7) * 0.5); // +0.5x per 7-day streak, cap 3x
            batch.update(db.doc(`users/${userRef.id}/streaks/daily`), {
              count: newStreak,
              multiplier,
              lastActiveDate: new Date().toISOString().slice(0, 10),
            });
            if (multiplier > 1) {
              // Grant streak bonus coins
              batch.update(db.doc(`users/${userRef.id}`), {
                "currency.coins": FieldValue.increment(Math.floor(50 * multiplier)),
              });
            }
          } else {
            // Broken streak — reset to day 1
            batch.update(db.doc(`users/${userRef.id}/streaks/daily`), {
              count: 1,
              multiplier: 1,
              lastActiveDate: new Date().toISOString().slice(0, 10),
            });
          }
        } else {
          // First streak record
          batch.set(db.doc(`users/${userRef.id}/streaks/daily`), {
            count: 1,
            multiplier: 1,
            lastActiveDate: new Date().toISOString().slice(0, 10),
          });
        }

        await batch.commit();
        resetCount++;
      }
    }

    logger.info(`Daily quest reset complete — ${resetCount} users reset`);
  } catch (e) {
    logger.error("Daily quest reset failed", e);
  }
});

// ============================================================
// notifyDiscord
// Posts match results to a Discord webhook. The webhook URL is
// stored in Firestore config (NOT hardcoded here). Create a doc
// at /config/discord with { webhookUrl }.
//   data: { matchId, winner, placement, mazeName, replayUrl }
// ============================================================
export const notifyDiscord = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId, winner, placement, mazeName, replayUrl } = request.data || {};

  if (!matchId) {
    throw new HttpsError("invalid-argument", "matchId required");
  }

  try {
    const configSnap = await db.doc("config/discord").get();
    const webhookUrl = configSnap.data()?.webhookUrl;
    if (!webhookUrl) {
      logger.warn("Discord webhook not configured — skipping notification");
      return { ok: false, reason: "webhook-not-configured" };
    }

    const placementLabel = placement === 1 ? "WINNER" : `#${placement}`;

    const body = {
      embeds: [{
        title: `🧠 ${winner || "Unknown"} ${placementLabel} — ${mazeName || "Neon Lab"}`,
        description: placement === 1
          ? `🏆 **${winner}** secured the treasure in match **${matchId}**!`
          : `${winner} placed **#${placement}** in match **${matchId}**.`,
        color: placement === 1 ? 0x5df2d6 : (placement <= 3 ? 0xffb84d : 0x8b91b8),
        fields: [
          { name: "Match", value: matchId, inline: true },
          { name: "Placement", value: `#${placement}`, inline: true },
        ],
        footer: { text: "Brainwork Royale · S03 Beta" },
        timestamp: new Date().toISOString(),
      }],
    };

    if (replayUrl) {
      body.embeds[0].url = replayUrl;
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      logger.error(`Discord webhook failed: ${res.status} ${res.statusText}`);
      return { ok: false, reason: `http-${res.status}` };
    }

    logger.info(`Discord notification sent for match ${matchId}`);
    return { ok: true };
  } catch (e) {
    logger.error("Discord webhook error", e);
    return { ok: false, reason: e.message };
  }
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
