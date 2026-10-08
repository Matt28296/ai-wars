# Units

Sixteen units in three domains. Costs are in credits; charge is fuel (air units burn 5 per cycle and crash at 0; naval units burn 1 and sink). Each unit has a filled glyph in `assets/Units` and is drawn on the battlefield by `UnitToken`.

## Ground

| Unit | Role | Cost | Move | Type | Vision | Charge | Ammo | Range | Notes |
|---|---|---:|---:|---|---:|---:|---:|---|---|
| **Trooper** | Exo-rifle squad | 1,000 | 3 | Foot | 2 | 99 | — | 1 | captures |
| **Breacher** | Heavy exo, rail launcher | 3,000 | 2 | Exo | 2 | 70 | 3 | 1 | captures |
| **Skimmer** | Hover scout | 4,000 | 8 | Hover | 5 | 80 | — | 1 |  |
| **Lancer** | Hover tank | 7,000 | 6 | Hover | 3 | 70 | 9 | 1 |  |
| **Bastion** | Heavy grav-tank | 16,000 | 5 | Tread | 2 | 50 | 8 | 1 |  |
| **Colossus** | Siege walker | 28,000 | 4 | Walker | 2 | 50 | 3 | 1 |  |
| **Mule** | Hover transport | 5,000 | 6 | Hover | 1 | 70 | — | — | carries 1; resupplies |
| **Arc Battery** | Rail artillery | 6,000 | 5 | Tread | 1 | 50 | 9 | 2–3 | indirect: can’t move and fire |
| **Salvo** | Missile platform | 15,000 | 5 | Tread | 1 | 50 | 6 | 3–5 | indirect: can’t move and fire |
| **Warden** | Point-defense laser | 8,000 | 6 | Tread | 2 | 60 | 9 | 1 |  |

## Air

| Unit | Role | Cost | Move | Type | Vision | Charge | Ammo | Range | Notes |
|---|---|---:|---:|---|---:|---:|---:|---|---|
| **Wasp** | Gunship drone | 9,000 | 6 | Air | 3 | 99 | 6 | 1 |  |
| **Raptor** | Air superiority | 20,000 | 9 | Air | 2 | 99 | 9 | 1 |  |
| **Anvil** | Strike bomber | 22,000 | 7 | Air | 2 | 99 | 9 | 1 |  |

## Naval

| Unit | Role | Cost | Move | Type | Vision | Charge | Ammo | Range | Notes |
|---|---|---:|---:|---|---:|---:|---:|---|---|
| **Picket** | Escort cruiser | 18,000 | 6 | Sea | 3 | 99 | 9 | 1 |  |
| **Dreadnought** | Rail battleship | 28,000 | 5 | Sea | 2 | 99 | 9 | 2–6 | indirect: can’t move and fire |
| **Barge** | Landing craft | 12,000 | 6 | Barge | 1 | 99 | — | — | carries 2 |

## Movement types

- **Foot** (Trooper) and **Exo** (Breacher): go almost anywhere; Exo climbs ridges at 1.
- **Hover** (Skimmer, Lancer, Mule): the futuristic twist — crosses rivers and shoals at cost 1, but canopy costs 3 and ridges are closed.
- **Tread** (Bastion, Arc Battery, Salvo, Warden): heavy and grounded; no rivers or ridges, glass waste costs 2.
- **Walker** (Colossus): climbs ridges at 2.
- **Air**: every tile costs 1; no terrain defense.
- **Sea** / **Barge**: water only; Barges also beach on shoals to unload.
