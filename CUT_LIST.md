# Cut List

Features that sounded great but didn't make it into the current scope. Revisit quarterly.

---

## Cut from the original landing page

| Feature | Why cut | When to revisit |
|---------|---------|-----------------|
| NEAT (NeuroEvolution of Augmenting Topologies) | Overly complex for a game. Simple GA on fixed-topology NN works better and is more debuggable. | Never — simple GA is the permanent choice |
| Rapier physics engine for battle | Battle sim runs deterministic 2D grid — physics adds nondeterminism. Rapier stays only in the training sandbox. | Only if 3D cosmetic physics becomes a core feature request |
| "5,000 free wardens" beta framing | Dishonest — no capacity to support 5,000 users. Open beta when ready, not before. | Phase 3 soft launch |
| Apple Sign-in | Requires paid Apple Developer account. Zero iOS-specific users exist. | When iOS usage reaches >5% of traffic |
| Duolingo integration | Duolingo's third-party API is unreliable. Build our own quiz instead. | Never — own quiz is better |
| Strava/Health API connectors | Authentication endpoints built, not live. Needs real API keys. | When Phase 4 begins (100+ WAU required) |
| Discord server with webhook | Webhook Cloud Function built. No actual server exists. | Before Phase 1 playtests (need community) |
| "Warden's Deck" branding | Over-branded. Simplifies to plain "Dashboard" or "Command Deck." | Never — keep it simple |
| 2FA for auth | Premature for pre-alpha. Adds friction to signup. | When paid features exist or users request it |
| Gear/equipment system | Mentioned on landing page, never scoped. Would add complexity without improving the core loop. | Phase 4 only if players specifically ask for it |

---

## Cut from current implementation but kept as future option

| Feature | Status | Notes |
|---------|--------|-------|
| Bone-driving for arms/spine | Built but disabled | PEP-Smol rig can drive arm/spine bones. Not wired to any training env. |
| Server-authoritative match resolution | Cloud Function stub exists | Needs Blaze plan + full sim re-implementation in Node |
| @vercel/og image generation | Replaced with SVG | JSX-in-Node too complex for this stack. SVG fallback works fine. |

---

## Principles for adding items to this list

1. Does removing this simplify the code or user flow?
2. Would adding it back later be harder than keeping it now?
3. Is it serving the design pillar or serving ego?

If the answer to #1 is yes and #3 is ego, cut it.
