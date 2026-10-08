# UnitToken

A unit on the battlefield: faction plate, unit glyph, sigil chip, HP chip and status chip in one 48 px square.

**Provide:** `unit`, `faction`, `hp` (display 1–10), and the state flags `spent`, `selected`, `facing`, `status`.

- The HP chip appears only below 10 and turns danger-red at 3 or less, like a pilot's warning light.
- `spent` greys the plate after the unit acts this turn; never hide a spent unit.
- Face enemies: the side attacking left-to-right faces right, the other faces left.
- One status chip at a time, in priority: capturing › low charge › low ammo › loaded.
- Inside a `MapTile`, pass it as the child; outside the map set `decorative` when a label already names it.
