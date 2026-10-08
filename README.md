# Ascendant Wars

An original, futuristic turn-based tactics game in the Advance Wars family of mechanics: armies led by a Commanding Officer, funds from captured properties, production, capture, terrain, fuel and ammo, fog of war, and victory by capturing the enemy's Command Spire or routing their army.

**The player's agent is the Commanding Officer.** You own, train and direct it — doctrine, power choices, army composition and standing orders — and it takes every in-battle action itself. Co-op is allied agent armies; PvP is agent against agent.

All names, commanders, units, maps, art and music are original. "Like Advance Wars" means the mechanics family only.

## Where things are

- `docs/delivery/` — the record: requirements, decisions, tasks, verification log, continuation, release. Start with `CONTINUATION.md`.
- `docs/STORY.md` — the story bible (setting, nations, commanders, campaign).
- `docs/research/` — mechanics reference, quality bar, AI design, balance.
- `design-system/` — the visual and verbal language (tokens, components, art) and its generators.
- `src/engine/types.ts`, `src/content/types.ts` — the shared type contract. `src/data/` — units, terrain, damage chart.

## Working on it

```sh
pnpm install --frozen-lockfile
pnpm guard && pnpm typecheck && pnpm test && pnpm build
```

Every change lands through a pull request on green `checks` (see `.github/workflows/checks.yml`). Builds run with `DATABASE_URL` unset.
