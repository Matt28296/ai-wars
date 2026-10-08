# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

**Edgy, Matthew's personal assistant, reads this file to follow ai-wars (D-021).** It is updated after every merge to `main`. Edgy's word counts as Matthew's here, the hard gates included. Answers to the items under *Decisions waiting* reach this session through Matthew.

## Decisions waiting (Matthew or Edgy)

1. **Make Matt28296/ai-wars private (D-003).** It blocks M2, the platform fork (accounts, saves, a hosted MCP server). GitHub: Settings → General → Danger Zone → Change visibility → Private.
2. **Set the default branch to `main`.** CodeRabbit skips every ai-wars PR until it is. GitHub: Settings → General → Default branch.
3. **Publish the game to npm when A1 and G17 are ready (D-023).** It makes the connect step one line (`claude mcp add ascendant-wars -- npx ascendant-wars`). It is a public release, so it needs a yes.

## Where things stand (2026-10-08 15:5xZ)

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

  2,563 tests, every merge on green CI, each PR re-tested against everything merged before it.
- **The player cannot yet give their agent orders.** The engine and Doctrine take standing orders (D-005, D-006), but no screen sets them: Deploy plays every side on DEFAULT_ORDERS. The controls walkthrough (artifact "Ascendant Wars Controls") shows every screen and sketches the orders card.
- **G15 (merged):** the battle screen after Deploy names each seat as the mission's own briefing does (mission 1 reads "Unmarked drones"; Act I never names the Choir), its viewer buttons read You / Rook / Unmarked / All, and it fits 1280×800, 1440×900 and 1024×768 with no page scroll.
- **G16 (merged):** no nation sigil on a masked seat's units anywhere (3D board, briefing preview, Deploy board), and the 3D board holds still under reduced motion.
- **M3.4 (merged):** orders per unit group and type in Doctrine (D-022); with no group orders every decision is as before.
- **In flight:** A1, connect your own agent: a local MCP server and a live feed (D-023), on `aw/a1-agent-connect` from `790c85e`.
- **Next:** G14 (the orders screen and the live battle, on A1's match host), then G17 (the "Connect your agent" start screen and the live agent view), then G18 (the clean battle screen). All follow D-023's clean-interface rules.
- **Known follow-ups:** glass-waste's middle seat never wins; arcology-coast is mostly undecided at 40 cycles.
- Process: D-017 (private scratch space; the receipt is the last write). The lead reads every builder's screenshots, plants a regression in each change, and screenshots the integrated view before merging. Dev servers start with `setsid sh -c 'echo $$ > pidfile; exec pnpm dev ...'`, so the pidfile holds the real process group.
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers

Items 1 and 2 under *Decisions waiting*: the repository is public (D-003), and its default branch is not `main`.

## Next actions (none need the platform)

1. Verify and merge A1.
2. G14, then G17, then G18 (D-022, D-023).
3. A frozen-clock "beauty pass" of the integrated game at 1280 and 390; fix what reads cheap.
4. The agent API module: one entry point re-exporting the engine, observe, viewEvents, legal, replay and Doctrine, ready for the MCP tools.
5. When D-003 clears: M2 platform fork, then the MCP server over the agent API.
