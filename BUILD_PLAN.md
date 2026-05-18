# Brainwork Royale — Build Plan

**Solo dev · ~20 hrs/week · realistic timeline: ~7–9 months to a real, fun, multiplayer-async game**

This plan is built around one rule: **never build the next phase until the current one is genuinely fun to a stranger.** If Phase 1 isn't fun, no amount of NEAT, Three.js, or Strava integration in later phases will save it. The whole project lives or dies on whether watching your dumb AI navigate a maze makes someone smile.

---

## Guiding principles (read before each phase)

**Ship the ugly version first.** Every phase has a working end-to-end slice on day one and gets prettier over time. Never build the "real" version before the duct-taped version proves the loop.

**Async is your superpower — don't accidentally kill it.** Every design decision should preserve the ability for two players who are never online at the same time to "play" each other. The moment you need synchronous state, you've broken the model.

**Determinism is non-negotiable from day 1.** Same seed + same AI weights + same inputs = same replay, every time, forever. If you build anything non-deterministic into the simulation, you cannot do replays, you cannot do PvP, you cannot debug. Lock this in early.

**Public devlog from week 1.** Twitter/X, Bluesky, or YouTube — pick one and post weekly. The biggest risk for a solo dev is finishing in silence. The second-biggest is losing motivation. A public devlog fixes both.

**Stop selling what doesn't exist.** Until Phase 3 is shipped, the landing page says "in development · follow the devlog." No "Season 3," no "5,000 free wardens," no fake beta. Honest framing keeps your credibility intact for when the real thing ships.

---

## Phase 0 — Pre-flight (Week 0, ~20 hrs)

Before any code, lock these down.

### Deliverables
- [ ] One-paragraph **design pillar statement.** Example: *"Brainwork Royale is a game where you raise an AI that fights for you in async maze battles. The fun comes from watching your AI learn over weeks of small habits and seeing it surprise you."* Pin this somewhere. Every feature you add later must answer "does this serve the pillar?"
- [ ] **Rewrite the landing page** to honest pre-alpha framing. Replace "Closed beta · S03" with "Devlog · pre-alpha." Replace "Free for first 5,000 wardens" with "Email signups for alpha invites." Fix the broken `/app.html` route — make it a "what's been built so far" page with screenshots/GIFs from your dev branches.
- [ ] **README rewrite.** Move the Claude Design handoff text to `docs/AGENTS.md`. Real README has: what the game is, current phase, how to run locally, tech stack, link to devlog.
- [ ] **Pick a devlog channel and post #1.** Even just "Hey, I'm rebuilding this solo, here's the plan, here's where I'm starting." Anchor the calendar.
- [ ] **Repo hygiene:** add a `CHANGELOG.md`, set up GitHub Actions for basic CI (lint + tests on PR), create labels for `phase-1`, `phase-2`, etc.

### Tech stack decision (lock these now, don't relitigate later)
- **Runtime:** Vanilla JS or TypeScript? Pick TS. Three months in, you'll thank yourself.
- **Build tool:** Vite. Don't overthink it.
- **Rendering Phase 1–2:** 2D HTML5 Canvas. No frameworks, no engines.
- **Rendering Phase 3+:** Decide at Phase 3 boundary, not now.
- **Backend:** Keep Firebase since you've already started. Firestore for state, Auth for users, Cloud Functions only if absolutely required.
- **Testing:** Vitest. Write tests for the simulation core from day 1, not later.

### Phase 0 gate (must be true to move to Phase 1)
- Landing page is honest
- Devlog post #1 is live
- Repo runs locally with `npm install && npm run dev` in under 2 minutes
- You can clearly state the design pillar without looking it up

---

## Phase 1 — Dumbest possible playable (Weeks 1–4, ~80 hrs)

**Goal:** A stranger plays for 5 minutes and says "huh, that was kinda fun." Nothing more.

**No neural networks. No 3D. No multiplayer. No backend. No accounts.** Single-page app, runs entirely client-side, refreshing the page resets everything.

### What the player actually does

1. Opens the page. Sees a 2D top-down maze (say, 20×20 grid) with one little square character at the start, exit at the other corner.
2. Sees 5 quiz questions on the side panel ("What's 7×8?", "Capital of France?"). For each correct answer, the AI gets one upgrade point.
3. Spends upgrade points on the AI: **+sight range** (sees further), **+speed**, **+memory** (remembers visited cells longer), **+turn rate**.
4. Hits "RUN." Watches the AI navigate the maze for 30–60 seconds. The AI uses simple scripted logic (right-hand-rule wall follower, plus the upgrades modulate its behavior). Sometimes it succeeds. Sometimes it loops.
5. Sees a result: "Completed in 47 seconds!" or "Got stuck." Hit "NEW MAZE." Repeat.

That's it. That's the whole Phase 1 game.

### Week-by-week breakdown

**Week 1 (~20 hrs): The simulation core.**
- [ ] Grid maze data structure (2D array of cells with walls).
- [ ] Maze generator using recursive backtracker — pick one algorithm, don't shop around.
- [ ] Seeded PRNG (use a tiny library like `seedrandom` or write your own xorshift32 — but **the PRNG must be the only source of randomness in the entire simulation**, ever).
- [ ] Agent state: position, direction, sight range, memory map, speed.
- [ ] Tick function: given (maze, agent_state, rng) returns next agent_state. Pure function. No DOM, no timers, no `Math.random()`.
- [ ] **Tests:** Same seed + same starting state = same final position after 1000 ticks. Write this test FIRST.

**Week 2 (~20 hrs): Rendering and the run loop.**
- [ ] Canvas renderer for the maze: walls, agent, exit, optional "fog of war" showing what the agent has seen.
- [ ] Run loop: ticks at fixed rate (say, 30 ticks/second), renders at requestAnimationFrame. **Separate simulation tick rate from render rate** — this matters enormously for replays later.
- [ ] Speed controls: pause, 1×, 2×, 5×.
- [ ] Result detection: agent reached exit, or N ticks elapsed (timeout).

**Week 3 (~20 hrs): The "training" layer (fake but feels real).**
- [ ] Question bank: 100–200 questions across 4–5 categories. Static JSON file. Don't build a CMS, just edit the JSON.
- [ ] Quiz UI: 5 questions, each correct = 1 upgrade point.
- [ ] Upgrade UI: spend points on the 4 stats. Show clear before/after numbers ("Sight: 3 → 4 tiles").
- [ ] Connect the quiz/upgrade screen → run screen → result screen as a clean state machine.

**Week 4 (~20 hrs): Polish for the playtest.**
- [ ] **Juice:** little particle when AI reaches exit, screen shake on collision, a tick-tick-tick sound as it moves. This is what makes 30 seconds of watching not boring.
- [ ] **Failure clarity:** when the AI gets stuck in a loop, the player should *understand why* visually (sight range circle is too small, memory faded, etc.).
- [ ] **Share button** that copies the maze seed + final time to clipboard. Plant the seed (heh) for virality even now.
- [ ] **Playtest with 5 real humans.** Watch them play. Don't help them. Write down every time they look confused.

### Phase 1 gate (must be true to move to Phase 2)
- A playtester who's never seen the game can start playing within 30 seconds of opening the page
- At least 3 of 5 playtesters voluntarily play a second round without being prompted
- The simulation is fully deterministic — replaying a seed produces pixel-identical output
- You can articulate, in one sentence, the moment in Phase 1 that's actually fun. (If you can't, you have a problem to solve before adding complexity.)

### Common Phase 1 traps
- Building a "level editor" before you have one level worth playing.
- Adding the neural network "just to start it." Don't. The whole point of Phase 1 is to validate the loop without it.
- Over-styling the UI. Use plain HTML/CSS, black on white. You'll redesign in Phase 4 anyway.
- Spending more than 1 hour on the question bank. It's filler.

---

## Phase 2 — Make the AI actually learn (Weeks 5–12, ~160 hrs)

**Goal:** The player's AI demonstrably gets better over multiple training generations, and the player feels ownership over that improvement. The "watch your brain think" magic appears here or never.

This is the biggest, most technically delicate phase. Budget 8 weeks, expect 10. Don't rush it.

### The big architectural decision: forget NEAT

Your landing page mentions NEAT. NEAT is a beautiful algorithm but it's a research-grade tool with topology mutation, speciation, fitness sharing, and a lot of failure modes. For a game, it's the wrong tool.

**Use instead: a simple genetic algorithm over a fixed-topology feedforward network.**

- **Inputs (~8):** distances to wall in 4 cardinal directions, distance to exit (if visible), agent speed, time-since-last-move, memory-cell-recency.
- **Hidden layer:** 8 neurons, tanh activation.
- **Outputs (4):** turn-left probability, turn-right probability, move-forward probability, stay probability. Argmax (or weighted sample for diversity) selects the action.
- **Weights:** ~100 floats total. Encode as a `Float32Array`. Cheap to mutate, crossover, save, transmit.

Total simulation per tick: ~200 multiply-adds. A laptop can run thousands of agents per second. Web Worker handles training in the background while the player does other things.

### The "training your AI with real habits" mechanic

This is where the *concept* of the game becomes concrete code. The bridge from quiz/habit → AI improvement is:

- **Each correct quiz answer / completed habit = 1 "training token."**
- **1 token = 1 generation of evolution.** A generation = simulate 50 candidate brains (mutations of your current one) on the same maze, keep the best one.
- **The player's current AI is just the best brain from their last training session.** Plus a small "lineage" record (how many generations, total fitness curve).

This is gameplay-honest: more habits → more generations → better AI. There's no fake "level up" — the brain literally trained more.

### Week-by-week breakdown

**Week 5 (~20 hrs): Neural network primitives.**
- [ ] `Brain` class: weight array, forward pass, serialize/deserialize.
- [ ] Replace Phase 1's scripted agent with a `Brain` agent. Random initial weights. It will be hilariously bad — that's correct.
- [ ] Fitness function: distance-to-exit at termination, time bonus for reaching, penalty for revisits.
- [ ] **Determinism check:** same brain + same maze + same seed = same fitness, always. Re-run your Phase 1 determinism test against the new architecture.

**Week 6 (~20 hrs): The genetic algorithm.**
- [ ] Mutation: gaussian noise on each weight with adjustable rate (start at 5%).
- [ ] Crossover: pick midpoint, swap halves (skip this initially — pure mutation often works as well for small networks).
- [ ] Generation loop: 50 candidates, evaluate, keep top 5, breed/mutate 45 children, repeat.
- [ ] Run 100 generations on a fixed maze. Plot fitness curve. If it's not going up, you have a bug. Find it before continuing.

**Week 7 (~20 hrs): Web Worker training.**
- [ ] Move the training loop into a Web Worker so the main thread stays responsive.
- [ ] Player triggers training, sees a progress bar, can browse the rest of the UI while it runs.
- [ ] Persist brain to `localStorage`. Refreshing the page should *not* wipe your AI.
- [ ] Add training history: chart of fitness over generations, total generations lived.

**Week 8 (~20 hrs): Make training visceral.**
- [ ] Mini-viewer in the corner showing the *current candidate* training in real-time. Watching brains die in mazes is half the fun. (See: every viral evolution sim ever.)
- [ ] "Best run of this session" replay viewable on demand.
- [ ] Generation counter ticks up satisfyingly. Sound design here matters.

**Week 9 (~20 hrs): Generalization, not memorization.**
- [ ] Critical problem to solve: if you train on one maze, the brain memorizes that maze. Solution: each generation, evaluate every candidate on **5 random mazes (seeded)**, fitness = average.
- [ ] This is slow. Profile. Optimize the hot loop (mostly: avoid allocations inside the tick function).
- [ ] Verify: trained brain performs well on a *new* random maze it's never seen.

**Week 10 (~20 hrs): The replay system, properly.**
- [ ] Replay format: `{seed, brainWeights, mazeParams, initialAgentState, terminationTick}`. About 500 bytes total.
- [ ] Replay player: takes a replay record, reconstructs the simulation tick-by-tick. Allow scrubbing.
- [ ] **Overlay mode:** as the brain runs, show its current input vector and output probabilities. This is your "watch the brain think" pillar. Spend time making it readable.

**Week 11 (~20 hrs): Quest/habit loop, real this time.**
- [ ] Daily quest tracker (still client-side, `localStorage`-based). Three quest types: timed focus session (Pomodoro-style timer in-app), quiz batch, manual check-in ("I went for a run today" — honor system for now).
- [ ] Each completed quest = N training tokens.
- [ ] Streak tracking. Simple visible counter.
- [ ] **Daily cap** on tokens. Critical for pacing — without a cap, hyper-grinders trivialize the curve; without a cap, casuals fall behind unrecoverably. Start with ~5 tokens/day.

**Week 12 (~20 hrs): Polish + playtest #2.**
- [ ] Onboarding flow that gets a new player to "my AI just finished its first maze!" in under 3 minutes.
- [ ] Visual indicators for stat changes ("Your AI's sight range improved from this training session").
- [ ] Playtest with 10 humans, ideally a different 10 than Phase 1.
- [ ] **Crucial question to ask them:** "Did this AI feel like *yours*?" If they say no, you have an ownership problem to fix before Phase 3.

### Phase 2 gate
- A new player's AI demonstrably improves over 50 generations of training
- The "watch the brain think" overlay is comprehensible to a non-technical playtester
- Training runs in the background without blocking the UI
- Replays are byte-perfect deterministic across sessions and browsers
- At least 6 of 10 playtesters describe their AI with possessive language ("my guy" / "mine kept doing X")

### Common Phase 2 traps
- Reaching for NEAT, RL, transformers, etc. The simple GA is good enough for the game. The complexity is for research, not for ship.
- Optimizing too early. Get it correct, then profile, then optimize the hot loop only.
- Letting training take so long the player gets bored. Target: 100 generations in under 60 seconds on a mid-range laptop.
- Making the brain too smart. A brain that always wins is as boring as one that always loses. Tune mutation rate + maze difficulty so wins feel earned.

---

## Phase 3 — Async multiplayer via replays (Weeks 13–22, ~200 hrs)

**Goal:** Two players who have never been online at the same time can "fight." A real player base starts to form. This is where Brainwork Royale becomes *a game* rather than *a toy*.

This phase introduces backend complexity. Plan accordingly.

### The core mechanic: ghost races

The simplest possible multiplayer is a ghost race, borrowed from racing games:

- Player A trains their brain. Wants to compete.
- Game generates a shared maze seed (one per day/hour for matchmaking).
- Player A's brain runs on that maze, finishes in T_A seconds. The replay is uploaded.
- Player B opens the game later. Game shows them today's seed, runs their brain, finishes in T_B seconds.
- After their run, Player B sees **A's ghost** overlaid on their replay, plus 14 other ghosts from other random opponents. **Best time wins the maze.**
- 16 agents per maze — exactly as promised on the landing page. But no one was online at the same time.

This is technically simple, perfectly async, infinitely scalable (ghosts don't fight each other, just race), and emotionally compelling (you watch your AI race against real people's AIs).

### Week-by-week breakdown

**Week 13–14 (~40 hrs): Backend foundation.**
- [ ] Firebase Auth: email/password + Google sign-in only. Skip Apple, skip 2FA, skip "Warden ID" — those go on the cut list until thousands of users actually exist.
- [ ] Firestore schema:
  - `users/{uid}`: display name, current brain weights (Float32Array → base64 → string), stats summary, joined date.
  - `mazes/{date}`: daily seed, maze parameters, when generated.
  - `runs/{date}/{uid}`: brain weights snapshot at run time, final time, replay record, submitted timestamp.
  - `leaderboards/{date}`: top 100 times for that maze.
- [ ] Security rules: a user can only write their own `users/{uid}` and their own `runs/{date}/{uid}`. Nothing else. Lock this down hard.

**Week 15 (~20 hrs): Cloud sync, no merge conflicts.**
- [ ] Migrate the localStorage brain to Firestore. Local stays as a cache; cloud is source of truth.
- [ ] Handle the "user trains on two devices simultaneously" case. Simplest answer: server timestamp wins, show a warning. Don't try to merge brains.
- [ ] Migrate quest/streak state to Firestore.

**Week 16 (~20 hrs): The daily maze flow.**
- [ ] Cron Cloud Function (or scheduled task) generates a new maze seed every 24 hours at a fixed UTC time.
- [ ] Player opens game → sees "Today's maze closes in 17 hours" → clicks Run → their brain runs, replay uploads.
- [ ] One run per maze per player. No do-overs. (This is what makes the result mean something.)

**Week 17 (~20 hrs): The race screen.**
- [ ] After player's own run, fetch 15 random other runs from today's maze.
- [ ] Render all 16 agents in the same maze, color-coded, name labels.
- [ ] Race plays out — each ghost moves at their actual recorded pace.
- [ ] Final placement screen. "You came 7th out of 16."

**Week 18 (~20 hrs): Leaderboards and meaning.**
- [ ] Daily leaderboard for today's maze (top 100).
- [ ] Personal stats page: win rate, best placement, lineage chart of your brain's improvement over weeks.
- [ ] Global rank: where do you sit among all players this week?

**Week 19 (~20 hrs): Anti-cheat (just enough).**
- [ ] Server-side verification: when a run is submitted, a Cloud Function re-simulates it with the submitted brain + that day's seed and verifies the claimed time matches. Reject if not.
- [ ] Rate limit submissions: max one per maze per user, enforced server-side.
- [ ] This is sufficient. Don't go deeper. A solo dev's anti-cheat budget should match the size of the cheating problem — which right now is zero.

**Week 20 (~20 hrs): The shareable artifact.**
- [ ] One-click "share my run" → generates an MP4/GIF (or just a deep link to a replay viewer) → posts to clipboard.
- [ ] Open Graph meta tags so the link unfurls beautifully on Twitter/Bluesky/Discord.
- [ ] This is your marketing channel. Spend real time making the share visual juicy. Slow-mo on the final dash to the exit. Confetti. The works.

**Week 21 (~20 hrs): Closed alpha.**
- [ ] Recruit 20–30 people via your devlog. Real beta now, not fake beta from January.
- [ ] Discord server. Pin a "known issues" channel.
- [ ] Watch logs. Hot-fix daily. This is where you find the bugs you never imagined.

**Week 22 (~20 hrs): Public soft launch.**
- [ ] Address the top 10 issues from alpha.
- [ ] Onboarding flow tested on 10 fresh users.
- [ ] Update landing page to *real* "play now" — no asterisks, no waitlist gates.
- [ ] Post on r/incremental_games, r/proceduralgeneration, Hacker News (Show HN), and one game design Twitter thread. Expect ~500–2000 visits, ~50–200 signups, ~10–30 daily active users. **That's a success.** Don't measure yourself against Wordle.

### Phase 3 gate
- Daily maze generates reliably, never missed a day for 2 weeks
- 50+ unique users have played at least 3 mazes
- Server can handle 1000 daily runs without crashing (load-test it)
- Anti-cheat catches a deliberately tampered submission in testing
- At least one of your shared replays has been re-shared by someone who's not your friend

### Common Phase 3 traps
- Building a synchronous multiplayer mode "because it'd be cool." It would be cool. It would also kill the project.
- Adding chat. Don't. You'll need a moderator. Use Discord for chat.
- Premium currency, lootboxes, anything that costs money. Not until Phase 4 minimum, probably never.
- Releasing without an analytics dashboard. You need to know: DAU, retention day 1 / day 7 / day 30, completion rate of first match.

---

## Phase 4 — Identity, fidelity, and ecosystem (Weeks 23–32+, ~200+ hrs)

**Goal:** Brainwork Royale becomes the thing the landing page originally promised. Classes, 3D, Strava, the works. **You only earn the right to start this phase if Phase 3 has 100+ weekly active users.** Otherwise, those users tell you what to build next instead.

This phase is intentionally less prescriptive — by the time you get here, real player behavior will dictate the priority list more than this document can.

### Likely subprojects, ranked by impact-to-effort

**Classes (~3 weeks).** Five archetypes that change starting stat profile and which quest types give bonus tokens. Mechanically thin, narratively rich. Done with care, this transforms how players see their brain — "my Engineer thinks in straight lines, my Mystic loops weird." Each class's brain trains within slightly different fitness functions (Engineer rewards short paths, Mystic rewards exploring memory cells, etc.) so the brains genuinely diverge.

**Strava / Apple Health / Google Fit integration (~2 weeks each).** Pick one. Strava has the cleanest public API. Step counts and run distance → bonus training tokens. **Critical UX rule:** never auto-link without explicit consent each session; never display raw health data. Show "Today: +3 tokens from movement." That's it.

**Duolingo integration.** Skip. Duolingo's API for third parties is unreliable. Build your own quiz instead and let Duolingo users feel at home in the UX.

**3D character rig (~4–6 weeks).** Three.js, the 59-animation rig the original landing page promised. **Crucial design decision:** the 3D layer is *cosmetic*. The simulation runs entirely in 2D, deterministically, on the canvas grid. The 3D is a stylized re-render of the same tick stream. This preserves replay determinism and keeps the simulation fast. Players see 3D in the replay viewer; training, fast-forward, and leaderboards stay 2D.

**Seasons (~2 weeks).** Reset the leaderboard every ~3 months, snapshot the current state, give returning players a small cosmetic reward. Drives retention. Your "Season 3" landing page line finally becomes true.

**Mobile-first experience (~3 weeks).** By Phase 4 you have data on what percentage of users are on phones. If it's over 40%, prioritize this. Same web app, better touch targets, vertical-friendly layout. Don't build a native app.

**Friends and clans (~2 weeks).** Only if players are asking for it. Friends list, friend-only leaderboard, optional clan tag. Light social features only. No DMs, no clan chat — Discord handles those.

**Monetization (~?? weeks). Approach extremely carefully.** Defensible options: cosmetic skins for the brain visualization, "more training tokens per day" passes capped low, a one-time premium tier ($5–10) that unlocks brain export and detailed analytics. **Hard rules:** never sell better brain performance. Never sell training shortcuts that give you a stronger brain than a free player can earn. Asymmetry there poisons the whole loop.

### Phase 4 has no single gate

Instead, it has health metrics. You should be watching:
- **D7 retention** > 20% (industry-okay), > 35% (good for an indie)
- **Average session length** > 5 minutes
- **Match completion rate** > 80% (people who start a match finish it)
- **Weekly active users** growing month over month, even slowly

If any of these tank when you ship a feature, the feature is wrong — revert or rework.

---

## Cross-cutting concerns (apply across all phases)

### Telemetry from day 1
- Event log with: anonymous user ID, event name, timestamp, payload. Self-hosted (Firestore is fine) or PostHog/Plausible.
- Track at minimum: page load, first run started, first run completed, training session started/completed, quiz answered (correct/incorrect), share button clicked, page exit.
- You cannot improve what you don't measure.

### Performance budget
- Phase 1: page interactive in < 2s on mid-range mobile.
- Phase 2: training 100 generations in < 60s on a 2020-era laptop.
- Phase 3: 16-agent replay renders at 60fps.
- Profile every milestone. Don't ship the milestone if it misses.

### Determinism testing
- A single test that runs in CI: "fixed seed + fixed brain + 10,000 ticks = expected final state hash." If this ever fails, stop everything and find the non-determinism. This is the load-bearing wall of the whole game.

### Backups and migrations
- Once Phase 3 is live and real players exist, every Firestore schema change needs a written migration plan. Players will lose progress otherwise. Set up daily Firestore exports to GCS — Firebase makes this a one-line scheduled function.

### The cut list (revisit weekly)
Maintain a `CUT_LIST.md` file. Features that sounded great but didn't make it. Examples that probably belong there from your current landing page: NEAT (replaced with simple GA), Apple Sign-in (until iOS users exist), Duolingo integration (API unreliable), "5,000 free wardens" (no, just open beta), the second physics engine integration (Rapier). Revisit quarterly. Most of these will stay cut forever, and that's fine.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Burnout from solo dev grind | High | Weekly devlog (forced reflection), one full day off per week, no exceptions |
| AI doesn't feel "yours" | Medium-high | Lineage display, naming, ownership-language playtest gates |
| Async loop isn't fun enough to retain | Medium | Ghost races + shareable replays = social loop without sync requirements |
| Cheating | Low-medium | Server-side simulation verification; only matters if game gets popular, and if so, it's a good problem |
| Hosting bills if it goes viral | Low | Firestore scales to free-tier well; cap free-tier ceiling with budget alerts |
| Scope creep (the original sin of this project) | **Very high** | This document. Re-read the design pillar before adding any feature. Maintain the cut list. |

---

## Timeline summary

| Phase | Duration | Cumulative | Milestone |
|---|---|---|---|
| 0 — Pre-flight | 1 week | Week 1 | Honest landing page, devlog live |
| 1 — Dumb playable | 4 weeks | Week 5 | Strangers say "kinda fun" |
| 2 — AI learns | 8 weeks | Week 13 | Brains visibly improve over generations |
| 3 — Async multiplayer | 10 weeks | Week 23 | Real players, real leaderboards |
| 4 — Identity & fidelity | 10+ weeks | Week 33+ | Classes, 3D, integrations, seasons |

**Total: ~8 months to a launched, playable, social game.** Add 30% for life events, holidays, and the things you couldn't predict. **Realistic shipping target: 9–10 months for v1.0 public.**

This is faster than most solo games of comparable ambition, *because* of the scope discipline. Stretch it longer and momentum dies. Try to compress it shorter and you ship junk. ~8 months at 20 hrs/week is the sweet spot.

---

## What success looks like at the end of Phase 4

- 500–2000 weekly active users
- A Discord with 100+ engaged members
- 5–10 viral replay clips that brought in users from outside your devlog
- An asset (the brain training + async replay system) that's genuinely novel and defensible
- A real decision point: keep going solo, raise money, or hand it off

Any one of those is a win. All five is a successful indie game.
