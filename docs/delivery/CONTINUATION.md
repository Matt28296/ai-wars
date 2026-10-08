# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 12:5xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` holds:
  - **M1, the rules engine**; **M3.0/M3.0b**, the fog-honest agent view and the per-viewer event filter;
  - **M3.1/M3.2, the Doctrine brain** with the first-mover rule and pressure when ahead (D-019);
  - **the whole campaign**, Acts I–IV, missions 1–14, as data;
  - **the front door (G9):** title with a 3D board, campaign map (spoiler-safe), briefings with portraits, and Deploy, which plays a mission with Doctrine in a Worker and opens the watch view;
  - **the 3D battlefield (D-018)**, the default board of the watch view, with `?renderer=2d` and a toolbar toggle for the SVG fallback:
    - G1 terrain, G2 + G7 unit miniatures (one skinned mesh per unit), G3 effects, G4 the renderer;
    - G5 commander portraits (11 speakers × 6 moods); G6 the watch HUD (intel card, live panels, iconised log, timeline marks);
    - G8a properties that make room for units, G8b the war-room table, match intro, storm static and 92% framing;
    - G10 battle feel (movement trails, attack camera, impact shake, power sweep);
    - G11 a living board (cloud shadows, wind, caustics; the terrain kit's `setMotion`).

  2,080 tests, every merge on green CI, each PR re-tested against everything merged before it.
- **In flight (Matthew asked for much higher-end graphics):**
  - G12, quality (GTAO ambient occlusion, high/medium/low tiers, `?quality=`, the stage calling `setMotion`), on `aw/g12-quality` from `e59fa8f`;
  - G13, the mission's story in the deployed battle (trigger evaluation, in-battle dialogue, the debrief and rank card), on `aw/g13-mission-story` from `c6c58dd`;
  - M3.3, the balance the M3.2 run missed (seat counts, multi-player pressure, saltglass and canopy), on `aw/m33-balance` from `e6e1fa6`.
  - G12 must be verified with G11 merged in, so its `setMotion` wiring is tested against the real kit.
- Process: D-017 (private scratch space; the receipt is the last write). The lead reads every builder's screenshots, plants a regression in each kit, and screenshots the integrated watch view before merging.
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork: accounts, persistence, the MCP server shell) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions (none need the platform)

1. Verify and merge G12, G13 and M3.3 as their receipts arrive, then record D-020 (M3.3's balance table).
2. A frozen-clock "beauty pass" of the integrated game: title, briefing, deploy, a full mission watch with its dialogue and debrief, at 1280 and 390; fix what reads cheap.
3. The agent API module: one entry point re-exporting the engine, observe, viewEvents, legal, replay and Doctrine, ready for the MCP tools.
4. When D-003 clears: M2 platform fork, then the MCP server over the agent API.
