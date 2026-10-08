# Ascendant Wars: Quality Bar

What made the GBA Advance Wars games feel premium, written as a checklist UI, art and audio engineers can build and test against. Each item is tagged:

- **MUST**: ship-blocking. Without it the game will not feel like the genre.
- **SHOULD**: expected by fans. Missing it reads as cheap.
- **NICE**: polish.

Timings: the GBA ran at ~59.7 Hz, so **1 frame ≈ 16.7 ms**. Figures marked *(est.)* are estimates from memory of the games' pacing, not frame-counted captures. Tune them against feel. Every timing below should sit in one `timings.ts` table so it can be tuned in one place. No frame-counted reference footage was available this session (video and wiki hosts were blocked).

Everything we ship is original: our layouts, art, music and words. We imitate the **feel and responsiveness**, not the look.

---

## 1. Screen flow

| # | Item | Tag |
|---|---|---|
| 1.1 | **Title**: logo, "press any key / tap", subtle animated backdrop (parallax or slow pan). Any input → main menu in ≤ 300 ms. After 30 s idle, an **attract mode** plays an AI-vs-AI demo battle on a skirmish map; any input returns to the title. | MUST (title) / NICE (attract) |
| 1.2 | **Main menu**: Campaign · War Room (skirmish vs AI) · Versus (hotseat) · Design Room (map editor) · Records · Options. Large chamfered tiles, cursor memory (returns to the last-used item), one-line help text at the bottom for the highlighted item. | MUST |
| 1.3 | **Campaign map**: continent map with mission nodes, completed nodes stamped with their rank, current node pulsing, a mission title card on hover (name, location, one-line summary). Acts or branches unlock visibly. Briefing (DialoguePlayer) → battle → debrief → back to the map with the new node revealed (pan to it, 600–800 ms). | MUST |
| 1.4 | **CO select**: grid of portraits grouped by faction (sigil + colour), a large portrait with bio, passive, Surge and Overclock name + star cost + rules text, and a meter preview with the actual star count. Changing CO plays a short portrait slide (150 ms) and a voice-style blip. Locked COs show a silhouette. | MUST |
| 1.5 | **War Room**: map list with thumbnail, size, player count, and best score/rank per map. Then CO select for you and the AI(s), AI difficulty, then battle. | MUST |
| 1.6 | **Versus (hotseat)**: 2–5 players, team assignment, human/AI per slot, rules page (fog on/off, weather, starting funds, income per property, cycle limit, property-count win, powers on/off). **With fog on, show a handover screen** between human turns ("Pass to <player>": the map is fully hidden until that player presses confirm). | MUST (handover in fog) |
| 1.7 | **Design Room**: map editor. Grid size, terrain brush, property owners, unit placement, symmetry helpers (mirror/rotate), validation (each player has a spire and a fabricator), save/load to localStorage slots, play-test button. | SHOULD |
| 1.8 | **Records**: per-map best rank/score, totals (battles, wins, units built/destroyed), CO usage. | SHOULD |
| 1.9 | **Options**: music volume, SFX volume, battle cut-ins (All / Player only / Off), map animation speed (Normal / Fast), AI turn speed (Normal / Fast), text speed, "confirm end turn when units are idle" toggle, grid lines on/off, colour-blind assist (sigils + patterns). Settings apply immediately and persist. | MUST |
| 1.10 | Screen transitions: one consistent wipe or fade, **200–300 ms**, never longer. Back always returns to the previous screen with focus restored. | MUST |

---

## 2. Cursor

| # | Item | Tag |
|---|---|---|
| 2.1 | Square bracket cursor framing the tile, with a **gentle pulse**: corners breathe in and out by 1–2 px on a **~600 ms** loop *(est.)*. It never hides the unit. | MUST |
| 2.2 | **Key-repeat with acceleration**: first step on key-down (0 ms), **initial delay 200–250 ms** (12–15 frames), then repeat every **~67 ms** (4 frames). After ~1 s held, every **~33 ms** (2 frames) *(est.)*. Diagonals are two keys at once, moving both axes per step. | MUST |
| 2.3 | Each tile step is a **visual ease of ~50–60 ms** (3 frames) from tile to tile, not a hard jump. Logical position updates instantly, so input is never lagged by the animation. | SHOULD |
| 2.4 | **Camera follow**: the map scrolls when the cursor comes within **2 tiles of the viewport edge**, easing the camera at ≈ the cursor's speed. Never let the cursor reach the very edge while more map lies beyond. | MUST |
| 2.5 | **Snapping modes**: in *attack-target* and *unload-drop* modes, directional input cycles only between valid tiles, in clockwise order from the nearest. In *move* mode it moves freely and clamps to the map. After a cancel it snaps back to the selected unit. After an action it stays on the unit's final tile. | MUST |
| 2.6 | **Turn-start position**: on cycle 1 the cursor starts on your spire. Later it starts where you last left it on your previous turn. Q/E (L/R) cycles through **un-acted units** in reading order; the camera pans to each (≤ 200 ms). | MUST (start) / SHOULD (memory) |
| 2.7 | **Mouse/touch**: hover moves the cursor (no repeat logic), click = confirm, right-click = cancel. Edge-pan the camera when the pointer rests near the viewport edge (NICE). Drag-to-pan on touch. | MUST |
| 2.8 | A **soft tick** SFX per cursor step, rate-limited to ≤ 1 per 50 ms while held, at about −18 dB relative to the confirm sound. | MUST |

---

## 3. HUD and info panels

| # | Item | Tag |
|---|---|---|
| 3.1 | **Terrain panel**: tile art, name, defense stars, and capture points (e.g. "12/20") when a property is being captured. **Unit panel** beside it: unit art, displayed HP, charge, ammo, cargo icons. | MUST |
| 3.2 | **Side-swap**: panels sit in a bottom corner and **jump to the opposite side when the cursor enters their half** of the viewport. Use a hysteresis band of 1 tile at the centre line so they don't flap. Swap animation: slide out 80 ms + slide in 80 ms, or an instant swap; never a fade longer than 150 ms. | MUST |
| 3.3 | **Player HUD** (top corner, same side-swap rule, top edge): CO portrait in faction colour, funds, power meter (small and large stars, partially filled star shows a fractional fill), and the cycle number. | MUST |
| 3.4 | The meter fills with an animated "pour" (~300 ms) after each battle. When Surge or Overclock becomes affordable, the stars **flash on a 400 ms loop** and a short "power ready" chime plays once. | MUST |
| 3.5 | On enemy units the unit panel shows the same info (HP, charge, ammo) unless hidden by fog. | MUST |
| 3.6 | Funds changes animate as a counter (income at turn start counts up over 400 ms; build costs count down over 200 ms). | SHOULD |

---

## 4. Move and attack range, path arrow

| # | Item | Tag |
|---|---|---|
| 4.1 | Selecting a unit shows its **move range** as translucent cyan/blue tiles (token colour) with a slow shimmer (1.2 s loop). It appears with a **fast ripple outward from the unit, 120–180 ms total**. | MUST |
| 4.2 | **Attack range**: holding cancel (X/Esc) or right-mouse on *any* unit, own or enemy, shows the tiles it could hit this turn (`attackRangeTiles`) in red while held. For indirect units also show the red range on select. | MUST |
| 4.3 | **Threat overlay** toggle (key T): union of all visible enemy attack ranges, red hatch. | SHOULD |
| 4.4 | **Path arrow**: segmented arrow (tail, straight, corner and head pieces) drawn from the unit to the cursor along the planned path. Rules: (a) moving the cursor to a tile adjacent to the path head **extends** the path if the total cost stays ≤ move and ≤ charge; (b) moving onto a tile already in the path **truncates** back to it; (c) otherwise (over budget, jump, mouse) **recompute** the cheapest path, preferring straight lines and the previous path's direction on ties; (d) the cursor outside the range keeps the last valid arrow. Redraw within the same frame. | MUST |
| 4.5 | The tile under the arrow head shows the forecast destination terrain stars in the terrain panel (players use this to plan). | SHOULD |
| 4.6 | **Damage forecast** in attack mode: "Damage 49–57%" and "Counter 29–34%" (or "No counter") in a panel opposite the target, updated as the cursor cycles targets. | MUST |

---

## 5. Unit movement and map animation

| # | Item | Tag |
|---|---|---|
| 5.1 | A unit glides along the path at **~80 ms per tile (Normal)** and **~40 ms per tile (Fast)** *(est.)*, eased only at the start and stop (not per tile). It faces its direction of travel and returns to the faction's default facing when done. | MUST |
| 5.2 | **Movement SFX by type**: footsteps (foot/exo), hover hum (hover), tread clank (tread), heavy servo thump (walker), rotor/jet whoosh (air), wake swish (sea/barge). It loops for the duration of the move. | SHOULD |
| 5.3 | After the move, the **command menu** opens next to the unit (opposite side of the screen centre) with only legal options in fixed order: Attack, Capture, Join, Load, Unload, Supply, Wait. Cancel returns the unit to its origin instantly (≤ 100 ms) with the selection restored. | MUST |
| 5.4 | **Idle animation**: every un-acted unit plays a **2-frame idle loop**, frame time **~250–300 ms** *(est.)*, with units on different phase offsets so the map shimmers rather than blinks in unison. Acted units turn **greyscale/desaturated and freeze**. | MUST |
| 5.5 | **Map badges** on the unit tile: displayed HP number bottom-right when < 10, and status icons bottom-left: low charge, low ammo, capturing, carrying cargo. When several apply, cycle them every **~500 ms**. | MUST |
| 5.6 | Water and river tiles animate (2–4 frames, ~400 ms per frame); properties show owner colour and sigil; neutral properties stay grey. | SHOULD |
| 5.7 | **Trap**: the unit stops, a "!" pops above it (bounce 150 ms, hold 500 ms), a sharp sting SFX plays, and the hidden enemy is revealed. | MUST |
| 5.8 | **Join / load / unload / supply**: small dedicated effects. Supply sparkle over each resupplied unit (300 ms); load shows the unit sliding into the transport; joined units show the HP number counting up. | SHOULD |

---

## 6. Battle cut-in (the signature moment)

| # | Item | Tag |
|---|---|---|
| 6.1 | **Split screen**: attacker on the side it attacked from, defender on the other, a centre divider. Each half shows a **backdrop matching that unit's tile** (flats, canopy, ridge, arcology skyline, fabricator, skyport, dock, sea, shoal, river, glass waste, spire, uplink), plus a sky backdrop for air units. Use the art contract `<BattleBackdrop terrain />`. | MUST |
| 6.2 | **Squad size reflects HP**: foot and exo show `ceil(displayHp / 2)` figures (5 at full HP); vehicles show 1–3 hulls by HP band (≥ 7, 4–6, ≤ 3) *(our design)*. When a figure is destroyed it drops or explodes. | MUST |
| 6.3 | **Sequence** (Normal speed) *(est.)*: open wipe **250 ms** → attacker beat **250 ms** → fire **600–900 ms** (muzzle flashes, tracers or rail streaks, missile arcs; indirects show the shot leaving, then cut to impacts on the defender half) → impact **400 ms** (defender shake ±3 px, explosions, sparks) → **HP ticks down** at **~60 ms per displayed HP** with a tick SFX → counter repeats the fire/impact/tick on the other half → hold **300 ms** → close wipe **250 ms**. Total ~**2.8–4.0 s** with a counter. | MUST |
| 6.4 | Each half's **HP counter** is a large number in the top corner; damage ticks visibly. | MUST |
| 6.5 | **Skip**: confirm or cancel during the cut-in jumps immediately (≤ 1 frame) to the final state and closes (150 ms). Holding confirm runs it at 2×. The options setting All / Player only / Off is honoured, and "Off" shows a 400 ms on-map exchange instead (flash, explosion, floating "−4"). | MUST |
| 6.6 | Weapon-specific SFX and visuals: trooper rifle burst, breacher rail launcher, laser (warden) crackle, cannon (lancer/bastion/colossus), rail artillery (arc), missile salvo (salvo), drone guns (wasp), air-to-air missiles (raptor), bomb drop (anvil), naval guns (picket, dreadnought). | MUST |
| 6.7 | Unit destruction on the map after the cut-in: explosion sprite (~500 ms) + 'explosion' SFX + small screen shake (2 px, 150 ms). | MUST |
| 6.8 | Ion storm overlay on the cut-in when that weather is active. Faction tint on the backdrop edges. | NICE |

---

## 7. CO power activation

| # | Item | Tag |
|---|---|---|
| 7.1 | **Sequence** *(est.)*: map dims to ~40% (**150 ms**) → a full-width band sweeps in (**200 ms**) carrying the CO portrait sliding in from the side (**250 ms**) and the **power name** in display type (Surge: single band; Overclock: double band + extra flare) → the CO's quote line types in (≤ 900 ms) → hold until **~2.2 s** total → band exits (**200 ms**) → **map effect**: every affected unit flashes in turn or together (heal: +N numbers float; damage: explosions on enemies; terrain: tiles morph) over **≤ 800 ms**. Whole thing ≤ 3.2 s. Confirm skips to the map effect; a second press skips the map effect. | MUST |
| 7.2 | **Music switches** to the power track on activation, with a 100 ms duck and then a hard cut on a downbeat. It stays until the owner's next turn starts. | MUST |
| 7.3 | While a power is active: HUD meter shows "SURGE" or "OVERCLOCK" state with a slow glow; affected units get a subtle outline shimmer (1 s loop). | SHOULD |
| 7.4 | Enemy (AI) activation plays the same sequence, so the player always knows a power fired. | MUST |

---

## 8. Turn and cycle transitions

| # | Item | Tag |
|---|---|---|
| 8.1 | **Turn banner** on every player's turn start: band across the centre with faction colour, sigil, CO portrait, and "CYCLE N" + player name. Slide in 200 ms, hold 700 ms, out 200 ms (≈ **1.1 s**, est.). A 'turnStart' jingle plays. Skippable with confirm. | MUST |
| 8.2 | **Music** switches to the active CO's or faction's theme at the banner (hard cut or 300 ms crossfade). AI turns play the AI CO's theme. | MUST |
| 8.3 | After the banner: repairs show "+2" floating numbers over repaired units at once (400 ms) with 'repair' SFX; supply sparkles; crashes show the unit falling or sinking with an explosion and a toast "Wasp lost: out of charge". | SHOULD (repairs) / MUST (crash visibility) |
| 8.4 | End-turn: from the map menu, **End** asks for confirmation **only if some units are un-acted** (option toggle). The R key opens the same prompt. | MUST |

---

## 9. Capture

| # | Item | Tag |
|---|---|---|
| 9.1 | **Capture cut-in** (respects the cut-in option): the property art on a backdrop, the trooper/breacher figure moving in, and a large **capture counter counting down** from the old to the new value (e.g. 20 → 10, ~50 ms per point, tick SFX), ≈ **1.2–1.5 s**. On completion the building recolours to the capturer's faction with a flash and a "CAPTURED" stamp (≈ 0.8 s) and the 'captured' fanfare. Skippable. | MUST |
| 9.2 | On the map: a capturing icon on the unit, and the terrain panel shows the remaining points. | MUST |
| 9.3 | Capturing a spire triggers the victory sequence directly after the stamp. | MUST |

---

## 10. Build menu

| # | Item | Tag |
|---|---|---|
| 10.1 | Confirm on an empty owned fabricator, skyport or dock opens the build menu directly. List: unit icon, name, cost. Unaffordable entries stay visible but **greyed** with the cost in red. At the unit cap the whole list is greyed with a reason line. | MUST |
| 10.2 | Side panel for the highlighted unit: art, move + move type, vision, charge, ammo, range, a short role line, and "strong vs / weak vs" icons derived from the damage chart. Funds shown at the top. | MUST |
| 10.3 | Build: funds count down, the unit materialises on the tile (scan-line build-in effect, 300 ms) with 'build' SFX, already greyed (acted). | MUST |
| 10.4 | Cursor memory: the build menu reopens on the last unit built at that building type. | SHOULD |

---

## 11. Map menu, intel and status

| # | Item | Tag |
|---|---|---|
| 11.1 | **Map menu** (confirm on empty tile, or Esc/Start): **Units** (list) · **Intel** · **CO** · **Surge** / **Overclock** (only when affordable, highlighted) · **Options** · **Save** · **End**. Opens in ≤ 100 ms with 'menuOpen'. | MUST |
| 11.2 | **Units list**: every own unit, sortable by type, HP, charge, ammo or acted state. Selecting a unit jumps the cursor to it. | SHOULD |
| 11.3 | **Intel → Status**: per player: CO, funds, income, unit count, unit value, property count, meter state, team. In fog, enemy funds and units are shown as "?" *(D)*. | MUST |
| 11.4 | **Intel → Rules**: objective, cycle limit, fog and weather, current cycle. | MUST |
| 11.5 | **CO screen** (C key anywhere on the map): both COs' passive, Surge and Overclock text, current meter and cost. | MUST |
| 11.6 | **Terrain info** (on hovering a tile + key I): name, stars, movement cost per move type, special notes (uplink +10% firepower, hides units, etc.). | SHOULD |
| 11.7 | One-line **help text** at the bottom of every menu explains the highlighted item. | SHOULD |

---

## 12. AI turn presentation

| # | Item | Tag |
|---|---|---|
| 12.1 | Before each AI action the camera **pans to the acting unit** (ease ≤ 250 ms; skip the pan if it is already on screen). The cursor appears on it for **~150 ms**, the destination flashes, then the unit moves with the same speed as player moves. | MUST |
| 12.2 | **Pause between AI actions ~200 ms** (Normal) / ~60 ms (Fast). Builds show the cursor on the factory + build-in effect. | MUST |
| 12.3 | AI think-time must never freeze the UI. Compute per action in ≤ 50 ms or yield (worker or chunking). If thinking takes > 300 ms show a small "thinking" pulse in the HUD. | MUST |
| 12.4 | Holding confirm during the AI turn = Fast for the rest of that turn. | SHOULD |
| 12.5 | In fog, AI moves are shown **only where the player can see**. Hidden moves are not animated (no camera pans into fog: that would leak information). | MUST |

---

## 13. Music approach

| # | Item | Tag |
|---|---|---|
| 13.1 | **Per-faction/CO map themes**: each faction has a theme (TrackName `helion`, `tidewell`, `verdant`, `kestrel`, `choir`) with a distinct lead timbre and tempo. 60–90 s seamless loop, plus an 8-bar intro that plays once. If the CO roster grows, give each CO a motif variant inside their faction track. | MUST |
| 13.2 | **Power theme** (`power`): higher energy, shared track. Overclock adds a layer (percussion + bass) over the same track rather than a separate file. Plays from activation until the owner's next turn. | MUST |
| 13.3 | Menus (`title`, `map`), campaign briefing (`briefing`), `victory`, `defeat`, `finale` each have distinct cues. Victory and defeat are 6–10 s stingers that then loop quietly. | MUST |
| 13.4 | Music is ducked by ~6 dB during battle cut-ins and power quotes. Volume settings persist. Audio starts only after the first user gesture (contract). | SHOULD |
| 13.5 | Hard cuts are on-brand for the genre: switch tracks on a beat boundary when possible (≤ 1 bar of latency). | NICE |

---

## 14. SFX inventory

Contract `SfxName` today: `cursor, select, cancel, move, menuOpen, confirm, error, fire, cannon, laser, missile, explosion, capture, captured, build, powerReady, surge, overclock, turnStart, victory, defeat, text`.

| Sound | Where | Tag |
|---|---|---|
| cursor | every cursor step (rate-limited) | MUST |
| select / confirm / cancel / error | unit select, menu confirm, back, illegal input (short low buzz) | MUST |
| menuOpen | map/command/build menus | MUST |
| move (per move type, see 5.2) | unit movement loop | MUST (one) / SHOULD (per type) |
| fire / cannon / laser / missile | cut-in weapons (6.6) | MUST |
| explosion | hits and destruction | MUST |
| capture / captured | counter tick / ownership flip fanfare | MUST |
| build | unit built | MUST |
| powerReady / surge / overclock | meter filled / activations | MUST |
| turnStart | turn banner | MUST |
| victory / defeat | results stingers | MUST |
| text | typewriter blip in dialogue (every 2nd character, pitch-varied ±5%) | MUST |
| **proposed additions:** `hpTick` (cut-in HP counter), `trap` (ambush sting), `repair`, `supply`, `load`, `unload`, `join`, `crash`, `rankStamp` | as named | SHOULD (propose to lead) |

All SFX are synthesised (contract). Keep each ≤ 600 ms except fanfares. No two common SFX should share a pitch centre.

---

## 15. Results screen and ranking

| # | Item | Tag |
|---|---|---|
| 15.1 | "VICTORY" / "DEFEAT" banner (1.0 s) → stats panel: cycles taken, units built, units lost, enemy units destroyed, damage dealt. | MUST |
| 15.2 | **Score**: three bars, **Speed**, **Power** and **Technique**, 0–100 each, count up one after another (**600 ms each**), then the total (/300), then the **rank letter stamps in** (scale 140% → 100% in 120 ms, thud SFX, slight shake). Thresholds: **S ≥ 280, A ≥ 250, B ≥ 200, C < 200** (matching the GBA scale [V]). | MUST |
| 15.3 | Formulas *(original, ours; the AW formulas are not documented)*: **Speed** = 100 if cycles ≤ par.cycles, else `max(0, round(100 − 100 × (cycles − par) / par))`. **Power** = `min(100, round(100 × (enemyUnitsDestroyed / max(1, unitsLost)) / par.power))`, which fits the mission `par.power` contract (kills per own loss). **Technique** = `clamp(round(100 − 200 × (lossRatio − 0.10)), 0, 100)` with `lossRatio = unitsLost / max(1, unitsBuilt + startingUnits)`. Losing ≤ 10% scores 100, 20% scores 80 and 60% scores 0, echoing the GBA benchmark of "lose under ~20% for a high Technique" [V benchmark]. | MUST (some formula) |
| 15.4 | "New record" flag when the best score for this map or mission improves. The rank is shown on the campaign node or War Room map afterwards. | SHOULD |

---

## 16. Save and suspend

| # | Item | Tag |
|---|---|---|
| 16.1 | **Autosave** (suspend slot) at the start of every human turn and when the tab is hidden. Reopening offers "Continue battle". | MUST |
| 16.2 | Map menu **Save**: writes the suspend slot with a 400 ms "Saved" toast. Campaign progress is saved after each mission. | MUST |
| 16.3 | Saves store seed + action log, plus a periodic `GameState` snapshot (deterministic replay). Version the format. | SHOULD |
| 16.4 | Three manual save slots in War Room/Versus. | NICE |

---

## 17. Controls (contract) and feel rules

| # | Item | Tag |
|---|---|---|
| 17.1 | Arrows/WASD move · Z/Enter/Space confirm · X/Esc/Backspace cancel · C CO info · Q/E cycle units · R end-turn prompt · hold X on a unit = attack range · T threat overlay *(proposed)* · I terrain info *(proposed)*. | MUST |
| 17.2 | **Input never queues behind animation**: any confirm/cancel during an animation skips or fast-forwards it. Nothing un-skippable is longer than 400 ms (except the first viewing of a story beat). | MUST |
| 17.3 | **Cancel is always safe**: it steps back one stage (target select → command menu → move → selection). Nothing is committed until a command is confirmed. | MUST |
| 17.4 | Menus remember the last position per menu type. Default focus is on the most likely option (Attack if available, else Wait). | SHOULD |
| 17.5 | Every number the rules use is visible somewhere: stars, HP, charge, ammo, capture points, costs, meter. No hidden state except fog. | MUST |
| 17.6 | Sigil + colour for faction identity everywhere (never colour alone). Text ≥ 4.5:1 contrast (design system). | MUST |
| 17.7 | Dialogue: typewriter at ~30 chars/s (Normal), the first press completes the line, the next advances, hold or Esc skips the scene. | MUST |

---

## 18. Little touches

- Cursor tick + menu blips at low volume; error buzz only for truly illegal input, never for "nothing here". **SHOULD**
- Units face the enemy side by default (player 0 faces right, others left), and turn while moving. **SHOULD**
- Built units "materialise", destroyed units leave a brief scorch decal (fades after 1 turn). **NICE**
- HP numbers on badges use the mono stat font; the low-charge icon blinks only on air/sea units that will crash next turn. **SHOULD**
- When the enemy's meter is full, their HUD stars flash too, so you can see a power is coming. **MUST**
- Hover help: terrain stars and costs; unit "strong vs" tips in the build menu. **SHOULD**
- Funds can never go negative; a repair that would leave too little is skipped with a toast. **SHOULD**
- The spire tile carries an "HQ" flag on the map. **MUST**

---

## 19. Top 10 MUST items (priority order for implementation)

1. Command flow with free cancel/undo before commit (5.3, 17.3)
2. Cursor feel: immediate step, 200–250 ms delay then ~67 ms repeat, edge scroll, target snapping (2.2, 2.4, 2.5)
3. Blue move range + held red attack range for any unit (4.1, 4.2)
4. Path arrow that extends, truncates or recomputes (4.4)
5. Damage + counter forecast before attacking (4.6)
6. Info panels that jump to the side away from the cursor (3.1–3.3)
7. Battle cut-in with per-tile backdrops, HP tick-down, squad size by HP, instant skip, All/Player/Off (6.1–6.5)
8. Turn banner + per-faction music + power theme switch (8.1, 8.2, 7.2, 13.1–13.2)
9. CO power activation sequence ≤ 3.2 s, skippable, also for AI (7.1, 7.4)
10. Map readability: 2-frame idle, greyed acted units, HP and status badges (5.4, 5.5)

Close behind: AI turn camera-follow with no fog leaks (12.1, 12.5), capture cut-in (9.1), results rank screen (15.2), autosave (16.1).
