# Ascendant Wars: Rules Reference (mechanics research)

The rules the engine has to implement. They are adapted from the GBA games Advance Wars (AW1) and Advance Wars 2: Black Hole Rising (AW2) and mapped onto our roster. Mechanics and formulas are documented here so we can reimplement them. No Nintendo text, names, maps or assets are reproduced, and all player-facing wording in our game is original.

Confidence tags used throughout:

| Tag | Meaning |
|---|---|
| **[V]** | Checked during this research against at least one secondary source (fan wiki, StrategyWiki, GameFAQs/GameSpot guide, LP archive). Most fan sites (Fandom, Wars Wiki, AWBW, GameFAQs) were **blocked by the network proxy**, so checks went through search-engine summaries only. |
| **[K]** | Team knowledge of the GBA games. Widely repeated in the community but **not re-verified** this session. |
| **[D]** | Our own design decision, where AW is unknown, inconsistent or unsuitable. |

Where this document disagrees with the one-paragraph summary in `docs/ARCHITECTURE.md`, see §16.

---

## 1. Roster mapping and base stats

Values come from `src/data/base.generated.ts` and sit next to their AW2 analog. Charge = fuel. "Drain" is the start-of-turn charge loss for air and sea units (§8).

| Ours | AW analog | Cost | Move / type | Vision | Charge | Drain/turn | Ammo | Range | Notes vs analog |
|---|---|---|---|---|---|---|---|---|---|
| trooper | Infantry | 1000 | 3 foot | 2 | 99 | – | – (MG only) | 1 | identical |
| breacher | Mech | 3000 | 2 exo | 2 | 70 | – | 3 | 1 | identical |
| skimmer | Recon | 4000 | 8 **hover** | 5 | 80 | – | – (MG only) | 1 | hover instead of tires: much better off-road |
| lancer | Tank | 7000 | 6 **hover** | 3 | 70 | – | 9 | 1 | hover instead of treads |
| bastion | Md Tank | 16000 | 5 tread | 2 | 50 | – | 8 | 1 | vision 2 (AW 1) |
| colossus | Neotank / Megatank | 28000 | 4 **walker** | 2 | 50 | – | 3 | 1 | Megatank-like stats (move 4, ammo 3, price); can climb ridges |
| mule | APC | 5000 | 6 **hover** | 1 | 70 | – | – | – | carries 1 foot/exo, resupplies |
| arc | Artillery | 6000 | 5 tread | 1 | 50 | – | 9 | 2–3 | identical |
| salvo | Rockets | 15000 | 5 tread | 1 | 50 | – | 6 | 3–5 | tread instead of tires |
| warden | Anti-Air | 8000 | 6 tread | 2 | 60 | – | 9 | 1 | identical |
| wasp | Battle Copter | 9000 | 6 air | 3 | 99 | **2** | 6 | 1 | identical |
| raptor | Fighter | 20000 | 9 air | 2 | 99 | **5** | 9 | 1 | identical |
| anvil | Bomber | 22000 | 7 air | 2 | 99 | **5** | 9 | 1 | identical |
| picket | Cruiser | 18000 | 6 sea | 3 | 99 | **1** | 9 | 1 | no submarine exists for it to hunt (see balance.md) |
| dreadnought | Battleship | 28000 | 5 sea | 2 | 99 | **1** | 9 | 2–6 | identical |
| barge | Lander | 12000 | 6 barge | 1 | 99 | **1** | – | – | carries 2 ground units |

AW units we dropped are Transport Copter, Missiles (ground SAM), Submarine and the AW2 campaign-only structures. §15 and `balance.md` cover what those absences do to balance.

### Movement costs (from our data; `–` = impassable)

| Terrain (★) | foot | exo | hover | tread | walker | air | sea | barge |
|---|---|---|---|---|---|---|---|---|
| flats (1) | 1 | 1 | 1 | 1 | 1 | 1 | – | – |
| canopy (2) | 1 | 1 | **3** | 2 | 2 | 1 | – | – |
| ridge (4) | 2 | 1 | – | – | **2** | 1 | – | – |
| maglev (0) | 1 | 1 | 1 | 1 | 1 | 1 | – | – |
| span (0) | 1 | 1 | 1 | 1 | 1 | 1 | – | – |
| river (0) | 2 | 1 | **1** | – | – | 1 | – | – |
| sea (0) | – | – | – | – | – | 1 | 1 | 1 |
| shoal (0) | 1 | 1 | **1** | 2 | 2 | 1 | – | 1 |
| glass (1) | 1 | 1 | 1 | **2** | 1 | 1 | – | – |
| arcology / fabricator / skyport / uplink (3) | 1 | 1 | 1 | 1 | 1 | 1 | – | – |
| spire (4) | 1 | 1 | 1 | 1 | 1 | 1 | – | – |
| dock (3) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

AW reference [K]: foot = Infantry (woods 1, mountain 2, river 2). Exo = Mech (all 1). Tread = treads (woods 2, no mountains or rivers, **shoal 1**). Our data charges tread and walker 2 on shoal, which is a deliberate twist or an accident; the lead should confirm. Naval units cannot enter shoal. The Lander (barge) can.

---

## 2. Turn structure

- Players act in fixed order (player index 0, 1, 2…). One **Cycle** is a full round. The cycle counter increments when player 0 starts a turn [K].
- During your turn each unit can **move once and act once** (attack, capture, wait, load, join, supply or unload). Moving without acting is not allowed: a moved unit must choose a command, with Wait as the default. Before you commit a command you can **cancel the move** and the unit returns to its origin with nothing spent [K]. This undo is essential to the AW feel (see quality-bar).
- Commands that end the unit's activity: Attack, Capture, Wait, Join, Load, Supply and Unload. A greyed-out unit is "acted".
- Building happens at any time during your turn on an empty owned production property. A new unit is acted until your next turn [K].
- A CO power can be activated at any time during your own turn, including after some units have moved [K]. AW2's AI only uses powers at turn start [V], and that is an AI habit, not a rule.

### 2.1 Start-of-turn order of operations (exact, recommended)

The AW1/AW2 cartridges apply **daily fuel drain before APC resupply**, so a low-fuel plane parked next to an APC can still crash. The fan site AWBW reversed this so that APC resupply comes first [V]. Exactly where property repair sits in the cartridge order could not be verified. We use the forgiving order:

```
startTurn(player):
  1. clear player's PowerState from their previous turn (powers last until the owner's next turn starts; §10)
  2. clear 'acted' on all of player's units
  3. income: funds += Σ income of owned properties × (1 + incomePercent/100)        (§6)
  4. property repair + resupply, in row-major order (y, then x) over the player's units (§7)
  5. mule resupply: every mule (not loaded) resupplies orthogonally adjacent own units  (§7)
  6. charge drain for air/sea units that were NOT resupplied in steps 4–5             (§8)
  7. crash/sink: own air/sea units with charge ≤ 0 are destroyed (event 'crashed')     (§8)
  8. victory check (a crash can rout a player)                                         (§13)
  9. emit 'turnStarted' { cycle, income }; UI shows the cycle banner
```

Step 6 exempts resupplied units [D]. As a result, any unit standing on a skyport or dock, or next to a mule, shows full charge at turn start and can never crash there. A strict drain-after-resupply order (the architecture summary) would show 94/99 on a plane parked at its skyport, which looks like a bug to players. Otherwise the outcome is the same as AWBW.

Turn end: there is no end-of-turn upkeep. CO power states persist through the opponents' turns (§10).

---

## 3. Movement

- A path's cost is the sum of each entered tile's cost for the unit's move type. It must be ≤ `move` **and** ≤ current charge [K].
- **Charge spent = movement points spent**, not tiles [V]. A hover skimmer crossing one canopy spends 3 charge.
- Units inside transports do not move on their own and spend no charge [K].
- Units may pass through **own and teammates'** units but cannot end on an occupied tile. The exceptions are Join (same type) and Load (onto a transport) [K for own; teammates: D].
- Units cannot pass through **visible enemy** units. Hidden enemies trigger an **ambush** (§9.4).
- A unit with 0 charge cannot move but can still attack in place (direct units) or fire (indirect units) [K].

---

## 4. Combat

### 4.1 Damage formula (AW2, our variables)

The community-documented AW2 formula, applied as a sequence of adjustments [V for structure; rounding is disputed, see 4.3]:

```
B        = base damage from DAMAGE[attacker][weapon][defender]          (src/data/damage.ts)
ATK      = 100 + Σ firepower modifiers  (CO passive, active power, +10 per owned uplink, +10 while any own power is active)
DEF      = 100 + Σ defense modifiers    (CO passive, active power, +10 while any own power is active)
L        = luck, integer drawn uniformly from [luckMin, luckMax]  (default 0..9) using state.rng
AHP      = attacker displayed HP = ceil(attacker.hp / 10)          (1..10)
DHP      = defender displayed HP = ceil(defender.hp / 10)
T        = defender's terrain stars (0..4), plus any terrainStars modifier; ALWAYS 0 for air defenders

damage%  = floor( (B × ATK/100 + L) × (AHP / 10) × (200 − (DEF + T × DHP)) / 100 )
damage%  = clamp(damage%, 0, defender.hp)        // internal HP lost, 1 internal HP = 1 %
```

Integer form for the engine (exact, no floating point, deterministic):

```ts
const defenseTerm = Math.max(0, 200 - (DEF + T * DHP));
const dmg = Math.floor(((B * ATK + 100 * L) * AHP * defenseTerm) / 100_000);
```

What each term does:
- **Attacker HP scales everything, luck included.** A 5-HP unit deals half [V].
- **Terrain is weighted by the defender's HP.** Each star is worth 10% to a full-HP defender and only 5% to a 5-HP defender [V]. Hiding a damaged unit in a city helps less than players expect.
- **Air units never receive terrain stars** [K]. That holds even over a canopy, ridge or skyport. Air *attackers* still face the ground defender's stars.
- Firepower and defense bonuses are **additive percentages** [V]. +20 passive, +10 uplink and +10 power give ATK 140.
- DEF above 200 is clamped so damage is never negative [D].
- A matchup with **no entry** cannot be attacked with that weapon. An entry of 1 can still chip via luck (trooper vs bastion: 0–8%) [K].

### 4.2 Worked examples (no CO, 10 HP unless noted)

| Attack | Calc | Result (luck 0 → 9) |
|---|---|---|
| lancer → lancer on flats (1★) | 55 × 1.0 × 0.90 | **49 → 57** |
| counter: lancer (now 51 hp → 6 HP) → attacker on flats | 55 × 0.6 × 0.90 | **29 → 34** |
| trooper → trooper on ridge (4★) | 55 × 1.0 × 0.60 | **33 → 38** [V: 33%] |
| trooper → 5-HP trooper on ridge | 55 × 1.0 × (200−120)/100 = 0.80 | **44 → 51** [V: 44%] |
| arc → bastion on arcology (3★) | 45 × 1.0 × 0.70 | **31 → 37** |
| bastion → lancer, ATK 140 (passive 20 + uplink 10 + power 10), flats | 119 × 0.90 | **107 → kill** |
| warden → wasp hovering over canopy | 120 × 1.0 × 1.00 (air: T=0) | **120 → kill** |

Use these as engine unit tests.

### 4.3 Rounding (disputed, our ruling)

Sources disagree on how the cartridge rounds. Some wikis say it truncates. Some say the displayed estimate truncates while the real value rounds to nearest. A TAS write-up describes a probabilistic extra point, which is really luck. AWBW floors the result and nudges values that land just below an integer because of floating-point error [V that a dispute exists].

**Ruling [D]:** compute in integers as above and floor once at the end. That is deterministic, replay-safe and never off by one from floating point. The forecast shows `[floor at luckMin, floor at luckMax]`.

### 4.4 Luck

- The default is uniform integer 0..9, added **after** the firepower multiplier and **before** the HP and defense scaling [V: "+0~9%", "good luck"]. Luck therefore shrinks for damaged attackers and against well-dug-in defenders.
- `luckMax` / `luckMin` modifiers model a lucky or unlucky CO (AW2 had a gambler-style CO with a 0..19 range, plus COs with negative luck) [K].
- Draw luck from `state.rng` only. Draw the attack first and the counter second, so replays reproduce exactly.

### 4.5 Weapons and ammo

- Each unit has an optional **primary** weapon that costs 1 ammo per shot, **counters included** [K], and an optional **secondary** that is unlimited.
- **Weapon choice is not "best damage".** The rule is fixed [K]: use the primary if it has an entry against the defender **and** ammo > 0, otherwise use the secondary if it has an entry, otherwise the unit cannot attack.
- Out of ammo: tank-type units fall back to their machine gun against vehicles at very low damage. The rebalanced table now contains those entries (see balance.md). Units with no secondary (arc, salvo, warden, raptor, anvil, dreadnought) **cannot attack or counter** at 0 ammo.
- The low-ammo icon shows when ammo ≤ ⌈max/3⌉. Low charge shows when charge ≤ 1/4 of max, or for air/sea when charge < drain × 2 [D, presentation].

### 4.6 Counterattacks

After the attacker's damage resolves, the defender strikes back **if all** of these hold [K; formula V]:
1. It survived (hp > 0).
2. The attack was **direct**: the attacker's range is [1,1], so it attacked from an adjacent tile.
3. The defender itself is a **direct** unit. Indirect units (arc, salvo, dreadnought) **never counter**, even when hit point-blank.
4. The defender has a usable weapon against the attacker (§4.5, ammo included).
5. Neither side is hidden (future stealth).

The counter uses the **defender's post-damage HP** as AHP and the **attacker's tile stars** as T (0 if the attacker is air). It rolls its own luck and spends ammo if it uses the primary. A counter can destroy the attacker.

`counterFirst` modifier (ambush doctrine) [D]: the defender's strike resolves first at full HP. If the attacker survives, it then attacks at its reduced HP.

### 4.7 Indirect fire

- Indirect = `range[0] > 1`. Indirect units **cannot move and fire in the same turn**: they must attack from the tile where they started [K]. The `indirectAfterMove` power modifier overrides this.
- They cannot target units inside their minimum range, so an arc cannot hit an adjacent unit.
- They need the target to be **visible** to their side in fog (§9).
- AW1/AW2 indirect ranges are fixed: no terrain or height bonus [K]. `rangeMax` modifiers come from COs only.

### 4.8 Forecast (UI and AI)

`forecast()` returns the attack's luck min–max at the current HP. The counter range is computed from the defender's HP after **max** damage (minimum counter) and after **min** damage (maximum counter). AW1/AW2 showed only a single luck-free percentage [K]. Showing the range is clearer and fair.

---

## 5. Capture

- Only units with `captures` (trooper, breacher) can capture [K].
- An untouched property has **20 capture points**. Each Capture action subtracts the capturer's **displayed HP** (×1 + CO capture modifiers if we add them) [V for 20 points and HP-based progress]. A full trooper takes two turns; a 4-HP trooper takes five.
- When points reach ≤ 0 the property switches to the capturer's owner, resets to 20, and emits 'captured'. Capturing an enemy property removes it from their income immediately [K].
- **Reset:** if the capturer moves off the tile, is destroyed, or boards a transport, the tile resets to 20 [K]. Taking damage does **not** reset progress. It only slows the next step.
- Joining a unit into the capturer keeps progress [D], because the occupant never left. AW behaviour here is unverified.
- Capturing a **command spire** defeats its owner (§13). HQs cannot be built from.
- Neutral properties need the same 20 points.

---

## 6. Income and production

- At the start of each of its owner's turns, every owned property with `income` pays it: **1000** each by default, uplinks 0 [V]. That includes cycle 1. The versus setup can override the per-property amount (`incomePerProperty`) [V].
- The CO `incomePercent` modifier scales the total.
- Production: an owned fabricator builds `ground`, a skyport `air`, a dock `sea`. The tile must be empty. Cost is paid immediately and the unit appears at full HP, charge and ammo, **acted** [K].
- `costPercent` modifies the build price. Repair cost uses the **modified** price [K].
- Unit cap: **50 units per player** [K]; the build menu greys out at the cap.

---

## 7. Repair and resupply

- At step 4 of the start of turn, each own unit standing on an own property that **services its domain** is repaired and resupplied [V for the 2-HP rule and domain matching]:
  - ground units: arcology, fabricator, command spire
  - air units: skyport only
  - sea units: dock only
  - uplinks repair nothing [D, mirrors comm towers]
- **Repair amount:** +2 displayed HP (+20 internal), plus `repairBonus` modifiers, capped at 10. AWBW repairs exactly +20 internal. The cartridge rounds to whole displayed HP [V]. Our ruling [D]: `newHp = min(100, (displayHp + 2) × 10)`, so a 57-hp unit (displayed 6) becomes 80 (displayed 8). A unit that is already at displayed 10 with hp < 100 is topped up to 100 for free.
- **Repair cost:** **10% of the unit's (CO-modified) cost per displayed HP restored** [V]. A full 2-HP repair costs 20% of the price.
- **Insufficient funds:** AWBW skips the unit. Cartridge behaviour could not be verified. Our ruling [D]: repair 2 HP if affordable, else 1 HP if affordable, else 0. Resupply always happens because it is free.
- **Resupply** sets charge and ammo to max at no cost [K].
- **Mule resupply** (step 5): every mule on the map that is not inside a transport resupplies charge and ammo of own units orthogonally adjacent to it, ground, air or sea [V]. A mule can also take a `supply` action after moving. Mules never repair HP [K].
- Units **inside** transports are not repaired or resupplied by properties [D].

---

## 8. Charge (fuel) drain, crashing and sinking

- Every movement point spent costs 1 charge (§3) [V].
- **Daily drain** at turn start (step 6) for air and sea units only [K: AW2 values]:
  - wasp **2**, raptor **5**, anvil **5** [V for the bomber's 5 and the copter's 2; the fighter's 5 was not found but is widely cited]
  - picket, dreadnought, barge **1**. One AW1 mission text states that naval units burn **2**/day [V that this text exists]. We use 1, the AW2 value. A hidden or dived unit (future stealth) would burn about 5/day like a dived submarine [V].
- The architecture summary says "air −5". That is wrong for the wasp, so use per-type drain. The engine needs a small table (`DRAIN: Partial<Record<UnitTypeId, number>>`), because `UnitType` has no drain field.
- After drain, an air or sea unit at **0 charge is destroyed** [V]: air units crash, naval units sink. This does not charge any power meter [V for AW1]. Ground units at 0 charge just cannot move.
- Units inside transports never drain [K].

---

## 9. Fog of war

### 9.1 Vision
- Each unit sees every tile within its **vision radius in Manhattan distance** (a diamond) from its current tile. Terrain does not block line of sight [K].
- **Foot and exo units on a ridge get +3 vision** (2 → 5), the AW mountain rule [V]. Ridges become the fog scouting posts they are in AW. The architecture summary says +1; we recommend +3 (§16). Walkers on ridges get no bonus [D].
- Owned **properties see only their own tile** (vision 0) [K]. Allies' vision is shared.
- `vision` modifiers come from COs. Ion storm weather: **−1 vision** for all units, minimum 1, mirroring AW rain [V for AW rain −1; D for us].
- Vision updates **on every step** of a move, not only at the end. That is required for ambush and lets the player watch the fog lift.

### 9.2 Hiding
- A ground unit on **canopy** is invisible to enemies unless an enemy unit is **adjacent** (distance 1), even inside enemy vision [V].
- AW reefs hid ships the same way. We have no reef. Shoal and sea never hide.
- Teammates always see their allies [V].
- Future stealth (`hidden: true`): visible only to adjacent enemy units. It can only be attacked by designated hunter types, and while hidden it drains about 5/day [V for dived subs]. Moving into it triggers ambush even in clear weather.

### 9.3 What fog hides
- Enemy units outside vision are not drawn: no HP, no info. **Property ownership colours are always visible** [K].
- You can only **target** units you can see. An indirect unit can fire at anything any friendly unit sees.
- `reveal` power effects lift fog for the user for N turns.

### 9.4 Trapping (ambush)
- If a moving unit's path enters a tile holding an **unseen** enemy, the move stops on the **last tile before** it [V]. If that tile is occupied by a friend the unit passed through, it backs up to the previous free tile [D]. A "!" trap marker shows, event 'ambushed' fires, and the unit is **acted**: it cannot attack, capture or do anything else [V].
- Charge is spent only for tiles actually entered. There is no free attack against the trapped unit.
- Unloading onto a tile with a hidden enemy: that drop fails, the cargo stays aboard, and the transport's action ends [D].
- Without fog (and without stealth), `reachable()` simply treats enemy tiles as blocked, so ambush cannot happen.

---

## 10. CO powers (Surge = small, Overclock = super)

### 10.1 Meter
- One **star = 9000 meter points**, on the scale of unit funds value [V].
- **Charge from combat** [V]: when a unit loses internal HP, `value = unitCost × hpLost / 100` (list price [D], so the meter scale is identical for every CO).
  - The owner of the unit that **took** damage gains **100% of value**.
  - The owner of the unit that **dealt** it gains **50% of value**. These are the AW2 "half-charge" rules. AW1 gave only 25% for dealing damage [V].
  - Counterattacks follow the same rule: whoever loses HP gets 100%, whoever inflicts it 50% [V for AW1].
- No charge from crashes, sinking, joining, scrapped units, units destroyed inside transports, or power-effect damage (`damageEnemies`, `strike`) [V AW1 list; silo damage V for AW2].
- **No charging while your own power is active**, from activation until your next turn starts [V]. The opponent's meter still charges normally.
- `powerChargePercent` modifiers scale gains. The meter caps at the current Overclock cost.

### 10.2 Costs and scaling
- `PowerDef.stars` is the base cost in stars. Surge uses the small stars. **Overclock's `stars` should be the full bar** (small + large) [D], because in AW2 the super needs the whole meter, small stars included [V].
- Each activation of **either** power raises the cost of future powers by **20% of base** (1800 per star) [V]. `cost(level) = stars × 9000 × (1 + 0.2 × min(powerUses, CAP))`.
- CAP: AW1 sources suggest the increase stops at around 200% after 10 uses, but the source is internally inconsistent [V]. The AW2 cap is unverified. **Recommendation: CAP = 5 (+100%)**, as in the architecture summary. Most skirmishes see under 6 activations, so the difference rarely shows.
- **Leftover carries over.** Activating Surge with more points than its cost keeps the remainder [V]. Another source says the meter is emptied; we follow the carry-over example.

### 10.3 Activation and duration
- Activation is allowed any time during your own turn, once per turn, and Surge and Overclock cannot both be active [K]. Instant effects apply immediately. Modifiers last **until the start of your next turn**, so defensive and counter bonuses apply during enemy turns [K].
- **Universal bonus:** while either power is active, all your units get **+10 firepower and +10 defense** on top of the power's own modifiers. That is AW2 behaviour [K]; AW1 is unverified.
- Units that acted before activation stay acted unless the power has `refresh`.

---

## 11. Joining

[K unless noted]
- Move a unit onto a **damaged** own unit of the **same type** (target displayed HP < 10) and choose Join.
- Result HP = min(10, dispA + dispB) displayed, internal = displayed × 10 [D].
- **Refund:** excess displayed HP × 10% of unit cost is returned as funds (event `joined.refund`). AW2 and later did this, but it is unverified for AW2 specifically. Without it, joining two healthy units wastes funds.
- Charge and ammo are summed and capped at max. The combined unit is acted.
- A transport carrying cargo cannot join. The joined unit keeps the target's capture progress [D].

---

## 12. Loading and unloading

[K unless noted]
- **mule:** carries 1 trooper or breacher. **barge:** carries 2 ground units of any type, including a loaded mule (nesting one level).
- **Load:** the cargo moves onto the transport's tile and chooses Load. The transport may already have acted. Loading ends the cargo's activity.
- **Unload:** the transport moves (or stays put) and chooses Unload. Each cargo drops onto an orthogonally adjacent, empty tile its move type can enter. Dropped cargo is acted. The transport is acted after unloading. Cargo loaded earlier in the same turn may be dropped after the transport moves, still acted.
- **barge** can load and unload only while on **shoal or dock** (AW Lander rule). Stating it explicitly, because our hover units can stand on shoal.
- Cargo is destroyed with its transport. Those units count as lost but do not charge meters (§10.1).
- Cargo cannot attack, capture, be targeted, drain charge or be repaired.

---

## 13. Victory conditions

- **Rout:** a player whose **last unit is destroyed** (combat, crash or cargo loss) is defeated [K]. Make it event-driven. The architecture's "no units after cycle 1" check falsely defeats a player who starts with zero units and has not built yet; trigger only after the player has owned at least one unit, or at the end of their own turn if they own no units, no production property and cannot afford a trooper [D].
- **Spire capture:** the owner is defeated immediately [V].
- **Defeated player's assets:** their units are removed. On spire capture their properties **transfer to the capturer**; on rout or resign they become **neutral** [K for AW multi-army maps; not re-verified].
- **Property count** (`capture` objective): win as soon as you own N properties [K: an AW versus option].
- **Survive / turn limit:** survive until the end of cycle N. In versus with a cycle limit, the tie-breaker is most properties, then most unit value [D].
- **Resign** = defeat.
- With teams, a team wins when every other team is defeated.

---

## 14. Weather (brief)

AW2 weather changed movement costs (snow), vision (rain) and so on [K]. Our only weather is the **ion storm**: −1 vision [D]. Suggested twist: air movement +1 cost per tile [D]. Keep weather effects few and show them in the Intel screen.

---

## 15. AW1 vs AW2 differences, and what we use

| Topic | AW1 | AW2 | Use |
|---|---|---|---|
| CO powers | one power, single bar with a per-CO length (≈25k–50k funds) [V] | small power + **super** power, stars of 9000 [V] | **AW2** (Surge/Overclock) |
| Meter charge from dealing damage | 25% of value [V] | **50%** [V] | **AW2** |
| Meter charge from taking damage | 100% [V] | 100% [V] | same |
| Cost increase per use | +20%, inconsistent cap [V] | +20% (1800/star) [V] | AW2, cap +100% (D) |
| +10 atk/def while a power is active | unverified | yes [K] | **AW2** |
| Neotank-class unit | none | Neotank [K] | colossus (Megatank-like, see balance) |
| AI transport fixation | strong (attacks APCs over everything) [V] | fixed, transports low priority [V] | neither: value-based (ai-behaviour.md) |
| AI ignores fog | yes (must still uncover woods) [V] | reported yes [V conflicting] | **no**: our AI plays honest fog |
| Join refund of excess HP | unverified | believed yes [K] | **refund** (D) |
| Damage formula and shared chart entries | same structure [K] | same structure [K] | AW2 |
| Rank: Speed/Power/Technique → S/A/B/C, 300 points | yes [V] | yes [V] | yes, with our own formulas (quality-bar §14) |

---

## 16. Notes for the lead: where this differs from `ARCHITECTURE.md`

1. **Charge drain:** per type (wasp 2, raptor 5, anvil 5, sea 1), not "air −5".
2. **Ridge vision:** AW is **+3** for foot/exo, the architecture says +1. Recommend +3.
3. **Turn start:** exempt units resupplied in steps 4–5 from that turn's drain, so a plane parked at its skyport never shows 94/99. Otherwise the order is unchanged.
4. **Rout:** make it event-driven (§13) so a player who starts with no units is not instantly defeated.
5. **Overclock stars** should be defined as the full bar (small + large).
6. **Repair rounding:** `(displayHp + 2) × 10`, partial 1-HP repair when funds are short.
7. **Tread/walker on shoal = 2:** AW treads pay 1. Confirm it is intentional.

## 17. Sources consulted (via search summaries; direct fetch was blocked)

- Advance Wars Wiki (Fandom): Damage Formula, Power Meter, Fog of War, Wood, Reef, Lash Out, Battle Helicopter pages
- Advance Wars By Web wiki (Fandom): Luck, Changes in AWBW, Properties, AWBW Interface Guide
- StrategyWiki: *Advance Wars 2: Black Hole Rising*, COs and Units pages; *Days of Ruin* gameplay page
- GameSpot: *Advance Wars 2* walkthrough (power meter, ranking benchmarks)
- GameFAQs: Serra_Britt's *AW2* Damage Calculation Guide (Md Tank vs Cruiser 45, Tank vs Cruiser 5); AI and fog threads
- TASVideos *AW2* submission notes (HP scaling, rounding discussion)
- Let's Play Archive: *Advance Wars* / *Advance Wars 2* (fuel use per day)
- ludo.guide *AW2* mission pages (rank thresholds)

Figures we **could not verify** and took from knowledge: the fighter's 5/day drain, naval 1/day (one AW1 text says 2), the AW2 power-cost cap, the AW2 partial-repair rule, the join refund, the 50-unit cap, HQ-capture property transfer, and the universal +10/+10 during powers.
