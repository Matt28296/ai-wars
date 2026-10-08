# Requirements matrix

One row per requirement. Sources: Matthew's direction of 2026-10-08 (quoted in `DECISIONS.md` D-001…D-003, D-008) and the decisions that follow from it.

**Status words:** `open` (not started) · `blocked` (waits on a named outside action) · `in progress` · `built` (code exists and its own tests pass; NOT proof) · `verified` (an entry in `VERIFICATION-LOG.md` shows it working on the real path). A mock, a fixture or a green build is never `verified` for a live path.

| # | Requirement | Source | Milestone | Status | Evidence |
|---|---|---|---|---|---|
| R01 | Fork charm@237860c's game service, agent layer, MCP tools, replay, tests, CI and delivery conventions into ai-wars; never write a source repo | D-001 | M2 | blocked (D-003: repo is public) | — |
| R02 | Stack: TanStack Start + React + Vite + TS, Tailwind/Radix, kysely/pg with pglite locally, better-auth, Node 22 | D-001 | M2 | blocked (D-003) | — |
| R03 | MCP: agent management (create, train, inspect the CO agent) | D-001 | M3 | open | — |
| R04 | MCP: orders (structured standing orders, D-005) | D-001, D-005 | M3 | open | — |
| R05 | MCP: mission entry (campaign, skirmish, co-op, PvP) | D-001 | M3 | open | — |
| R06 | MCP: observation (fog-aware: only what the agent's army can see) | D-001 | M3 | open | — |
| R07 | MCP: actions (only server-listed legal actions; anything else rejected with a reason) | D-001 | M3 | open | — |
| R08 | MCP: replay (any finished battle replays exactly from seed + actions) | D-001 | M3 | open | — |
| R09 | Persistence: kysely over pg, pglite locally; migrations are named steps in their own PR, never a build side effect | D-001 | M2 | blocked (D-003) | — |
| R10 | Accounts: better-auth; each agent and its records belong to one account | D-001 | M2 | blocked (D-003) | — |
| R11 | CI (`checks.yml`) on every PR: frozen install, guard, typecheck, tests, build with DATABASE_URL unset, build carries its sha | D-001, D-002 | M0 | verified | VERIFICATION-LOG 2026-10-08 05:12 (PR #1) |
| R12 | Delivery records kept current: REQUIREMENTS, TASKS, DECISIONS, VERIFICATION-LOG, CONTINUATION, RELEASE | D-001 | M0 | in progress | — |
| R13 | No Fire Emblem layer: no named player cast, weapon triangle, growth rates, class promotions or permadeath | Direction §2 | M2 | open | — |
| R14 | Armies led by a Commanding Officer with a passive and a charged power (Surge / Overclock) | Direction §2 | M1 | in progress | — |
| R15 | Funds from captured properties, paid at turn start | Direction §2 | M1 | in progress | — |
| R16 | Unit production at Fabricators, Skyports and Docks (ground / air / sea) | Direction §2 | M1 | in progress | — |
| R17 | Capture by infantry (Trooper, Breacher) by display HP against 20 points | Direction §2 | M1 | in progress | — |
| R18 | Terrain defense stars and movement costs by movement type | Direction §2 | M1 | in progress | — |
| R19 | Charge (fuel) and ammo, with air crash and naval sink at 0 charge | Direction §2 | M1 | in progress | — |
| R20 | Unit-vs-unit damage table (`src/data/damage.ts`) used by the damage formula | Direction §2 | M1 | built (table + integrity tests) | `src/data/data.test.ts` |
| R21 | Fog of war (vision, hiding terrain, ambush) | Direction §2 | M1 | in progress | — |
| R22 | Win by Command Spire (HQ) capture or rout | Direction §2 | M1 | in progress | — |
| R23 | The player's agent is the CO; the human owns, trains and directs it (doctrine, power choices, army composition, standing orders) | Direction §3 | M3 | open | — |
| R24 | The agent takes every in-battle action; no manual unit control in the normal product (CI guard) | Direction §3 | M0 guard, M4 | in progress | `scripts/guard.test.mjs` |
| R25 | Co-op = allied agent armies | Direction §3 | M6 | open | — |
| R26 | PvP = agent vs agent | Direction §3 | M6 | open | — |
| R27 | All original: no Nintendo names, COs, sprites, maps or music (CI denylist) | Direction §4 | M0 guard | in progress | `scripts/guard.test.mjs` |
| R28 | The design system, story bible and type contract are the Ascendant Wars identity in the fork | Direction §4 | M0–M2 | in progress | `design-system/`, `docs/STORY.md`, `src/game/aw/types.ts` |
| R29 | Soft Yeti testnet only, no real value; adapter reused only after Blacklink's live link is proven | D-008 | later | open | — |
| R30 | One worktree per writer; Sonnet builders, at most 5 in parallel; merge only on real CI | D-002 | all | in progress | — |
| R31 | No player free text in any model prompt (structured orders; planted-marker test once a prompt exists) | D-005 | M3 | open | — |
| R32 | A mock is never proof the live path works (VERIFICATION-LOG discipline) | Direction §6 | all | in progress | — |
| R33 | A safety refusal is posted word for word and never retried another way | Direction §6 | all | in progress | — |
| R34 | $0: no paid services, keys or plans; no public deploy or visibility change without Matthew's yes | Direction §7 | all | in progress | — |
| R35 | `/api/version` returns the running build's sha | D-001 | M2 | open (sha embed in M0) | — |
| R36 | Deterministic engine: seeded RNG, pure reducer, identical replays from seed + action list | D-001 | M1 | in progress | `src/game/aw/index.test.ts` (one seeded attack; full replay test in M1.6) |
| R37 | Seeded campaign and skirmish simulations run in CI and finish with the expected winner | D-001 | M1, M5 | open | — |
| R38 | Browser smoke tests on dev and production builds (Blacklink lacks this) | D-001 | M4 | open | — |
