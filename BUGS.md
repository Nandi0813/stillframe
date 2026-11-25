# BUGS.md

How testing worked: I used Playwright (Chromium with WebGPU, Apple Metal) against the Vite dev server. The
automation browser refuses pointer lock, so the test page stubs `document.pointerLockElement` with an init script.
Game code is unchanged for this. Input goes in as real DOM events: `keydown`/`keyup`, `mousedown` on the canvas, and
`mousemove` with `movementX/Y`. `tests/autopilot.js` plays a level through those events. It reads state from
`window.__game` (exposed in dev builds only) to decide its next move, and to log the cause of every death.

## Part 2: things that looked wrong during the refactor (left untouched in Part 2)

| # | Where | Why it looked wrong | Outcome |
|---|---|---|---|
| a | `Ui.isUnlocked` | `if (index < 0) return true` means level 0 looks up `levels[-1]`, so it is locked | real bug, #1 |
| b | `Game.frame` → `driver.update(dt, WALK_SPEED, planarSpeed, …)` | argument order differs from `update(realDt, planarSpeed, maxSpeed, …)` | real bug, #2 |
| c | `PlayerController.look` `yaw += mouseDx` | `+yaw` turns forward `(-sin, 0, -cos)` to the left | real bug, #3 |
| d | `final.wgsl` `ca = post.grade.z * radial` | 0..1 strength used directly as a UV fraction | real bug, #4 |
| e | `StaticWorld.moveAxis` vertical branch | snaps any overlapping body to the top of the box, even one it started inside | real bug, #5 |
| f | `NavGrid.bake` | "highest box top ≤ 3.3 m" counts low roofs/lintels (2.6–3.3 m) as floors | real bug, #6 |
| g | three gravity constants 18/16/16 (`GRAVITY`, `GRAVITY2`, `GRAVITY3`) | duplicated tuning values for enemies/props/player | style only, kept |
| h | `activeLasers` hard-codes `0.6` instead of `TELEGRAPH` | duplicated constant | style only, kept |
| i | many level spawns sit inside boxes (1-3 rushers in crates, 3-4 walkers in corner blocks, 1-2 walkers in poles) | data error, made harmful by (e) | harmless after #5 |
| j | player cooldowns tick in *sim* time, so the gun "reloads" only while you move | looks odd, but it fits "time moves when you move" | design, kept |

---

## Bug #1: PLAY does nothing; every level shows LOCKED

- **Steps:** open the game, click PLAY. Or click LEVELS.
- **Seen:** PLAY: nothing happens, the title screen stays. LEVELS: `1-1 PLATFORM LOCKED` (disabled), all levels
  locked. Happens every time, on a fresh save.
- **Root cause:** `src/ui/ui.ts`, `Ui.isUnlocked`. Only `index < 0` was always unlocked. Level 0 then checked whether
  `levels[-1]` (undefined) was cleared, so it returned `false`. `Game.startLevel` returns early for locked levels.
- **Fix:** `index <= 0` is always unlocked.
- **Verified:** Playwright: after PLAY the "TIME / MOVES / …" title card appears and the HUD shows
  `1-1 PLATFORM 4 LEFT`. 1-2 unlocks only after 1-1 is cleared.

## Bug #2: time never slows down

- **Steps:** start 1-1, press F4 (debug overlay), stand still.
- **Seen:** `timeScale 1.000` both standing still and walking. The core mechanic ("time moves only when you move")
  is missing, so enemies and bullets run at full speed all the time.
- **Root cause:** `src/game/game.ts`, `Game.frame` called
  `driver.update(dt, WALK_SPEED, this.player.planarSpeed, …)` against the signature
  `update(realDt, planarSpeed, maxSpeed, …)`. So `moveInput = clamp(4 / speed)`. At speed 0 that is `4/0 = Infinity`,
  which clamps to 1.
- **Fix:** swapped the two arguments. Typed the `TimeScaleDriver.update` parameters.
- **Verified:** overlay reads `timeScale 0.015` standing, `0.999` while holding W, `0.015` again after release.

## Bug #3: horizontal mouse look is inverted

- **Steps:** start 1-1 (enemy straight ahead), move the mouse right.
- **Seen:** the view turns left (the enemy slides to the right of the screen). Shows up only once #1 is fixed.
- **Root cause:** `src/game/player.ts`, `PlayerController.look` did `yaw += mouseDx * sens`. With forward =
  `(-sin yaw, 0, -cos yaw)`, increasing yaw turns left.
- **Fix:** `yaw -= mouseDx * sens`. The gamepad right stick uses the same path, so it is fixed too.
- **Verified:** Playwright `mousemove` with `movementX: +25` ×6: the enemy now moves to the left of the crosshair
  (view turned right). Before/after screenshots.

## Bug #4: enemies appear as three red/green/blue copies while time is slow

- **Steps:** start 1-1, stand still, turn so the enemy is off-centre.
- **Seen:** the enemy (and props) split into three offset coloured copies, about 40–50 px apart at 1200 px width.
  Straight floor strips bend into curves. The effect is worst exactly when the game is meant to be played, with time
  frozen, and it gets stronger toward screen edges. You cannot tell which copy is the real enemy. It does not happen
  while moving at full speed, or with "Reduce motion" on.
- **Root cause:** `src/shaders/final.wgsl`, `fsFinal`. `ca = post.grade.z * radial` uses the 0..1 aberration
  strength (`freeze * 0.6`) directly as a UV-space fraction. That shifts the red/blue samples by up to ~15% of the
  screen.
- **Fix:** scale to a few pixels: `ca = post.grade.z * radial * 0.08`.
- **Verified:** same scene: one enemy, a straight floor strip, slight fringe at the edges only.

## Bug #5: in 1-2 you start on the roof of the carriage

- **Steps:** play 1-2 (CARRIAGE) and don't touch any key as play starts.
- **Seen:** the player stands on the carriage roof (y = 2.9 m). Dropped pistols and some walkers end up on the roof
  too. It does *not* happen if you are already holding a movement key on the first frame.
- **Root cause:** `src/physics/static-world.ts`, `StaticWorld.moveAxis`. On the vertical axis any overlapping box
  snapped the body to its top (moving down) or below it (moving up). 1-2's player spawn `(0,0,0)` is inside an 8 cm
  handrail pole (`pillar(0, z)` for z = −12…12). The first gravity step overlapped the pole, which lifted the player
  to 2.6 m, then the ceiling to 2.9 m. Holding a key let the horizontal pass push the player out first. The same thing
  lifts walkers spawned in the poles at z = ±12, the walker spawned in the 1 m crate, and 1-3's rushers spawned inside
  the 2.4 m crates.
- **Fix:** vertical resolution only applies to boxes the body was outside of before that move. Overlaps are then
  resolved sideways. The 1-2 player spawn moved to `(0,0,2)`, between poles.
- **Verified:** Playwright: start 1-2 with no input, then `player.pos = [0,0,2]` (floor), walkers at y = 0. Landing,
  stairs (1-4) and jumping still work in play.

## Bug #6: enemies can't get into the carriage, or along it

- **Steps:** 1-2, second wave: rushers spawn on the platform outside the carriage.
- **Seen:** they never find the doorways. They run straight at you and grind against the carriage wall (or the
  walkers inside get stuck behind a pole). The level stalls unless you go out to them.
- **Root cause:** `src/physics/nav-grid.ts`, `NavGrid.bake`. A cell's floor was the *highest* box top ≤ 3.3 m. Inside
  the carriage that is the roof (2.9 m). In the doorways it is the lintel (2.6 m). So the baked carriage was a
  2.9 m-high island and the doors were walls. Second issue: on the 0.5 m grid no cell centre fell inside the free band
  beside each 8 cm pole (needs |x| ∈ [0.36, 0.68]), so the aisle was cut at every pole. Found by printing the baked
  grid as ASCII.
- **Fix:** the floor is now the lowest box top with headroom above it, then stepped up onto anything within `STEP`
  (stairs). The grid is 0.25 m instead of 0.5 m, and A\* gets 16k expansions. Bake time ≤ 3 ms, path ≤ 1.5 ms on
  every level.
- **Verified:** nav check script: all spawns in 1-1…1-5 now path to the player (only the ones placed inside crates
  fail until they step out). In play, rushers come through the doors and walkers walk the aisle. 1-2 is cleared by
  the autopilot.

## Final verification

The autopilot played each level from a fresh save through real input events:

| Level | Result | Deaths | Real time |
|---|---|---|---|
| 1-1 PLATFORM | cleared | 0 | 57 s |
| 1-2 CARRIAGE | cleared | 0 | 67 s |
| 1-3 TURNSTILES | cleared | 1 (shot from 6 m by a walker, a fair death) | 88 s |

`npm run build` (tsc + Vite) passes with no type errors.
