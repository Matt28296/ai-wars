# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 07:5xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` holds:
  - **M1, the rules engine:** movement, combat, economy, powers, fog, victory, legal actions, replay, self-play, commanders, six skirmish maps;
  - **M3.0 and M3.0b, the fog-honest agent view and the per-viewer event filter;**
  - **Acts I and II of the campaign,** missions 1–7.
  
  796 tests, every merge on green CI.
- **In flight:**
  - builders on M3.1 (Doctrine brain + `pnpm balance`) and M4.2 (Act III).
- Process: D-017 (private scratch space; the receipt is the last write).
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork: accounts, persistence, the MCP server shell) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions (none need the platform)

1. Verify and merge M3.1 (Doctrine). Record its balance table and source hash in this log.
2. Verify and merge M4.2 (Act III), then dispatch M4.3 (Act IV).
3. M3.2, the agent API module: one entry point re-exporting the engine, observe, viewEvents, legal, replay and Doctrine, ready for the MCP tools.
4. When D-003 clears: M2 platform fork, then the MCP server over M3.2.
