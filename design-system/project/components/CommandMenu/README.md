# CommandMenu

The list of commands that opens after a unit moves or when the player presses confirm on an empty tile.

**Provide:** `items` in display order (`{id, label, hint?, disabled?}`), the `activeId` under the cursor, `onSelect`, and an optional `title` (the acting unit's name).

- Order after a move is fixed: **Fire · Capture · Join · Load · Unload · Supply · Wait**. Only show what is possible; never show a disabled Fire.
- The map menu is **End turn · CO · Intel · Options · Suspend**.
- Labels are one word in capitals. Hints are counts or keys (targets in range, `R`).
- Place it beside the unit, on the side away from the screen edge; it never covers the unit it commands.
