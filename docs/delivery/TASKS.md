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
| M1.6a | Rules integration: D-015 (charge per tile, ion storm, 50-unit cap, no nested transports, turn-start defeat), the D-013 campaign deadline, fog vision through `effectiveVision`, canopy hiding in attack and move queries, re-exports | M1.1–M1.5 | M1.1–M1.5 | yes (builder) | `pnpm test src/game/aw/rules.test.ts` + the whole suite |
| M1.6b | Legal-action enumerator, replay from seed + actions, seeded random-play simulations with a state hash (determinism, immutability, invariants) | M1.1–M1.5 | M1.1–M1.5 | yes (builder) | `pnpm test src/game/aw/sim.test.ts src/game/aw/replay.test.ts` |
| M1.7 | Rename Ren Okafor → Rook Okafor everywhere (D-007) — **merged PR #3 `16cfa5d`** | `84f49aa` | — | done | `git grep -n -w Ren -- ':!docs/delivery' ':!docs/research'` returns nothing |
| M1.8 | The eleven commanders as engine data — **merged PR #10 `88e751e`** | `c6f8876` | M1.4 | done | `pnpm test src/content/commanders.test.ts` (41) |
| M2 | Platform fork (R01, R02, R09, R10, R35) | M1 | D-003 cleared | **no — blocked** | see milestone plan |
