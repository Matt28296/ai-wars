# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 05:1xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` exists (`35bcf4f`): the Ascendant Wars foundation (design system, story bible, contract, data, damage chart, research). The stopped workers' salvage stays on `claude/futuristic-advanced-wars-game-rt8yq6` @ `fa1789f`.
- M0 (records, CI, guard, builder/reader definitions, pnpm) is on `aw/m0-records-ci`, going to its first PR.
- The engine salvage (about 1,700 lines across 12 modules in `src/engine/*` on the salvage branch) has no dispatcher and no tests; M1 turns it into `src/game/aw` through bounded builder orders.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land. *Smallest action:* Matthew, GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private. The lead re-reads the API and starts M2 the same hour.
2. **GitHub Actions on ai-wars has never run.** *Smallest action:* none expected; the first PR shows whether Actions is enabled. If it is disabled, Matthew enables it under Settings → Actions.

## Next actions

1. Open the M0 PR, read the `checks` run, merge on green with the gate output quoted.
2. M1.0: move the contract and the salvage engine into `src/game/aw`, compiling, with a smoke test.
3. M1.1–M1.5: up to five Sonnet builders, one worktree each, file-disjoint orders from `TASKS.md`.
4. M1.6: integration, determinism, seeded simulations in CI.
5. When D-003 clears: M2 platform fork.
