# BuildMenu

Production at a Fabricator, Skyport or Dock: what can be built here, what it costs, what you can afford.

**Provide:** `title` (the property), `funds`, `faction`, `items` (unit ids, or `{unit, cost}` when a commander changes prices), `activeId`, `onSelect`.

- Rows the player cannot afford stay visible but grey out and refuse selection — the price is the lesson.
- Keep the list in roster order (cheap to expensive within a domain); never sort by affordability.
- Funds sit top-right in `stat-sm` with the `CR` unit; costs align right in mono.
