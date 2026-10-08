# StatusChip

One or two words of state with an icon: low charge, critical, capturing, surge ready, or a faction label.

**Provide:** `tone` and the words. Use `tone="faction"` with `faction` to label a nation.

- Status is never colour alone: every tone carries its icon (`signal` dot, `warn` diamond, `danger` cross, faction sigil).
- `signal` is the positive state (ready, destroys target); there is no green "success" — green belongs to Verdant.
- Keep it to two words. Sentences go in `body-sm` beside it.
