// Writes components/<Comp>/preview.html for every component (and the Skirmish showcase page).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const comp = join(here, '..', 'project', 'components');

const page = (marker, title, js, extraCss = '') => `${marker}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title} — preview</title>
<style>body{margin:0;background:var(--void);color:var(--ink);font-family:var(--font-sans)}${extraCss}</style>
</head>
<body>
<div id="root" class="aw-stage"></div>
<script>
  var A = window.Ascendant, h = React.createElement;
${js}
</script>
</body>
</html>
`;

const P = {
  Button: ['<!-- @dsCard group="Actions" height=80 subtitle="primary · secondary · danger · ghost" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    h(A.Button, { variant: 'primary', hotkey: 'Z' }, 'Deploy'),
    h(A.Button, { hotkey: 'X' }, 'Cancel'),
    h(A.Button, { variant: 'danger' }, 'Resign'),
    h(A.Button, { variant: 'ghost' }, 'Skip'),
    h(A.Button, { size: 'sm' }, 'Intel'),
    h(A.Button, { disabled: true }, 'Overclock')));`],
  CommandMenu: ['<!-- @dsCard group="Actions" height=240 subtitle="the after-move menu" -->', `
  function Demo() {
    var s = React.useState('fire');
    return h(React.Fragment, null,
      h(A.CommandMenu, { title: 'Lancer', activeId: s[0], onSelect: s[1], items: [
        { id: 'fire', label: 'Fire', hint: '3' }, { id: 'capture', label: 'Capture' }, { id: 'wait', label: 'Wait' }] }),
      h(A.CommandMenu, { activeId: 'end', items: [
        { id: 'end', label: 'End turn', hint: 'R' }, { id: 'co', label: 'CO', hint: 'C' }, { id: 'intel', label: 'Intel' }, { id: 'opts', label: 'Options' }, { id: 'suspend', label: 'Suspend' }] }));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(Demo));`],
  BuildMenu: ['<!-- @dsCard group="Actions" height=420 subtitle="fabricator production; unaffordable rows grey out" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(
    h(A.BuildMenu, { faction: 'helion', funds: 9000, activeId: 'lancer', items: ['trooper', 'breacher', 'skimmer', 'lancer', 'mule', 'arc', 'warden', 'bastion'] }));`],
  StatusChip: ['<!-- @dsCard group="Status" height=72 subtitle="every status carries a word and an icon" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    h(A.StatusChip, null, 'Waited'),
    h(A.StatusChip, { tone: 'signal' }, 'Surge ready'),
    h(A.StatusChip, { tone: 'warn' }, 'Low charge'),
    h(A.StatusChip, { tone: 'danger' }, 'Critical'),
    h(A.StatusChip, { tone: 'faction', faction: 'tidewell' }, 'Tidewell'),
    h(A.StatusChip, { tone: 'faction', faction: 'choir' }, 'Hollow Choir')));`],
  Sigil: ['<!-- @dsCard group="Status" height=96 subtitle="five nations and ECHO" -->', `
  var row = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir', null].map(function (f) {
    return h('div', { key: f || 'echo', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } },
      h(A.Sigil, { faction: f, size: 40, title: f || 'ECHO' }),
      h('span', { className: 'caption aw-muted' }, f ? A.data.factions.find(function (x) { return x.id === f; }).short : 'ECHO'));
  });
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null, row));`, '.aw-stage{gap:28px}'],
  UnitToken: ['<!-- @dsCard group="Battlefield" height=200 subtitle="all 16 units; HP, status, acted and selected states" -->', `
  var ids = A.data.units.map(function (u) { return u.id; });
  var fs = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];
  var units = ids.map(function (id, i) { return h(A.UnitToken, { key: id, unit: id, faction: fs[i % 5], facing: i % 2 ? 'left' : 'right' }); });
  var states = [
    h(A.UnitToken, { key: 'a', unit: 'lancer', faction: 'helion', hp: 7 }),
    h(A.UnitToken, { key: 'b', unit: 'trooper', faction: 'tidewell', hp: 3, status: 'capturing' }),
    h(A.UnitToken, { key: 'c', unit: 'wasp', faction: 'verdant', status: 'low-charge' }),
    h(A.UnitToken, { key: 'd', unit: 'mule', faction: 'kestrel', status: 'loaded' }),
    h(A.UnitToken, { key: 'e', unit: 'bastion', faction: 'choir', hp: 5, status: 'low-ammo' }),
    h(A.UnitToken, { key: 'f', unit: 'arc', faction: 'helion', spent: true }),
    h(A.UnitToken, { key: 'g', unit: 'raptor', faction: 'tidewell', selected: true })];
  ReactDOM.createRoot(document.getElementById('root')).render(h('div', null,
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, units),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 } }, states)));`],
  MapTile: ['<!-- @dsCard group="Battlefield" height=232 subtitle="15 terrains, owned properties, ranges, cursor, fog" -->', `
  var t = A.data.terrain.map(function (x) { return h(A.MapTile, { key: x.id, terrain: x.id }); });
  var owned = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'].map(function (f, i) { return h(A.MapTile, { key: f, terrain: ['fabricator', 'arcology', 'skyport', 'spire', 'uplink'][i], owner: f }); });
  var states = [
    h(A.MapTile, { key: 'm', terrain: 'flats', overlay: 'move' }),
    h(A.MapTile, { key: 'm2', terrain: 'canopy', overlay: 'move', cursor: 'select' }, h(A.UnitToken, { unit: 'lancer', faction: 'helion', selected: true })),
    h(A.MapTile, { key: 'a', terrain: 'flats', overlay: 'attack' }),
    h(A.MapTile, { key: 'a2', terrain: 'ridge', overlay: 'attack', cursor: 'target' }, h(A.UnitToken, { unit: 'trooper', faction: 'tidewell', hp: 6, facing: 'left' })),
    h(A.MapTile, { key: 'f', terrain: 'canopy', fog: true })];
  ReactDOM.createRoot(document.getElementById('root')).render(h('div', null,
    h('div', { style: { display: 'flex', flexWrap: 'wrap' } }, t),
    h('div', { style: { display: 'flex', gap: 12, marginTop: 16 } }, h('div', { style: { display: 'flex' } }, owned), h('div', { style: { display: 'flex', gap: 6 } }, states))));`],
  TerrainCard: ['<!-- @dsCard group="Intel" height=176 subtitle="defense stars and capture progress" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    h(A.TerrainCard, { terrain: 'ridge' }),
    h(A.TerrainCard, { terrain: 'fabricator', owner: 'tidewell', capture: 12 }),
    h(A.TerrainCard, { terrain: 'uplink' })));`],
  UnitCard: ['<!-- @dsCard group="Intel" height=232 subtitle="HP, charge and ammo with warnings" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    h(A.UnitCard, { unit: 'lancer', faction: 'helion', hp: 8, charge: 52, ammo: 6 }),
    h(A.UnitCard, { unit: 'wasp', faction: 'verdant', hp: 3, charge: 14, ammo: 1 }),
    h(A.UnitCard, { unit: 'trooper', faction: 'kestrel', hp: 10 })));`],
  BattleForecast: ['<!-- @dsCard group="Intel" height=232 subtitle="damage and counter before you commit" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    h(A.BattleForecast, { attacker: { unit: 'lancer', faction: 'helion', hp: 10 }, defender: { unit: 'trooper', faction: 'tidewell', hp: 10 }, damage: [56, 64], counter: [4, 6] }),
    h(A.BattleForecast, { attacker: { unit: 'arc', faction: 'helion', hp: 9 }, defender: { unit: 'warden', faction: 'choir', hp: 4 }, damage: [68, 76], counter: null })));`],
  CommanderPortrait: ['<!-- @dsCard group="Commanders" height=152 subtitle="frame and monogram until painted art lands" -->', `
  var cs = A.data.commanders.filter(function (c) { return ['ren', 'sefa', 'maru', 'corvin', 'cantor', 'echo'].indexOf(c.id) > -1; });
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    cs.map(function (c, i) { return h(A.CommanderPortrait, { key: c.id, name: c.name, faction: c.faction, initials: c.initials, state: i === 1 ? 'surge' : i === 3 ? 'overclock' : undefined }); }),
    h(A.CommanderPortrait, { name: 'Juno Reyes-Abara', faction: 'verdant', initials: 'JR', size: 48 })));`],
  PowerMeter: ['<!-- @dsCard group="Commanders" height=120 subtitle="small diamonds charge Surge, large ones Overclock" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    h(A.PowerMeter, { value: 1.6, surge: 3, max: 6 }),
    h(A.PowerMeter, { value: 3.4, surge: 3, max: 6 }),
    h(A.PowerMeter, { value: 7, surge: 3, max: 7 })));`],
  PlayerHud: ['<!-- @dsCard group="Commanders" height=112 subtitle="top corner of the battlefield" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
    h(A.PlayerHud, { commander: { name: 'Ren Okafor', faction: 'helion', initials: 'RO' }, funds: 12400, cycle: 4, power: { value: 2.3, surge: 3, max: 6 } }),
    h(A.PlayerHud, { commander: { name: 'Cantor', faction: 'choir', initials: 'C' }, funds: 31000, power: { value: 7, surge: 3, max: 7 } })));`],
  DialogueBox: ['<!-- @dsCard group="Story" height=360 subtitle="the story voice; ECHO speaks in signal" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, width: '100%' } },
    h(A.DialogueBox, { speaker: { name: 'ECHO', faction: null, initials: 'E', title: 'Tactical adjutant' }, channel: 'Tactical channel · encrypted' },
      'Enemy Lancer, eight tiles out. Recommendation: do not stand in front of it. That is the whole recommendation.'),
    h(A.DialogueBox, { side: 'right', speaker: { name: 'Sefa Tamura', faction: 'tidewell', initials: 'ST', title: 'Fleet Admiral' } },
      'The tide does not hurry, Captain. It simply arrives.')));`],
  TurnBanner: ['<!-- @dsCard group="Story" height=280 subtitle="sweeps across at the start of each turn" -->', `
  ReactDOM.createRoot(document.getElementById('root')).render(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, width: '100%' } },
    h(A.TurnBanner, { cycle: 4, faction: 'helion', commander: 'Ren Okafor' }),
    h(A.TurnBanner, { cycle: 4, faction: 'kestrel', commander: 'Corvin Ashgrave' }),
    h(A.TurnBanner, { cycle: 12, faction: 'choir', commander: 'VESPER' })));`],
  Skirmish: ['<!-- @dsCard group="Showcase" height=640 page subtitle="the components together on a battlefield" -->', `
  var rows = [
    '..f.=....~~',
    '.Ff.=.^^.~~',
    '...f=.^C.s~',
    'rrr#rrr..s~',
    '..C.=..f.Ds',
    '.U..=..fF..',
    '....=......'];
  var owners = {'1,1': 'helion', '8,5': 'tidewell', '7,2': 'tidewell', '9,4': 'tidewell', '2,4': 'helion'};
  var codes = { '.': 'flats', f: 'canopy', '^': 'ridge', '=': 'maglev', '#': 'span', r: 'river', '~': 'sea', s: 'shoal', C: 'arcology', F: 'fabricator', D: 'dock', U: 'uplink' };
  var units = { '4,2': ['lancer', 'helion', 10], '2,2': ['trooper', 'helion', 7], '6,4': ['arc', 'helion', 10, true], '7,1': ['trooper', 'tidewell', 6], '8,4': ['warden', 'tidewell', 9], '10,1': ['picket', 'tidewell', 10] };
  var move = ['4,1', '4,0', '5,2', '4,3', '3,2', '5,1', '5,3', '3,1', '6,2', '4,4', '5,0'];
  var attack = ['7,1', '6,1', '7,2'];
  function Board() {
    var grid = rows.map(function (r, y) {
      return h('div', { key: y, style: { display: 'flex' } }, r.split('').map(function (ch, x) {
        var k = x + ',' + y, u = units[k];
        return h(A.MapTile, { key: k, terrain: codes[ch], owner: owners[k], overlay: move.indexOf(k) > -1 ? 'move' : attack.indexOf(k) > -1 ? 'attack' : undefined, cursor: k === '6,1' ? 'select' : undefined },
          u && h(A.UnitToken, { unit: u[0], faction: u[1], hp: u[2], spent: u[3], selected: k === '4,2', facing: u[1] === 'tidewell' ? 'left' : 'right' }));
      }));
    });
    return h('div', { style: { position: 'relative', width: 528 + 8 + 360, display: 'flex', gap: 16, alignItems: 'flex-start' } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(A.PlayerHud, { commander: { name: 'Ren Okafor', faction: 'helion', initials: 'RO' }, funds: 12400, cycle: 4, power: { value: 2.3, surge: 3, max: 6 } }),
        h('div', { style: { boxShadow: '0 0 0 1px var(--line-strong)' } }, grid),
        h(A.DialogueBox, { speaker: { name: 'ECHO', faction: null, initials: 'E' }, channel: 'Tactical channel' }, 'Lancer in range of the Trooper on the ridge. Ridge is four stars. Expect less than you hope.')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(A.CommandMenu, { title: 'Lancer', activeId: 'fire', items: [{ id: 'fire', label: 'Fire' }, { id: 'wait', label: 'Wait' }] }),
        h(A.BattleForecast, { attacker: { unit: 'lancer', faction: 'helion', hp: 10 }, defender: { unit: 'trooper', faction: 'tidewell', hp: 6 }, damage: [27, 31], counter: [2, 3] }),
        h(A.TerrainCard, { terrain: 'ridge' })));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(Board));`],
};

for (const [name, [marker, js, css]] of Object.entries(P)) {
  const dir = join(comp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'preview.html'), page(marker, name, js, css));
}
console.log('wrote', Object.keys(P).length, 'previews');
