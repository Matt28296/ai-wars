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

### D-018: the battlefield is a lit 3D diorama rendered with three.js; the SVG board stays as a fallback (2026-10-08, DECIDED)
- **Matthew, verbatim:** *"use whatever workflows, skills, tools, prompts, plugins or connectors needed to refactor and optimize the graphics to be might higher end"*.
- **Decided:**
  - The battlefield moves to a real-time 3D "tactical diorama": `three` 0.186.1, MIT, $0, pinned exactly, with `@types/three` 0.186.0. Both releases are older than the one-week release-age rule (D-010).
  - The HUD, event log, controls and cut-in stay React/DOM.
  - The 3D board is a drop-in for the SVG `Stage`. It consumes the same timeline and transition plan, so replay, fog honesty (D-016) and scrubbing are unchanged.
  - The SVG board stays as the fallback (no WebGL2, or `?renderer=2d`).
- **Art:** `docs/research/art-direction.md`, which sets readability first and keeps everything original and procedural. There is no image model in this environment, and no image-generation connector is available.
- **Parallel build:**
  - `src/ui/board3d/contract.ts` fixes the module interfaces;
  - placeholder modules let the renderer core start at once;
  - terrain, units and effects are separate builders in separate folders.
- **Checked by:** node tests, plus headless Chromium (SwiftShader WebGL2, confirmed working in this environment) screenshots read by the builder and the lead.
- **Reversible:** yes; the SVG board remains, and the 3D board sits behind one switch.

### D-019: the first mover collects no income on turn one, and Doctrine presses when clearly ahead (2026-10-08, DECIDED)
- **Measured problem (M3.1, hash `f1a42064b9ecdc72`):** in Doctrine-vs-Doctrine mirrored games the first mover won most duels (calder 17–3, tether 12–4, canopy 9–7). Big maps stalled: saltglass 14 of 20 undecided, arcology-coast 16 of 20.
- **Decided:**
  1. `createGame` takes `firstMoverRule: 'none' | 'noFirstIncome' | 'secondBonus'`; the default is **`noFirstIncome`** (player 0 collects no income at the start of its first turn).
     - Measured with the M3.1 Doctrine, 30 mirrored games per map, cap 40 cycles (hash `b3b2697776c3d469`), side-0 share of decided games: `none` 86/76/61% (calder/tether/canopy, mean 74%); `noFirstIncome` 57/44/77% (mean 59%); `secondBonus` 73/71/64% (mean 69%).
     - Re-checked with the final Doctrine, 20 games (hash `de6f2ff473a24ec2`), calder/tether/canopy/saltglass: `none` 90/74/56/100; `secondBonus` 60/76/59/67; `noFirstIncome` 53/44/75/90. Over all four maps the two rules tie at 65.5%; over the three duel maps `noFirstIncome` is better (57% vs 65%), so it stands.
  2. **Campaign missions use `'none'`.** Their balance is authored per mission (start funds, positions, objectives), so whatever builds a mission's `CreateGameOptions` passes `firstMoverRule: 'none'`; `missions.test.ts` does. The default applies to skirmish, where maps are symmetric. **A recorded match must carry its rule:** a setup that omits `firstMoverRule` replays under the current default, so a match recorded before this change replays differently. The watch view's demo now passes `'none'` explicitly; the replay format (M3.3) stores the rule with the setup.
  3. **Doctrine pressure.** When its team's visible army value is at least 1.6× the strongest single enemy player's (and at least 6,000), never under fog or an ion storm, or when it nears the 50-unit cap (≥ 48), Doctrine plays Advance whatever the orders say: capturers go for the enemy spire with an armed escort within 2 tiles, attacks that clear the spire score higher, and building stops at 36 units. The 1.6 is the low end of a plateau: the first time a side reached a ratio r, it went on to win 79% (1.2), 86% (1.4), 88% (1.5, 1.6) and 90% (1.8, 2.0) of 42 decided games.
  4. `forecast` gives no damage and no counter for a target out of range or with no usable weapon (the same answer as an unseen target). Under fog an enemy transport's cargo is hidden: `cargo: []` and a `loaded` flag (D-016's rule, extended to cargo).
- **Result** (`pnpm balance --games 20`, default rule, cap 40, hash `de6f2ff473a24ec2`; side-0 share of decided games, undecided):

  | map | wins by seat | side-0 share | undecided | target |
  |---|---|---|---|---|
  | calder-fields | 10 / 9 | 53% | 1 (5%) | met |
  | tether-ridges | 8 / 10 | 44% | 2 (10%) | met |
  | canopy-highlands | 15 / 5 | 75% | 0 | share missed (+10) |
  | saltglass-bay | 9 / 1 | 90% | 10 (50%) | both missed |
  | glass-waste (3p) | 0 / 4 / 9 | n/a | 7 (35%) | undecided missed (+10) |
  | arcology-coast (4p) | 0 / 2 / 6 / 2 | n/a | 10 (50%) | undecided missed (+25) |

  Targets were 35–65% side-0 share on 2-player maps and ≤ 25% undecided. Undecided games fell from 14 to 10 on saltglass and from 16 to 10 on arcology-coast. Two of six maps are fully on target.
- **Open (M3.3):**
  - saltglass's only land route is a ~40-tile march along the north shore, so pressure starts at cycle 20–31 and needs 10–15 more cycles; that is a map problem as much as a brain problem;
  - in 3- and 4-player games no single side gets 1.6× the strongest enemy, the 48-unit cap never fires (units peak at 40), and `noFirstIncome` over-penalises seat 0 there (it won 0 of 23 decided games): the rule should apply to 2-player games only, or scale by seat;
  - canopy and saltglass keep a seat bias under all three rules.
- **Reversible:** yes; the rule is one option with a default, and pressure is one function in `eval.ts`.

### D-020: the first-mover rule depends on the seat count, Doctrine counts a lead over the whole field, and two maps change (2026-10-08, DECIDED)
- **Measured problem (D-019's open items):**
  - In 3- and 4-player games, `noFirstIncome` over-penalised seat 0.
  - No single side ever reached 1.6× the strongest enemy, so Doctrine never pressed.
  - Saltglass's only land route was a ~40-tile march.
  - Canopy kept a seat bias under every rule.
- **Decided:**
  1. **The default rule depends on the player count** (`defaultFirstMoverRule(n)`):
     - two players keep `noFirstIncome`;
     - three or more get the new `'gradedFirstIncome'`, where player 0 collects (n − 2)/(n − 1) of its first income, rounded to 100: half with three players, two thirds with four.
     - An explicit option still wins, and campaign missions keep passing `'none'`.
     - Evidence is weak and stated as such. Arcology seat-0 share of decided games over three seed sets, where 25% is fair: `none` 35% (9/26), graded 27% (9/33), `noFirstIncome` 19% (6/31).
     - It is seat 0 only. Scaling every seat k by k/(n − 1) would need later seats' start of turn in `turn.ts` and a state field.
  2. **A recorded match carries its rule.**
     - `resolvedSetup(setup)` writes the rule a game is played under into its setup, and `recordMatch` keeps that form, so a record replays the same after the default moves (as it just did for 3+ players).
     - This keeps D-019's promise. Tests: `balance-rules.test.ts` and `timeline.test.ts`; a no-op `resolvedSetup` fails both.
  3. **Pressure over the field:**
     - With two or more enemy players in view, Doctrine also counts as "ahead" when its army is worth at least 1.4× the strongest enemy's AND at least half of all the enemies' together (`FIELD_LEAD_RATIO`, `FIELD_SHARE`).
     - Two-player games are unchanged.
     - No measured gain (glass-waste undecided 15 → 13 of 50; arcology 13 → 13 of 20). It stays on because it is principled and costs nothing, and one constant turns it off.
  4. **Maps:**
     - **saltglass-bay** gets a two-wide causeway on its south edge (23 steps between the spires instead of 33), and two islet arcologies in the north bay so the bay still has four Barge-only properties. Start funds go 2000 → 1000.
     - **canopy-highlands** start funds go 2000 → 4000. At 2000, seat 0 won 85% and 75% of decided games on two seed sets; at 4000, 57% and 51%. The response to funds is not monotone, and 2000 was the outlier.
     - Each change's measurements are in the comments in `maps.ts`.
- **Result** (`pnpm balance --games 20`, seeds 1000–1019, default rule per seat count, cap 40, hash `2d06826137613104`; reproduced exactly by the lead from the builder's tree):

  | map | wins by seat | side-0 share | undecided | target |
  |---|---|---|---|---|
  | calder-fields | 10 / 9 | 53% | 1 (5%) | met |
  | tether-ridges | 8 / 10 | 44% | 2 (10%) | met |
  | canopy-highlands | 5 / 14 | 26% | 1 (5%) | undecided met; share missed (−9) |
  | saltglass-bay | 5 / 12 | 29% | 3 (15%) | undecided met; share missed (−6) |
  | glass-waste (3p) | 0 / 3 / 8 | n/a | 9 (45%) | missed |
  | arcology-coast (4p) | 2 / 1 / 1 / 0 | n/a | 16 (80%) | missed |

  Held-out seeds 8000–8029 (30 games, same hash), side-0 share and undecided:
  - calder 47% / 0%;
  - tether 59% / 10%;
  - canopy 59% / 3%;
  - saltglass 54% / 20%.

  On the merged head (the lead's `resolvedSetup` commit and main through G12, hash `83494c9c4e38b47a`), calder and canopy re-run to the same rows: no game changed.

  All four 2-player maps are in the band on held-out seeds. Pooled over 50 games, saltglass is at 44% (18 of 41 decided) and canopy at 46% (22 of 48). The standard error of a 20-game share is about 11 points, so the two misses on seeds 1000–1019 are probably noise, not proven bias.
- **Open:**
  - **glass-waste:** the axis player (seat 0) won 0 games in about 25 runs of 20–30 games.
    - Seat-permuted runs show the cause is the position, not the seat or the rule.
    - Players 1 and 2 attack it two to three times as often as each other.
    - Five map fixes failed. Unconfirmed lead: removing the x=12 road gave it 1 win in 14.
  - **arcology-coast:** 80% undecided. Its decided games end at a mean of about 38 of 40 cycles, after three eliminations in a row, and start funds of 0–8000 changed nothing. Meeting its 25% target needs a smaller map or a longer cap.
- **Reversible:** yes. The rule is one option with a per-count default, pressure is two constants, and each map change is in one table.

### D-021: Edgy speaks for Matthew on ai-wars, and follows it through CONTINUATION.md (2026-10-08, RULED)
- **Matthew, in this session (13:5xZ):** Edgy is *"my personal assistant agent, the top agent of the network"*. Asked how this session and Edgy should stay in touch, he chose "Edgy reads our status file"; asked whether Edgy's word counts as his for ai-wars, he chose **"Yes, fully"**.
- **Decided:**
  1. **Channel:** Edgy follows ai-wars through `docs/delivery/CONTINUATION.md` on `main`. The lead updates it after every merge, and its *Decisions waiting* section lists what needs a call.
  2. **Authority:** an instruction from Edgy for ai-wars counts as Matthew's, the hard gates included: money, repository visibility, public deploys and paid services.
  3. **How Edgy's answers arrive:** through Matthew, pasted into this session. This session is not a fleet seat: its machine (`vm`) is not in jclaw-coord's identity table, so it does not write the bus. It reads Edgy's lane only when Matthew asks it to.
- **Reversible:** yes. A two-way lane on the bus would need the head to add a route and an identity row for this session.

### D-022: orders per unit group, types on demand, changeable during the battle from the player's next turn (2026-10-08, RULED)
- **Matthew, in this session (14:4xZ–15:0xZ):**
  - *"We need more specific control over the various types of units in the game."*
  - On the orders screen he chose six groups, with each unit type available on demand.
  - On timing he asked *"Does each player move all of their units before the other player moves their units?"* (yes: each player's agent acts with all of its units on its own turn, then the next player's turn begins; a cycle is one round of every player's turn). He then said *"It doesn't matter if the agent will only act during their own turn, correct?"* (correct: the timing only matters for a change made during the player's own turn).
- **Decided:**
  1. **Granularity:** orders by group: Infantry, Armour, Artillery, Air, Navy, Transports. Each group has a posture, a mission from its own fixed list, a retreat HP and a target priority. A group can be expanded to give one unit type its own orders. The engine half is M3.4.
  2. **Timing:**
     - The battle plays live, and the player can change orders at any time while watching.
     - A change takes effect when the player's next turn starts, so each of the player's turns runs under one set of orders.
     - The player's turn N is computed only when playback reaches its start, with the orders in force at that moment. Other players' turns may be computed ahead.
     - Every order change is written into the match record, so a replay stays exact (the D-019 principle).
  3. **Head-to-head (PvP)** keeps D-006: orders lock at match entry.
- **Reversible:** yes, until G14 ships.
