# Part 1 – Understanding STILLFRAME

- **Repository:** https://github.com/Nandi0813/stillframe
- **Playable game (GitHub Pages):** https://nandi0813.github.io/stillframe/

Source analysed: the original single-file `index.html` (7,421 lines, first commit `410810e`).
Line numbers below refer to that file.

## 1. What the game is

STILLFRAME is a first-person action game that runs in the browser on **WebGPU**. Each level is a small
arena (subway platform, train carriage, office, rooftop). Glass-like humanoid enemies
(purple *walkers*, pink *rushers*, blue *marksmen*) spawn in waves. You win a level by
**shattering every enemy**, or on levels that have an exit, by **reaching the exit zone**. One hit kills you. When
you die the level restarts at once ("AGAIN.").

The game has 15 levels in 3 acts: Transit, Office Tower and Rooftops (`LEVELS`, l. 3388). Progress, best times and
settings are saved in `localStorage` under `stillframe.save` (l. 3735). Clearing a level unlocks the next one. After a
clear you see a results screen with real time, "time that passed", kills and accuracy. You can also watch a real-time
replay of the run.

### Controls (title screen, l. 3548; bindings, l. 1876)

| Input | Action |
|---|---|
| WASD / arrows | move |
| Mouse | look (pointer lock) |
| LMB | fire gun · punch (empty hands) · throw (non-gun item or empty gun) |
| RMB | throw held item |
| E | pick up the aimed item (swaps with the held one) |
| Space | jump |
| R | restart level |
| Esc | pause |
| F2 / F3 / F4 | debug: freeze time / force real time / FPS overlay |

### Weapons and items (l. 4795)

- **Guns:** pistol (6 shots), scatter (3 shots, 5 pellets), carbine (12 shots, 3-round burst).
- **Melee:** blade. It one-shots enemies and can slice bullets out of the air.
- **Throwables:** bottle, mug (these break), brick. A thrown item that hits an enemy in the head kills it. A hit on
  the body stuns and disarms it.
- An empty gun is thrown when you click.
- Punching takes 2 hits. The first hit stuns and disarms; the second kills.

### The mechanic that makes it different

**Time moves only when you move.** The tagline says so, and level 1-1 spells it out: "TIME / MOVES / WHEN / YOU /
MOVE.". `TimeScaleDriver` (l. 6161) maps the player's planar speed to a world time scale between `MIN = 0.015` and 1.
Looking around adds up to 0.35, and any action (shooting, throwing, punching) gives a short 0.12 s "kick" to full speed.
Being airborne forces at least 0.8.

The player moves on *real* time (`PlayerController.update` gets `realDt`). Enemies, bullets and props are stepped on
*scaled* simulated time (`Time.advanceSim`, l. 2080). So when you stand still, bullets hang in the air and you can
plan. Each step you take lets the world advance. The post-processing desaturates the world when time is frozen and
leaves enemies in colour (`final.wgsl`, `isEnemy` mask).

## 2. Code map (subsystems)

Everything lives inside one `<script type="module">`. It looks like esbuild output: `var X = class`, `_Gfx`,
renamed `m2`/`tmp2` variables and inlined `*_default` shader strings. So the file was bundled from a TypeScript
project, and the types and comments were stripped.

| Subsystem | Main symbols (line) | Responsibility |
|---|---|---|
| GPU bootstrap | `Gfx` (509), `showUnsupported` (623) | adapter/device, canvas context, DPR-aware resize, resolution scale |
| Meshes | `Mesh`, `createBufferWithData` (643), `MeshBuilder` (3837) | vertex/index buffers, box / tapered-box / triangle geometry |
| Shaders (WGSL strings) | `common/scene/shadow/glass/fx/post/outline/bloom/final_default` (666–1133) | lit opaque pass, shadow map, refractive glass enemies, additive line FX, outline, bloom, tonemap + grade |
| Renderer | `Renderer` (1163) | instanced draw buckets per layer (opaque/glass/viewmodel), segment FX, 8-pass frame graph, render targets |
| Camera | `Camera` (1837) | yaw/pitch, view/projection matrices |
| Input | `Input` (1904), `DEFAULT_BINDINGS` | keyboard/mouse/gamepad, pointer lock, per-frame pressed/released edges |
| Time & loop | `Time` (2059), `Loop` (2120) | fixed 120 Hz simulation with accumulator, time scale, requestAnimationFrame |
| Math helpers | `v3`, `lerp`, `angleDiff`, … (2158) | small vector/angle utilities (alongside `wgpu-matrix` from a CDN) |
| Audio | `AudioEngine` (2233), `SYNTHS` (2452) | WebAudio, all SFX procedurally synthesised, time-scaled pitch, music drone |
| Level data | `LevelBuilder` (2509), `level()`, `ACT1..3`, `LEVELS` | declarative box-based level geometry, props, enemy waves |
| UI | `Ui` (3400) | DOM title / levels / settings / pause / results / replay screens, HUD, word "title cards" |
| Save | `loadSave`/`writeSave` (3752) | localStorage persistence |
| Debug overlay | `DebugOverlay` (3779) | FPS / time-scale text |
| Themes | `THEMES` (3925) | per-act lighting and material colours |
| Collision | `StaticWorld` (3999), `rayBox`, `segmentSphere`, `segmentCapsule` | uniform grid of static AABBs, raycast, character sweep with step-up, sphere resolve |
| Navigation | `NavGrid` (4310) | 0.5 m walkability grid baked from boxes, A* plus path smoothing |
| Level build | `buildLevelMesh` (4583) | one merged mesh per level plus collision/nav data |
| Asset library | `buildMeshLibrary` (4685) | enemy body parts, items, shards, fists |
| Enemy AI | `ENEMY_PARAMS`, `createEnemy`, `updateEnemy` (4826–5196) | idle → alert → pursue → stunned state machine, gun fetching, shooting, marksman laser telegraph, melee |
| World simulation | `World` (5221) | player actions, projectiles, props physics, waves/spawning, win/lose |
| Player | `PlayerController` (6071) | walking, jumping, collision, look |
| Time driver | `TimeScaleDriver` (6161) | **the core mechanic**: movement → time scale |
| Effects | `FxSystem` (6195) | particles and glass shards (visual only, not deterministic) |
| Viewmodel | `Viewmodel` (6456) | first-person hands/weapon animation |
| Replay | `ReplayRecorder`/`ReplayPlayer` (6571) | records per-frame player input + step counts and re-simulates deterministically |
| Animation | `computePose` (6630) | procedural enemy skeleton |
| Game | `Game` (6704), `boot` (7394) | state machine (title/intro/playing/paused/dead/cleared/results/replay); wires everything together |

### Dependencies (who uses whom)

```
boot ─► Gfx ─► Game
Game ─► Renderer ─► (shaders, Mesh, wgpu-matrix)
     ─► Input, Loop/Time, AudioEngine, Ui, Save, DebugOverlay
     ─► PlayerController ─► StaticWorld
     ─► TimeScaleDriver
     ─► World ─► StaticWorld, NavGrid, Rng, enemy AI (updateEnemy), weapons/items tables
     ─► FxSystem, Viewmodel, computePose, ReplayRecorder/ReplayPlayer(World)
     ─► LEVELS (LevelBuilder) ─► buildLevelMesh ─► MeshBuilder, StaticWorld, NavGrid, THEMES
```

`World` is the only owner of game rules. It has no rendering or DOM dependency, and it emits `events` (shot, impact,
enemyDeath, …) that `Game.handleEvent` turns into sound and particles. Because `World` is deterministic (seeded `Rng`,
fixed step), replay works by feeding the recorded player frames back into a fresh `World`.

## 3. One frame, from key press to pixels

1. **Browser event.** `keydown` → `Input.onKeyDown` (l. 1996) → `press(code)` adds the code to `down` and
   `pressedRaw`. Mouse motion adds up in `accDx/accDy` while the pointer is locked.
2. **rAF.** `Loop.tick(now)` (l. 2143) → `Time.beginFrame` computes `realDt`, capped at 0.1 s.
3. **`Game.frame(t)`** (l. 6957):
   - `input.update` moves the raw edges into `pressedFrame` and the mouse delta into `mouseDx/Dy`, and polls the
     gamepad.
   - In the `playing` state: `PlayerController.update(input, realDt, …)` (look plus WASD acceleration,
     `StaticWorld.moveCharacter`). Then `toFrame()` packs pos/vel/yaw/pitch with the `fire/throw/interact` edges.
   - `World.applyPlayerFrame(frame)` copies the player state in and runs pick-up / throw / `primaryAction` (spawns
     player bullets). The frame is pushed to the `ReplayRecorder`.
   - `TimeScaleDriver.update(...)` returns the new time scale, which is written to `t.timeScale`.
4. **Simulation.** `Time.advanceSim` adds `realDt * timeScale` to the accumulator. `while (consumeStep())` calls
   `Game.fixedStep` → `World.step(1/120)`. That step runs waves/spawns, `updateEnemy` for each enemy (AI, nav, shooting),
   `stepProps`, `stepProjectiles` (swept bullet hits against static geometry / enemies / player / props, plus bullet
   clashes) and `checkWin`.
5. **`Game.render(t)`** (l. 7038):
   - records the step count, moves to `dead`/`cleared` if needed;
   - `handleEvents` → audio + `FxSystem` particles/shards;
   - sets up the camera from the player eye, then `drawWorld` queues instanced meshes (level mesh, props, enemies as
     glass via `computePose`) and segments (bullet trails, marksman lasers), and the viewmodel is queued;
   - `updatePost` derives freeze/desaturation/aberration/threat from the time scale;
   - `Renderer.render`: shadow pass → opaque pass (HDR + normal/mask MRT) → copy HDR → glass pass (refraction samples
     the copy) → additive FX pass → viewmodel pass (cleared depth) → outline (depth/normal edges) → bloom down/up
     chain → final pass (chromatic aberration, bloom, desaturate non-enemies, ACES, vignette, threat pulse, grain,
     gamma) into the swap-chain texture;
   - the HUD DOM is updated.
6. The browser presents the canvas.

## 4. Design problems

1. **One 7,400-line file with global mutable state and no module boundaries.** Rendering, game rules, AI, UI and
   level data share one scope. Module-level scratch vectors (`scratchA/B/C`, `tmp`, `visualRng`) are shared silently
   between systems. *Why it hurts:* nobody can own a subsystem, every change risks a far-away side effect, merge
   conflicts are constant, and you cannot unit-test `World` without also loading WebGPU code.
2. **Positional, untyped argument lists.** Examples: `TimeScaleDriver.update(realDt, planarSpeed, maxSpeed, lookSpeed,
   airborne, busy)` and `Renderer.drawMesh(mesh, model, color, emissive, layer, flash, extraY, highlight)`. *Why it
   hurts:* swapping two numbers still type-checks in JS and fails silently. That is exactly what happens in this file:
   `Game.frame` calls `driver.update(dt, WALK_SPEED, this.player.planarSpeed, …)` with speed and max speed swapped
   (BUGS.md #2). An options object or named TS types would catch it.
3. **Magic numbers and duplicated constants.** There are three different `GRAVITY` values (18, 16, 16 as `GRAVITY`,
   `GRAVITY2`, `GRAVITY3`). Telegraph time `0.6` is hard-coded again in `activeLasers`. Eye height `1.6` is written
   both as a literal and as `EYE_HEIGHT`. Shader uniform layouts are hand-packed float offsets (`put(76, …)`) that must
   match WGSL structs by hand. *Why it hurts:* tuning one place leaves the others stale, and a layout mismatch gives
   wrong pixels with no error.
4. **Shaders as string literals concatenated at runtime** (`common_default + scene_default`). *Why it hurts:* no
   syntax highlighting or validation in the editor. Errors appear only as console messages with line numbers into a
   concatenated string, and the struct definitions are shared implicitly.
5. **Ambiguous "magic" data in level definitions.** `pos` is `[x, z]` or `[x, y, z]` depending on its length
   (`flushSpawnQueue`). Ceiling boxes are just boxes, so the nav-mesh baker cannot tell a ceiling from a floor
   (see BUGS.md). *Why it hurts:* the level designer cannot see these rules, and bugs show up as enemies behaving
   strangely, far from where the data was written.
6. **Third-party code from a CDN at runtime** (`wgpu-matrix` from jsdelivr). *Why it hurts:* no offline dev, no
   lockfile, and a supply-chain risk if the CDN is compromised. It also gives the editor no types.

## 5. Trust, but verify

Claims I checked myself instead of taking them from reading alone:

- **"PLAY does nothing because level 1-1 is locked."** `Ui.isUnlocked(index)` returns `true` only for `index < 0`.
  For index 0 it looks at `levels[-1]`, which is `undefined`, so it returns false. `Game.startLevel` then returns
  early. *Verified in the browser (Playwright):* clicking PLAY leaves the title screen up, and the LEVELS screen
  shows `1-1 PLATFORM LOCKED disabled=true`.
- **"Time does not slow down when you stand still."** `Game.frame` passes `(dt, WALK_SPEED, planarSpeed, …)` to
  `update(realDt, planarSpeed, maxSpeed, …)`. So `moveInput = clamp(4 / speed)`: standing still divides by 0, which
  gives Infinity and clamps to 1. *Verified in the browser* after fixing the lock: the debug overlay (F4) shows
  `timeScale 1.000` while the player stands still (see BUGS.md #2).
- **Mouse look direction.** The name `rotate`/`look` suggests normal FPS look. The code adds `mouseDx` to yaw, but
  yaw = +θ turns the forward vector `(-sin θ, 0, -cos θ)` to the *left*. Verified in the game (BUGS.md #3).
