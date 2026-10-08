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
| M3.1 | Doctrine brain (D-004/D-005): structured standing orders → deterministic action choice over the fog-honest list; seeded bot-vs-bot balance runs on the six maps with a source hash recorded | `e6654d4` | M3.0 | in progress (builder) | win rates per map and side within the band set in the order; replay-identical |
| M2 | Platform fork (R01, R02, R09, R10, R35) | M1 | D-003 cleared | **no — blocked** | see milestone plan |
| M4.0 | Act I "Cinder Season", missions 1–4 as data — **merged PR #15 `3f0b34c`** | `55ae6d9` | M1.9 | done | `pnpm test src/content/missions.test.ts` |
| M4.1 | Act II "False Colors", missions 5–7 — **merged PR #17 `3706d99`** | `e6654d4` | M4.0 | done | same file, Act II block |
| M4.2 | Act III "Thin Air", missions 8–11 | `3706d99` | M4.1 | in progress (builder) | same file, Act III block |
| M4.3 | Act IV "The Hollow Choir", missions 12–14 | after M4.2 | M4.2 | no | same file, Act IV block |
