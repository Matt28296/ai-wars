# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 06:2xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- **M1 (the rules engine) is complete once PR #14 merges.** `main` holds:
  - movement, combat, turn economy, powers, fog/victory/score;
  - rules integration (D-013, D-015);
  - the eleven commanders as data;
  - six original skirmish maps with a map checker.
- PR #14 adds the legal-action list, exact replay and seeded self-play. That is 599 tests.
- Every merge waited for green CI, with the gate output quoted on the PR. See `VERIFICATION-LOG.md`.
- The `wip/*` branches on GitHub are backup snapshots of builder work that has since merged. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork: accounts, persistence, the MCP server shell) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions (none need the platform)

1. **M3.0, the fog-honest agent view (D-016):**
   - an observation and action list for a fogged player;
   - a move ending on a hidden enemy resolves as an ambush.
2. **M3.1, the Doctrine brain (D-004, D-005):**
   - structured standing orders drive deterministic choices over that list;
   - seeded bot-vs-bot balance runs on the six maps, with a source hash recorded.
3. When D-003 clears: M2 platform fork, then the MCP tools over M3.
