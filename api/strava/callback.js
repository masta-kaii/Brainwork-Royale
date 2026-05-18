/* ============================================================
   Strava OAuth — Step 2: Callback
   Strava redirects here after user authorizes. Exchanges the
   authorization code for access + refresh tokens, stores them
   in Firestore.
   
   GET /api/strava/callback?code=xxx&state=xxx
   ============================================================ */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function getDb() {
  if (!getApps().length) {
    initializeApp();
  }
  return getFirestore();
}

function makeId() {
  return Array.from({ length: 16 }, () => Math.random().toString(36)[2]).join("");
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return new Response(`Strava authorization denied: ${error}`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code || !state) {
    return new Response("Missing code or state parameter", { status: 400 });
  }

  try {
    const db = getDb();

    // Retrieve the stored OAuth state
    const stateDoc = await db.doc(`_stravaOAuth/${state}`).get();
    if (!stateDoc.exists) {
      return new Response("OAuth state expired or invalid — please try again", { status: 400 });
    }
    const { codeVerifier, redirectUri } = stateDoc.data();

    // Clean up state
    await db.doc(`_stravaOAuth/${state}`).delete();

    // Exchange code for tokens
    const configSnap = await db.doc("config/strava").get();
    const config = configSnap.data() || {};
    const { clientId, clientSecret } = config;

    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Strava token exchange failed", tokenRes.status, errText);
      return new Response(`Token exchange failed: ${tokenRes.status}`, { status: 500 });
    }

    const tokenData = await tokenRes.json();

    // Generate a local connector ID for this user
    const connectorId = makeId();

    // Store tokens in Firestore (encrypted at rest by Firestore)
    await db.doc(`connectors/${connectorId}`).set({
      provider: "strava",
      athleteId: tokenData.athlete?.id,
      athleteName: tokenData.athlete
        ? `${tokenData.athlete.firstname || ""} ${tokenData.athlete.lastname || ""}`.trim()
        : "Strava Athlete",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at
        ? new Date(tokenData.expires_at * 1000)
        : FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      lastSyncedAt: null,
    });

    // Return a success page that closes itself (for popup flow) or redirects
    const successHtml = `<!DOCTYPE html><html><head><title>Strava Connected</title>
<style>body{background:#07080d;color:#f3f5ff;font-family:'JetBrains Mono',monospace;display:grid;place-items:center;height:100vh;margin:0}
.card{text-align:center;padding:40px;background:#0b0d16;border:1px solid #2a3052;border-radius:20px;max-width:400px}
h1{color:#5df2d6;font-size:20px;margin:0 0 8px}
p{color:#8b91b8;font-size:13px;margin:0 0 20px}
.id{color:#5a608a;font-size:10px;margin-top:16px;word-break:break-all}
</style></head><body><div class="card">
<h1>✓ Strava Connected</h1>
<p>${tokenData.athlete?.firstname || "Athlete"}, your activities will now sync to Brainwork Royale.</p>
<p style="color:#5a608a;font-size:11px">Connector ID: <span class="id">${connectorId}</span></p>
<p style="color:#5a608a;font-size:11px">Store this ID in your warden profile to link steps → STA.</p>
</div></body></html>`;

    return new Response(successHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  } catch (e) {
    console.error("Strava callback error", e);
    return new Response(`Callback error: ${e.message}`, { status: 500 });
  }
}
