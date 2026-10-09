# Motion

How the game moves is measured on every change, not guessed. `pnpm motion` drives the production build in a real browser and reports frame pacing, how fast and how smoothly units glide, the camera, and the playback cadence. Matthew's asks: *"monitor for in game movement speed, smoothness etc."* and *"The character movement speed should be slower like real ... advance wars"*.

## What is measured

| Group | Numbers | Where they come from |
|---|---|---|
| Frame pacing | fps (frames over the wall clock, deliberate gaps included); drawFps (the rate while drawing); maxStill (the longest the picture did not change, ms); frame interval p50, p95, p99, max; share of frames over 1.5x the median ("dropped") and over 50 ms; long tasks (count, total, max); the JS time of the stage's own `frame()` p50 and p95 | the stage's frame loop (the recorder), or the page's own `requestAnimationFrame` ticks on a build with no recorder |
| Unit glide | per move beat: ms per tile against `TIMINGS.moveTileMs` at that speed (240 at 1x, 120 at 2x); steadiness (the peak per-frame speed over the mean speed, the final tile left out: 1.00 for the steady march); the largest step any frame took; progress along the path; where it ends | the recorder (`?probe=motion`) |
| Camera | per-frame displacement and speed; any jump outside a cut the stage declared; whether a shake decays | the recorder |
| Playback cadence | each step's measured length (start to the next start) against its plan (`durationMs` + the dwell), as a ratio per speed; steps a second at 1x, 2x and 4x; story holds left out | the recorder; steps a second also from `.aww-root[data-step]` on any build |

A **gap** is a stretch where the stage chose not to draw. On a machine slower than 20 fps the stage stops drawing for up to `YIELD_MS` (150 ms) after a step ends (the picture is a still then, and the page's own work gets its turn). The frame after a gap carries `skips` > 0. A gap is counted on its own and is left out of the frame-interval percentiles and of drawFps, but it is **not** left out of fps or of maxStill: fps is the wall clock, and maxStill is the longer of the longest gap and the longest frame interval. Without that, the stage would look faster, and smoother, for being less often on screen.

The recorder is **off unless the address says `?probe=motion`**. When it is off the frame loop never calls it and nothing is added to `window`. When it is on, `window.__awMotion.read()` returns everything recorded since the last `reset()`. It keeps only the current view's own state (D-016).

## The budgets

`pnpm motion` exits 1 when one of these is broken. A budget that cannot be judged (a machine too slow, nothing to measure) says so and neither passes nor fails.

| Budget | Rule | Judged |
|---|---|---|
| No frame worse than the baseline | with `--compare`, each of fps, frame p95 and maxStill is no more than 10% worse than the baseline's AND worse by more than its slack (0.5 fps, 3 ms on p95, 10 ms on maxStill) at the same tier and render scale. maxStill is held against the baseline's WORST frame interval. Every other frame metric (p50, p99, max, the shares, long tasks, JS time) is printed for reading and is never a budget | `--compare` |
| The floor rule | a build at a smaller render scale than its baseline (the same tier) is held to fps and p95 **no worse at all** (past the slack, which is only jitter); maxStill keeps the 10% | `--compare` |
| Glide speed in spec | every measurable beat within 15% of `TIMINGS.moveTileMs` at its speed (240 at 1x, 120 at 2x), or one frame, whichever is larger | always |
| Glide steady | steadiness at most 1.1: one speed from tile to tile. A steady march reads 1.00 at any frame rate; the old smoothstep read 1.17 to 1.44 on this box (1.5 at its peak) | always |
| No teleport | a frame moves a unit at most (frame dt / ms per tile) x 1.5 tiles + 0.05 | always |
| Glide path and end | progress never goes back; within 0.05 tile of the path; ends within 0.02 tile of the destination tile's centre | always |
| No glide at 4x | at 4x and under reduced motion the plan has no move beat and no unit glides (timing.ts) | always |
| Camera | no frame moves the camera faster than 80 world units a second (dt capped at 0.1 s as the stage caps it) outside a declared cut; a shake's second half is no bigger than its first | always |
| No hitch | no interval over both 3x the median and 100 ms | at 30 fps or more |
| Cadence in spec | each speed's total measured step time within 10% of its plan | at 30 fps or more |
| No stall | no step runs past its plan by more than 100 ms or 3 frames, whichever is larger | at 30 fps or more |

The limits live in one place, `LIMITS` in `src/ui/watch/motion/analysis.ts` (the comparison's in `compare.ts`), and the tests quote them.

## How to run

```
pnpm build                                                    # DATABASE_URL unset
pnpm motion --port 5312                                       # serves dist/ with `vite preview` on 5312, measures, stops it
pnpm motion --url http://127.0.0.1:5311/                      # measures a build that is already served
pnpm motion --port 5312 --out motion.json                     # also writes the JSON report
pnpm motion --port 5312 --compare baseline.json               # prints deltas, exits 1 on a broken budget
pnpm motion --port 5312 --pin low@1                           # ?quality=low&scale=1: same tier and scale as a build that has no scale
pnpm motion --port 5312 --second-load                         # after each scenario, loads the page again in the same browser profile and times the settling
pnpm motion --port 5312 --shots shots/                        # screenshots at render scale 1, 0.7 and 0.5, both sizes
```

It runs at 1280x800 and 390x844, at 1x, 2x and 4x, on three scenarios: **deploy** (first-light, the story skipped), **demo** (the seeded demo match) and **live** (G17's live view, from a scripted feed the script starts and stops itself). Per scenario it loads the page, waits until the adaptive step has settled (the tier and scale unchanged for 15 s), then plays the same 10 steps at each speed.

Flags: `--sizes desktop,phone`, `--speeds 1,2,4`, `--scenarios deploy,demo,live`, `--steps 10`, `--max-seconds 60`, `--settle-seconds 90`, `--label`, `--tolerance 0.1`.

Playwright is taken from the repo if it is there, else `$PLAYWRIGHT_MODULE`, else `/opt/node22/lib/node_modules/playwright`. If none is found the script says so in one line and exits 2. It never installs anything. A build with the recorder is measured in `recorder` mode, one without (main has none) in `page` mode; the report says which, per run, and `--compare` compares only the metrics both sides have.

## The render scale

Below the lowest quality tier there is one more step: the internal render scale (1, 0.85, 0.7, 0.5). It shrinks the drawing buffer and leaves the canvas's CSS size alone. It steps only when the adaptive step is already at `low` and a full window of frames is still slower than `slowMs`, one step at a time, never back up, with the tiers' warm-up and window. **0.5 is for a canvas at least 960 CSS px wide** (`WIDE_CANVAS_PX`); a narrower one (a phone) stops at 0.7. `?scale=1|0.85|0.7|0.5` pins it. The tier and the scale are `data-quality` and `data-scale` on `.aww-stage3d`.

**A device remembers where it settled, for 7 days** (`aw.quality.v1` in `localStorage`, tier + scale + time): the next battle on it starts there. It never starts better than the machine's own guess, `?quality=` and `?scale=` win over it (a pinned tier ignores it and writes nothing), a remembered 0.5 on a canvas that is now narrow is held to 0.7, and storage that is missing, full or throws just means nothing is remembered.

## The playback clock and the yield

Playback cadence was bound to the frame rate: on a machine under 20 fps every step boundary (the end of a step, the dwell timer, the next step's render) was several page tasks, each queued behind a whole frame. Two things in `runtime.ts` keep the clock off the frame rate: a plan also ends on a timer (a hidden tab does not play on), and on a slow machine (a drawn frame over `YIELD_SLOW_MS`, 50 ms) the stage stops drawing for up to `YIELD_MS` after a step ends (the gaps above) so the page gets its turns. A machine at 20 fps or better never skips a frame.

### The yield: how `YIELD_MS` = 150 was chosen

The budget: the longest still is at most 1.1x main's worst frame interval **in the same run**, in every scenario, size and speed. Each row is one full `pnpm motion --compare` run against main (`891b259`) on this box, 9 runs a size (deploy, demo and live at 1x, 2x and 4x). Steps a second and fps are means of the three scenarios; maxStill is the largest of them. "Over" is how many of the 9 runs broke the still budget; "cadence" is measured step time over planned step time (1.00 is on plan).

| yield | desktop 1280x800: steps/s 1x / 4x, fps, maxStill 1x / 2x / 4x, over, cadence 1x / 4x | phone 390x844: the same |
|---|---|---|
| main (no recorder) | 0.69 / 1.72, 6.0, 350 / 333 / 267, -, derived 1.75 to 2.21 / 6.14 to 6.50 | 1.03 / 3.59, 16.3, 100 / 83 / 83, -, derived 1.28 to 1.37 / 2.65 to 3.48 |
| 0 ms | 0.82 / 2.82, 10.5, 133 / 150 / 150, 0 of 9, 1.30 / 3.84 | 0.87 / 3.79, 15.4, 117 / 100 / 100, 7 of 9, 1.22 / 2.66 |
| 60 ms | 0.83 / 2.89, 10.5, 133 / 150 / 150, 0 of 9, 1.28 / 3.53 | 0.88 / 3.93, 15.4, 117 / 117 / 117, 7 of 9, 1.21 / 2.68 |
| 100 ms | 0.80 / 4.43, 10.3, 150 / 133 / 133, 0 of 9, 1.32 / 2.52 | 0.89 / 5.35, 14.7, 117 / 117 / 100, 9 of 9, 1.19 / 1.89 |
| **150 ms** | 0.82 / 5.06, 9.6, 200 / 167 / 167, 0 of 9, 1.30 / 2.00 | 0.90 / 6.35, 14.4, 167 / 167 / 150, 9 of 9, 1.18 / 1.79 |
| 150 ms, second run | 0.84 / 5.09, 10.3, 167 / 167 / 150, 0 of 9, 1.26 / 2.06 | 0.90 / 6.49, 14.8, 167 / 167 / 133, 8 of 9, 1.19 / 1.63 |
| 250 ms | 0.93 / 5.47, 9.4, 250 / 250 / 150, 1 of 9, 1.13 / 2.24 | 0.95 / 6.71, 13.5, 267 / 183 / 100, 8 of 9, 1.13 / 1.68 |
| 400 ms (the first guess) | 0.99 / 5.15, 9.2, 333 / 217 / 133, 2 of 9, 1.07 / 1.97 | 1.01 / 6.38, 13.4, 300 / 200 / 133, 9 of 9, 1.05 / 1.64 |

Steps a second at 1x and 2x are not comparable between main and this branch (the branch's march is slower by design: 240 ms a tile against 140). The cadence ratio is: main's is derived (the plan's length rebuilt from the game code at main's pace, over the steps a second main measured), so it is approximate; the branch's is read by the recorder.

- **Desktop:** the still budget holds at 0, 60, 100 and 150 ms (0 of 9; at 150 the worst run's still is 0.80x to 0.83x of main's worst frame in that run, and every run is at least 16% inside it) and breaks at 250 (1 of 9: 250 against 217) and 400 (2 of 9: 300 against 217 and 233). The cadence is what the yield buys: at 4x the run takes 3.5 to 3.8 times its plan with no yield and 2.0 with 150. 150 is the longest that passes, and the best cadence of those that do.
- **Phone: no length passes, not even 0.** Its frames are about 67 ms and main's worst is 67 to 100 (83 in 7 of the 9 runs, so 93 ms is the limit), while this branch's own worst still with a 0 ms yield is 83 to 117, and its fps is already 5% under main's at 0 ms: at 0.7 the phone's frame is no faster than at 1 (67 ms at p50 in both), and the next step down, 0.5, is for wide canvases only. What the yield does on the phone: at 150 ms the 4x run plays 6.3 to 6.5 steps a second against main's 3.6 (cadence 1.6 to 1.8 against main's 2.7 to 3.5), for a longest still of 150 to 167 ms against main's 83 and an fps 10% under main's.

### The lead's call (2026-10-09): yield on wide canvases only
- The stage now yields only on a canvas at least `WIDE_CANVAS_PX` (960 CSS px) wide, the same line the 0.5 render scale uses. A phone-sized board never yields.
- Why: on the phone, the yield buys a cadence the phone barely needs (its 4x already plays at main's rate), and costs stills of 150 to 167 ms against main's 83 to 100.
- **The phone board is still 3% to 6% slower than main, and that is real, not noise.** The lead's page-level measurement of this branch's final build (the yield gated off on the phone; no recorder; Deploy first-light; three runs each):
  - 1x: 15.0 / 15.1 / 14.8 fps, against main's 16.0 / 15.9 / 15.8;
  - 4x: 14.1 / 14.6 / 15.0, against 15.4 / 15.2 / 14.8;
  - p50 66.7 ms on both, and p95 133 to 150 ms against main's 117 to 133.
- The gap is the cost of G18's 2.6x bigger phone board. A lower render scale does not buy it back on this box (0.7 is no faster than 1 there), so the cost is not pixels.
- So the phone **breaks the fps budget**, and the merge with it is Matthew's call, not a pass.
- **Budget note:** a single run's worst frame is not a stable baseline on this box. Main against main varied by up to 150 ms in it, so `maxStill` on the phone needs several runs. The fps gap above is steady across runs (main 15.8 to 16.0 against 14.8 to 15.1).

## Measured 2026-10-09 (this box, software rendering)

Main is `891b259` (no recorder: page-level numbers); the branch is G18 plus P1 at 150 ms. Ranges over deploy, demo and live (and 1x, 2x, 4x for the frame numbers). The branch settles at low, scale 0.5 on desktop and 0.7 on the phone; main stays at low, scale 1.

| | main | this branch |
|---|---|---|
| desktop: fps, p95 interval, longest still | 5.1 to 6.6 fps, 167 to 233 ms, 167 to 350 ms | 9.2 to 11.0 fps, 100 to 124 ms, 117 to 167 ms |
| phone: fps, p95 interval, longest still | 14.1 to 17.8 fps, 67 to 83 ms, 67 to 100 ms | 13.2 to 16.2 fps, 67 to 83 ms, 83 to 167 ms |
| steps a second at 4x (no glide, the same plan), desktop / phone | 1.38 to 2.00 / 3.19 to 3.85 | 4.10 to 5.62 / 6.12 to 7.04 |
| cadence (measured step time over its plan), 1x / 2x / 4x, desktop | derived 1.75 to 2.21 / 2.35 to 2.97 / 6.14 to 6.50 (deploy, demo) | 1.23 to 1.29 / 1.20 to 1.42 / 1.93 to 2.15 |
| cadence, 1x / 2x / 4x, phone | derived 1.28 to 1.37 / 1.47 to 1.71 / 2.65 to 3.48 | 1.16 to 1.20 / 1.12 to 1.32 / 1.53 to 1.83 |
| glide, ms a tile at 1x / 2x | 140 / 70 by the plan (not measurable on a build with no recorder) | 240.0 / 120.0 in every measured beat, 0 failing beats of 12 groups |
| glide steadiness (peak per-frame speed over the mean, final tile left out) | smoothstep: 1.17 to 1.44 when measured here with the recorder on the old ease (1.5 at its peak) | 1.00 in every beat, at every frame rate |

`--compare` against main: **desktop passes every budget** (all nine desktop runs: fps +54% to +84%, p95 -38% to -50%, longest still 20% to 57% under main's worst frame). **The phone does not**: fps 4% to 12% under main's in all nine runs and a longer still in eight (see the yield section for why no yield length fixes that).

- **Time to settle** (the load to the last change of tier or scale): the first load steps down through the scales, 10 to 12 s on the phone and 20 to 24 s on the desktop (main has no steps and reads 2 to 7 s). The second load, in the same profile, starts where the first ended and does not step again: 4.5 to 9.7 s on the phone and 5.8 to 11.4 s on the desktop, which is the load itself (the first reading of the stage).
- **A whole battle at 1x, start to result** (the plan's length, from the game code): the demo is 280 steps, 5.58 min at main's pace and 6.21 min now (+37.8 s, +11%, 121 move beats over 378 tiles); Deploy first-light is 49 steps, 52.4 s and 64.1 s (+11.7 s, +22%, 29 beats over 117 tiles).
- **Does the board read crisply at a smaller scale?** On the desktop, 1 is crisp. At 0.7 it is a little soft: units, terrain, the cables and who owns what read as clearly as at 1, and only the smallest marks (a unit's badge, the helipad's H) are soft. At 0.5 it is plainly soft: positions, ownership and terrain still read, but the units are blobs, the badges and the H are gone. On the phone, 0.7 keeps units readable as orange and blue shapes on the board; 0.5 is smudged, which is why a narrow canvas stops at 0.7. (Screenshots: `pnpm motion --shots <dir>`.)

## Caveats

- **This machine has no GPU.** WebGL runs in software (SwiftShader) on the CPU, on the same cores as the page. Its absolute fps is a floor, not what a player sees, and a run can move by 10% on its own: main's own worst frame in the demo's desktop 1x run read 350 ms here and 233 in an earlier run on this box, and two runs of the same 150 ms build read stills of 150 to 200. The budgets compare a frame's worst case to a single other frame's worst case, so only same-machine, same-minute comparisons count. Do not run anything else while it measures.
- **maxStill counts the dwell.** After each step the picture is meant to rest for 200 ms at 1x (100 at 2x, 50 at 4x): nothing moves. Main redraws that rest and so has no still; the yield skips those redraws, so a still at a step boundary is the price of the cadence, and the budget is what bounds it.
- The cadence, hitch and stall budgets need a machine at 30 fps or more, so they have not been judged on real recordings here; their tests use recordings written from the spec.
- Glide speed is measured from where the unit was drawn against the clock, so it checks the drawing follows the plan. It cannot say the plan's speed is pleasant; `TIMINGS` is the spec for that.
- A glide shorter than two frames cannot be measured. It is counted as `unmeasured`, not passed.
- Main's cadence ratios are derived, not recorded, and its steadiness is read from a build with the old ease and the recorder, not from main itself (main has no recorder).
