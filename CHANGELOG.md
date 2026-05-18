# Changelog

All notable changes to Brainwork Royale.

---

## [Unreleased] — Phase 0 (Pre-flight)

### Changed
- **Honest landing page** — Replaced fake "S03 beta" framing with pre-alpha devlog framing
- **README rewrite** — Design pillar, current state, project structure, quick start
- **BUILD_PLAN.md** — Full 4-phase build plan with gates and risk register
- **CUT_LIST.md** — Features deliberately cut or deferred

### Fixed
- Vercel deploy: moved API functions to root `api/`, added `package.json`
- JSX parse error in `home.jsx` (orphaned duplicate replay content)
- Boot hang: added 15s auth timeout with error surface

---

## [2026-05-18] — Depth Tuning + 4 Phases

### Added
- Shaped fitness for all 7 training skills (forward velocity + sideways penalty + upright bonus)
- Per-env trainerConfig hooks (pop 32, mutation 0.12, sigma 0.35, elitism 6)
- Warmup phase in both evalEnv and evalEnvBatch
- Monotonic saveBrain (never clobber better brains)
- Live sparkline HUD during training
- "Play best brain" replay button (no coin cost)
- Reset-brain safety net
- Boot timeout + error boundary + step-by-step diagnostics
- Bot brains in battle sim (all agents get brain-driven speed)
- "Drop into a maze" button on Command Deck
- Training level-ups → warden stats (balance/walk→STA, run/dodge→SPD, attack/combo→STR)
- Live countdown on landing page (May 24 target)
- Beta waitlist to Firestore
- Server-side quest proof verification (quiz, body, focus, game)
- Daily quest reset Cloud Function + streak tracking
- 3D viewer GPU detection + lazy load + mobile fallback
- Class selection onboarding modal
- Discord webhook Cloud Function
- OG image cards (SVG via /api/og)
- Draco-compressed PEP-Smol (39% smaller)
- Strava OAuth flow (PKCE) + activity sync endpoint
- Demo brains for first-time users
- Pre-seeded replays with brain-driven movement

### Fixed
- `.firebaserc` project ID (was placeholder)
- Firebase init wrapped in try/catch
- PEP-Smol + Rapier loaders use global boot diagnostics
- Firestore security rules: added waitlist, connectors, questLog, streaks
- Removed dead code: `_walkFitness`, `_runFitness`, `_attackFitness` (old)
- 22 design artifacts removed from git tracking

---

## [2026-05-14] — Initial Setup

### Added
- FWOG Memory Core integration (local only)
- Initial project scaffold from Claude Design handoff
