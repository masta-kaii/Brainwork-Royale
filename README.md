# Brainwork Royale

> *"A game where you raise an AI through small daily habits and watch it compete in async maze battles. The fun comes from seeing your brain learn over weeks — and occasionally surprise you."*

**Current phase: Phase 0 — Pre-flight**  
**Tech stack: Vanilla JS · Firebase (Auth/Firestore) · Three.js · Vercel**  
**Devlog: [TBD]**

---

## Quick start

```bash
# Clone + serve locally
git clone https://github.com/masta-kaii/Brainwork-Royale.git
cd Brainwork-Royale

# Install Vercel CLI (if not installed)
npm i -g vercel

# Serve locally
vercel dev
```

Opens at `http://localhost:3000`. The landing page is `project/index.html`, the game shell is `project/app.html`.

---

## What is Brainwork Royale?

You train an AI by completing real-world habits — quizzes, focus sessions, movement. Each habit generates training tokens that evolve your AI's brain through a genetic algorithm. Your brain then competes against other players' brains in async maze races. You don't control the character. You raise it.

The core loop:
1. **Quest** — complete daily habits to earn training tokens
2. **Train** — your brain evolves through generations of neuroevolution
3. **Compete** — your brain races against others' in seeded mazes
4. **Replay** — watch how your (and others') brain navigated the maze

---

## Current state

Phase 0 is about setting honest foundations. The landing page previously advertised features that didn't exist yet. We're fixing that. What's actually built:

- Working auth flow (Firebase: email/password, Google, guest)
- 2D maze generation + battle simulation (seeded, deterministic)
- 3D character viewer (Three.js, 59-animation PEP-Smol rig)
- Ragdoll physics training for 7 locomotion skills (Rapier physics, shaped fitness GA)
- Replay viewer with time-scrub controls
- Quest system stub (client-side only)
- Waitlist + countdown on landing (being updated to honest framing)

What's NOT built yet (and the landing page won't claim otherwise):
- Async multiplayer ghost races
- Server-authoritative match resolution
- Strava/Health API integration (auth endpoints built, not connected)
- Real neural-network maze navigation (the current battle AI uses BFS pathfinding)

---

## Project structure

```
Brainwork Royale/
├── api/              # Vercel serverless functions (OG images, Strava OAuth)
├── docs/             # Developer documentation
├── functions/        # Firebase Cloud Functions
├── project/          # Static site deployed to Vercel
│   ├── api/          # (deprecated — moved to root api/)
│   ├── assets/       # 3D models, GLTF files
│   ├── runtime/      # Brain export SDK
│   ├── src/          # JSX components (Babel-transpiled in browser)
│   │   ├── app.jsx           # App shell + boot sequence
│   │   ├── home.jsx          # Command Deck (dashboard)
│   │   ├── training.jsx      # Training screen shell
│   │   ├── skill-trainer.jsx # Per-skill training UI
│   │   ├── brain-engine.jsx  # NN + GA trainer + physics
│   │   ├── training-envs.jsx # 21 training environments (7 skills × 3 levels)
│   │   ├── sim.jsx           # Battle simulation (maze gen, agents, replays)
│   │   ├── battle.jsx        # 3D battle screen
│   │   ├── replays.jsx       # Replay viewer
│   │   ├── quests.jsx        # Quest UI
│   │   ├── scene3d.jsx       # Three.js 3D rendering
│   │   ├── firebase.js       # Firebase SDK init
│   │   ├── firestore-state.js # Firestore data layer
│   │   └── ...
│   ├── styles.css
│   ├── index.html    # Landing page
│   └── app.html      # Game shell
├── BUILD_PLAN.md     # The master build plan
├── CHANGELOG.md
├── CUT_LIST.md
└── package.json      # Vercel function dependencies
```

## Deploy

Pushes to `main` auto-deploy to Vercel at `brainwork-royale.vercel.app`.  
Firebase Functions deploy separately: `firebase deploy --only functions`.

---

*Read the full build plan: [BUILD_PLAN.md](BUILD_PLAN.md)*
