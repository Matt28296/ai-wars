# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 11:1xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` holds:
  - **M1, the rules engine**; **M3.0/M3.0b**, the fog-honest agent view and the per-viewer event filter;
  - **M3.1/M3.2, the Doctrine brain** with the first-mover rule and pressure when ahead (D-019);
  - **the whole campaign**, Acts I–IV, missions 1–14, as data;
  - **the 3D battlefield (D-018)**, the default board of the watch view, with `?renderer=2d` and a toolbar toggle for the SVG fallback:
    - G1 terrain, G2 + G7 unit miniatures (one skinned mesh per unit), G3 effects, G4 the renderer;
    - G5 commander portraits (11 speakers × 6 moods);
    - G8a properties that make room for units, G8b the war-room table, match intro, storm static and 92% framing.

  1,753 tests, every merge on green CI, each PR re-tested against everything merged before it.
- **In flight (Matthew asked for much higher-end graphics):**
  - G6, the watch HUD (intel card, live panels, event-log icons, timeline ticks);
  - G9, the front door (title with a 3D board, campaign map, briefing with portraits, Deploy);
  - G10, battle feel (movement trails, attack camera, impact shake, power sweep);
  - M3.3, the balance the M3.2 run missed (seat counts, multi-player pressure, saltglass and canopy).
- Process: D-017 (private scratch space; the receipt is the last write). The lead reads every builder's screenshots, plants a regression in each kit, and screenshots the integrated watch view before merging.
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork: accounts, persistence, the MCP server shell) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions (none need the platform)

1. Verify and merge G6, G9, G10 and M3.3 as their receipts arrive, then record D-020 (M3.3's balance table).
2. A frozen-clock "beauty pass" of the integrated game: title, briefing, deploy, a full mission watch, at 1280 and 390; fix what reads cheap.
3. The mission debrief and in-mission dialogue (the events' lines) in the deployed watch.
4. The agent API module: one entry point re-exporting the engine, observe, viewEvents, legal, replay and Doctrine, ready for the MCP tools.
5. When D-003 clears: M2 platform fork, then the MCP server over the agent API.
