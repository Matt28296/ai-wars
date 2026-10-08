# Decision log

Every decision that shapes Ascendant Wars, newest last. Each says what was decided, why, what it costs, and whether it is reversible. A ruling by Matthew is quoted word for word. Status words: **RULED** (Matthew), **DECIDED** (the lead, reversible, overturned by Matthew's word), **PROPOSED** (waiting).

### D-001: Ascendant Wars is a fork of Blacklink with an Advance Wars-family layer (2026-10-08, RULED)
- **Matthew, verbatim (the direction):** *"copy Blacklink, but make Ascendant Wars play like Advance Wars instead of Fire Emblem."* … *"BASE: fork the current Blacklink game, repo Matt28296/charm-branch-dream-ever, main @ 237860c (read-only source; never push there). Bring over its stack (TanStack Start + React + Vite + TS, Tailwind/Radix, kysely/pg with pglite locally, better-auth, Node 22), its agent layer (the game's MCP server: agent management, orders, mission entry, observation, actions, replay), persistence, accounts, tests, CI (.github/workflows/checks.yml), and its docs/delivery records … into Matt28296/ai-wars."*
- **Measured (2026-10-08 04:5xZ):** `charm@237860c` is Vinext 1.0-beta (Next 16 API on Vite 8) + Drizzle on Cloudflare D1 with ChatGPT Sites sign-in; it holds the agent layer (`src/game/agent/*`, `app/mcp`, `lib/game-service.ts`, `lib/spectator/*`), `checks.yml` and the `docs/delivery` set. The named stack (TanStack Start, kysely/pg + pglite, better-auth) is the shell in `Matt28296/blacklink@f7d9044`, which charm's own D-001 dropped.
- **Decided (Matthew approved the lead's default (a), verbatim: *"You have approval please proceed"*):** take charm@237860c's game service, agent layer, MCP tools, replay, tests, CI and delivery conventions, and run them on blacklink@f7d9044's TanStack Start + Tailwind/Radix + kysely/pg (pglite locally) + better-auth shell. Neither source repo is ever written.
- **Not taken:** Blacklink's Fire Emblem layer (`src/game/banner`, its art and rigs), its manual-combat routes, Soft Yeti/wallet/link code (until D-008's condition), ChatGPT Sites hosting and its project id, Grok platform files, and PR #2 of charm (see D-009).
- **Reversible:** the shell choice is cheap until the platform milestone (M2) lands, expensive after.

### D-002: one `main`, short-lived `aw/<task>` branches, merge only on real CI (2026-10-08, RULED)
- **Matthew, verbatim:** *"one worktree per writer, never two writers in one checkout; Sonnet on every builder, at most 5 in parallel; merge only on real CI; DATABASE_URL unset for builds"*; and on the lead's ask to create `main` and `aw/<task>` branches and merge PRs on green: *"You have approval please proceed"*.
- **Decided:** `main` is the record. Every change is a PR from `aw/<task>`, merged by the lead only when `checks` is green on the PR's head, with the gate output quoted in the PR, after re-reading that `main` has not moved since the PR was tested. No force-push to `main`; a bad merge is undone by a revert PR.
- **The session branch** `claude/futuristic-advanced-wars-game-rt8yq6` keeps the pre-fork history and the stopped workers' salvage (`fa1789f`); it is input, not the record.
- **Reversible:** yes.

### D-003: no Blacklink code enters while ai-wars is public (2026-10-08, RULED)
- **Measured (2026-10-08 04:5xZ and again 05:0xZ, GitHub API):** `Matt28296/ai-wars` visibility is **public**. Both Blacklink repos are private.
- **Matthew, verbatim:** *"$0: no paid services, keys or plans, and no public deploy or visibility change, without my yes."* Importing private Blacklink code into a public repo publishes it. The lead's default (a), approved (*"You have approval please proceed"*): Matthew switches ai-wars to private himself; until the API reads `private`, only original code lands here.
- **Also measured:** everything already pushed (design-system source, story bible, contract, research, salvage) is public now.
- **Reversible:** making a repo private is; publishing code is not.

### D-004: the CO agent's in-battle brain is Doctrine (local rules) (2026-10-08, DECIDED)
- **Decided:** the player's agent decides every in-battle action with a deterministic rules engine ("Doctrine (local rules)"), shaped by what the human set: doctrine, power choices, army composition and standing orders. It is labelled as rules, never as AI. Our server makes no model call, so it costs $0 and has no prompt for player text to leak into. A player's own agent client may act through the MCP tools instead; its choices pass the same legality check.
- **Why:** Matthew: *"the agent takes every in-battle action itself. No manual unit control in the normal product."* and *"$0"*.
- **Reversible:** yes; a model-backed brain needs Matthew's yes (cost, data).

### D-005: standing orders are structured, never free text (2026-10-08, DECIDED)
- **Decided:** orders are chosen from fixed options and numbers (posture, objectives, retreat threshold, power policy, composition weights, target priorities). No free-text field reaches the engine or any prompt.
- **Why:** Matthew: *"never put player free text into a model prompt"*. Blacklink found player text reaching its provider prompt (its D-007/D-013, B-AI.1); here the input shape makes it impossible, and a code test will plant a marker to prove it once any prompt exists.
- **Reversible:** yes.

### D-006: when an order change takes effect (2026-10-08, DECIDED)
- **Decided:** solo and co-op: at the agent's next decision; the pending decision keeps its legal list. PvP: orders lock at match entry; withdrawing is a forfeit. Mirrors Blacklink's D-005 so an order change can't become a disguised move command.
- **Reversible:** yes, until implemented.

### D-007: the player's agent is an adjutant AI commander; the named cast are NPC commanders (2026-10-08, DECIDED)
- **Decided:** in the story, each player's agent is a newly commissioned adjutant AI on the Meridian Link. The eleven named commanders in `docs/STORY.md` are NPC commanders (allies, rivals, enemies) run by Doctrine. ECHO stays Helion's adjutant and the tutorial voice. "Ren Okafor" is renamed **Rook Okafor**, so he is never confused with Blacklink's Ren.
- **Reversible:** yes.

### D-008: Soft Yeti is later and testnet only (2026-10-08, RULED)
- **Matthew, verbatim:** *"Soft Yeti stays testnet only, no real value. Reuse Blacklink's adapter later, after Blacklink's live link is proven."*
- **Decided:** no Soft Yeti, wallet or chain code in ai-wars until Blacklink's live link is measured working. No real value, ever, without Matthew's word.

### D-009: charm PR #2 stays untouched (2026-10-08, RULED by standing rule)
- **Measured (charm `docs/delivery/DECISIONS.md` D-013 @ 237860c):** Blacklink's orchestrator was refused by a safety classifier on merging PR #2 and on a read-only view of it; it waits for Matthew's word.
- **Matthew, verbatim:** *"a safety refusal is posted word for word and never retried another way."* ai-wars does not read, copy or depend on that branch in any form. It is not needed: our engine replaces the layer it carries.

### D-010: package manager and supply-chain hygiene (2026-10-08, DECIDED)
- **Decided:** pnpm 10.28 pinned through `packageManager`; `minimumReleaseAge: 10080` (a version must be a week old) and an install-script allow-list in `pnpm-workspace.yaml`; CI installs with `--frozen-lockfile`.
- **Reversible:** yes.

### D-011: the parallel writers were stopped; their output is salvage (2026-10-08, DECIDED)
- **What happened:** before the direction, six writers (engine, content, art, audio, battle UI, shell UI) shared one checkout on the inherited model. They were stopped on the direction (one worktree per writer, Sonnet builders). The research writer finished its docs (`docs/research/*`).
- **Decided:** their partial files are input for builders, reviewed like any other code, never counted as done. The manual-control battle UI is not reused as a control surface; its renderer may be reused for watching.

### D-012: the rules spec is `docs/research/mechanics.md`; its seven open points ruled (2026-10-08, DECIDED)
- **Decided:** where `docs/research/mechanics.md` and the older `docs/ARCHITECTURE.md` summary differ, `mechanics.md` wins. Its §16 points:
  1. Charge drain is per unit type (`drain` in the unit data): Wasp 2, Raptor 5, Anvil 5, Picket/Dreadnought/Barge 1; ground units 0.
  2. Foot and exo units on a ridge get **+3** vision.
  3. Units resupplied at the start of a turn skip that turn's drain.
  4. Rout is event-driven: a player is routed when their last unit is destroyed (or at the end of their turn with no units after they have had units), never just because they started with none.
  5. Overclock's star cost is the full bar (small + large stars).
  6. Repair is +2 display HP for 10% of the unit's cost per HP; when funds are short, it repairs 1 HP if that is affordable.
  7. Treads and walkers keep paying **2** on shoals — an intentional twist (sand is hover terrain). This differs from the GBA games on purpose.
- **Reversible:** yes; each is one rule in one module.

### D-013: a turn limit is a head-to-head day limit; campaign deadlines get their own field (2026-10-08, DECIDED)
- **Decided:** `GameState.turnLimit` means a versus-style day limit (mechanics.md §13): when it ends, the team with the most properties wins, then the most unit value (cost × display HP), then the team that moves later. A campaign "win within N cycles or fail" condition is a different rule and gets an explicit deadline field on the mission objective in M1.6, so the two can never be confused from state alone.
- **Why:** the salvage made any turn limit an automatic loss for player 0, which is wrong for versus play; the M1.5 builder found the ambiguity and asked.
- **Reversible:** yes.

### D-014: activating a power empties the whole meter (2026-10-08, DECIDED)
- **Decided:** Surge and Overclock both reset the meter to 0; leftover charge does not carry over. This keeps the choice real: spend on Surge now, or save the whole bar for Overclock. (mechanics.md §10.2 describes a carry-over variant; this is the deliberate exception.)
- **Reversible:** yes; one line in `activatePower` (`pl.power -= cost`).

### D-015: five rules the M1 integration needs (2026-10-08, DECIDED)
- **Decided:**
  1. Charge is spent **per tile moved**, not per movement-cost point: a unit that crosses three canopy tiles spends 3 charge, the same as over three road tiles. This is the GBA behaviour and is what `applyMove` already does.
  2. Ion storm: every unit sees 1 tile less (floor 1) and **air units move 1 tile less** (floor 1). The "+1 cost per tile for air" variant in `mechanics.md` §15 is not used: a flat −1 is easier to read on the map.
  3. **50 units per player** on the map (cargo counts). At the cap the build is illegal and the build menu greys it out. The figure is unverified against the originals (`mechanics.md` §17); it is our rule either way.
  4. A transport that is **carrying cargo cannot board another transport**. A Mule with a trooper inside cannot load into a Barge. Destroying a transport still destroys everything inside it, nested or not, as a defence.
  5. If the player whose turn is starting loses their last unit during turn start (crash or sink), they are defeated at once. Play passes straight to the next undefeated player, and victory is checked after every turn-start loss. This holds in games of 3 or more players too.
- **Reversible:** yes; each is one rule in one module.

### D-016: under fog, the agent only ever sees what its player can see (2026-10-08, DECIDED)
- **Found by M1.6b:** `legalActions` reads the true state. Attack targets are already limited to visible enemies (M1.6a). But a tile holding a hidden enemy has no follow-up options, so it is missing from the list of places to stop, and that absence tells a fogged player something is there.
- **Decided, for M3:**
  1. The agent (the Doctrine brain and any MCP client) receives a fog-filtered observation, never the raw state.
  2. Its action list comes from a fog-honest wrapper over `legalActions`.
  3. A move whose destination holds a hidden enemy is accepted and resolves as an ambush on the tile before it, as a move through one already does. That is an engine change in M3.0, with its own tests.
  4. A test plants a hidden enemy and checks that the fogged player's observation and action list are identical with and without it.
- **Reversible:** yes, until the MCP tools ship.

### D-017: builders keep private scratch space, and the receipt is the last write (2026-10-08, DECIDED)
- **What happened:**
  - Two builders running in parallel each wrote a scratch script named `mutate.py` to the shared scratchpad root. One of them later ran the other's copy, which mutated and then restored the Act II mission files in a third worktree.
  - The lead committed during that window. The commit captured one planted mutation ("Nine are unclaimed"). The test suite caught it, the lead folded the restored content into the unpushed commit, and only the true content was merged.
  - Checked afterwards: `main`'s `missions.ts` and `mission-maps.ts` equal the builder's pre-mutation backups exactly.
- **Decided** (in `.claude/agents/builder.md`):
  - each builder keeps scratch files only in a private folder named after its order;
  - a builder never runs a script it did not write for that order;
  - a builder checks `git status`/`git diff --stat` against TOUCHES before its receipt;
  - the receipt is its last action.
  - The lead commits a builder's work only after the builder's completion notice arrives and the files have stopped changing.
- **Reversible:** yes.
