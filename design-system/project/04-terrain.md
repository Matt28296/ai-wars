# Terrain

Fifteen kinds of ground. Defense stars reduce damage taken (air units ignore them); move costs are per movement type, — is impassable. Properties earn 1,000 CR a cycle and repair the domain they build. Art for each is in `assets/Terrain`; the battlefield draws them with `MapTile`.

| Terrain | Code | Stars | Foot | Exo | Hover | Tread | Walker | Air | Sea | Barge | Note |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **Flats** | `.` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Open ground. |
| **Canopy** | `f` | 2 | 1 | 1 | 3 | 2 | 2 | 1 | — | — | Hides units in fog. Hover pays 3. |
| **Ridge** | `^` | 4 | 2 | 1 | — | — | 2 | 1 | — | — | Foot +1 vision. No hover or treads. |
| **Maglev** | `=` | 0 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Fast and exposed. |
| **Span** | `#` | 0 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Bridge over water. |
| **River** | `r` | 0 | 2 | 1 | 1 | — | — | 1 | — | — | Hover crosses freely. No treads. |
| **Sea** | `~` | 0 | — | — | — | — | — | 1 | 1 | 1 | Naval and air only. |
| **Shoal** | `s` | 0 | 1 | 1 | 1 | 2 | 2 | 1 | — | 1 | Barges land here. |
| **Glass Waste** | `g` | 1 | 1 | 1 | 1 | 2 | 1 | 1 | — | — | Treads pay 2. |
| **Arcology** | `C` | 3 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Income; repairs ground units. |
| **Fabricator** | `F` | 3 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Builds ground units. |
| **Skyport** | `A` | 3 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Builds air units. |
| **Dock** | `D` | 3 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | Builds naval units. |
| **Uplink** | `U` | 3 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | +10% firepower to its owner. |
| **Command Spire** | `H` | 4 | 1 | 1 | 1 | 1 | 1 | 1 | — | — | Command Spire. Lose it, lose the war. |

The code column is the character used in map files. Properties are drawn in their owner’s faction fill with `on-` coloured detail; unowned ones in `terrain-structure` grey.
