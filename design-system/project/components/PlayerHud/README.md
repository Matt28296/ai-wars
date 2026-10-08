# PlayerHud

The active player's corner of the battlefield: commander, funds, cycle and power.

**Provide:** `commander` (`{name, faction, initials, src}`), `funds`, `cycle`, and the `power` meter props.

- Top-left by default; it swaps to top-right when the cursor enters its quadrant.
- Funds in `stat` with `CR`; never abbreviate credits (12,400, not 12.4k).
- The commander's name is in their faction ink — the HUD is how players know whose turn it is between banners.
