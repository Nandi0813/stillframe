# Part 2 – Module structure

## How the split was done

The original file is an esbuild bundle: top-level names are already unique, and each former module sits in one
contiguous block. `tools/split-bundle.mjs` cuts it by line ranges into modules. For each module it:

- exports every top-level declaration;
- generates `import` lines for the names each module uses from other modules;
- moves the WGSL strings to `.wgsl` files, imported with Vite's `?raw`;
- moves the CSS to `src/ui/style.css`.

The few false positives (e.g. a method named `platform` matching the level `platform`) were removed using
`noUnusedLocals`. Because the cut is mechanical, the behaviour is unchanged. Verified by running the build: same
title screen, same locked PLAY button as the first commit.

## Layout

```
index.html               page shell (canvas, overlay, unsupported panel) + <script src="/src/main.ts">
src/
  main.ts                boot: create Gfx, Game; report unsupported WebGPU
  engine/                generic WebGPU + browser plumbing, no game rules
    gfx.ts               adapter/device/canvas, resize, resolution scale
    renderer.ts          frame graph, pipelines, instancing, post params
    mesh.ts, mesh-builder.ts  GPU buffers, procedural geometry
    camera.ts, input.ts, time.ts (fixed-step Time + Loop)
  shaders/*.wgsl         one file per shader stage (common, scene, shadow, glass, fx, post, outline, bloom, final)
  math/                  vec.ts (small vector/angle helpers), rng.ts (seeded RNG)
  physics/               static-world.ts (AABB grid, raycasts, character/sphere collision), nav-grid.ts (A*)
  levels/                builder.ts (LevelBuilder DSL), act1-3.ts (data), themes.ts, level-mesh.ts, index.ts (LEVELS)
  game/                  rules and simulation, no rendering
    world.ts             World: player actions, projectiles, props, waves, win/lose
    enemy.ts             enemy AI state machine
    player.ts            PlayerController (walk/jump/look)
    time-scale.ts        TimeScaleDriver – the core mechanic
    items.ts             weapons/items tables
    replay.ts            recorder/player
    game.ts              Game: state machine that wires all subsystems together
  render/                game-specific visuals: mesh-library, pose (enemy skeleton), fx (particles/shards), viewmodel
  audio/                 audio-engine.ts (WebAudio graph), synths.ts (procedural SFX)
  ui/                    ui.ts (DOM screens + HUD), debug-overlay.ts, style.css
  save.ts                localStorage persistence
tests/autopilot.js       Playwright play-test driver
tools/split-bundle.mjs   the one-off split script (kept so the refactor commit is reviewable)
```

## Why this split

- **Split by dependency direction, not by file size.** `engine/`, `math/` and `physics/` know nothing about
  STILLFRAME. `levels/` is data plus builders. `game/` holds the rules. `render/`, `audio/` and `ui/` present the game.
  `game/game.ts` is the only place that knows about everything. A newcomer looking for a rule (why did the enemy shoot?)
  goes to `game/`. A visual bug goes to `render/` or `shaders/`.
- **`game/world.ts` has no GPU/DOM imports.** The simulation is deterministic and drives the replay system. Keeping
  it pure means it can be unit-tested in Node. The nav/collision checks for BUGS.md #6 already run it headless with
  `tsx`.
- **Shaders get their own files** so they get editor syntax support and readable diffs. They are still concatenated
  the same way at runtime (`common + scene`, `post + outline`, …).
- **Levels are data**, one file per act, so level designers don't touch engine code.
- **Kept on purpose:** class bodies and names from the original. The refactor commit only moves code. It does not
  rename or retype it, so it stays reviewable as "nothing changed". Types are added where a change touches the code
  (e.g. `TimeScaleDriver.update`, `PlayOptions`, `RoomOptions`). `tsconfig` is non-strict for now (`strict: false`),
  with `noUnusedLocals` on.

## Tooling

- `npm run dev`: Vite dev server. `npm run build`: `tsc --noEmit && vite build`. `npm run preview`: serves `dist/`.
- `wgpu-matrix@3.4.2` is an npm dependency (the same version as the old CDN URL), locked in `package-lock.json`.
- **F5 in VS Code** (`.vscode/launch.json`):
  - *Dev server (Chrome)* starts the `vite: dev` background task and opens Chrome.
  - *Production build (Chrome)* runs build + preview on :4173.
  - Both have source maps (`build.sourcemap: true`), so breakpoints set in `src/**/*.ts` bind in the editor.
- `vite.config.ts` uses `base: './'` so the same build works locally and under the GitHub Pages sub-path.
