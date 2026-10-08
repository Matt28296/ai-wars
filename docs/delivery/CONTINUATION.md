# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 09:3xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` holds:
  - **M1, the rules engine:** movement, combat, economy, powers, fog, victory, legal actions, replay, self-play, commanders, six skirmish maps;
  - **M3.0 and M3.0b, the fog-honest agent view and the per-viewer event filter;**
  - **M3.1, the Doctrine brain** (the agent's in-battle decisions from structured standing orders) and `pnpm balance`;
  - **the whole campaign,** Acts I–IV, missions 1–14, as data;
  - **M5.0, the watch-only battle viewer** (SVG stage);
  - **G0, the 3D foundation** (D-018): three.js, the art bible `docs/research/art-direction.md`, the `src/ui/board3d` contract and placeholders.

  1,162 tests, every merge on green CI.
- **In flight (Matthew asked for much higher-end graphics):**
  - G1 terrain, G2 unit miniatures and G4 the Stage3D renderer core (builders, one worktree each);
  - G3 effects kit (verified, in CI);
  - G5 commander portraits, 12 speakers × 6 moods (builder);
  - M3.2 balance and engine gaps (builder).
- Process: D-017 (private scratch space; the receipt is the last write). Integration order for the 3D work: G3, G1, G2 into main as they pass, then G4 swaps the placeholders out by import; `?renderer=2d` keeps the SVG stage.
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork: accounts, persistence, the MCP server shell) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions (none need the platform)

1. Verify and merge G1, G2, G4 and G5 as their receipts arrive. For each: check scope, read the screenshots, plant a regression, and merge on green CI.
2. Verify and merge M3.2 and record its balance table and source hash here (D-019).
3. G6: HUD polish against the 3D board, then a Doctrine-vs-Doctrine demo in the viewer.
4. The agent API module: one entry point re-exporting the engine, observe, viewEvents, legal, replay and Doctrine, ready for the MCP tools.
5. When D-003 clears: M2 platform fork, then the MCP server over the agent API.
