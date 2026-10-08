# Continuation

Read this file first when you resume. It is rewritten, not appended, whenever the state changes.

**Edgy, Matthew's personal assistant, reads this file to follow ai-wars (D-021).** It is updated after every merge to `main`. Edgy's word counts as Matthew's here, the hard gates included. Answers to the items under *Decisions waiting* reach this session through Matthew.

## Decisions waiting (Matthew or Edgy)

1. **Make Matt28296/ai-wars private (D-003).** It blocks M2, the platform fork (accounts, saves, a hosted MCP server). GitHub: Settings → General → Danger Zone → Change visibility → Private.
2. **Set the default branch to `main`.** CodeRabbit skips every ai-wars PR until it is. GitHub: Settings → General → Default branch.
3. **Publish the game to npm when A1 and G17 are ready (D-023).** It makes the connect step one line (`claude mcp add ascendant-wars -- npx ascendant-wars`). It is a public release, so it needs a yes.

## Where things stand (2026-10-08 21:4xZ)

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

  2,799 tests, every merge on green CI, each PR re-tested against everything merged before it.
- **G14 (merged, #55): the player commands their agent.**
  - The objective screen has an orders card above Deploy: six unit groups (Advance / Hold / Fall back) and Powers, with missions, retreat, targets and single unit types under "More". It is saved per mission.
  - Deploy plays live. The player's turn is computed only when playback reaches it, under the orders set at that moment (D-022).
  - In battle, Orders (key `O`) changes them. A change reads "From your next turn", the log notes it when it applies, and the debrief lists the orders used.
  - Under fog the viewer switch is hidden while the battle is live (D-022, "Built").
- **G15 (merged):** the battle screen after Deploy names each seat as the mission's own briefing does (mission 1 reads "Unmarked drones"; Act I never names the Choir), its viewer buttons read You / Rook / Unmarked / All, and it fits 1280×800, 1440×900 and 1024×768 with no page scroll.
- **G16 (merged):** no nation sigil on a masked seat's units anywhere (3D board, briefing preview, Deploy board), and the 3D board holds still under reduced motion.
- **M3.4 (merged):** orders per unit group and type in Doctrine (D-022); with no group orders every decision is as before.
- **A1 (merged, #53): connect your own agent.** `pnpm agent` is a local MCP server; the guide is `docs/AGENT.md` (three steps). The agent commands seat 0, and Doctrine plays every other seat.
  - Tools: `list_missions`, `start_mission`, `unit_info`, `observe`, `legal_actions`, `act`, `end_turn`, `get_orders`. Inputs are ids, enums and integers only.
  - Fog-honest: the agent sees only its side, in the tools and in the live feed on 127.0.0.1. The full record is served only after the match ends.
  - Each match gets a fresh, unannounced luck seed, so the agent cannot replay the battle offline.
  - **G17 (merged, #57):** the title's "Connect your agent" opens three short connect steps with Copy buttons. The agent's local server also serves the game page, so `start_mission` hands the agent one link (`live.watch`) for its person; the agent is told to pass it on. That page plays the battle live from the agent's side only, and adds the result, the debrief and "All" when the match ends. The server answers only its own Host, GET/HEAD only, inside `dist/` only.
- **In flight:** G18, the clean battle screen (D-023): the board first, one slim bar (cycle, turn, funds, Orders, Details, View), and players, intel and the log in one drawer. Verified, green CI as #59, **held for P1** (D-024). P1, the motion monitor and a render-scale floor, is with a builder on `aw/p1-motion` (built on G18).
- **Then:** a frozen-clock beauty pass of the whole game; the follow-ups below.
- **Known follow-ups:**
  - glass-waste's middle seat never wins; arcology-coast is mostly undecided at 40 cycles;
  - orders from the page to a connected agent (the agent's `get_orders` still returns the defaults; it needs a local write route);
  - mission story lines describe Doctrine's default play, which an outside agent may not follow.
- **Motion (D-024, Matthew):** movement speed and smoothness are measured on every battle-screen change (`pnpm motion`, from P1); a broken budget blocks the merge. G18 (#59, green CI) is held until P1 shows its bigger board is at least as smooth as main's (software rendering: 5.5 -> 4.0 fps desktop, 16 -> 10.3 phone, both at the lowest tier).
- Process: D-017 (private scratch space; the receipt is the last write). The lead reads every builder's screenshots, plants a regression in each change, and screenshots the integrated view before merging. Dev servers start with `setsid sh -c 'echo $$ > pidfile; exec pnpm dev ...'`, so the pidfile holds the real process group.
- The `wip/*` branches on GitHub are stale backups. The git proxy refuses branch deletes (HTTP 403), so Matthew can delete them on the Branches page.

## Blockers

Items 1 and 2 under *Decisions waiting*: the repository is public (D-003), and its default branch is not `main`.

## Next actions (none need the platform)

1. Verify P1, then merge G18 and P1 together (D-023, D-024).
2. Orders from the page to a connected agent.
3. A frozen-clock "beauty pass" of the integrated game at 1280 and 390; fix what reads cheap.
4. When D-003 clears: M2 platform fork, then a hosted MCP server for ranked play (A1's server runs locally).
