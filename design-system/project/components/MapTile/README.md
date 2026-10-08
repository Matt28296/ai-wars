# MapTile

One square of the battlefield: terrain art, owner tint, range overlay, fog and the cursor, with an optional unit on top.

**Provide:** `terrain`, `owner` for properties, `overlay` (`move`/`attack`), `cursor` (`select`/`target`), `fog`, `size`, and a `UnitToken` child.

- Movement range is a solid signal wash; attack range is a hatched red wash — they differ in pattern, not only hue.
- The cursor's corner brackets sit outside the tile; `target` swaps to danger and adds the reticle.
- Fog darkens, never hides, the terrain: players must still read the ground they can't see.
- Lay tiles edge to edge with no gap; the faint grid line is inside each tile.
