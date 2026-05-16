# Brainwork Royale — Design Brief

> A solo-dev web game where your real-world habits train an AI character that fights other AIs in maze battle royales.

---

## 1. The Pitch (One Paragraph)

**Brainwork Royale** is a browser-based game where every player owns an AI character with its own evolving neural network "brain." The character's body stats (speed, stamina, intelligence, strength) are leveled up by the player completing **real-world tasks** — quizzes on subjects they want to learn, productivity goals that are hard to fake, and in-game challenges. The AI itself is trained via **neuroevolution** (genetic algorithm + neural network), starting from a base model the admin pre-trains. Players don't control their character in battle. Instead, they prepare it — do quests, train it, equip it — then send it into **maze battle royale matches** where AIs navigate procedural mazes full of obstacles, fight each other, and race to a treasure at the center. Winners earn crafting materials, coins, and cosmetics. Players can watch full replays to see how their AI's brain is evolving over time.

---

## 2. Core Loop

```
Real-world quest → Stat / training boost → Auto-battle → Rewards → Better gear → Stronger AI
       ↑                                                                              │
       └──────────────────────────────────────────────────────────────────────────────┘
```

1. Player wakes up, opens the game
2. Picks a daily quest (study a subject, run X km, finish Y focus minutes, complete in-game challenge)
3. Completes it in the real world or in-app
4. Quest grants **stat points** AND **extra training generations** for their AI
5. AI runs its training in the background (set-and-forget, replay available)
6. Player enters their AI into the next battle royale match
7. Match resolves automatically — player watches the replay
8. Wins earn currency / cosmetics / crafting mats
9. Repeat

---

## 3. The AI System

### 3.1 Reference videos (the "vibe")

These are the visual / behavioral references the player wants the game to feel like:

| Video | Channel | What it shows |
|---|---|---|
| [AI Learns to Walk](https://youtu.be/L_4BPjLBF4E) | AI Warehouse | Agent "Albert" learns locomotion in rooms |
| [Multi-Agent Hide and Seek](https://youtu.be/kopoLzvh5jY) | OpenAI | Agents discover emergent tool use against each other |
| [AI Learns to Race Hurdles](https://youtu.be/MrbizZybHi4) | AI Warehouse | Albert vs Albert, 100m hurdles competition |
| [AI Learns to Escape Extreme Maze](https://youtu.be/F6iVsA47qiM) | AI Warehouse | Albert solves an extreme labyrinth |
| [This AI Learned Boxing](https://youtu.be/SsJ_AusntiU) | Two Minute Papers | AI agents learn knockout-power combat |

**Important technical note for Design:** All five reference videos use **Deep Reinforcement Learning** (Unity ML-Agents / PPO), not neuroevolution. For this project we're proposing **neuroevolution (NEAT)** instead because:

- It runs entirely in the browser (TensorFlow.js or neataptic, no server GPU)
- It's visually more satisfying for a game — you literally watch a population evolve
- It's far simpler for a solo dev to implement and debug
- The *player-facing experience* (an agent that learns over time) is identical

If Design strongly prefers RL for any reason, that's a discussion. Default is neuroevolution.

### 3.2 What the AI actually "sees" and "does"

**Inputs (sensors):**
- 8-directional raycasts → distance to walls, enemies, treasure, items
- Own health, stamina, position relative to treasure
- Nearest enemy distance + direction
- Current state flags (in combat? has item?)

**Outputs (actions):**
- Move direction (or move vector)
- Attack / defend / use ability
- Pick up item

**Stats feed into the body, not the brain:**
- Same neural network architecture for everyone
- Speed stat = max movement speed multiplier
- Stamina stat = how long the AI can sprint or fight
- Intelligence stat = perception range / number of raycasts / vision angle
- Strength stat = damage dealt

This means **two players with identical brains but different stats will fight differently** — and a smarter brain can still beat better stats.

### 3.3 Base model vs. fine-tuning

- **Admin (you)** trains a strong base model offline using thousands of simulated generations. Everyone gets this on signup so they don't start with a brain that can't even walk.
- **Players** receive the base model and earn **training generations** as a reward for completing quests. Their AI fine-tunes from the base, gradually diverging into a unique fighter.
- **Admin can iterate** the base model over time and re-release it (versioned).

### 3.4 Replay & history

- Every match is deterministic given (seed + AI weights), so replays are tiny — just store the seed and starting weights
- Players can scrub through past matches and watch their AI's evolution generation by generation
- "Brain timeline" view: see how decisions change between gen 10, 50, 200

---

## 4. Quest System

### 4.1 Three quest categories

**A. In-game quests** (easiest, always available)
- Win 3 matches today
- Reach top 10 in a maze
- Defeat a specific boss bot
- Crafting challenges

**B. Learning quizzes** (subject-based, chosen by player)
- Player picks subjects they want to learn (math, history, languages, programming, etc.)
- Adaptive difficulty — quizzes get harder as you do better
- Rewards Intelligence stat + training generations
- Quiz content can be admin-curated or AI-generated (Claude API) per subject

**C. Real-world productivity quests** (the "hard to lie on" ones)
- Step count / distance run (Google Fit, Apple Health, Strava API) → Stamina
- Focus / study time (Forest, Toggl, or in-app webcam-monitored timer) → Intelligence
- Sleep duration (health APIs) → Recovery / Stamina
- Code commits, language learning streaks (GitHub, Duolingo) → Intelligence

### 4.2 Anti-cheat philosophy

The "hard to lie on" requirement is real but a perfect solution is impossible. Layered approach:

1. **API-verified data** for anything we can (health, fitness, productivity apps)
2. **In-app timed tasks** with optional webcam attention checks for study mode (opt-in, with a clear "this is creepy, but it's optional" framing)
3. **Photo proof + Claude Vision API** for ambiguous claims ("here's my running watch showing 5km")
4. **Honor system + diminishing returns** — cheating gives small rewards anyway; real engagement gives bigger long-term rewards via stat compounding
5. **Anti-cheat is NOT the MVP focus** — start with in-game and quiz quests, add real-world later

### 4.3 Stat-to-quest mapping (proposed)

| Quest type | Primary reward | Secondary |
|---|---|---|
| Run 5km | +Stamina | +Training generations |
| Solve 10 math quizzes | +Intelligence | +Training generations |
| 25-min focus session | +Intelligence | +Stamina |
| 8hr sleep | +Recovery (full stamina at battle start) | — |
| Win in-game match | +Coins | +Crafting mats |
| Daily streak | +Multiplier on all rewards | — |

---

## 5. Gameplay: Maze Battle Royale

- **8–16 AI agents** drop into a procedurally generated maze
- Maze has obstacles, items (health pots, speed boosts), and a **central treasure**
- Agents must navigate to the treasure while fighting each other
- **Last alive OR first to grab the treasure wins** (two valid strategies emerge)
- Match length: ~2–5 minutes
- Replay is saved; player can watch later

### 5.1 PvP variants
- **Async PvP** (MVP): Submit your AI, matches run on shared schedule (e.g., 4x daily), results posted
- **Direct duel** (later): 1v1 challenge with friend's AI
- **Ranked seasons** (later): Tier-based matchmaking

### 5.2 Rewards
- Coins (currency)
- Crafting materials (build gear that gives stat bonuses)
- Cosmetic skins for the AI character
- Rare: blueprints for special abilities the AI can learn to use

---

## 6. Technical Stack (Proposed)

| Layer | Choice | Why |
|---|---|---|
| Game engine | **Three.js + React-Three-Fiber (R3F)** | 3D in the browser. R3F wraps Three.js in React, integrates with your Vercel/React setup. Babylon.js is a viable alternative. |
| Physics | **Rapier** (via `@react-three/rapier`) | Fast WASM-based 3D physics, collision detection, character movement |
| 3D assets (MVP) | **Mixamo + Quaternius** | Free rigged humanoid stickman + full animation library (walk/run/attack/idle/death). Replaceable later with custom bear models. |
| Neural network | **neataptic** or **TensorFlow.js** | In-browser NN, no server GPU needed. neataptic is purpose-built for NEAT. |
| Frontend framework | **React + Vite** | Wrap the game canvas, build UI screens (quests, profile, replays) |
| Backend | **Firebase** ✓ | Confirmed. Auth + Firestore + storage + realtime + functions in one. Generous free tier. (Supabase is a viable alternative if SQL/relational data becomes a bottleneck.) |
| Hosting | **Vercel** ✓ | Confirmed. One-click deploy, free tier for solo projects, auto-deploys from GitHub |
| Version control | **GitHub** ✓ | Confirmed. Source of truth, connects to Vercel for CI/CD |
| AI API (optional) | **Anthropic Claude API** | Generate quiz questions on demand, verify photo proof of quests |
| Health/productivity APIs | Google Fit, Apple Health, Strava | OAuth-based, real data |

**Why 3D (decided):** Matches the visual references (AI Warehouse, OpenAI Hide-and-Seek). Three.js runs natively in browsers including mobile. Risk is performance + asset cost, mitigated by using simple rigged stickmen as the startup asset (upgrade visuals later).

**Why React-Three-Fiber over raw Three.js:** R3F lets you write 3D scenes as React components. UI screens (HUD, menus, replays) and the 3D game world live in the same React tree. For a solo dev shipping fast, this is much cleaner than maintaining two separate rendering systems.

**Why neataptic over TF.js:** neataptic is small, purpose-built for NEAT, and the API is friendly. TF.js is more flexible but overkill until we know we need it.

---

## 7. Cross-Device Support (PC, Tablet, Mobile)

Brainwork Royale is **fully responsive and runs on any modern browser** — desktop, tablet, and mobile. This is a core requirement, not an afterthought, because the game's core loop (do real-world quest → check back in) naturally pulls players across devices throughout their day.

### 7.1 Why this works well for this specific game

The game design is *unusually* friendly to multi-device because:

- **No real-time combat input** — the AI fights for you, so we don't need precise controls
- **Async matches** — no twitch reflexes, no latency-sensitive PvP
- **Short interaction sessions** — checking a replay or completing a quiz works great on a phone
- **Browser-based** — no separate native apps to maintain (one codebase, all devices)

### 7.2 Device-specific UX

| Device | Primary use case | UI considerations |
|---|---|---|
| **Mobile** | Daily quest check-ins, quick replay watching, quiz answering | Large tap targets, vertical-first layout, swipe nav, bottom action bar |
| **Tablet** | Replay viewing, brain timeline browsing, casual play | Hybrid layout — multi-pane where useful, but still touch-first |
| **PC / Desktop** | Long sessions, admin dashboard, deep replay analysis, watching multiple matches | Multi-pane dashboard, keyboard shortcuts, larger viz / charts |

### 7.3 Technical approach

- **Responsive React UI** — Tailwind CSS with mobile-first breakpoints
- **Three.js auto-scaling** — `Canvas` from R3F auto-handles resize; renderer uses `setSize` on viewport changes, camera aspect ratio updates automatically
- **Touch + mouse + keyboard input handling** — R3F supports all three natively via pointer events; design every interactive element to work with touch first, then enhance for mouse/keyboard
- **PWA (Progressive Web App)** — installable on mobile home screens, works offline for quizzes, feels app-like without an app store
- **Performance budget for mobile** — neural network training is the heaviest task. Solution:
  - Cap training generations per session on low-end devices
  - Offer "train in background" via Web Workers so the UI stays responsive
  - Detect device tier and adjust default settings (battle agent count, particle effects, etc.)
- **Test matrix** — minimum: latest Chrome/Safari/Firefox on iOS, Android, Windows, macOS

### 7.4 Design questions Design needs to answer

- Should the **battle viewport** be landscape-locked on mobile? (Mazes are easier to read landscape)
- How do we handle the **admin dashboard** on mobile — strip it down, or desktop-only?
- **Notification strategy** — push notifications for "your match starts in 10 min" or "daily quest reset"? PWAs support this.
- **Onboarding flow** — needs to work on a 6" phone screen as well as a 27" monitor

---

## 8. Art Direction & Visual Style

### 8.1 Direction: 3D, low-poly, "intentionally simple"

Locked-in direction: **3D in the browser**, starting with the simplest possible art and upgrading over time.

Visual references (now properly aligned):
- **AI Warehouse / OpenAI Hide-and-Seek videos** — fixed camera angle, simple low-poly characters, clean environments. This is the *exact* visual target for MVP.
- **Boomerang Fu** — the *gameplay feel* reference: top-down-ish camera, chaotic combat, juicy hit feedback, bright colors. Note that Boomerang Fu is also 3D with a top-down camera — it's the same approach.

Why this works:
- 3D matches all reference videos faithfully
- "Intentionally simple" low-poly is a *deliberate aesthetic*, not a placeholder vibe (think Astro Bot, Crossy Road, Among Us — extreme commercial success with simple 3D)
- Solo-dev friendly because we lean on stock assets
- Plays well in browser, including mobile (with care)

### 8.2 Startup asset: Rigged stickman

**MVP character: a simple rigged humanoid stickman/low-poly figure.** This is the placeholder character for launch. The bears come later (V1 or V2).

**Sources (free, ready-to-use):**

| Source | What it provides | Cost |
|---|---|---|
| **Mixamo** (Adobe) | Free rigged humanoid + huge animation library (walk, run, attack, hit, death, idle). Export to FBX/GLB. | Free |
| **Quaternius** | Low-poly rigged characters, including simple humanoids | Free / CC0 |
| **Kenney.nl 3D Animated Characters** | Super simple rigged characters | Free / CC0 |
| **Ready Player Me** | Customizable rigged avatars, web-optimized | Free tier |

**Recommended combo for MVP:** **Quaternius humanoid model + Mixamo animations**. Quaternius gives you a clean low-poly character; Mixamo provides every animation you'll need (walk, run, attack swing, hit reaction, death, victory, idle). Both export to GLB which Three.js loads natively via `useGLTF` in R3F.

### 8.3 Player's existing assets — your pixel-art bears

The player already has **pixel-art bear character portraits** (Engineer Bear, Polar Bear, Dark Angel Bear, Rainbow Bear, Helmet Bear with cub). These have strong personality and visual identity.

**Where they live in the game:**
- ✅ **UI portraits** — profile screens, character select, win/loss screens, leaderboards
- ✅ **Character class identity** — each bear archetype can become a class
- ❌ Not in-game models (for MVP). Stickmen do the actual fighting in the maze.

**Suggested character class mapping** (each bear archetype = a class with stat trade-offs):

| Bear | Class | Stat focus | Identity |
|---|---|---|---|
| Engineer Bear | Tech | +Intelligence | Builds/repairs, longer perception |
| Polar Bear | Tank | +Stamina, +Defense | Slow, tough, cigarette-tough vibe |
| Dark Angel Bear | Glass Cannon | +Strength | High damage, low health |
| Rainbow Bear | Trickster | +Speed | Fast, chaotic, dodge-focused |
| Helmet Bear w/ Cub | Support | +Recovery | Companion, healing, defense |

When a player selects "Engineer Bear" in the character menu, they get the Engineer's stat profile and ability set — and their portrait is the Engineer Bear pixel art. In-match, they're still a stickman (color-coded to indicate class). When the V1 bear models drop, the stickmen get replaced with bears matching the portraits.

### 8.4 Art pipeline for solo dev

| Asset need | MVP approach | Upgrade path |
|---|---|---|
| Character models | Quaternius/Mixamo stickman | Custom bear models (Fiverr ~$100-300 each, or Synty Studios polypack) |
| Animations | Mixamo library (free) | Same, or custom on Fiverr |
| Environment / maze | Kenney.nl 3D modular dungeon packs (free CC0) | Custom themed packs |
| UI portraits | Player's existing pixel art ✓ | Same — they're great |
| VFX (hits, particles) | Three.js built-in `Points` + free shader packs | Custom shaders if needed |
| Skybox / lighting | HDR maps from Poly Haven (free CC0) | Custom |

### 8.5 Performance budget (critical for 3D + mobile)

3D in browser + neural network training is the heaviest combo in the project. Hard caps:

- **Triangle count per character:** < 3,000 (Quaternius/Kenney are well under this)
- **Max characters on screen:** 16
- **Texture sizes:** 512×512 or smaller, use texture atlases
- **Draw calls:** budget < 100 per frame
- **Mobile detection:** auto-reduce particle counts, shadow quality, and post-processing on low-end devices
- **Training during match:** never — only train between matches, in Web Workers

### 8.6 Color & style consistency

- Lock in a **3-color core palette + 2 accents** early — this is the single biggest polish lever for solo devs
- Use **post-processing** (bloom, color grading via `@react-three/postprocessing`) to make low-poly look intentional rather than cheap
- **Toon/cel-shading** is an option that makes simple meshes look stylish; library: `three-toon-shader`

---

## 9. Audio

### 9.1 Phase 1 (MVP): Use existing free/AI-generated assets

I can't generate audio files directly, but here's the recommended sourcing approach:

| Audio type | Source for MVP |
|---|---|
| Background music | **Suno** or **Udio** (AI music gen, royalty-free for paid tier), or free CC0 from **Incompetech** / **Free Music Archive** |
| SFX (hits, UI, footsteps) | **Kenney.nl Audio packs** (CC0 free), **freesound.org** (CC licensed) |
| Victory / loss stings | Same sources, or **ElevenLabs Sound Effects** for AI-generated |
| Ambient maze sounds | freesound.org with attribution check |

### 9.2 Phase 2 (post-MVP): Custom audio

Once the game is validated, consider:
- Commissioning a chiptune/orchestral hybrid soundtrack on Fiverr (~$50-200 per track)
- Custom SFX pack from a hobbyist sound designer
- Voiceover stings for AI announcer (ElevenLabs or hire on Voices.com)

### 9.3 Audio design principles for this game

- **Match feedback must be satisfying** — hit confirms, treasure pickup, victory all need punchy short SFX
- **Music should loop seamlessly** — players watching replays will hear the same track many times
- **Mute toggle is mandatory** — many players check the game at work or while watching TV
- **Distinct AI death sound** — players need to instantly hear when their AI is eliminated

---

## 10. Data Model (Firestore Schema Sketch)

A rough sketch of what lives in Firestore. Final schema decisions during build.

```
/users/{userId}
  - displayName, email, createdAt, role: "player" | "admin"
  - stats: { wins, losses, currentRank, totalQuests }
  - currency: { coins, gems }
  - cosmetics: [array of owned cosmetic IDs]

/users/{userId}/character/{characterId}
  - name, stats: { speed, stamina, intelligence, strength }
  - equippedCosmetics: { skin, trail, victoryPose }
  - createdAt

/users/{userId}/brain/{brainId}     ← AI weights stored here
  - baseModelVersion: "v1.2"
  - weights: [serialized neural network, ~10-100KB]
  - generation: 47
  - lastTrainedAt
  - fitnessHistory: [recent fitness scores]

/users/{userId}/quests/{questId}
  - type: "in-game" | "quiz" | "real-world"
  - status: "active" | "completed" | "expired"
  - rewardClaimed: bool
  - startedAt, completedAt

/matches/{matchId}
  - seed (for deterministic replay)
  - participants: [userId array]
  - results: { winner, placements, treasure }
  - timestamp, tier (matchmaking tier)

/matches/{matchId}/replay
  - participantBrains: [array of brain snapshots]
  - mazeLayout: serialized maze
  - durationSeconds

/baseModels/{version}
  - weights, releasedAt, releasedBy (admin)
  - description, changelog
  - active: bool
```

**Storage notes:**
- Brain weights (10-100KB each) — manageable for thousands of users on Firebase Spark plan
- Match replays — only seeds + brain snapshots, not video. Tiny.
- If brain history gets huge, archive old generations to Firebase Storage as JSON files

---

## 11. Match System & Balance

### 11.1 Auto maze generation

- **Procedural generation per match** — every match has a unique maze from a seed
- **Algorithm options:** Wilson's algorithm (truly random, even mazes), recursive backtracker (longer corridors), or cellular automata (cave-like). Recommend **recursive backtracker** for the visual variety + readable navigation.
- **Difficulty knobs:** maze size, density of obstacles, number of treasure items, hazard frequency
- **Maze themes:** start with 1 theme (e.g., neon arcade), add more in V1 (jungle, ice, lava, etc.) — same generator, different tilesets

### 11.2 Tiered matchmaking / ranking

A simple ranked tier system:

| Tier | Description | Unlocks |
|---|---|---|
| **Bronze** | New players, base model only | Standard maze |
| **Silver** | Some training, basic stats | Slightly larger maze, more obstacles |
| **Gold** | Decent training, mid stats | Treasure tier 2, more cosmetics |
| **Platinum** | Well-trained, high stats | Multi-treasure maze, complex hazards |
| **Diamond** | Top players | Cross-region tournaments, exclusive cosmetics |

**Matchmaking rules:**
- Match AIs within ±1 tier when possible
- ELO-style rating per AI character, not per player (so a player can have multiple characters at different ranks)
- Seasonal reset every 8 weeks with rewards

### 11.3 Balance levers (for you to tune)

These are the variables you'll spend time tuning:

| Lever | Range | Affects |
|---|---|---|
| Neural net mutation rate | 1-5% | How quickly AIs evolve vs. stay stable |
| Population size per training session | 20-100 | Training speed vs. diversity |
| Stat point scaling | linear / log | How much grinding feels rewarding |
| Match duration | 2-5 min | Pace, viewing fatigue |
| Treasure vs. last-alive reward | ratio | Strategy diversity |
| Quest reward magnitude | XP curve | Daily engagement vs. burnout |

**Recommendation:** Build a private admin "balance dashboard" early so you can adjust these without redeploying.

---

## 12. Admin Tools

A dedicated admin panel (web-based, role-gated) for the solo dev to operate the game.

### 12.1 MVP admin tools

- **Base model management** — upload, version, set active, view performance metrics
- **User management** — search users, view their characters/brains, suspend accounts
- **Match inspector** — view any match, watch replays, debug issues
- **Balance dashboard** — adjust the balance levers above without redeploy (stored in Firestore as config)
- **Quest management** — create/edit/disable quests, manage quiz questions
- **Cheat reports** — review flagged accounts, view evidence

### 12.2 V1 admin tools

- **Live ops dashboard** — DAU, retention, match volume, quest completion rates
- **Bulk actions** — grant currency, gift cosmetics, broadcast announcements
- **Tournament management** — create/run special events
- **A/B testing** — roll out balance changes to % of users

### 12.3 Implementation note

- Build the admin panel as a **separate route** within the same web app, gated by `role: "admin"` on the user document
- Use a simple table-heavy UI (don't over-design — function over form)
- All admin actions should be **logged to an audit trail** in Firestore

---

## 13. Development Workflow & Deployment

Locked-in choices for shipping the game:

### 13.1 GitHub (source of truth)

- **Single repo** — monorepo for game + UI + Firebase functions (no need to split early)
- **Branch strategy:** `main` (production) + `dev` (active work) + feature branches off `dev`
- **Protected `main`** — no direct pushes, PRs only (even as solo dev, this catches mistakes)
- **GitHub Actions for CI** — run linting, type checks, and basic tests on every PR
- **Secrets management** — Firebase config, Anthropic API key, etc. stored in GitHub Secrets (never in code)
- **Issues + Projects** — use GitHub's built-in project board for the MVP roadmap so you have one source of truth

### 13.2 Vercel (hosting & CI/CD)

- **Auto-deploy from GitHub** — push to `main` → live in production within ~60 seconds
- **Preview deployments** — every PR gets its own unique URL automatically. Huge for testing on real phones without setting anything up.
- **Environment variables** — Firebase config, staging vs production keys configured per environment in Vercel dashboard
- **Edge functions** — Vercel's edge runtime can host lightweight API routes (e.g., quest verification, leaderboards) close to users for low latency
- **Analytics** — Vercel's built-in analytics + Web Vitals for free, no extra setup
- **Custom domain** — point your domain at Vercel when ready (free SSL included)

### 13.3 The deploy pipeline at a glance

```
Local dev → Push to feature branch → PR → Auto preview URL → Review on phone/tablet/PC
                                                                        ↓
                                                              Merge to dev → Test
                                                                        ↓
                                                       Merge to main → Auto-deploy live
```

### 13.4 Why this stack is solo-dev gold

- **Zero ops** — no servers to manage, no Docker, no Kubernetes, no deploy scripts
- **Free tier covers MVP** — GitHub (free for public + generous private limits), Vercel hobby tier (free), Firebase Spark plan (free, generous Firestore + auth + 5GB storage)
- **Built-in best practices** — preview URLs, automatic SSL, CDN, rollbacks, zero-downtime deploys all come for free
- **Scales when you need it** — both Vercel and Firebase have clear paid tiers if the game blows up

### 13.5 What this means for the project structure

```
/brainwork-royale
├── /apps
│   └── /web              ← React + Vite + R3F frontend
├── /packages
│   ├── /game-core        ← R3F scenes, neural network, training, physics
│   ├── /shared-types     ← TypeScript types shared between frontend and backend
│   └── /ui-components    ← Reusable React components
├── /assets
│   ├── /models           ← GLB files (stickman, environment props)
│   ├── /animations       ← Mixamo FBX/GLB animations
│   ├── /textures         ← Texture atlases, materials
│   └── /audio            ← SFX, music
├── /firebase
│   ├── /functions        ← Cloud Functions (quest verification, match resolution, etc.)
│   ├── firestore.rules   ← Database security rules
│   └── firestore.indexes.json
├── .github
│   └── /workflows        ← GitHub Actions for CI
├── vercel.json           ← Vercel deployment config
└── README.md
```

(This is a suggestion — Design or you may want to simplify it for MVP.)

---

## 14. MVP Scope vs. Full Vision

### 14.1 MVP (target: 4-6 months solo — adjusted for 3D)
- [ ] User accounts (Firebase auth)
- [ ] Procedural maze generation (one theme, low-poly modular tiles)
- [ ] One character type (rigged stickman from Quaternius/Mixamo) with 4 stats
- [ ] Base model trained offline by admin
- [ ] 5 quest types — all in-game or quiz-based (no external APIs yet)
- [ ] Neuroevolution training loop running in browser (with Web Worker for mobile)
- [ ] Three.js + R3F scene with camera, lighting, basic post-processing
- [ ] Rapier physics for character movement and collision
- [ ] Async PvP — 4 matches per day on a schedule
- [ ] Tiered ranking system (Bronze → Diamond)
- [ ] Replay viewer (3D playback)
- [ ] Basic economy: coins + 1 cosmetic shop
- [ ] Player's pixel-art bear portraits used in UI (profile, character select, win screen)
- [ ] Class system mapping bear archetypes to stat profiles
- [ ] Free CC0 audio pack (Kenney.nl) + 1-2 background tracks
- [ ] Admin dashboard (base model mgmt, user mgmt, match inspector, balance levers)
- [ ] Responsive layout (PC + tablet + mobile)
- [ ] PWA installable
- [ ] Mobile performance fallbacks (reduce poly, particles, shadows on low-end)

### 14.2 V1 (after MVP validates)
- Real-world quest APIs (fitness, productivity)
- **Custom 3D bear models** replacing stickmen, matching the pixel-art portraits
- Multiple character classes fully realized with unique abilities
- Crafting + gear system (visible on 3D models)
- Direct PvP duels
- Brain evolution timeline view
- Anti-cheat measures (Claude Vision verification, webcam focus)
- Custom commissioned music + SFX
- Multiple maze themes (3D environment variations)
- Live ops admin tools (analytics, bulk actions)
- Tournament management

### 14.3 V2 / Stretch
- Improved 3D art quality, toon/cel-shading polish
- Guilds / team battles
- Marketplace for cosmetics (3D skins, hats, trails)
- Mobile native wrapper (Capacitor)
- Localization for non-English markets
- VR mode (Three.js supports WebXR natively if it ever makes sense)

---

## 15. Open Gaps / Future Notes

Not blockers for going to Design, but track these as the project grows:

- **Legal:** Terms of Service, Privacy Policy (required for health/fitness API integration, COPPA if under-13 players, GDPR for EU)
- **Player communication:** Discord server, social channels, in-app news/patch notes
- **Analytics:** PostHog or Vercel Analytics — track D1/D7 retention, quest completion %, replay watch rate, match abandonment
- **Error monitoring:** Sentry free tier
- **Localization:** Structure all UI strings in JSON from day 1, even if only English at launch
- **Accessibility:** Colorblind palette, font scaling, reduced motion toggle
- **Backups:** Scheduled Firestore exports (Firebase has built-in tools)
- **Testing strategy:** Recruit a small alpha group (5-10 friends), then a Discord beta before public launch

---

## 16. Key Design Questions for Refinement

These are things to nail down with Design before building:

1. **Camera angle** — fixed top-down (Boomerang Fu style)? Angled isometric? Free orbit? Affects readability and how players watch replays.
2. **AI personality framing** — does the player feel like a coach, a parent, a scientist? Affects UI tone.
3. **Brain visualization** — how do we show players "your AI is getting smarter" without showing actual weights? (e.g., behavior tag clouds, decision heatmaps)
4. **Quest selection UX** — do players pick quests, or are they assigned? Daily reset cadence?
5. **Onboarding** — first 5 minutes need to hook someone who's never thought about neural networks
6. **Monetization** — F2P with cosmetics? Premium battle pass? No monetization initially?
7. **Cheating tolerance** — at what point does it ruin the game vs. just being annoying?
8. **Failure states** — what happens when an AI loses 20 matches in a row? Auto-rollback to better generation? Pity system?
9. **Stickman → Bear transition** — at what point in V1 do we upgrade visuals, and how do we communicate the change to players who got attached to their stickmen?

---

## 17. Constraints & Context

- **Solo developer** — every feature must be ruthlessly scoped
- **Web-first, multi-device** — single codebase running on PC, tablet, and mobile browsers, no installs (optional PWA install for app-like feel)
- **Player computer does the training** — no backend GPU costs
- **Async over real-time** — no matchmaking server complexity
- **Educational subtext** — real-world learning quests are a core differentiator, not a gimmick

---

## 18. The Three-Sentence Summary (for anyone joining the conversation)

Brainwork Royale is a web game where your real-life habits — what you study, how much you exercise, how focused you are — train an AI character with its own evolving neural network brain. Players don't control their character in combat. Instead they prep it through real-world quests, then send it into automated maze battle royales where it competes against other players' AIs and the replay shows how it has learned.
