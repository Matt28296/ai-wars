# BattleForecast

The odds before the player commits an attack: damage dealt, counter-damage taken, and what is left.

**Provide:** `attacker` and `defender` (`{unit, faction, hp}`) and the `damage`/`counter` ranges from the engine's forecast.

- Ranges include luck: show `56–64%`, or a single number when min equals max.
- `counter: null` reads "None" — indirect fire and units that can't hit back.
- When the hit destroys the target the footer becomes a signal chip, so the decisive shot reads at a glance.
- Opens beside the target, opposite the command menu.
