# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 05:5xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` @ `c6f8876` holds:
  - M0: records, CI, guard and agent definitions;
  - M1.0: the engine in `src/game/aw`, with `createGame` and `applyAction`;
  - M1.1 movement, M1.2 combat, M1.3 turn economy, M1.4 powers and M1.5 fog/victory/score, each merged on green CI. 392 tests.
- M1.8 (the eleven commanders as data) is PR #10, waiting on CI.
- M1.6 is split into two file-disjoint builder orders:
  - 6a: rules integration (D-013 deadline, D-015);
  - 6b: legal-action enumerator, replay and seeded simulations.
- The salvage branch `claude/futuristic-advanced-wars-game-rt8yq6` @ `fa1789f` is input only.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
   - The lead re-reads the API and starts M2 the same hour.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions

1. Merge PR #10 on green CI.
2. Dispatch M1.6a and M1.6b, one Sonnet builder each in its own worktree. Verify each receipt with a planted regression, then PR and merge on green CI.
3. Then M1 is done. Next is M3 prep, which does not need the platform: the Doctrine brain (D-004) over the legal-action enumerator, with seeded bot-vs-bot balance runs that record a source hash.
4. When D-003 clears: M2 platform fork.
