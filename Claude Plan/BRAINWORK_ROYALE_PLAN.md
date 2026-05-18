# Brainwork Royale — Improvement Plan

> **Repo**: [masta-kaii/Brainwork-Royale](https://github.com/masta-kaii/Brainwork-Royale)  
> **Live site**: [brainwork-royale.vercel.app](https://brainwork-royale.vercel.app)  
> **Stack**: Vanilla JS · HTML/CSS · Firebase (Auth, Firestore, Storage) · Vercel · Three.js  
> **Beta target**: S03 opens May 24, 2026 — first 5,000 wardens free

---

## Overview

The landing page (`index.html`) is polished and sets ambitious expectations — NEAT AI brains, 16-AI maze battles, deterministic replays, health API quests. However, `app.html` (the actual game) is stuck on **"BOOTING WARDEN'S DECK…"** and never loads. The entire game loop is design-stage only; nothing is wired up yet.

This document organises all improvements into four priority tiers, from critical blockers to launch polish.

---

## Tier 1 — Critical: Make the App Boot

> Nothing else matters until `app.html` renders past the loader.

### 1.1 Debug the entry point crash
- Open browser DevTools on `https://brainwork-royale.vercel.app/app.html`
- Check the Console for JS errors (uncaught exceptions, failed imports, syntax errors)
- Check the Network tab for 404s on scripts, fonts, or GLB assets
- Check Vercel runtime logs under the deployment for server-side failures

### 1.2 Verify Firebase env vars on Vercel
- Firebase config keys (`apiKey`, `authDomain`, `projectId`, etc.) must be set as **Vercel environment variables**, not just in a local `.env`
- Go to Vercel → Project Settings → Environment Variables and confirm all keys are present for Production
- A missing or wrong `projectId` causes silent Firebase init failure that stalls the boot sequence

### 1.3 Add a global error boundary
- Wrap the boot sequence in `try/catch` and add `window.onerror` + `window.addEventListener('unhandledrejection', ...)` handlers
- Surface the real error to the DOM instead of hanging on the boot screen
- Example:
```js
window.addEventListener('unhandledrejection', e => {
  document.getElementById('boot-status').textContent = `Boot failed: ${e.reason}`;
  console.error(e.reason);
});
```

### 1.4 Check Node / Vercel runtime version
- Confirm `package.json` specifies the correct `engines.node` version
- Mismatched Node versions between local dev and Vercel runtime cause subtle breakage

---

## Tier 2 — Core Loop: Build the Actual Game

> The heart of Brainwork Royale. None of this exists yet — build in the order listed.

### 2.1 Procedural maze generator
- **Algorithm**: Recursive backtracker (simple, reliable, no dead ends at start)
- **Seeded RNG**: Use the match ID as the seed so every replay produces the identical maze
- **Storage**: Store the maze grid in Firestore under `matches/{matchId}/maze` as a flat array of cell flags
- **Output format**:
```js
// Cell flags (bitfield): N=1, E=2, S=4, W=8
const maze = { width: 32, height: 32, cells: Uint8Array }
```
- **Milestones**:
  - [ ] Maze renders as canvas or SVG in isolation
  - [ ] Start and exit positions deterministic per seed
  - [ ] Grid serialises to/from Firestore cleanly

### 2.2 NEAT brain engine (per warden)
- **Library**: [neataptic](https://github.com/wagenaartje/neataptic) or a custom minimal NEAT in a Web Worker
- **Inputs** (suggested): distance to wall N/E/S/W, distance to exit, current heading, last reward signal (7 inputs)
- **Outputs**: turn left, turn right, move forward (3 outputs, softmax)
- **Training**: Runs in background between matches — `requestIdleCallback` or a dedicated Web Worker
- **Persistence**: Serialise the genome to Firestore under `wardens/{uid}/genome`
- **Milestones**:
  - [ ] Single AI navigates a fixed maze (even randomly at first)
  - [ ] Fitness function rewards proximity to exit, penalises loops
  - [ ] Genome survives page refresh (Firestore round-trip)
  - [ ] Training generation counter increments correctly

### 2.3 16-AI match simulation
- **Where it runs**: Firebase Cloud Function (Node 20) triggered by a match queue document
- **Input**: 16 warden genome IDs + maze seed
- **Process**: Simulate up to `maxTicks` (e.g. 5,000); each tick evaluates all 16 nets and steps their positions
- **Output**: A compact tick log — array of `[tick, agentId, x, y, heading]` tuples — written to Firestore
- **Client**: Reads the tick log and renders it via canvas/Three.js as a replay (not live)
- **Milestones**:
  - [ ] Cloud Function runs a single match locally with `firebase emulators`
  - [ ] Tick log written to Firestore under `matches/{matchId}/ticks`
  - [ ] Client reads and renders a match replay at variable speed

### 2.4 Deterministic replay viewer
- **Requirement**: Given the same genome + maze seed, the replay is bit-identical every time
- **Playback controls**: Play, pause, scrub (range slider over tick index), speed multiplier (0.5×, 1×, 2×, 4×)
- **Brain inspector**: Click any agent to see its network activations at the current tick
- **Diff view**: Compare two generations of the same warden's genome side-by-side
- **Milestones**:
  - [ ] Replay renders correctly from stored tick log
  - [ ] Scrub slider works at all speeds without desync
  - [ ] Per-agent stats panel (survival tick, distance to exit, path length)

### 2.5 Quest → stat pipeline
- **Stats that matter**: INT (perception range), STA (stamina at battle start), AGI (move speed), STR (tiebreaker)
- **Quest types and their stat rewards**:

| Quest type | Stat gained | Measurement |
|---|---|---|
| Quiz (correct answer) | INT | +1 per correct, difficulty-weighted |
| Focus session | AGI | +1 per 25-min block completed |
| Steps (Strava/Fit) | STA | +1 per 1,000 steps |
| Sleep (Apple Health) | STA + STR | logged 7–9 hrs = +2 |

- **Milestones**:
  - [ ] Quest completion writes a stat delta to Firestore
  - [ ] Stat changes are reflected in the next match's agent initialisation
  - [ ] Daily quest cap enforced server-side (Cloud Function)

### 2.6 Health API connectors
Prioritise in this order (easiest to hardest):

1. **Strava** — OAuth 2.0 PKCE, webhook for activity sync, maps run/ride distance to STA
2. **Google Fit** — REST API with OAuth, maps steps to STA
3. **Apple Health** — Requires iOS native bridge; defer until iOS app exists
4. **Duolingo** — Unofficial API or manual check-in; low priority

- Store OAuth tokens encrypted in Firestore under `wardens/{uid}/connectors/{provider}`
- Refresh tokens via a scheduled Cloud Function (daily sync)

---

## Tier 3 — UX: Close the Gap Between Landing Page and Product

### 3.1 Wire the auth flow
The sign-in modal UI exists on the landing page but has no Firebase handlers.

- **Google**: `signInWithPopup(provider)` — one call, works immediately
- **Apple**: Requires Apple developer account + `OAuthProvider('apple.com')`
- **Email/password**: `createUserWithEmailAndPassword` + `signInWithEmailAndPassword`
- After sign-in: create a warden doc in Firestore (`wardens/{uid}`) if it doesn't exist, then redirect to `app.html`
- Guest mode: `signInAnonymously()`, mark the doc as `guest: true`

### 3.2 Warden's Deck screen (post-login)
After login, there is nothing. This is the core dashboard. Minimum viable panels:

- **Warden card**: Class icon, username, current stats (INT/STA/AGI/STR bars)
- **Quest panel**: Today's active quests, completion state, XP progress
- **Match queue button**: "Drop into a maze" → triggers match queue, shows estimated wait
- **Replay history**: Last 5 matches with outcome (placement, survival ticks)
- **Brain stats**: Current generation count, fitness trend (sparkline)

### 3.3 Class selection onboarding
Five classes are described on the landing page but not selectable.

- Show class cards during first-time onboarding (after account creation)
- Each card: class name, stat profile radar chart, favoured quest types, example ability
- Save `warden.class` to Firestore on selection; gate changes behind a cooldown (e.g. once per season)
- The selected class seeds the initial genome biases

### 3.4 Adaptive quiz module
- **Question bank**: Store questions in Firestore under `questions/{subject}/{difficulty}` (1–5)
- **Adaptive logic**: Track per-warden accuracy per subject. If accuracy > 80% → bump difficulty. If < 40% → drop difficulty.
- **Subjects**: Start with Math, History, Code — the three highest-engagement categories
- **Reward flow**: Correct answer → stat delta written → warden UI updates in real time

### 3.5 Three.js character viewer optimisation
The 3D rig is the landing page's strongest hook. It must load fast.

- **Compress the GLB**: Run the model through `gltf-pipeline` with Draco compression (target < 800 KB)
- **Lazy load**: Don't initialise Three.js until the viewer section enters the viewport (`IntersectionObserver`)
- **Progressive load**: Show a CSS skeleton / low-poly placeholder until the full model streams in
- **Mobile fallback**: If GPU tier is low (navigator.gpu or canvas2D benchmark), show a sprite sheet instead of the 3D model
- **Target**: First meaningful paint of the 3D viewer < 2s on a 10 Mbps connection

---

## Tier 4 — Polish: Make S03 Launch Feel Real

### 4.1 Beta waitlist with email confirmation
The "Reserve a slot" CTA has no backend.

- Wire the email input to Firestore `waitlist/{email}` with a server timestamp
- Send a confirmation email via Firebase Extensions → Trigger Email
- Show slot number: "You're warden #3,412 of 5,000"
- Track referral source with a `?ref=` query param

### 4.2 Live countdown timer
"Opens in 8 days" is hardcoded and will be wrong immediately.

```js
const TARGET = new Date('2026-05-24T00:00:00+08:00'); // MYT
function tick() {
  const diff = TARGET - Date.now();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  el.textContent = `${d}d ${h}h ${m}m ${s}s`;
}
setInterval(tick, 1000);
```

### 4.3 Firestore security rules audit
`firestore.rules` exists but likely has open or overly-permissive rules.

- Wardens should only write to their own doc: `allow write: if request.auth.uid == userId;`
- Match results must be server-authored only (no client writes to `matches/`)
- Quest completions verified server-side (Cloud Function) before stat deltas are applied
- Rate-limit quest submissions: one completion per quest type per day per warden

### 4.4 Dynamic OG / share cards
When wardens share a replay link it should unfurl with context.

- Use [Vercel OG](https://vercel.com/docs/functions/og-image-generation) (`@vercel/og`) to generate dynamic images
- Template: character class icon + warden name + match placement + maze thumbnail
- Route: `/api/og?matchId=xxx` returns a 1200×630 PNG
- Add `<meta property="og:image" content="/api/og?matchId=...">` to the replay page

### 4.5 Discord community
The footer links to Discord but there is no server.

- Create the Discord server with channels: `#announcements`, `#replays`, `#bugs`, `#class-chat`
- Add a Discord webhook that posts match results: "🧠 {warden} placed #{rank} in a maze — view replay"
- Wire the footer link to the real invite URL

---

## Implementation Order (Recommended Sprint Sequence)

| Sprint | Focus | Outcome |
|---|---|---|
| **S1** (now) | Fix boot, add error boundary, verify env vars | `app.html` renders |
| **S2** | Maze generator + single AI walking it | Playable prototype |
| **S3** | Auth flow + warden's deck skeleton | Logged-in experience exists |
| **S4** | 16-AI match sim + tick log | First real matches run |
| **S5** | Replay viewer + scrub controls | Core loop complete |
| **S6** | Quest pipeline + quiz module | Habits feed the AI |
| **S7** | Strava connector + stat sync | Real-world integration live |
| **S8** | Waitlist, countdown, OG cards, Discord | Beta launch ready |

---

## Open Questions

- **Match queue**: Do wardens wait for 16 real wardens to queue, or is the match sim triggered immediately with bots filling empty slots? → Recommend bots for beta.
- **Season structure**: What defines a season (S03)? Time-boxed (monthly)? Score threshold? → Define before S5.
- **Gear system**: "Better gear" is mentioned in the loop but undefined. Cosmetic only? Stat buffs? → Scope before S6.
- **Rapier physics**: Listed as "queued for V1" in the landing page. Keep deferred — don't block S03.

---

## Tech Debt to Track

- `functions/` directory contents need review — confirm Cloud Functions are deployed and not local-only
- `.firebaserc` — confirm the project alias matches the actual Firebase project ID
- `vercel.json` — confirm rewrites are not intercepting `app.html` and returning 404
- No CI/CD pipeline observed — add GitHub Actions for lint + deploy preview on PR

---

*Last updated: May 18, 2026*
