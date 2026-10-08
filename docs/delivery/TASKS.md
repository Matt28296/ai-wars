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
| M1.0 | Move the contract + salvage engine into `src/game/aw`; createGame, applyAction, menu queries; compiling with a smoke test | `319d3da` | M0.1 | yes (PR #2) | `pnpm typecheck && pnpm test` green in CI |
| M1.1 | Movement: `reachable`, move costs by type, charge limit, fog ambush truncation | M1.0 | M1.0 | after M1.0 | `pnpm test src/game/aw/movement.test.ts` |
| M1.2 | Combat: damage formula, luck, counter, indirect rules, forecast, ammo/secondary | M1.0 | M1.0 | after M1.0 | `pnpm test src/game/aw/combat.test.ts` |
| M1.3 | Turn economy: income, repair, resupply, charge drain + crash/sink, capture, production | M1.0 | M1.0 | after M1.0 | `pnpm test src/game/aw/economy.test.ts` |
| M1.4 | Powers: meter charge, star costs and scaling, every Modifier and InstantEffect | M1.0 | M1.0 | after M1.0 | `pnpm test src/game/aw/power.test.ts` |
| M1.5 | Fog, victory (rout, spire, objectives), score card | M1.0 | M1.0 | after M1.0 | `pnpm test src/game/aw/fog.test.ts src/game/aw/victory.test.ts` |
| M1.6 | `applyAction` integration, legality, determinism and immutability, seeded simulations | M1.1–M1.5 | M1.1–M1.5 | no | `pnpm test src/game/aw` + sims in CI |
| M1.7 | Rename Ren Okafor → Rook Okafor everywhere (D-007) | `84f49aa` | — | yes (lead) | `git grep -n -w Ren -- ':!docs/delivery' ':!docs/research'` returns nothing |
| M2 | Platform fork (R01, R02, R09, R10, R35) | M1 | D-003 cleared | **no — blocked** | see milestone plan |
