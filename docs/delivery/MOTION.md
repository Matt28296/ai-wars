# Motion

How the game moves is measured on every change, not guessed. `pnpm motion` drives the production build in a real browser and reports frame pacing, how fast and how smoothly units glide, the camera, and the playback cadence. Matthew's ask: *"monitor for in game movement speed, smoothness etc."*

## What is measured

| Group | Numbers | Where they come from |
|---|---|---|
| Frame pacing | fps; frame interval p50, p95, p99, max; share of frames over 1.5x the median ("dropped") and over 50 ms; long tasks (count, total, max); the JS time of the stage's own `frame()` p50 and p95 | the stage's frame loop (the recorder), or the page's own `requestAnimationFrame` ticks on a build with no recorder |
| Unit glide | per move beat: ms per tile against `TIMINGS.moveTileMs` at that speed (140 at 1x, 70 at 2x); the largest step any frame took; progress along the path; where it ends | the recorder (`?probe=motion`) |
| Camera | per-frame displacement and speed; any jump outside a cut the stage declared; whether a shake decays | the recorder |
| Playback cadence | each step's measured length (start to the next start) against its plan (`durationMs` + the dwell), as a ratio per speed; steps a second at 1x, 2x and 4x; story holds left out | the recorder; steps a second also from `.aww-root[data-step]` on any build |

A **gap** is a stretch where the stage chose not to draw. On a machine slower than 20 fps the stage stops drawing for up to 400 ms after a step ends (the picture is a still then, and the page's own work gets its turn). The frame after a gap carries `skips` > 0. A gap is counted on its own and is left out of fps and the percentiles. Without that, the stage would look slower for being kinder to the page.

The recorder is **off unless the address says `?probe=motion`**. When it is off the frame loop never calls it and nothing is added to `window`. When it is on, `window.__awMotion.read()` returns everything recorded since the last `reset()`. It keeps only the current view's own state (D-016).

## The budgets

`pnpm motion` exits 1 when one of these is broken. A budget that cannot be judged (a machine too slow, nothing to measure) says so and neither passes nor fails.

| Budget | Rule | Judged |
|---|---|---|
| No frame worse than the baseline | with `--compare`, no frame metric (fps, interval p50/p95/p99/max, dropped and over-50 ms shares, long tasks, JS time) is more than 10% worse than the baseline's AND worse by more than its slack (2 ms on p50, 3 on p95, 5 on p99, 10 on max, 0.5 fps, 2 points on the shares, 1 long task / 50 ms total) at the same tier and render scale | `--compare` |
| The floor rule | a build at a smaller render scale than its baseline (the same tier) is held to two numbers only: fps and p95 no worse | `--compare` |
| Glide speed in spec | every measurable beat within 15% of `TIMINGS.moveTileMs` at its speed, or one frame, whichever is larger | always |
| No teleport | a frame moves a unit at most (frame dt / ms per tile) x 1.5 tiles + 0.05 | always |
| Glide path and end | progress never goes back; within 0.05 tile of the path; ends within 0.02 tile of the destination tile's centre | always |
| No glide at 4x | at 4x and under reduced motion the plan has no move beat and no unit glides (timing.ts) | always |
| Camera | no frame moves the camera faster than 80 world units a second (dt capped at 0.1 s as the stage caps it) outside a declared cut; a shake's second half is no bigger than its first | always |
| No hitch | no interval over both 3x the median and 100 ms | at 30 fps or more |
| Cadence in spec | each speed's total measured step time within 10% of its plan | at 30 fps or more |
| No stall | no step runs past its plan by more than 100 ms or 3 frames, whichever is larger | at 30 fps or more |

The limits live in one place, `LIMITS` in `src/ui/watch/motion/analysis.ts`, and the tests quote them.

## How to run

```
pnpm build                                                    # DATABASE_URL unset
pnpm motion --port 5312                                       # serves dist/ with `vite preview` on 5312, measures, stops it
pnpm motion --url http://127.0.0.1:5311/                      # measures a build that is already served
pnpm motion --port 5312 --out motion.json                     # also writes the JSON report
pnpm motion --port 5312 --compare baseline.json               # prints deltas, exits 1 on a broken budget
pnpm motion --port 5312 --pin low@1                           # ?quality=low&scale=1: same tier and scale as a build that has no scale
pnpm motion --port 5312 --shots shots/                        # screenshots at render scale 1, 0.7 and 0.5, both sizes
```

It runs at 1280x800 and 390x844, at 1x, 2x and 4x, on three scenarios: **deploy** (first-light, the story skipped), **demo** (the seeded demo match) and **live** (G17's live view, from a scripted feed the script starts and stops itself). Per scenario it loads the page, waits until the adaptive step has settled (the tier and scale unchanged for 15 s), then plays the same 10 steps at each speed.

Flags: `--sizes desktop,phone`, `--speeds 1,2,4`, `--scenarios deploy,demo,live`, `--steps 10`, `--max-seconds 60`, `--settle-seconds 90`, `--label`, `--tolerance 0.1`.

Playwright is taken from the repo if it is there, else `$PLAYWRIGHT_MODULE`, else `/opt/node22/lib/node_modules/playwright`. If none is found the script says so in one line and exits 2. It never installs anything. A build with the recorder is measured in `recorder` mode, one without (main has none) in `page` mode; the report says which, per run, and `--compare` compares only the metrics both sides have.

## The render scale

Below the lowest quality tier there is one more step: the internal render scale (1, 0.85, 0.7, 0.5). It shrinks the drawing buffer and leaves the canvas's CSS size alone. It steps only when the adaptive step is already at `low` and a full window of frames is still slower than `slowMs`, one step at a time, never back up, with the tiers' warm-up and window. `?scale=1|0.85|0.7|0.5` pins it. The tier and the scale are `data-quality` and `data-scale` on `.aww-stage3d`.

## The playback clock

Playback cadence was bound to the frame rate: on a machine under 20 fps every step boundary (the end of a step, the dwell timer, the next step's render) was several page tasks, each queued behind a whole frame, so a step with nothing to animate cost three frames, not its 60 ms. Two things in `runtime.ts` keep the clock off the frame rate: a plan also ends on a timer (a hidden tab does not play on), and on a slow machine the stage stops drawing for up to 400 ms after a step ends (`skips`, the gaps above) so the page gets its turns. A machine at 20 fps or better never skips a frame.

## Baseline (2026-10-08, this machine, software rendering)

Mean over deploy, demo and live; 10 steps at each speed. Main is `891b259` (no recorder, so page-level numbers); the branch is G18 plus P1.

| | main, low at scale 1 | this branch, adaptive (settles at low, scale 0.5) |
|---|---|---|
| desktop 1280x800: fps, p95 interval | 5.8-5.9 fps, 194-204 ms | 10.2-11.0 fps, 101-111 ms |
| phone 390x844: fps, p95 interval | 15.6-15.8 fps, 72-78 ms | 21.5-22.1 fps, 50-56 ms |
| steps a second, 1x / 2x / 4x, desktop | 0.70 / 1.05 / 1.62 | 1.21 / 2.16 / 5.44 |
| steps a second, 1x / 2x / 4x, phone | 1.01 / 1.61 / 3.42 | 1.19 / 2.10 / 5.99 |
| glide, ms a tile at 1x / 2x | not measurable | 140.0 / 70.0 (every measurable beat) |
| cadence ratio, desktop 1x / 2x / 4x | not measurable | 1.08-1.12 / 1.15-1.34 / 1.84-2.02 |

The same board at the same tier and scale (G18 head against this branch, both pinned `low@1`, at 1x): fps 3.8 to 3.9 on desktop and 10.1 to 9.7 on phone, p95 300 to 296 ms and 117 to 117 ms, and steps a second 0.60 to 0.89 (1x), 0.75 to 1.43 (2x) and 1.13 to 2.54 (4x) on desktop. At 1x and 4x the cadence ratio is still above 1: the page's own tasks still cost about a frame each at a boundary, and a frame costs 100 to 270 ms here. The cadence budget is judged at 30 fps or more, which this machine never reaches.

## Caveats

- **This machine has no GPU.** WebGL runs in software (SwiftShader) on the CPU, on the same cores as the page. Its absolute fps is a floor, not what a player sees, and a run can move by 10% on its own (main against main, on a 3-step run, read 12% apart). Only same-machine, same-settings comparisons count. Do not run anything else while it measures.
- The cadence, hitch and stall budgets need a machine at 30 fps or more, so they have not been judged on real recordings here; their tests use recordings written from the spec.
- Glide speed is measured from where the unit was drawn against the clock, so it checks the drawing follows the plan. It cannot say the plan's speed is pleasant; `TIMINGS` is the spec for that.
- A glide shorter than two frames cannot be measured. It is counted as `unmeasured`, not passed.
