# Ascendant Wars: Balance Pass on `src/data/damage.ts`

**Scope:** an audit of the lead's baseline damage chart against the AW2 analog of every matchup, with corrections. Only numbers in `src/data/damage.ts` were edited. The export shape (`DAMAGE: Record<UnitTypeId, DamageRow>` with optional `primary` / `secondary` partial records) and all comments are unchanged. Some **new numeric entries** were added inside existing `secondary` records (machine-gun fallbacks, §2.3). These add numbers only and keep the shape; strip them if you want strictly edited values only.

Formula and terms are in `mechanics.md` §4. Base damage is the % of a full-HP defender removed by a full-HP attacker before CO, luck and terrain.

Confidence: **[V]** means the analog value was checked against a secondary source this session (search summaries only; fan sites were blocked by the proxy). **[K]** means the AW2 value is from team knowledge, not re-verified.

---

## 1. Verdict on the baseline

The baseline is an accurate transcription of the AW2 chart for 13 of 16 rows. Spot checks: Md Tank → Cruiser 45 and Tank → Cruiser 5 [V, GameFAQs damage guide]; Neotank cannon 105/75/55 vs Tank/Md/Neo, MG 125 vs Infantry [V, forum transcription]; B-Copter → Cruiser being effective in AW1/AW2 [V]. The remaining entries match our recollection of the AW2 chart [K].

Three problems remained:

1. **One transcription slip:** Recon → B-Copter is 12 in AW2. The baseline had 10.
2. **Missing out-of-ammo fallbacks.** In AW, a tank with no shells still machine-guns vehicles for tiny damage. The baseline gave lancer, bastion, colossus and wasp secondaries only against foot and air, so at 0 ammo they could not attack or counter a vehicle at all. That matters most for the **colossus, which has 3 ammo**.
3. **Two design gaps the AW chart cannot fill:**
   - **colossus** has Megatank stats (28000, move 4, ammo 3) but Neotank-plus damage. It was overpriced.
   - **picket** (Cruiser) lost its whole sea role because we have no submarine.

The two requested twists are kept:
- **Hover units slightly weaker against infantry.** This is now in the numbers as well as in canopy costing hover 3.
- **Warden lasers shred air and troops.** The AW2 Anti-Air values (105 vs foot, 120 vs wasp) already do this, so they are unchanged.

---

## 2. Change log (every edit)

### 2.1 Corrections to match AW2

| Entry | Old | New | AW2 analog | Reason |
|---|---|---|---|---|
| skimmer → wasp (MG) | 10 | **12** | Recon → B-Copter 12 [K] | transcription slip |

### 2.2 Twist: hover units are slightly weaker vs (canopy-hiding) infantry

| Entry | Old | New | AW2 analog |
|---|---|---|---|
| skimmer → trooper | 70 | **65** | Recon → Inf 70 |
| skimmer → breacher | 65 | **60** | Recon → Mech 65 |
| lancer MG → trooper | 75 | **70** | Tank → Inf 75 |
| lancer MG → breacher | 70 | **65** | Tank → Mech 70 |

Reasoning:
- AW's Recon moves on **tires** (flats 2, woods 3, no rivers). Our skimmer is **hover** (flats 1, river 1, shoal 1), so it reaches far more troopers per turn. Without a trim it would be the best anti-infantry unit per funds in the game.
- The lancer gains river and shoal crossings over a tread tank.
- −5 is "slightly". The change is a damage trim, not a counter swap: a full skimmer still takes ~6 HP off a trooper on flats (62% avg) and ~5.5 HP off one in canopy.
- Hover pays 3 to enter canopy and the trooper gets 2★ there. Together with the trim, infantry in canopy is a genuinely good answer to hover raiders, which is the intended fantasy.

### 2.3 Out-of-ammo machine-gun fallbacks (added entries, AW2 values)

These apply **only when primary ammo is 0**. The weapon rule is in mechanics §4.5: the primary is used whenever it has ammo and an entry.

| Attacker (AW2 analog MG) | Added secondary entries |
|---|---|
| lancer (Tank MG) | skimmer 40, lancer 6, bastion 1, colossus 1, mule 45, arc 45, salvo 55, warden 5 |
| bastion (Md Tank MG) | skimmer 45, lancer 8, bastion 1, colossus 1, mule 45, arc 45, salvo 55, warden 7 |
| colossus (Neotank MG) | skimmer 65, lancer 10, bastion 1, colossus 1, mule 65, arc 65, salvo 75, warden 17 |
| wasp (B-Copter MG) | skimmer 30, lancer 6, bastion 1, colossus 1, mule 20, arc 25, salvo 35, warden 6 |

The breacher already had its AW2 MG fallbacks in the baseline. Values for these entries are [K].

### 2.4 Colossus: priced like a Megatank, so it now hits like a Megatank-lite

The baseline colossus had Neotank+10 damage and Neotank toughness, with ¾ the move, ⅓ the ammo and +27% cost compared with a Neotank. Compared with the bastion (16000) it cost 1.75× for roughly 1.4× the offense and 1.15× the toughness. Nobody would build it.

The fix keeps the cost (28000) and the 3-shot "siege walker" identity. Each shot is now decisive and the hull is somewhat tankier. Values sit between AW2 Neotank and the later Megatank.

| Entry | Old | New | Neotank (AW2) / Megatank (DS) |
|---|---|---|---|
| colossus → skimmer, mule, salvo | 135 | **145** | 125 / 195 |
| colossus → arc, warden | 125 | **145** | 115 / 195 |
| colossus → lancer | 115 | **130** | 105 / 180 |
| colossus → bastion | 85 | **95** | 75 / 125 |
| colossus → colossus | 60 | **65** | 55 / 65 |
| colossus → picket / dreadnought / barge | 45 / 20 / 55 | **55 / 25 / 65** | (approx.) |
| colossus MG → wasp | 25 | **22** | 22 / 22 |
| breacher → colossus | 15 | **10** | 15 / 5 |
| lancer → colossus | 15 | **10** | 15 / 10 |
| bastion → colossus | 45 | **40** | 45 / 25 |
| arc → colossus | 40 | **35** | 40 / 15 |
| salvo → colossus | 50 | **45** | 50 / 25 |
| anvil → colossus | 90 | **80** | 90 / 35 |
| dreadnought → colossus | 50 | **45** | 50 / 25 |

The Megatank values are approximate [K]; they are only used as an upper bound. Unchanged: trooper 1, skimmer 1, warden 5, wasp 20 vs colossus. Those are already negligible.

Effect, average luck on flats, attacker strikes first, counter included:

| Exchange | Before | After |
|---|---|---|
| colossus → bastion | 80% dealt / 9% counter | **89% / 8%**: the bastion is left at about 1 HP |
| bastion → colossus | 44% / 48% | **40% / 62%**: attacking a colossus head-on loses |
| anvil → colossus | 85% | **76%**: still the clean answer (no counter possible) |
| arc → colossus | 40% | **35%**: about 9800 funds per 6000 arc shot, still efficient |
| salvo → colossus | 49% | **44%** |
| breacher → colossus | 17% / dies | **13% / dies** |

Gameplay result:
- A colossus that strikes first beats two bastions (32000). Two bastions that strike first beat it.
- Initiative decides, which is the AW way.
- It has three shots before it needs a mule. After that it can only machine-gun.
- It walks over ridges (4★). A colossus dug into a ridge is a fortress you crack with anvils, salvos and focus fire, not a frontal tank trade.

### 2.5 Picket: inherits the missing submarine's anti-ship job

| Entry | Old | New | Analog |
|---|---|---|---|
| picket → dreadnought | 5 | **25** | AW2 Cruiser cannot hit Battleships (only subs); Sub → Battleship 55 |
| picket → barge | 25 | **40** | Sub → Lander 95 |
| picket → picket | 25 | 25 | (DS Cruiser → Cruiser 25) |

Reasoning:
- With no sub, the baseline navy had one damage dealer (dreadnought) plus an 18000 escort that could only shoot planes.
- Now a picket that closes inside the dreadnought's minimum range (2) chips 25–34% per turn with no counter, because indirect units never counter. The dreadnought must retreat, and it cannot fire after moving.
- The dreadnought still deletes a picket at range (95). The naval triangle becomes: dreadnought outranges pickets, pickets harass dreadnoughts up close and screen air, anvils punish both.

### 2.6 Everything else

Unchanged, AW2-accurate [K, plus V spot checks]:
- trooper, breacher (except vs colossus), arc, salvo, warden and raptor rows
- anvil and dreadnought rows (except vs colossus)
- picket anti-air (115 / 55 / 65)
- wasp missiles

---

## 3. Final chart (as now in `damage.ts`)

`P / *S*` = primary (uses ammo) / *secondary* (unlimited; used when the primary has no entry or no ammo). A lone italic number means the secondary is the only weapon for that target. `·` = cannot attack.

| att \ def | trp | brc | skm | lnc | bst | col | mul | arc | slv | wdn | wsp | rap | anv | pkt | drd | brg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **trooper** | *55* | *45* | *12* | *5* | *1* | *1* | *14* | *15* | *25* | *5* | *7* | · | · | · | · | · |
| **breacher** | *65* | *55* | 85 / *18* | 55 / *6* | 15 / *1* | 10 / *1* | 75 / *20* | 70 / *32* | 85 / *35* | 65 / *6* | *9* | · | · | · | · | · |
| **skimmer** | *65* | *60* | *35* | *6* | *1* | *1* | *45* | *45* | *55* | *4* | *12* | · | · | · | · | · |
| **lancer** | *70* | *65* | 85 / *40* | 55 / *6* | 15 / *1* | 10 / *1* | 75 / *45* | 70 / *45* | 85 / *55* | 65 / *5* | *10* | · | · | 5 | 1 | 10 |
| **bastion** | *105* | *95* | 105 / *45* | 85 / *8* | 55 / *1* | 40 / *1* | 105 / *45* | 105 / *45* | 105 / *55* | 105 / *7* | *12* | · | · | 45 | 10 | 35 |
| **colossus** | *130* | *120* | 145 / *65* | 130 / *10* | 95 / *1* | 65 / *1* | 145 / *65* | 145 / *65* | 145 / *75* | 145 / *17* | *22* | · | · | 55 | 25 | 65 |
| **mule** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| **arc** | 90 | 85 | 80 | 70 | 45 | 35 | 70 | 75 | 80 | 75 | · | · | · | 65 | 40 | 55 |
| **salvo** | 95 | 90 | 90 | 80 | 55 | 45 | 80 | 80 | 85 | 85 | · | · | · | 85 | 55 | 60 |
| **warden** | 105 | 105 | 60 | 25 | 10 | 5 | 50 | 50 | 55 | 45 | 120 | 65 | 75 | · | · | · |
| **wasp** | *75* | *75* | 55 / *30* | 55 / *6* | 25 / *1* | 20 / *1* | 60 / *20* | 65 / *25* | 65 / *35* | 25 / *6* | *65* | · | · | 55 | 25 | 25 |
| **raptor** | · | · | · | · | · | · | · | · | · | · | 100 | 55 | 100 | · | · | · |
| **anvil** | 110 | 110 | 105 | 105 | 95 | 80 | 105 | 105 | 105 | 95 | · | · | · | 85 | 75 | 95 |
| **picket** | · | · | · | · | · | · | · | · | · | · | *115* | *55* | *65* | 25 | 25 | 40 |
| **dreadnought** | 95 | 90 | 90 | 80 | 55 | 45 | 80 | 80 | 85 | 85 | · | · | · | 95 | 50 | 95 |
| **barge** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |

Who can hit air:
- wasp: trooper, breacher, skimmer, lancer, bastion, colossus (machine guns), warden, wasp, raptor, picket
- raptor and anvil: warden, raptor, picket only

Nothing on the ground can hit a raptor or anvil except the warden, because we have no SAM (AW "Missiles") unit. That makes wardens and raptors the whole anti-air game. See §5.

---

## 4. Cost table

| Unit | Current cost | Suggested | Note |
|---|---|---|---|
| trooper | 1000 | 1000 | |
| breacher | 3000 | 3000 | |
| skimmer | 4000 | 4000 | hover buff offset by the −5 anti-foot trim. If playtests still show early skimmer spam, go to **4500** rather than cutting damage further. |
| lancer | 7000 | 7000 | hover vs tread is roughly a wash (better rivers and shoals, worse canopy) |
| bastion | 16000 | 16000 | |
| colossus | 28000 | **28000 (keep)** | **Only with the new numbers.** If you revert §2.4 to the baseline Neotank-plus numbers, set cost **22000 and ammo 6** instead. Do not do both. |
| mule | 5000 | 5000 | |
| arc | 6000 | 6000 | |
| salvo | 15000 | 15000 | tread instead of tires is neutral to slightly positive. Watch for indirect turtling on glass-free maps. |
| warden | 8000 | 8000 | sole ground AA; keep cheap |
| wasp | 9000 | 9000 | |
| raptor | 20000 | 20000 | |
| anvil | 22000 | 22000 | |
| picket | 18000 | **18000 (keep)** | **Only with the new anti-ship numbers.** If §2.5 is reverted, drop to **15000**: an AA-only boat is not worth 18000. |
| dreadnought | 28000 | 28000 | |
| barge | 12000 | 12000 | |

No other unit is mispriced against its AW2 analog. Our roster changes (no transport copter, no SAM, no sub) shift value toward wasps, raptors and dreadnoughts, but not enough to re-price before playtesting.

---

## 5. Watch list for playtests (not changed)

1. **Air dominance without SAMs.** Warden (8000, range 1) is the only ground AA.
   - If anvils dominate, the first lever is warden → anvil 75 → **85**, in the warden's "shreds air" spirit. Do it before touching costs.
   - The second lever is a future SAM unit.
2. **Colossus on ridges.** A full colossus on a 4★ ridge takes only 60% of base damage.
   - If it becomes unkillable, the lever is anvil → colossus 80 → **90**. The anvil is meant to be the clean answer, and air attackers still face the defender's stars.
   - Do not touch ridge stars.
3. **Hover vs canopy.** If troopers in canopy feel too safe against skimmers, revert skimmer → trooper to 70 (canopy cost 3 already penalises hover).
4. **Picket harassment.** If dreadnoughts feel helpless, lower picket → dreadnought to 20. Pickets are 6 move, dreadnoughts 5.

## 6. Non-damage observations for the lead (outside my files)

- **Tread/walker on shoal = 2** (AW treads pay 1). Fine as a twist, but beach landings with bastions get slow. Confirm it is intended.
- **Daily charge drain** must be per type: wasp 2, raptor 5, anvil 5, ships 1 (mechanics §8).
- **bastion/colossus vision 2** (AW 1): fine and helps the walker read ridges.
- **Uplink +10% firepower** stacks additively per uplink owned. With 3 uplinks plus a power, a bastion one-shots lancers. Cap uplink stacking at +20% (2 towers) if maps have many.

## 7. Reproducing the numbers

The exchange figures in §2 come from a throwaway script that bundles `damage.ts` with esbuild and applies the mechanics §4 integer formula. It averages luck 0..9, uses flats (1★) for both sides, and a 0★ sea for ships. It is not shipped, so recreate it from the formula if needed.
