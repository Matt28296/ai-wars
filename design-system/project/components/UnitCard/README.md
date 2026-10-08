# UnitCard

Intel on the unit under the cursor: name, role, HP, charge and ammo with warnings.

**Provide:** `unit`, `faction`, `hp`, and `charge`/`ammo` when below full.

- The unit name is in the faction's ink colour; the token beside it carries the sigil.
- Low charge (20% or less) and low ammo (1 or less) turn their meters `warn` and add a chip; HP 3 or less turns `danger`.
- Units without a primary weapon say so in words rather than showing an empty meter.
