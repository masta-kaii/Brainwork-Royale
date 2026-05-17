# Brainwork Royale Game

_Started 2026-05-15 19:03 UTC_

---

## User

Please create the game based on the brainwork-royale-design-brief.md. Do it stage by stage and be aware of usage limit.

## Assistant

_[tool: read_file]_

_[tool: update_todos]_

I'll build this as a high-fidelity interactive prototype, stage by stage. Let me commit to a direction up front so I can move fast.

**Design direction (locking in):**
- **Aesthetic:** "Arcade lab" — feels like a science workstation crossed with an arcade cabinet. Dark base, neon accents, monospace typography for system-y feel, contrasted with a friendly sans for content.
- **Palette:** deep navy/near-black base, neon mint `oklch(0.85 0.15 175)`, hot magenta `oklch(0.7 0.2 0)`, amber accent `oklch(0.82 0.15 75)`
- **Type:** JetBrains Mono for HUD/data, Inter for body
- **Bears:** Original chunky CSS-pixel bear portraits I'll author from scratch (not recreating existing art) — each class gets a distinct silhouette
- **Layout:** Mobile-first responsive web app with bottom nav on phones, side rail on desktop
- **Hero feature:** A live animated maze battle with raycast vision viz — the thing that makes this game feel different

**Build stages:**
1. Foundation — shell, nav, Home dashboard, design tokens
2. Roster (bear class select) + Quests (with a working quiz mini-flow)
3. **Battle** — live animated procedural maze with neuroevolved-feeling agents (the hero)
4. Brain (AI profile, stat radar, generation timeline)
5. Polish + tweaks

Let me set up the foundation.

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

Now let me write the Roster and Quests screens — Stage 2.

_[tool: write_file]_

_[tool: write_file]_

Now the hero feature — the Battle screen with the animated maze sim.Now the Brain screen and index.html.

_[tool: write_file]_

_[tool: write_file]_

_[tool: show_html]_

_[tool: done]_

_[tool: update_todos]_

_[tool: fork_verifier_agent]_

Built **Brainwork Royale** as a 5-screen interactive prototype.

**What's in it:**
- **Command Deck** — hero panel with live mini-maze preview, match countdown, KPI strip, daily quest list, AI status + latest replay
- **Quests** — filterable (in-game/quiz/real-world) with a **working interactive quiz modal** that grants stat boosts on completion
- **Battle** — the hero: procedurally generated maze (recursive backtracker), 8 BFS-pathfinding agents, raycast vision overlays, live HP bars, leaderboard, event log, 1×/2×/4×/8× speed controls, win-state modal, re-roll
- **Roster** — pick any of 5 bear classes (Engineer/Polar/Dark Angel/Rainbow/Helmet), each with stat profile + ability. Selection actually swaps your AI's class
- **Brain** — radar chart, live animated neural net (12 → 8 → 5 with firing edges), scrubbable generation timeline, behavior tag clouds per generation, training queue with source breakdown

**Design system:** "Arcade lab" — dark navy base, neon mint/magenta/amber accents, JetBrains Mono for HUD/data + Inter for body. Original chunky CSS-pixel bear portraits I authored from grid patterns (not derived from any existing art).

**Responsive:** sidebar on desktop → bottom tab nav under 760px.

**Caveats / next steps:**
- All data is client-side mock — quest progress, AI stats, and class selection persist within a session but reset on reload
- The neural net viz is illustrative (real NEAT would have many more units + dynamic topology)
- No tweaks panel yet — happy to add one if you'd like to expose match speed defaults, agent count, maze size, or palette as live tweaks
- Bear portraits are placeholders for the eventual pixel-art set you have

## User

isnt we going to make 3D game right by using simple stickman as hero. For Roster i think not required. and for live battle cannot be fast forward since it live it will follow real time. only the completed battle can be replay and fast forward for studying how the hero working. Please make 3D game same like that reference I share and boomerang fu style of 3D

## Assistant

_[tool: update_todos]_

Got it — switching to actual 3D with stickman heroes (Boomerang Fu / AI Warehouse style camera), making live battle real-time only, and adding a dedicated **Replays** section where past matches can be scrubbed and fast-forwarded. Removing Roster.

Let me work through this:

_[tool: str_replace_edit]_

Now extract the sim into its own file (so live battle + replays can both use it):

_[tool: write_file]_

_[tool: write_file]_

Now the 3D scene engine. This is the core — Three.js scene with stickmen, maze walls, treasure, and animated movement.

_[tool: write_file]_

Now rewrite the Battle screen as a 3D live match (real-time only):

_[tool: write_file]_

Now the Replays screen with scrubbable, fast-forwardable playback:

_[tool: write_file]_

_[tool: str_replace_edit]_

Now append CSS for the 3D battle, replay viewer modal, and replay cards:

_[tool: str_replace_edit]_

_[tool: delete_file]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: eval_js]_

_[tool: save_screenshot]_

Three.js is loaded and all functions are wired. Let me click into the Battle tab and verify the 3D scene renders.

_[tool: view_image]_

_[tool: save_screenshot]_

Home looks great — Roster removed, Replays shows 3 seed matches. Let me check the 3D battle:

_[tool: view_image]_

_[tool: save_screenshot]_

3D battle is rendering with maze walls, glowing treasure, and stickmen visible. Let me wait for the agents to move around and verify animations:

_[tool: view_image]_

_[tool: save_screenshot]_

Live 3D battle is working — stickmen converging on the treasure with HP bars. Let me check Replays:

_[tool: view_image]_

_[tool: save_screenshot]_

Replays list is gorgeous — mini maze previews with agent positions and placement badges. Let me open a replay:

_[tool: view_image]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: save_screenshot]_

The viewer is fully working (canvas, scrubber, events, agent rows all present) — the previous screenshot just didn't capture the overlay. Let me grab it again with high-quality:

_[tool: view_image]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: screenshot_user_view]_

_[tool: done]_

The user's preview is stale — showing the old version with Roster. Let me push the latest:

_[tool: update_todos]_

_[tool: fork_verifier_agent]_

Switched to a real 3D game with stickman heroes, Boomerang Fu top-down-angled camera, and removed Roster + made live battles real-time only.

**What changed:**
- **3D engine** — Three.js scene with proper lighting, shadows, fog, accent point lights. Maze walls render as instanced cubes with neon mint emissive glow. Treasure is a rotating gold octahedron on a pedestal with a pulsing glow ring.
- **Stickman characters** — capsule torso + sphere head + class-colored cap, with shoulder-pivoted swinging limbs, idle bob, walking gait, attack arm-thrust, damage flash, and dramatic flat-on-back death pose. HP bar floats above each one (rendered via canvas-textured sprite). Your AI gets a pulsing mint ring under its feet.
- **Live Battle (real-time only)** — sim ticks every 320ms with smooth interpolation between cells. No speed control. Live event ticker, leaderboard, real-time timer. When the match ends, the full replay record auto-saves.
- **Replays** — new dedicated section. List of completed matches shown as cards with mini-maze previews and placement badges (#1/WIN/etc). Pre-populated with 3 seed replays so it's not empty on first load. Click any card → full-screen viewer modal with:
  - The same 3D scene
  - **Scrubber** with event dots marked on the timeline
  - **Speed control** (1× / 2× / 4× / 8×)
  - Pause/play, restart
  - Click any event in the log to jump to that tick
- Roster screen removed. AI defaults to Engineer class (still shown in portraits/data).

**Caveats:**
- Stickman uses primitive geometry (capsule + sphere) rather than rigged GLB models — closer to the AI Warehouse "Albert" placeholder feel than full Mixamo rigs. Easy upgrade path: swap `makeStickman` for `useGLTF` calls when you have real models.
- The "your bear class" doesn't yet drive in-match stickman color/silhouette — every agent is the same shape, only the cap/torso color differs. Class-specific accessories (Engineer's visor, Polar's scarf) would fit naturally here.
- No 3D textures or post-processing yet (bloom, color grading). The flat-emissive look is intentionally simple per the brief's MVP guidance.

