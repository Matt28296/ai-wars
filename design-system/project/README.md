Ascendant Wars is a turn-based tactics game: five nations, eleven commanders, sixteen units and fifteen kinds of ground on a square grid. This system is its visual and verbal language — a dark tactical interface wrapped around a bright, readable battlefield. Use it for the game itself, its menus and story scenes, and anything that has to look like it belongs to the same war.

## Principles

- **The battlefield is the hero.** Chrome is dark, quiet and edged; the map is where colour lives. Never let a panel out-shout the terrain.
- **Read it in one glance.** A player should know whose unit, how hurt, and whether it can still act, without hovering. Every state has a shape and a word, not just a colour.
- **Engineered, not ornate.** Panels cut their corners (chamfers), they don't round them. Lines are thin and straight. No gradients for decoration, no glows except the cursor and selection.
- **Signal is the interface.** One accent — `signal` cyan — marks the cursor, focus, selection and anything positive. It is never a nation's colour, so it can never be confused for a side.

## Content fundamentals

**Voice.** Military-crisp in the interface, human in the story. Interface copy is short, imperative and calm: "Fire", "End turn", "Low charge". Story copy belongs to the characters — each commander's voice is described in the Commanders section.

- **Commands** are single words in capitals (the `label` style sets them so): FIRE · CAPTURE · JOIN · LOAD · UNLOAD · SUPPLY · WAIT · END TURN.
- **Headings and names** use title case: "Battle forecast", "Lancer", "Command Spire". Sentences use sentence case.
- **The player is "you" in rules text** ("You can't build here — this Dock belongs to Tidewell"). Commanders address the player by rank ("Captain").
- **Game words are fixed:** a turn is a *cycle* ("Cycle 04", two digits), fuel is *charge*, money is *credits* written `12,400 CR` (never 12.4k), the HQ is the *Command Spire*, CO powers are *Surge* and *Overclock*, a defense rating is *stars*.
- **Numbers** are digits in the mono face: `HP 7`, `56–64%`, `12/20`. Ranges use an en dash.
- **No emoji, no exclamation marks in the interface.** Characters may exclaim (Juno does, a lot); ECHO never does.
- **Errors explain and offer a way out:** "Not enough credits for a Bastion. You have 9,000 CR." rather than "Error".

Real copy, for tone:

> ECHO: "Enemy Lancer, eight tiles out. Recommendation: do not stand in front of it. That is the whole recommendation."
> Sefa Tamura: "The tide does not hurry, Captain. It simply arrives."
> Interface: "3 units still ready. End turn anyway?"

## Visual foundations

### Colour

Two themes: **Night Ops** (`dark`, the default and the first theme) and **Briefing** (`light`, for daylight screens and print). Chrome tokens change between them; the battlefield — terrain, faction fills, overlays — stays the same, because the map is a world, not a page.

- **Grounds:** `void` behind everything, `panel` for HUD panels and cards, `panel-raised` for menus stacked on top. `line` for hairline dividers inside panels; `line-strong` for every panel and control edge (≥ 3:1 on all three grounds).
- **Text:** `ink` for primary text and `ink-muted` for labels and metadata, on `void`, `panel`, `panel-raised` and `signal-soft`. Both meet 4.5:1 in both themes.
- **Signal:** `signal` for the cursor, focus, selection, active rows and positive states; `signal-soft` behind selected rows; `on-signal` on a signal fill (the primary button).
- **Status:** `warn` (low charge/ammo, capture in progress) and `danger` (critical HP, destroyed, irreversible actions). Positive is `signal`, never green — green is a nation.
- **Nations:** each has a fill (`helion`, `tidewell`, `verdant`, `kestrel`, `choir`), an `on-` token for marks on that fill, and an `-ink` token for its name as text on chrome. Set a commander's or nation's name in its `-ink`; set unit plates, banners and owned buildings in its fill. The fills step down in lightness — Kestrel gold, Helion amber, Verdant green, Tidewell cobalt, Choir obsidian — and every one is paired with its sigil, so no two sides are told apart by hue alone.
- **The Hollow Choir** is obsidian (`choir`) and always rimmed in its red signal (`on-choir`) so it reads on dark terrain and dark panels.
- **Battlefield:** `terrain-*` tokens paint the ground (each terrain has a base and a `-detail` tone); `map-shade` draws unit outlines, HP chips and the grid; `map-ink` is the HP digit. Ranges are `overlay-move` (solid signal wash) and `overlay-attack` (hatched red wash); fog is `overlay-fog`.

### Type

Three families, all bundled as font files (Latin subsets; SIL Open Font License).

- **Chakra Petch** (`--font-display`) — angular and engineered. `title` (48/52) for act and mission titles and Overclock call-outs, one per screen; `headline` (28/32) for the turn banner and results; `heading` (18/24) for card titles and speaker names; `label` (13/16, tracked +0.08em) for every command, HUD label and button, always in capitals.
- **Barlow** (`--font-sans`) — plain-spoken. `body` (17/26, medium) is the story voice in dialogue and briefings; `body-sm` (14/20) for rules text and tooltips; `caption` (12/16) for metadata. Nothing is set below 12 px.
- **IBM Plex Mono** (`--font-mono`) — tabular figures. `stat` (22/26) for funds and damage forecasts; `stat-sm` (13/16) for HP, charge, ammo, costs and capture points. Numbers never jitter as they count.

### Space, shape and layout

- **Spacing** runs on 4 px: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-6` 24 · `space-8` 32. Panels pad `space-4`; panels sit `space-6` apart; the HUD keeps `space-8` from the screen edge.
- **The battlefield runs on the tile:** `tile` is 48 px at 1×, scaled by whole numbers to fit the screen (`tile-sm` 32 px inside cards and minimaps). Units, overlays and the cursor are all sized from the tile.
- **Chamfer, not curve.** Panels, dialogue boxes and banners cut their top-left and bottom-right corners by `chamfer` (12 px); menus, cards, unit plates and portraits by `chamfer-sm` (6 px). Radii stay tiny: `radius-xs` (2 px) for buttons, HP chips and meter pips, `radius-sm` (4 px) for status chips. `radius-full` is only for round things.
- **Edges, not shadows.** Every panel has a 1 px `line-strong` edge. `shadow-panel` lifts only what floats over the battlefield (menus, dialogue, forecast). There are no drop shadows on cards at rest.
- **HUD layout:** player HUD top-left, terrain and unit cards bottom-left, command menu beside the acting unit. Each one swaps to the opposite side when the cursor enters its quadrant — the HUD never covers what the player is looking at.

### States and motion

- **Focus:** `focus-ring` — a 2 px gap in the panel colour, then 2 px of solid `signal`, drawn as a box-shadow so it follows the shape. Every interactive element shows it on keyboard focus.
- **Selection:** `glow-select` (a signal ring with a short glow) on the selected unit and the battlefield cursor — the only glow in the system.
- **Hover** tints rows and buttons with `signal-soft`; **active** menu rows turn `signal` with the ▸ cursor; **disabled** drops to 45% opacity and refuses the pointer.
- **Spent units** (already acted this turn) desaturate and darken; they never disappear.
- **Motion is quick and mechanical:** the cursor bobs 2 px on a 600 ms loop; units slide 60–80 ms per tile; menus open in 120 ms; the turn banner sweeps in over 300 ms and holds about 1.2 s; dialogue text types at the player's chosen speed. Ease out on entry, never bounce. Respect reduced-motion: replace slides with fades and drop the bob.

## The battlefield

- **Unit token:** faction plate (cut corners, 2 px `map-shade` outline) with the unit glyph in its `on-` colour; the nation's sigil on a `map-shade` chip top-left; one status chip top-right (capturing › low charge › low ammo › loaded); the HP chip bottom-right below 10 HP, in `danger` at 3 or less.
- **Facing:** units face the enemy; the right-hand side of a map faces left.
- **Properties** (Arcology, Fabricator, Skyport, Dock, Uplink, Command Spire) take their owner's fill and `on-` detail; unowned ones are neutral grey (`terrain-structure`).
- **Overlays:** blue-cyan wash for where a unit can go; hatched red wash for what it can hit; the cursor's four corner brackets for where the player is. Fog darkens but never hides the ground.

## Iconography

- **Unit glyphs** (`assets/Units`): single-ink filled silhouettes on a 24 px grid, drawn facing right, readable at 24–48 px. Exported in `ink` (#e8edf3) for use on dark grounds; inside the bundle they are recoloured live per faction.
- **Sigils** (`assets/Sigils`): one mark per nation plus ECHO's bracket mark, single ink on a 24 px grid, exported in each nation's fill colour.
- **Terrain tiles** (`assets/Terrain`): 32 px square art in the `terrain-*` tokens, unowned properties in neutral grey.
- **Small interface icons** (status chips, unit status) are drawn inline by the components on a 12 px grid: dot, diamond, cross, bolt, round, flag, cargo.
- No emoji, no stock icon font. There is no logo yet: set the game's name in Chakra Petch 700.
- Commander portraits are a monogram in a faction frame until painted art exists; the game ships stylised vector portraits drawn to this palette.
