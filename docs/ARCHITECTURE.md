# Ascendant Wars — Architecture

> **Superseded in part (2026-10-08).** Ascendant Wars is now a fork of Blacklink (see `docs/delivery/DECISIONS.md` D-001). The engine boundaries and rules below still hold and move to `src/game/aw` in M1. The app shell, the manual-control battle UI and the shell/story UI described here are replaced: the player's agent plays every battle, and the platform comes from the fork in M2.

Browser game: **Vite + React 18 + TypeScript**, no other runtime dependencies. Tests: **vitest** (`npm test`). Typecheck: `npm run typecheck`. Dev server: `npm run dev`.

## Sources of truth

| What | Where | Notes |
|---|---|---|
| Design tokens (colours, type, spacing, shadows) | `design-system/tools/tokens.src.mjs` | `npm run tokens` regenerates `src/styles/tokens.css` and the published design system. Never hand-edit generated files. |
| Base unit / terrain / faction data + vector art (glyphs, sigils, terrain tiles) | `design-system/tools/game.src.mjs` | Generated into `src/data/base.generated.ts`. |
| Damage chart | `src/data/damage.ts` | Hand-maintained (balance audit in `docs/research/balance.md`). |
| Contract types | `src/engine/types.ts`, `src/content/types.ts` | Shared by every module. Change only via the lead. |
| Story canon | `docs/STORY.md` | Characters, factions, campaign outline, writing rules. |
| Research | `docs/research/*.md` | Mechanics reference, quality bar, AI design, balance. |

Design system (the visual language this game is built on): `design-system/project/` — README, tokens, component guidelines. The game's UI must follow it: token names, type styles (`.title .headline .heading .label .body .body-sm .caption .stat .stat-sm` classes from `tokens.css`), chamfered panels, signal-cyan interface accent, faction colour + sigil (never colour alone), dark theme first.

## Modules and owners

```
src/
  engine/      rules: pure, deterministic, no DOM.            (engine worker)
  ai/          computer opponent, uses only the engine API.  (AI worker)
  content/     commanders, maps, campaign, dialogue.         (content worker)
  art/         SVG React components: portraits, sprites.     (art worker)
  audio/       WebAudio synth music + SFX, no asset files.   (audio worker)
  ui/          React screens, map renderer, animation.       (UI worker)
  data/        static data + damage chart.                   (lead / research)
  styles/      tokens.css (generated) + global css.          (lead / UI)
  main.tsx     mounts <App/> from ui/.                       (UI worker)
```

Rules for every worker:
- Stay inside your directory. If you need something from another module that doesn't exist yet, code against the API below and leave a `// TODO(integration):` note — don't create files in someone else's directory.
- No new npm dependencies without the lead.
- Do not `git commit` or `git push` — the lead integrates and commits.
- `npm run typecheck` and `npm test` must pass for your files before you report done.

## Engine API (`src/engine/index.ts`)

Pure functions over immutable `GameState` (return new objects; never mutate the input). Deterministic: all randomness comes from `state.rng` (mulberry32), so a game is replayable from its seed + action list.

```ts
// Setup
createGame(opts: {
  map: MapDef;                                  // from src/content/types.ts
  players: { faction: FactionId; commander: CommanderId; controller: 'human' | 'ai'; team: number; funds?: number; aiLevel?: 'cadet'|'officer'|'marshal' }[];
  fog?: boolean; weather?: Weather; objective?: Objective; turnLimit?: number;
  seed?: number; startFunds?: number; incomePerProperty?: number;
}): GameState                                  // runs the first player's start-of-turn (income etc.)

// Mutation (the only way state changes)
applyAction(state: GameState, action: Action): ApplyResult   // throws IllegalActionError if illegal
isLegal(state: GameState, action: Action): boolean

// Queries for UI and AI
unitAt(state, c: Coord): Unit | undefined
unitById(state, id: number): Unit | undefined
tileAt(state, c: Coord): Tile
terrainAt(state, c: Coord): TerrainType       // respects terrainOverrides
displayHp(hp: number): number                  // ceil(hp/10)
reachable(state, unitId): Map<string, { x: number; y: number; cost: number; path: Coord[] }>  // key `${x},${y}`; respects fog (you may path into unseen enemies — ambush)
attackTargets(state, unitId, from: Coord): Coord[]      // indirect units only when from == current position (unless a power allows)
attackRangeTiles(state, unitId): Coord[]                // threat preview: every tile the unit could hit this turn
thenOptions(state, unitId, dest: Coord): Then['kind'][] // what the command menu offers at dest, in display order: attack, capture, join, load, unload, supply, wait
unloadTargets(state, transportId, dest: Coord, cargoIndex: number): Coord[]
forecast(state, attackerId, from: Coord, target: Coord): { damage: [number, number]; counter: [number, number] | null } // % of 100, luck min–max
buildOptions(state, at: Coord): { type: UnitTypeId; cost: number; affordable: boolean }[]
visibility(state, player: PlayerIndex): boolean[][]     // [y][x]; all true when fog is off
canActivatePower(state, level: 'surge'|'overclock'): boolean
powerCost(state, player: PlayerIndex, level): number    // in meter points
powerStars(state, player): { filled: number; surge: number; overclock: number } // for the HUD meter (stars, fractional filled)
effectiveMove(state, unit), effectiveRange(state, unit), effectiveVision(state, unit)
incomeOf(state, player): number
propertyCount(state, player): number
scoreCard(state, player): { speed: number; power: number; technique: number; total: number; rank: 'S'|'A'|'B'|'C' } // results screen
```

Commanders are looked up from `src/content/commanders.ts` (`COMMANDERS: Record<string, CommanderDef>`); an unknown id behaves as a commander with no modifiers.

### Rules summary (full reference: `docs/research/mechanics.md`)
- Damage: `floor((B × ATK/100 + luck) × (attackerDisplayHp/10) × (200 − (DEF + terrainStars × defenderDisplayHp)) / 100)` where B is the chart value, ATK = 100 + firepower mods (+10 per uplink owned, +10 while any power is active), DEF = 100 + defense mods (+10 while a power is active), luck = integer in [luckMin, luckMax] (default 0–9) drawn from `state.rng`. Air units get no terrain stars. Damage is in internal HP (1–100).
- Counterattack: the defender strikes back at its post-damage HP if it survives, is direct (range [1,1]), and has a chart entry vs the attacker. Indirect units never counter and cannot move and fire in the same turn (unless a power allows).
- Capture: units with `captures` subtract their display HP from the tile's 20 points; at ≤ 0 the property changes owner and resets to 20. Moving off resets it. Capturing a player's spire defeats them.
- Turn start, in order: income (1000 per property by default, modified) → repair +2 HP on owned properties that build the unit's domain (spire/arcology repair ground units; skyport air; dock sea), paying 10% of unit cost per HP → resupply on those properties and next to Mules → charge drain (air −5, sea −1 per turn; at 0 air crash, sea sink) → power state cleared from last turn.
- Power meter: gains from damage dealt (in funds value of HP removed × 0.5) and taken (× 1.0); one star = 9000 meter points; star cost rises 20% per previous activation (cap +100%).
- Fog: vision from units (+1 for foot/exo on ridge) and owned properties (vision 0, tile only); canopy and ion storms hide units unless adjacent.
- Victory: rout (no units after cycle 1 and none being built), spire capture, or the mission objective.

## Content contracts (`src/content/`)

- `commanders.ts` — `export const COMMANDERS: Record<string, CommanderDef>` (all 11 from `docs/STORY.md`, with `playable` false for VESPER, Cantor and ECHO in versus mode by default — the campaign can still assign them).
- `maps.ts` — `export const MAPS: Record<string, MapDef>`; every row the same width; `owners` rows mirror `terrain` rows.
- `campaign.ts` — `export const ACTS: CampaignAct[]`, `export const MISSIONS: Record<string, Mission>`.
- `skirmish.ts` — `export const SKIRMISH_MAPS: string[]` (map ids for War Room / Versus).

## Art contract (`src/art/`)

- `Portrait.tsx` — `<Portrait commander={id} mood="neutral|happy|angry|grim|surprised|smug" size={96} />`: an SVG bust, original stylised vector art, faction-coloured via CSS variables.
- `UnitSprite.tsx` — `<UnitSprite type faction facing="left|right" size={48} frame={0|1} />` map sprite (idle 2-frame), and `<BattleSprite type faction facing size />` larger art for the battle cut-in.
- `TerrainTile.tsx` — `<TerrainTile terrain owner size frame />` (sea/river animate between 2–4 frames), `<BattleBackdrop terrain />` for the cut-in.
- All colours via `var(--token)`; no raster files.

## Audio contract (`src/audio/`)

- `audio.ts` — `export const audio = { init(): Promise<void>; sfx(name: SfxName): void; music(track: TrackName | null): void; setVolume(kind: 'music'|'sfx', v: number): void; muted: boolean }`.
- `SfxName`: `'cursor' | 'select' | 'cancel' | 'move' | 'menuOpen' | 'confirm' | 'error' | 'fire' | 'cannon' | 'laser' | 'missile' | 'explosion' | 'capture' | 'captured' | 'build' | 'powerReady' | 'surge' | 'overclock' | 'turnStart' | 'victory' | 'defeat' | 'text'`.
- `TrackName`: `'title' | 'map' | 'briefing' | 'helion' | 'tidewell' | 'verdant' | 'kestrel' | 'choir' | 'power' | 'victory' | 'defeat' | 'finale'`.
- Everything synthesised with WebAudio (no samples), started only after a user gesture.

## UI contract (`src/ui/`)

Two owners:
- **UI-battle worker:** `src/ui/kit/**` (TSX ports of the design-system components: Frame, Button, CommandMenu, BuildMenu, StatusChip, Sigil, UnitCard, TerrainCard, BattleForecast, PowerMeter, PlayerHud, TurnBanner) and `src/ui/battle/**`.
- **UI-shell worker:** `src/ui/App.tsx`, `src/main.tsx`, `src/styles/global.css`, `src/ui/shell/**` (title, menus, CO select, campaign map, war room, options, results, save slots) and `src/ui/story/**` (DialoguePlayer, briefings, cut-scenes).

Shared interfaces:

```ts
// src/ui/battle/BattleScreen.tsx
export interface BattleSetup {
  mode: 'campaign' | 'skirmish' | 'versus';
  mission?: Mission;                 // campaign: briefing already shown by the shell; battle runs mission.events
  map: MapDef;
  players: { faction: FactionId; commander: CommanderId; controller: 'human' | 'ai'; team: number; funds?: number; aiLevel?: 'cadet'|'officer'|'marshal' }[];
  fog: boolean; weather?: Weather; objective: Objective; turnLimit?: number; seed: number;
  resume?: GameState;                // continue a suspended battle
}
export interface BattleResult { outcome: 'victory' | 'defeat' | 'quit'; winnerTeam: number | null; state: GameState; score: ReturnType<typeof scoreCard> | null }
export function BattleScreen(props: { setup: BattleSetup; onExit(result: BattleResult): void; onSuspend?(state: GameState): void }): JSX.Element

// src/ui/story/DialoguePlayer.tsx
export function DialoguePlayer(props: { lines: DialogueLine[]; onDone(): void; backdrop?: 'none' | 'dim' | 'briefing' }): JSX.Element
// typewriter text, portraits left/right, Z/Enter/click to advance (first press completes the line), X/Esc/hold to skip all.
```

`App.tsx` owns the screen state machine: Title → Main menu (Campaign · War Room · Versus · Options) → CO select / map select → Battle → Results. The Battle screen drives the engine via `applyAction`, animates `GameEvent`s, and hands AI turns to `src/ai` (`nextAction(state: GameState): Action` — returns one action at a time so the UI can animate each).

Input everywhere: arrows/WASD move the cursor; **Z / Enter / Space = confirm**, **X / Esc / Backspace = cancel**, **C = CO info**, **Q/E = cycle units**, **R = end-turn prompt**; mouse hover moves the cursor, click confirms, right-click cancels; touch: tap = cursor+confirm, two-finger tap = cancel.
