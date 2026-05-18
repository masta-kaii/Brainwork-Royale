/* ============================================================
   Strava OAuth — Step 1: Authorize
   Redirects the user to Strava's OAuth authorization page.
   Uses PKCE (Proof Key for Code Exchange) for security.
   
   GET /api/strava/auth
   ============================================================ */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Lazy-init Firebase Admin (reuses across warm invocations)
function getDb() {
  if (!getApps().length) {
    initializeApp();
  }
  return getFirestore();
}

function generateCodeVerifier() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from({ length: 96 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default async function handler(req) {
  try {
    const db = getDb();
    const configSnap = await db.doc("config/strava").get();
    const config = configSnap.data() || {};
    const clientId = config.clientId;

    if (!clientId) {
      return new Response("Strava not configured — add clientId to /config/strava", { status: 500 });
    }

    const redirectUri = `https://${req.headers.get("host") || "brainwork-royale.vercel.app"}/api/strava/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await sha256(codeVerifier);

    // Store verifier temporarily (5 min TTL) so callback can use it
    const state = crypto.randomUUID();
    await db.doc(`_stravaOAuth/${state}`).set({
      codeVerifier,
      createdAt: Date.now(),
      redirectUri,
    });

    const authUrl = new URL("https://www.strava.com/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("approval_prompt", "auto");
    authUrl.searchParams.set("scope", "activity:read_all");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return Response.redirect(authUrl.toString(), 302);
  } catch (e) {
    console.error("Strava auth error", e);
    return new Response(`Auth failed: ${e.message}`, { status: 500 });
  }
}
