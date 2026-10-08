# Tasks

Work is split by **owner area**. Areas never share a file, so builders in separate worktrees cannot collide. A subtask names what it builds on (`main @ sha`), what it waits for, whether it is buildable now, and the command that accepts it.

## Owner areas

| Area | Files (exclusive) | Owner |
|---|---|---|
| CORE | `.github/**`, `scripts/**`, `package.json`, `pnpm-*.yaml`, `vite.config.ts`, `tsconfig.json`, `.claude/**`, `docs/delivery/**` | lead |
| CONTRACT | `src/game/aw/types.ts`, `src/content/types.ts` | lead (builders read only) |
| DATA | `src/data/**`, `design-system/tools/**` (generators) | lead |
| ENGINE | `src/game/aw/**` except `types.ts`; each builder gets a disjoint file list | builders |
| CONTENT | `src/content/**` except `types.ts` | builders (after M1) |
| DESIGN | `design-system/project/**`, `docs/STORY.md` | lead |
| PLATFORM | the TanStack shell, auth, db (M2) | blocked (D-003) |
| AGENT | MCP server, game service, Doctrine brain (M3) | after M1 + M2 |
| UI | agent home, watch, debrief, replay (M4) | after M2 |

## Subtasks

| # | Subtask | Builds on (main @ sha) | Depends on | BUILDABLE NOW | Acceptance (command or check) |
|---|---|---|---|---|---|
| M0.1 | Records, CI, guard, agent definitions, pnpm — **merged PR #1 `319d3da`** | `35bcf4f` | — | done | PR `checks` green; `pnpm guard` fails on a planted Nintendo name |
| M1.0 | Move the contract + salvage engine into `src/game/aw`; createGame, applyAction, menu queries; compiling with a smoke test — **merged PR #2 `84f49aa`** | `319d3da` | M0.1 | done | `pnpm typecheck && pnpm test` green in CI |
| M1.1 | Movement: `reachable`, move costs by type, charge limit, fog ambush truncation — **merged PR #6 `ade6246`** | `2fef0e4` | M1.0 | done | `pnpm test src/game/aw/movement.test.ts` (44) |
| M1.2 | Combat: damage formula, luck, counter, indirect rules, forecast, ammo/secondary — **merged PR #8 `13c6764`** | `90a95c7` | M1.0 | done | `pnpm test src/game/aw/combat.test.ts` (75) |
| M1.3 | Turn economy: income, repair, resupply, charge drain + crash/sink, capture, production — **merged PR #5 `2fef0e4`** | `84f49aa` | M1.0 | done | `pnpm test src/game/aw/economy.test.ts` (59) |
| M1.4 | Powers: meter charge, star costs and scaling, every Modifier and InstantEffect — **merged PR #9 `c6f8876`** | `13c6764` | M1.0 | done | `pnpm test src/game/aw/power.test.ts` (112) |
| M1.5 | Fog, victory (rout, spire, objectives), score card — **merged PR #7 `90a95c7`** | `ade6246` | M1.0 | done | `pnpm test src/game/aw/fog.test.ts src/game/aw/victory.test.ts src/game/aw/score.test.ts` (65) |
| M1.6a | Rules integration: D-015 (charge per tile, ion storm, 50-unit cap, no nested transports, turn-start defeat), the D-013 campaign deadline, fog vision through `effectiveVision`, one visibility rule for attack and move, re-exports — **merged PR #12 `feed69b`** | `0dddde6` | M1.1–M1.5 | done | `pnpm test src/game/aw/rules.test.ts` + the whole suite |
| M1.6b | Legal-action enumerator, replay from seed + actions, seeded self-play with a state hash (determinism, immutability, invariants); BUG-1 fixed by the lead — **merged PR #14 `55ae6d9`** | `cd3bb7a` | M1.1–M1.5 | done | `pnpm test src/game/aw/sim.test.ts src/game/aw/replay.test.ts` |
| M1.7 | Rename Ren Okafor → Rook Okafor everywhere (D-007) — **merged PR #3 `16cfa5d`** | `84f49aa` | — | done | `git grep -n -w Ren -- ':!docs/delivery' ':!docs/research'` returns nothing |
| M1.8 | The eleven commanders as engine data — **merged PR #10 `88e751e`** | `c6f8876` | M1.4 | done | `pnpm test src/content/commanders.test.ts` (41) |
| M1.9 | Six original skirmish maps and a reusable map checker — **merged PR #13 `cd3bb7a`** | `feed69b` | M1.0 | done | `pnpm test src/content/maps.test.ts` (51) |
| M3.0 | Fog-honest agent view (D-016): observation + action list for a fogged player; a move ending on a hidden enemy resolves as an ambush — **merged PR #16 `e6654d4`** | `3f0b34c` | M1.6b | done | planted hidden enemy: identical observation and action list with and without it |
| M3.0b | Per-viewer event filter (D-016): the events a viewer may see per step — **merged PR #18 `7589bb6`** | `3706d99` | M3.0 | done | `pnpm test src/game/aw/view-events.test.ts` (44) |
| M3.1 | Doctrine brain (D-004/D-005): structured standing orders → deterministic action choice over the fog-honest list; seeded bot-vs-bot balance runs on the six maps with a source hash recorded — **merged PR #21 `3552323`** | `e6654d4` | M3.0 | done | `pnpm test src/game/doctrine` + `pnpm balance` (hash `f1a42064b9ecdc72`) |
| M3.2 | First-mover rule chosen by measurement, Doctrine pressure when ahead, `forecast` range check, enemy transport cargo hidden by fog; balance rerun (D-019) — **merged PR #27 `e6e1fa6`** | `8f28b18` | M3.1 | done | 2 of 6 maps on target; the rest is M3.3 |
| M3.3 | Balance: a seat-count first-mover default, multi-player Doctrine pressure, map fixes for saltglass and canopy — **merged PR #43 `0c4d876`** | `e6e1fa6` | M3.2 | done | side-0 share 35–65% on 2-player maps, ≤ 25% undecided |
| M5.0 | Watch-only battle viewer: SVG stage, timeline, transition beats, HUD, cut-ins, event log — **merged PR #22 `47c8df2`** | `3552323` | M3.1 | done | `pnpm test src/ui/watch` + demo screenshots |
| M2 | Platform fork (R01, R02, R09, R10, R35) | M1 | D-003 cleared | **no — blocked** | see milestone plan |
| M4.0 | Act I "Cinder Season", missions 1–4 as data — **merged PR #15 `3f0b34c`** | `55ae6d9` | M1.9 | done | `pnpm test src/content/missions.test.ts` |
| M4.1 | Act II "False Colors", missions 5–7 — **merged PR #17 `3706d99`** | `e6654d4` | M4.0 | done | same file, Act II block |
| M4.2 | Act III "Thin Air", missions 8–11 — **merged PR #20 `5088ecf`** | `3706d99` | M4.1 | done | same file, Act III block |
| M4.3 | Act IV "The Hollow Choir", missions 12–14; the campaign is complete — **merged PR #23 `59e812b`** | `47c8df2` | M4.2 | done | same file, Act IV block |
| G0 | 3D foundation: three 0.186.1, art direction, board3d contract + placeholders (lead) — **merged PR #24 `8f28b18`** | `59e812b` | M5.0 | done | `pnpm test src/ui/board3d` |
| G1 | Terrain kit: tiles, autotiling, water, props, properties, capture rings, fog — **merged PR #29 `c4df30a`** | `1dac6f1` | G0 | done | `pnpm test src/ui/board3d/terrain` + gallery screenshots |
| G2 | Unit miniatures: 16 procedural models, faction paint, idle motion, poses — **merged PR #28 `107740c`** | `c4df30a` | G0 | done | `pnpm test src/ui/board3d/units` + gallery screenshots |
| G3 | Effects kit: muzzle, tracer, shell, hit, explosion, pulse, ambush, spawn, numbers — **merged PR #25 `1dac6f1`** | `8f28b18` | G0 | done | `pnpm test src/ui/board3d/fx` (52) + gallery screenshots |
| G4 | Renderer core: Stage3D (scene, camera rig, lights, shadows, post), plan wiring, fallback — **merged PR #26 `aac7808`** | `1dac6f1` | G0 | done | `pnpm test src/ui/board3d/stage` + demo screenshots |
| G5 | Commander portraits: 11 speakers (the ten commanders + ECHO) × 6 moods, hand-authored SVG; HUD and cut-in moods — **merged PR #31 `44fa49c`** | `e6e1fa6` | G0 | done | `pnpm test src/ui/portraits` + contact-sheet screenshots |
| G6 | Watch HUD: intel card for the acting unit, live funds and power, an iconised event log, a timeline with cycle ticks — **merged PR #37 `323a2ff`** | `44fa49c` | G4, G5 | done | `pnpm test src/ui/watch` + screenshots at three sizes |
| G7 | Unit kit: one rigidly skinned mesh per unit, 96 draw calls for 40 units (was 363); a faction fresnel rim — **merged PR #32 `eb93e34`** | `44fa49c` | G2 | done | draw-call test + before/after contact sheets |
| G8a | Terrain: `setOccupied` low form for properties under a unit; rails and beacons under the bloom threshold — **merged PR #34 `c33f153`** | `71c7592` | G1, contract (#30) | done | `pnpm test src/ui/board3d/terrain` + watch-view screenshots |
| G8b | Stage: the war-room table, match intro, ion-storm static, occupancy and reduced-motion wiring, 92% framing — **merged PR #35 `eb3f1ab`** | `c33f153` | G4 | done | stage tests + demo screenshots at fixed steps |
| G9 | The front door: title screen with a 3D board, campaign map, Advance Wars-style briefing (portraits, moods, typewriter), Deploy plays the mission with Doctrine — **merged PR #38 `c6c58dd`** | `c33f153` | G5 | done | `pnpm test src/ui/front` + screenshots; legacy `#step=` links unchanged |
| G10 | Battle feel: movement trails (dust, wake, contrails), an attack camera, impact shake, the power sweep — **merged PR #39 `e59fa8f`** | `eb3f1ab` | G3, G8b | done | `pnpm test src/ui/board3d` + manual-clock screenshots |
| G11 | A living board: cloud shadows, wind on the grass and trees, caustics in the shallows; terrain kit `setMotion` — **merged PR #40 `d934bf6`** | `323a2ff` | G1, G8a | done | `pnpm test src/ui/board3d/terrain` + gallery and watch screenshots |
| G12 | Quality: GTAO ambient occlusion, high/medium/low tiers chosen from cheap signals and stepped down on slow frames, `?quality=`, the stage calls `setMotion` — **merged PR #42 `422d2b7`** | `e59fa8f` | G10, G11 | done | tier and pass tests + AO on/off crops |
| G13 | The mission's story in the deployed battle: trigger evaluation, in-battle dialogue, the debrief with a rank card — **merged PR #44 `3a4ff18`** | `c6c58dd` | G9 | done | `pnpm test src/ui/front src/ui/watch` + screenshots |
| G15 | The deployed battle screen names seats as the mission does (no late reveals, unique viewer labels) and fits the screen | `3a4ff18` | G13 | builder | per-mission spoiler test over the rendered watch + fold measurements |
| G14 | Command: an orders card before Deploy, a live step-by-step battle, an in-battle orders bar (D-006), order changes in the match record | after G15 | G15 | proposed | waiting on Matthew: live orders or locked at Deploy |
