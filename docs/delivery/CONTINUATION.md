# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

## Where things stand (2026-10-08 13:4xZ)

- Direction: fork Blacklink, swap its Fire Emblem layer for an Advance Wars-family layer, keep the agent-as-commander core (`DECISIONS.md` D-001).
- `main` holds:
  - **M1, the rules engine**; **M3.0/M3.0b**, the fog-honest agent view and the per-viewer event filter;
  - **M3.1–M3.3, the Doctrine brain**: the first-mover rule by seat count, pressure over the field, two map fixes (D-019, D-020); recorded matches carry their first-mover rule;
  - **the whole campaign**, Acts I–IV, missions 1–14, as data;
  - **the front door (G9) and the mission's story (G13):** title, campaign map, briefing, Deploy (Doctrine on every side in a Worker), in-battle dialogue at the mission's own beats, and a debrief with a result card and rank;
  - **the 3D battlefield (D-018)**, the watch view's default board, with `?renderer=2d` and a toggle:
    - G1 terrain, G2 + G7 units, G3 effects, G4 the renderer, G5 portraits, G6 the HUD;
    - G8a/G8b properties, table, intro, storm, framing; G10 battle feel; G11 the living board;
    - G12 ambient occlusion and high/medium/low quality tiers (`?quality=`).

  2,270 tests, every merge on green CI, each PR re-tested against everything merged before it.
- **The player cannot yet give their agent orders.** The engine and Doctrine take standing orders (D-005, D-006), but no screen sets them: Deploy plays every side on DEFAULT_ORDERS. The controls walkthrough (artifact "Ascendant Wars Controls") shows every screen and sketches the orders card.
- **In flight:** G15, the deployed battle screen naming seats as the mission does (Act I must not name the Choir), unique viewer labels, and fitting 1280×800 (it measured 972 px tall), on `aw/g15-deployed-view` from `3a4ff18`.
- **Next, waiting on Matthew's call:** G14, orders before Deploy and, if he picks it, a live battle with an in-battle orders bar.
- **Known follow-ups:** the units kit ignores reduced motion (idle motion keeps playing); glass-waste's middle seat never wins; arcology-coast is mostly undecided at 40 cycles.
- Process: D-017 (private scratch space; the receipt is the last write). The lead reads every builder's screenshots, plants a regression in each change, and screenshots the integrated view before merging. Dev servers start with `setsid sh -c 'echo $$ > pidfile; exec pnpm dev ...'`, so the pidfile holds the real process group.
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers (each with the smallest outside action)

1. **ai-wars is public (D-003).** No Blacklink code can land, so M2 (the platform fork: accounts, persistence, the MCP server shell) cannot start.
   - *Smallest action:* Matthew goes to GitHub → Matt28296/ai-wars → Settings → General → Danger Zone → Change visibility → Private.
2. **The default branch is not `main`, so CodeRabbit skips every PR.**
   - *Smallest action:* Matthew goes to Settings → General → Default branch → `main`.

## Next actions (none need the platform)

1. Verify and merge G15.
2. G14 on Matthew's answer (live orders or locked at Deploy).
3. A frozen-clock "beauty pass" of the integrated game at 1280 and 390; fix what reads cheap. Units honour reduced motion.
4. The agent API module: one entry point re-exporting the engine, observe, viewEvents, legal, replay and Doctrine, ready for the MCP tools.
5. When D-003 clears: M2 platform fork, then the MCP server over the agent API.
