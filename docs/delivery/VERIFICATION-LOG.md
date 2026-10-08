# Verification log

What has been measured working, and how. An entry names the claim, the exact command or check, where it ran, the result, and whether the path was **live** or a **mock/fixture**. A requirement is `verified` only through an entry here on the real path. Mocks, fixtures and green builds are recorded as what they are and never as live evidence.

| Date (UTC) | Claim | Check | Ran where | Result | Path |
|---|---|---|---|---|---|
| 2026-10-08 05:09 | The originality guard refuses a Nintendo name in shipped code and passes the current tree | `pnpm guard` on the tree (116 files, 0 findings, rc 0); same command with a planted `src/planted.ts` containing `'Sturm'` (1 finding, rc 1) | lead worktree, local | PASS both directions | fixture (planted file) |
| 2026-10-08 05:09 | The guard refuses to report clean when it cannot read the tree | `pnpm guard` with a tracked file missing from disk: `could not run (ENOENT …)`, rc 2 | lead worktree, local | PASS (fails red) | fixture |
| 2026-10-08 05:09 | The build embeds the commit it was built from | `GITHUB_SHA=0123…4567 pnpm build`, then `grep -rl` finds it in `dist/assets/index-*.js` | lead worktree, local | PASS | local build, not CI |
