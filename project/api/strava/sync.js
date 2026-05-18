/* ============================================================
   Strava Sync — Manually triggers activity sync for a user.
   Fetches recent activities from Strava API and maps distance
   (km) to STA stat points.
   
   POST /api/strava/sync
   Body: { connectorId, uid }
   ============================================================ */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function getDb() {
  if (!getApps().length) {
    initializeApp();
  }
  return getFirestore();
}

async function refreshToken(db, connectorId, refreshToken) {
  const configSnap = await db.doc("config/strava").get();
  const { clientId, clientSecret } = configSnap.data() || {};

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();

  await db.doc(`connectors/${connectorId}`).update({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  });

  return data.access_token;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { connectorId, uid } = body || {};

    if (!connectorId) {
      return new Response(JSON.stringify({ error: "connectorId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = getDb();
    const connDoc = await db.doc(`connectors/${connectorId}`).get();
    if (!connDoc.exists) {
      return new Response(JSON.stringify({ error: "Connector not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conn = connDoc.data();
    let accessToken = conn.accessToken;

    // Check if token needs refresh
    if (conn.expiresAt && conn.expiresAt.toMillis() < Date.now()) {
      accessToken = await refreshToken(db, connectorId, conn.refreshToken);
    }

    // Fetch recent activities (last 7 days)
    const after = Math.floor((Date.now() - 7 * 86400000) / 1000);
    const actRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!actRes.ok) {
      return new Response(JSON.stringify({ error: `Strava API error: ${actRes.status}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const activities = await actRes.json();

    // Map: 1 STA point per 1,000 steps, ~1,300 steps per km walking
    // Distance in METERS from Strava
    let totalDistance = 0;
    let totalSteps = 0;
    for (const act of activities) {
      if (act.type === "Run" || act.type === "Walk" || act.type === "Hike") {
        totalDistance += act.distance || 0;
      }
      // Some activities have step count directly
      if (act.type === "Walk" || act.type === "Hike") {
        totalSteps += (act.distance || 0) / 0.75 * 1.3; // rough step estimate
      }
    }

    // Calculate STA gain: 1 STA per 1,000 steps
    const staGain = Math.min(20, Math.floor(totalSteps / 1000));

    // Update connector last sync
    await db.doc(`connectors/${connectorId}`).update({
      lastSyncedAt: FieldValue.serverTimestamp(),
      lastSyncDistance: totalDistance,
      lastSyncSteps: Math.round(totalSteps),
    });

    // Bump user STA stat if uid provided
    if (uid && staGain > 0) {
      const userDoc = await db.doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const char = (await db.doc(`users/${uid}/character/default`).get()).data() || {};
        const currentSta = char.stats?.stamina || 50;
        await db.doc(`users/${uid}/character/default`).update({
          "stats.stamina": Math.min(100, currentSta + staGain),
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      activities: activities.length,
      totalDistance: Math.round(totalDistance / 1000 * 10) / 10, // km
      totalSteps: Math.round(totalSteps),
      staGain,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Strava sync error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = {
  runtime: "nodejs20.x",
};
