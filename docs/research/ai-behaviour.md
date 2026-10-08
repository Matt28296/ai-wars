# Ascendant Wars: AI Behaviour (research + design)

Part A summarises how the GBA Advance Wars AI behaves and where players beat it. Part B is our **original** AI design, ready to implement as `src/ai` against the engine API (`nextAction(state): Action`, one action per call).

Confidence: **[V]** means reported in community sources found this session (forums, wikis, guides; via search summaries, since direct fetch was blocked). **[K]** means team knowledge or player lore that was not re-verified. The AW AI's real internals were never published, so everything in Part A is *observed behaviour*.

---

## Part A: How the AW AI plays, and its known weaknesses

### A.1 Observed behaviour

| Behaviour | Notes | Src |
|---|---|---|
| **Target preference by category** | It favours units that cannot retaliate: transports, and indirects caught inside their minimum range. | [V] |
| **Transport fixation (AW1)** | AW1's AI attacked APCs above almost everything, except when its HQ was being captured. AW2 fixed it (transports became low priority). A later remake reportedly brought it back. | [V] |
| **Air uses ground logic** | Bombers can be baited onto a cheap APC instead of a Medium Tank. | [V] |
| **Power timing** | AW2 AI activates powers **only at the start of its turn** (with one exception CO at the end). It **always fires the Super if it starts a turn with it**, and fires the normal power with a per-CO probability. | [V] |
| **Fog** | AW1/AW2 AI is widely reported to ignore fog (it attacks units its side cannot see) but still has to uncover units hidden in woods. Reports for AW2 conflict. | [V conflicting] |
| **HQ neglect** | It rarely defends its HQ actively. Guards often do not move until something enters their attack range, so infantry HQ rushes work. | [V] |
| **Fixed production habits** | (Remake observation) it keeps a set of foot soldiers + an APC + a transport copter, always gets one Anti-Air, then spams Tanks and B-Copters. It can be "farmed" into rebuilding the same units. | [V, remake] |
| **Movement-power blind spot** | It parks units one tile outside your normal threat range and gets hit by movement-boosting powers. | [V, DS] |
| **Piecemeal attacks** | Units attack one by one as they come into range, rather than massing and striking together. | [K] |
| **No retreat or repair** | Damaged units keep fighting instead of falling back to cities, and rarely join. | [K] |
| **Indirect misuse** | Artillery advances into direct-fire range or blocks chokepoints for its own tanks. | [K] |
| **Ignores tempo and objectives** | It does not race captures against a cycle limit or a property-count win. | [K] |

### A.2 Lessons for our AI
1. **Value-based targeting**, never category rules. A transport is worth its cost plus its cargo, no more.
2. **Honest fog.** Players resent cheating AIs. Use belief tracking (B.8) instead of peeking.
3. **Mass, then strike.** Order attacks so indirects soften first, then directs finish and kill (B.4).
4. **Retreat and repair** expensive damaged units (B.6).
5. **Respect movement powers**: compute threat with enemy powers assumed active when their meter is full (B.2).
6. **Defend the spire** with a dedicated guard rule (B.5).
7. Leave a *few* exploitable quirks on the easiest level so new players get wins (B.10).

---

## Part B: Recommended AI design (original)

### B.0 Shape of the module

```
src/ai/
  index.ts        export function nextAction(state: GameState): Action
  eval.ts         unitValue, expectedDamage, threat maps
  plan.ts         candidate generation + scoring for one unit
  production.ts   build choice
  power.ts        power timing
  belief.ts       fog belief (last seen + spread)
  config.ts       per-difficulty weights (B.10)
```

`nextAction` is called repeatedly by the UI with the newest state until it returns `endTurn`. It is **stateless across calls**: everything it needs is recomputed from `state`, with a memo keyed by `state` identity for the threat map. That keeps it replay-safe and lets the UI animate each action. Randomness comes from a local PRNG seeded from `hash(state.rng, state.cycle, player, actionIndex)`. **Never advance `state.rng`.**

```ts
export function nextAction(state: GameState): Action {
  const me = state.current;
  const cfg = CONFIG[state.players[me].aiLevel ?? 'officer'];
  const ctx = buildContext(state, me, cfg);           // values, threat, belief, objectives (memoised)

  // 1. Power at turn start (before any unit acted), or a 'refresh'-type power once most units have acted
  const p = choosePower(ctx);       if (p) return p;

  // 2. Best unit action across all un-acted units
  const best = bestUnitAction(ctx); // highest score; ties: priority class (B.1)
  if (best && best.score > cfg.minActionScore) return best.action;

  // 3. Remaining un-acted units: safe reposition or wait in place (always legal: path [pos], then 'wait')
  const idle = firstUnactedUnit(ctx);
  if (idle) return safeFallback(ctx, idle);

  // 4. Production after units have vacated factories
  const b = chooseBuild(ctx);       if (b) return b;

  return { kind: 'endTurn' };
}
```

Termination: each call either acts with an un-acted unit, builds (spending funds), activates a power (once per turn) or ends the turn, so the loop always ends. If `applyAction` ever throws for an AI action, the UI should call `nextAction` again with a blacklist of that unit for this turn. The AI must also check `isLegal` before returning.

### B.1 Priority classes (tie-breakers and ordering)

The scores below are in **funds**. Classes only break near-ties (within 5%) and fix ordering hazards:

1. Win now: capture completes on an enemy spire; kill the last enemy unit.
2. Stop a loss: attack or block an enemy capturer on **our** spire or a property that would complete next turn.
3. Indirect attacks (they cannot move, and firing first lets directs finish targets).
4. Direct attacks that kill.
5. Other attacks.
6. Captures (start or continue).
7. Transport actions (load, unload, supply).
8. Retreat / repair / join.
9. Reposition (advance, screen, block).

### B.2 Valuation primitives

```ts
// Funds value of a unit as it stands
unitValue(u) = cost(u.type) * displayHp(u.hp) / 10 * roleMult(u)
roleMult(u):
  1.0 base
  +0.5 if u is a capturer currently capturing (scaled by progress: 0.5 * (1 - tile.capture/20) + 0.25)
  +cargo value for transports (sum unitValue(cargo))
  +0.2 for indirects (force multipliers)
  ×0.8 if charge would crash it next turn and no skyport/dock/mule is reachable (it is already lost)

// Expected damage, using engine forecast midpoint
expDmg(att, from, def) = mean(forecast(state, att.id, from, def.pos).damage)       // internal HP
expCounter(...)        = mean(forecast(...).counter ?? [0,0])

// Threat map: for every tile, the expected damage each own unit type would take there next enemy turn
threat[tile][type] = Σ over the top-3 enemy attackers that can reach an attack position on tile:
                     expDmg(enemy, bestFrom, hypothetical unit of `type` at tile)
  - direct enemies: reachable(state, enemy.id) (ignoring our units except as blockers) + adjacent tiles
  - indirect enemies: only tiles in range of their CURRENT position (no move+fire)
  - if the enemy's meter can fire a power next turn: apply that power's move/firepower/range modifiers
  - fog: include belief units (B.8) at weight = belief probability
exposure(unit, tile) = min(unit.hp, threat[tile][unit.type]) / 100 * cost(unit.type)
```

The threat map is computed once per call over at most ~40 enemy units. Cache it with the state reference. Approximate "top-3" by greedy sum capped at 100 HP.

### B.3 Attack target scoring

```ts
for each un-acted unit A, for each tile D in reachable(A) (or only A.pos for indirects),
  for each target T in attackTargets(state, A.id, D):
    f = forecast(A, D, T)
    dmg     = mean(f.damage)
    killP   = P(damage >= T.hp)                // from the luck range: fraction of luck rolls that kill
    counter = killP >= 0.99 ? 0 : mean(f.counter)
    dealt   = min(T.hp, dmg)/100 * cost(T) * roleMult(T)
    taken   = counter/100 * cost(A)
    score = dealt
          + killP * (0.5 * unitValue(T) + futureDamageAvoided(T))   // removing a unit removes its next attack
          + captureDisruption(T)                                     // T capturing our property
          - cfg.counterWeight * taken
          - cfg.exposureWeight * exposure(A after damage, D)
          + positionValue(A, D)                                      // terrain stars, blocking, closer to objectives
          + focusBonus(T)                                            // T already damaged this turn → finish it
```

- `futureDamageAvoided(T)` = the expected damage T would deal next turn to our best target within its threat, so killing a loaded arc beats killing a mule.
- `captureDisruption(T)`: if T is capturing our property: `propertyValue × (1 − remainingAfter/20)`. Add 2× property value if the attack drops T's displayed HP below the remaining capture points (the capture now cannot finish next turn).
- **Attack ordering (focus fire, Officer+)**: before committing the top attack, check whether another unit could make a kill this turn on the same target with a softening hit first. Search pairs and triples over the top-K targets (K = 6), choose the sequence with the best total score, and return its **first** action. The next call recomputes and naturally continues the sequence. Indirects are tried first in sequences.
- **Never** attack where `taken > dealt` unless killP ≥ 0.9, it is a class-1/2 action, or the attacker is doomed anyway (exposure ≥ its value).

### B.4 Captures

```ts
propertyValue(p):
  base 1000 * cfg.horizon (≈ 8 turns of income) for income properties
  +4000 fabricator (production), +3000 skyport/dock if the map has air/sea play, +2000 uplink (+10% firepower)
  enemy spire: +∞ (class 1 when completable; otherwise 40000)
  ×1.5 if it is enemy-owned (swing: they lose the income too)
  ×(1 − 0.5 × contestRisk(p))                                 // threat on the tile vs our capturer
```

- **Assignment**: each turn, greedily match capturers to properties by `propertyValue / (turnsToCapture + travelTurns)`. `travelTurns` uses `reachable`; let mules offer ferry ETA (B.7). A capturer already on a property **continues** unless exposure ≥ 2× its value and the capture cannot finish next turn.
- Early game (cycle ≤ 3): capture with everything; production is mostly troopers (B.5).
- Leave 1 trooper or breacher near our spire as a **spire guard** once any enemy capturer is within 2 turns of it. The guard sits on the spire (blocking) or attacks the capturer.

### B.5 Production

Run after all units have moved (factories vacated). Funds reserve: Cadet 0, Officer 0 (except to save for a planned unit), Marshal up to 1 cycle of income when saving.

```ts
chooseBuild(ctx):
  for each empty own production tile F (sorted by distance to the front, nearest first):
    options = buildOptions(state, F.pos).filter(o => o.affordable)
    for each type t in options:
      U(t) = matchup(t) + need(t) − overcount(t)
      score(t) = U(t) / cost(t) ** 0.85           // slight preference for quality over spam
    pick argmax (Cadet: sample from top-3 by softmax)
    if Marshal and best score < saveThreshold and a better unit becomes affordable next turn → skip (save)

matchup(t) = Σ over known enemy units e, weighted by proximity w(e) = 1 / (1 + turnsToContact(e)):
               w(e) * ( dmgValue(t → e) − dmgValue(e → t) )
   dmgValue(x → y) = base(x,y) on 1.5 average stars, with counter, in funds of y (or of x for the reverse)

need(t):
  capturers:  + (uncapturedReachableProperties − ourCapturers) * 1500, for trooper/breacher (trooper preferred when funds are tight)
  anti-air:   if enemyAirValue > 0.15 * enemyArmyValue and ourAAValue < 0.6 * enemyAirValue → + warden/raptor bonus
  transport:  + mule bonus if ≥ 2 capturers have travelTurns ≥ 3 and no free mule; barge only if B.7 says there is an island objective
  scouting:   + skimmer bonus in fog if we have no unit with vision ≥ 4 near the front
  indirect:   + arc/salvo bonus if the front is static (enemy armour value high and contact > 1 turn away)
  naval:      dock builds only if the enemy has naval value, or a naval route to an objective exists

overcount(t): penalise > 35% of army value in one type; at most 1 mule per 4 foot; at most 2 barges
```

Opening book (cycle 1–2): troopers from every fabricator. One breacher if funds ≥ 3000 after troopers. A skimmer on cycle 2 in fog.

### B.6 Retreat, repair and join

```ts
retreatScore(u, tile) for tile = own property servicing u's domain within reach, not occupied:
  hpGain = min(2, 10 − displayHp(u))
  value  = hpGain/10 * cost(u)  −  repairCost  −  cfg.exposureWeight * exposure(u, tile)
  trigger when displayHp(u) <= 4 (cost ≥ 12000) or <= 3 (others), and no attack scores > value
join: two same-type own units with sum ≤ 11 displayed HP, the receiving unit not more exposed → score = value preserved + refund
low charge: air/sea with charge < drain × (turnsToNearestService + 1) → move toward skyport/dock or a mule
low ammo:   primary ammo 0 and no useful secondary → move to a service tile or mule
```

### B.7 Indirect positioning and transports

**Indirects (arc, salvo, dreadnought)**
```ts
if attackTargets(state, u.id, u.pos) non-empty → fire (B.3 picks the best target)
else choose tile D in reachable(u) maximising:
   nextTurnTargets(D)   = Σ over enemies e within range of D next turn: expected dealt value × P(e still there)
 − 2.0 * exposure(u, D)                                  // indirects are fragile and cannot counter
 − 4000 if D is within any enemy direct threat (reachable + 1)
 + 1500 if ≥ 1 own direct unit stands between D and the nearest enemy (screened)
 − 3000 if D sits on a chokepoint/road tile our directs need to pass
```
**Screening (direct units)**: when an own indirect has exposure > 0, give direct units a bonus for tiles that cut enemy paths to tiles adjacent to the indirect. Check with `reachable` for the threatening enemy, recomputed with the blocker placed.

**Mule**: state machine per mule.
```
IDLE → (assignment: capturer c with footETA − ferryETA ≥ 2) → PICKUP (move adjacent to c; c then Loads)
PICKUP → FERRY (move toward target property; stop where the next-turn drop is ≤ 1 tile from target and exposure(mule+cargo) acceptable)
FERRY → DROP (Unload onto the tile closest to the target; prefer tiles with stars) → SUPPORT
SUPPORT: follow the armour group 2 tiles behind, Supply when ≥ 2 adjacent units are low; never end inside the threat map if alternatives exist
```
**Barge**: compute land-connected components of the map (hover/foot passable). If an objective (an enemy spire or a cluster of ≥ 3 properties) lies in a different component than all our fabricators, run the same state machine with 2 cargo slots between shoal/dock tiles. Otherwise do not build barges.

### B.8 Fog handling (honest)

- Use only `visibility(state, me)` plus the event history the UI has shown, and track it in a belief map derived from state alone. Simplest: each call, every visible enemy is certain. For enemies seen earlier, keep `lastSeen` from previous states (store a WeakMap keyed by `state.mapId+player`, reset when a new game starts) and spread probability over tiles reachable within `turnsSince × move`.
- Unseen **canopy** tiles adjacent to unseen territory near enemy property carry a small prior (0.1) of a trooper-class unit.
- Movement: prefer paths through visible tiles for valuable units. Path into unseen canopy-adjacent tiles only with cheap units, which act as **scouts first**. Turn order in fog: skimmers and wasps move first (vision), then re-plan the others with the newly revealed info. The re-plan happens automatically because `nextAction` is recomputed.
- An ambush reveals the enemy. Next call, attack it with indirects or directs if favourable.
- Never target or path around invisible units with knowledge we should not have (tests: AI decisions must be identical whether or not hidden enemy units exist, other than via `visibility`).

### B.9 CO power timing

```ts
choosePower(ctx):
  if any own unit has acted this turn and no refresh-type power: return null        // AI fires at turn start
  canO = canActivatePower(state, 'overclock'), canS = canActivatePower(state, 'surge')
  if (!canS && !canO) return null
  gain(level) = planValue(stateWithPower(level)) − planValue(state)    // greedy plan of top-K attacks/captures, cheap
  defensive(level) = expected reduction of next-turn enemy damage (defense/heal powers)
  // Prefer the bigger power if it is affordable, or nearly affordable while gain(S) is small
  if canO and (gain(O)+defensive(O) ≥ cfg.powerThreshold * powerCost(O) or meterIsCapped) → overclock
  if canS:
     starsToO = (powerCost(O) − meter)/9000
     if starsToO ≤ 1 and gain(S) < 1.5 * cfg.powerThreshold * powerCost(S) → hold (save for Overclock)
     if gain(S)+defensive(S) ≥ cfg.powerThreshold * powerCost(S) → surge
  if enemy meter is full and our power has defensive value → fire now (deny their alpha strike)
  return null
```
`planValue` is a cheap estimate: the sum of the best attack scores for the top 6 units plus capture progress. Running it twice per turn start is affordable. Heal and funds powers use their direct value (`hp × cost/10` healed, funds gained).

### B.10 Difficulty levels

| Setting | Cadet | Officer | Marshal |
|---|---|---|---|
| Action choice | softmax over top-3 (T=0.35 × score range) | best | best |
| Focus-fire sequencing (B.3) | off | pairs | pairs + triples |
| `counterWeight` / `exposureWeight` | 0.5 / 0.2 | 1.0 / 0.6 | 1.0 / 1.0 |
| Threat map uses enemy powers | no | yes | yes |
| Retreat/repair (B.6) | never | HP ≤ 2 | rules as written |
| Production | top-3 sample, no saving, no counter-weighting | matchup + needs | + proximity weighting + saving |
| Transport planning | none (mules only as supply) | mule ferry | mule + barge |
| Power timing | fire as soon as available (AW-like) | threshold 0.6 | threshold 0.8 + hold-for-Overclock + deny |
| Fog | visible only, no belief | belief, last seen | belief + canopy priors + scout-first |
| Spire guard | no | yes | yes, plus counter-capture |
| Deliberate quirks | over-values hitting mules (×1.3), chases kills recklessly | none | none |
| Resource cheats | none | none | none (missions may grant funds, shown to the player) |

### B.11 Performance and testing

- Budget: ≤ **50 ms per `nextAction`** on a mid laptop for a 20×15 map with 40 units. Precompute `reachable` per unit once per call, and the threat map once per call. Forecasts are cheap pure functions.
- If profiling exceeds the budget, cap candidates: for each unit, keep the 12 best destination tiles by `positionValue` plus every attack-capable tile.
- Tests (vitest, `src/ai/*.test.ts`):
  1. **Legality fuzz**: 200 seeded AI-vs-AI games on every skirmish map; every returned action passes `isLegal`; every game ends within the cycle cap.
  2. **No fog leak**: the same visible state with and without extra hidden enemy units gives the same first action.
  3. **Kill preference**: given a killable salvo and a full-HP mule, the AI kills the salvo.
  4. **Capture defence**: an enemy trooper capturing our spire with 10 points left gets attacked or blocked.
  5. **Indirect safety**: an arc with no targets never ends inside the enemy direct threat when a safe tile exists.
  6. **Ladder**: Marshal beats Officer ≥ 70% and Officer beats Cadet ≥ 70% over 100 mirrored games.
