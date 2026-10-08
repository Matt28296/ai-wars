import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './game.src.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const proj = join(here, '..', 'project');
const repo = join(here, '..', '..');
const story = readFileSync(join(repo, 'docs', 'STORY.md'), 'utf8');
const between = (a, b) => { const i = story.indexOf(a); const j = b ? story.indexOf(b, i + a.length) : story.length; return story.slice(i, j).trim(); };

// World & campaign: setting, factions, secret, campaign, epilogue
const world = ['# World and campaign', '',
  'The canon every screen, briefing and line of dialogue draws from.', '',
  between('## The premise in one breath', '## Commanders').replace(/^## /gm, '## '),
].join('\n');
writeFileSync(join(proj, '01-world.md'), world + '\n');

// Commanders + writing rules
const cos = ['# Commanders', '',
  'Eleven commanders: two per nation, the Choir’s two voices, and ECHO. Every one has a passive doctrine, a **Surge** (small power) and an **Overclock** (super power); all powers also add +10% firepower and +10% defense while active. Write every line in the commander’s voice below.', '',
  between('### Rook Okafor', '## Writing rules for dialogue').replace(/^### /gm, '## '), '',
  between('## Writing rules for dialogue'),
].join('\n');
writeFileSync(join(proj, '02-commanders.md'), cos + '\n');

// Units
const mt = G.moveTypes;
const range = (r) => (!r ? '—' : r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`);
let u = '# Units\n\nSixteen units in three domains. Costs are in credits; charge is fuel (air units burn 5 per cycle and crash at 0; naval units burn 1 and sink). Each unit has a filled glyph in `assets/Units` and is drawn on the battlefield by `UnitToken`.\n\n';
for (const dom of ['ground', 'air', 'sea']) {
  u += `## ${dom === 'ground' ? 'Ground' : dom === 'air' ? 'Air' : 'Naval'}\n\n| Unit | Role | Cost | Move | Type | Vision | Charge | Ammo | Range | Notes |\n|---|---|---:|---:|---|---:|---:|---:|---|---|\n`;
  for (const x of G.units.filter((z) => z.domain === dom)) {
    const notes = [x.captures && 'captures', x.carries && `carries ${x.carries}`, x.supplies && 'resupplies', x.range && x.range[0] > 1 && 'indirect: can’t move and fire'].filter(Boolean).join('; ');
    u += `| **${x.name}** | ${x.role} | ${x.cost.toLocaleString('en-US')} | ${x.move} | ${mt[x.moveType]} | ${x.vision} | ${x.charge} | ${x.ammo ?? '—'} | ${range(x.range)} | ${notes} |\n`;
  }
  u += '\n';
}
u += `## Movement types\n\n- **Foot** (Trooper) and **Exo** (Breacher): go almost anywhere; Exo climbs ridges at 1.\n- **Hover** (Skimmer, Lancer, Mule): the futuristic twist — crosses rivers and shoals at cost 1, but canopy costs 3 and ridges are closed.\n- **Tread** (Bastion, Arc Battery, Salvo, Warden): heavy and grounded; no rivers or ridges, glass waste costs 2.\n- **Walker** (Colossus): climbs ridges at 2.\n- **Air**: every tile costs 1; no terrain defense.\n- **Sea** / **Barge**: water only; Barges also beach on shoals to unload.\n`;
writeFileSync(join(proj, '03-units.md'), u);

// Terrain
let t = '# Terrain\n\nFifteen kinds of ground. Defense stars reduce damage taken (air units ignore them); move costs are per movement type, — is impassable. Properties earn 1,000 CR a cycle and repair the domain they build. Art for each is in `assets/Terrain`; the battlefield draws them with `MapTile`.\n\n';
t += '| Terrain | Code | Stars | Foot | Exo | Hover | Tread | Walker | Air | Sea | Barge | Note |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n';
const codes = { flats: '.', canopy: 'f', ridge: '^', maglev: '=', span: '#', river: 'r', sea: '~', shoal: 's', glass: 'g', arcology: 'C', fabricator: 'F', skyport: 'A', dock: 'D', uplink: 'U', spire: 'H' };
for (const x of G.terrain) {
  const c = (k) => (x.cost[k] == null ? '—' : x.cost[k]);
  t += `| **${x.name}** | \`${codes[x.id]}\` | ${x.def} | ${c('foot')} | ${c('exo')} | ${c('hover')} | ${c('tread')} | ${c('walker')} | ${c('air')} | ${c('sea')} | ${c('barge')} | ${x.note} |\n`;
}
t += '\nThe code column is the character used in map files. Properties are drawn in their owner’s faction fill with `on-` coloured detail; unowned ones in `terrain-structure` grey.\n';
writeFileSync(join(proj, '04-terrain.md'), t);
console.log('sections written');
