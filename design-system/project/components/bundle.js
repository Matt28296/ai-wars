/* @ds-bundle: {"format":4,"namespace":"Ascendant","components":[{"name":"Button"},{"name":"CommandMenu"},{"name":"BuildMenu"},{"name":"StatusChip"},{"name":"Sigil"},{"name":"UnitToken"},{"name":"MapTile"},{"name":"TerrainCard"},{"name":"UnitCard"},{"name":"BattleForecast"},{"name":"CommanderPortrait"},{"name":"PowerMeter"},{"name":"PlayerHud"},{"name":"DialogueBox"},{"name":"TurnBanner"}]} */
(() => {
  const React = window.React;
  const h = React.createElement;
  const DATA = {"factions":[{"id":"helion","name":"Helion Accord","short":"Helion","motto":"Light holds the line.","home":"The Sunward Plains"},{"id":"tidewell","name":"Tidewell Union","short":"Tidewell","motto":"The tide answers to order.","home":"The Arcology Coast"},{"id":"verdant","name":"Verdant Compact","short":"Verdant","motto":"What grows, endures.","home":"The Canopy Highlands"},{"id":"kestrel","name":"Kestrel Dominion","short":"Kestrel","motto":"Height is the first advantage.","home":"The Tether Ridges"},{"id":"choir","name":"The Hollow Choir","short":"Choir","motto":"We have counted your wars.","home":"The Glass Waste"}],"units":[{"id":"trooper","name":"Trooper","role":"Exo-rifle squad","domain":"ground","move":3,"moveType":"foot","cost":1000,"vision":2,"charge":99,"ammo":null,"range":[1,1],"captures":true},{"id":"breacher","name":"Breacher","role":"Heavy exo, rail launcher","domain":"ground","move":2,"moveType":"exo","cost":3000,"vision":2,"charge":70,"ammo":3,"range":[1,1],"captures":true},{"id":"skimmer","name":"Skimmer","role":"Hover scout","domain":"ground","move":8,"moveType":"hover","cost":4000,"vision":5,"charge":80,"ammo":null,"range":[1,1]},{"id":"lancer","name":"Lancer","role":"Hover tank","domain":"ground","move":6,"moveType":"hover","cost":7000,"vision":3,"charge":70,"ammo":9,"range":[1,1]},{"id":"bastion","name":"Bastion","role":"Heavy grav-tank","domain":"ground","move":5,"moveType":"tread","cost":16000,"vision":2,"charge":50,"ammo":8,"range":[1,1]},{"id":"colossus","name":"Colossus","role":"Siege walker","domain":"ground","move":4,"moveType":"walker","cost":28000,"vision":2,"charge":50,"ammo":3,"range":[1,1]},{"id":"mule","name":"Mule","role":"Hover transport","domain":"ground","move":6,"moveType":"hover","cost":5000,"vision":1,"charge":70,"ammo":null,"range":null,"carries":1,"supplies":true},{"id":"arc","name":"Arc Battery","role":"Rail artillery","domain":"ground","move":5,"moveType":"tread","cost":6000,"vision":1,"charge":50,"ammo":9,"range":[2,3]},{"id":"salvo","name":"Salvo","role":"Missile platform","domain":"ground","move":5,"moveType":"tread","cost":15000,"vision":1,"charge":50,"ammo":6,"range":[3,5]},{"id":"warden","name":"Warden","role":"Point-defense laser","domain":"ground","move":6,"moveType":"tread","cost":8000,"vision":2,"charge":60,"ammo":9,"range":[1,1]},{"id":"wasp","name":"Wasp","role":"Gunship drone","domain":"air","move":6,"moveType":"air","cost":9000,"vision":3,"charge":99,"ammo":6,"range":[1,1]},{"id":"raptor","name":"Raptor","role":"Air superiority","domain":"air","move":9,"moveType":"air","cost":20000,"vision":2,"charge":99,"ammo":9,"range":[1,1]},{"id":"anvil","name":"Anvil","role":"Strike bomber","domain":"air","move":7,"moveType":"air","cost":22000,"vision":2,"charge":99,"ammo":9,"range":[1,1]},{"id":"picket","name":"Picket","role":"Escort cruiser","domain":"sea","move":6,"moveType":"sea","cost":18000,"vision":3,"charge":99,"ammo":9,"range":[1,1]},{"id":"dreadnought","name":"Dreadnought","role":"Rail battleship","domain":"sea","move":5,"moveType":"sea","cost":28000,"vision":2,"charge":99,"ammo":9,"range":[2,6]},{"id":"barge","name":"Barge","role":"Landing craft","domain":"sea","move":6,"moveType":"barge","cost":12000,"vision":1,"charge":99,"ammo":null,"range":null,"carries":2}],"terrain":[{"id":"flats","name":"Flats","note":"Open ground.","def":1,"cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"canopy","name":"Canopy","note":"Hides units in fog. Hover pays 3.","def":2,"cost":{"foot":1,"exo":1,"hover":3,"tread":2,"walker":2,"air":1,"sea":null,"barge":null}},{"id":"ridge","name":"Ridge","note":"Foot +1 vision. No hover or treads.","def":4,"cost":{"foot":2,"exo":1,"hover":null,"tread":null,"walker":2,"air":1,"sea":null,"barge":null}},{"id":"maglev","name":"Maglev","note":"Fast and exposed.","def":0,"cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"span","name":"Span","note":"Bridge over water.","def":0,"cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"river","name":"River","note":"Hover crosses freely. No treads.","def":0,"cost":{"foot":2,"exo":1,"hover":1,"tread":null,"walker":null,"air":1,"sea":null,"barge":null}},{"id":"sea","name":"Sea","note":"Naval and air only.","def":0,"cost":{"foot":null,"exo":null,"hover":null,"tread":null,"walker":null,"air":1,"sea":1,"barge":1}},{"id":"shoal","name":"Shoal","note":"Barges land here.","def":0,"cost":{"foot":1,"exo":1,"hover":1,"tread":2,"walker":2,"air":1,"sea":null,"barge":1}},{"id":"glass","name":"Glass Waste","note":"Treads pay 2.","def":1,"cost":{"foot":1,"exo":1,"hover":1,"tread":2,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"arcology","name":"Arcology","note":"Income; repairs ground units.","def":3,"property":true,"income":1000,"cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"fabricator","name":"Fabricator","note":"Builds ground units.","def":3,"property":true,"income":1000,"builds":"ground","cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"skyport","name":"Skyport","note":"Builds air units.","def":3,"property":true,"income":1000,"builds":"air","cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"dock","name":"Dock","note":"Builds naval units.","def":3,"property":true,"income":1000,"builds":"sea","cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":1,"barge":1}},{"id":"uplink","name":"Uplink","note":"+10% firepower to its owner.","def":3,"property":true,"income":0,"boost":10,"cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}},{"id":"spire","name":"Command Spire","note":"Command Spire. Lose it, lose the war.","def":4,"property":true,"income":1000,"hq":true,"cost":{"foot":1,"exo":1,"hover":1,"tread":1,"walker":1,"air":1,"sea":null,"barge":null}}],"moveTypes":{"foot":"Foot","exo":"Exo","hover":"Hover","tread":"Tread","walker":"Walker","air":"Air","sea":"Sea","barge":"Barge"},"commanders":[{"id":"ren","name":"Ren Okafor","initials":"RO","faction":"helion","title":"Field Captain"},{"id":"ilse","name":"Ilse Varga","initials":"IV","faction":"helion","title":"Marshal"},{"id":"sefa","name":"Sefa Tamura","initials":"ST","faction":"tidewell","title":"Fleet Admiral"},{"id":"dax","name":"Dax Halloran","initials":"DH","faction":"tidewell","title":"Commissioner of Logistics"},{"id":"maru","name":"Maru Ingram","initials":"MI","faction":"verdant","title":"Grove Elder"},{"id":"juno","name":"Juno Reyes-Abara","initials":"JR","faction":"verdant","title":"Wing Lead"},{"id":"corvin","name":"Corvin Ashgrave","initials":"CA","faction":"kestrel","title":"Highlord"},{"id":"sable","name":"Sable Ashgrave","initials":"SA","faction":"kestrel","title":"Night Wing Commander"},{"id":"cantor","name":"Cantor","initials":"C","faction":"choir","title":"Voice of the Choir"},{"id":"vesper","name":"VESPER","initials":"V","faction":"choir","title":"The Choir Itself"},{"id":"echo","name":"ECHO","initials":"E","faction":null,"title":"Tactical Adjutant"}],"art":{"glyphs":{"trooper":["M10 2h4l1 1v3.5l-1 1h-4l-1-1V3z","M8 8.5h8l1.5 6.5H15v6.5h-2.5V17h-1v4.5H9V15H6.5z","M14.5 10.5H22v2h-7.5z"],"breacher":["M10 1.5h4l1 1V5h-6V2.5z","M3 5.5h15v3H3z","M18 4.5h2.5v5H18z","M6 9h11l1 7h-2.5v5.5h-3V17h-1v4.5h-3V16H5z"],"skimmer":["M9 5.5h3.5l2 4.5H8z","M2 14.5l4-4h9.5l6.5 3.8V16H2z","M4 17.5h6v2.2H4z","M14 17.5h6v2.2h-6z"],"lancer":["M7 8.5h8.5l1 4.5H6z","M15.5 9.5H22v2h-6.5z","M2 13h20l-2.2 4.5H4.2z","M5 18.8h14v1.7H5z"],"bastion":["M6 6.5h10v5H6z","M16 7.2h6v1.6h-6z","M16 9.6h6v1.6h-6z","M2 11.5h20v5H2z","M4 17h16l2 2-2 2H4l-2-2z"],"colossus":["M5 3.5h13v9.5H5z","M18 5.5h5v2h-5z","M18 9h5v2h-5z","M6 13h3v6H6z","M14 13h3v6h-3z","M4 19h7v2.5H4z","M12 19h7v2.5h-7z"],"mule":["M2 8.5h14.5l5.5 4.5v4.5H2zM15.5 10.2v3.3h4z","M4 19h15v1.7H4z"],"arc":["M9.2 11.6 20 3.5l1.4 1.9-10.8 8.1z","M5.5 10.5h6.5V14H5.5z","M2 14h16v4H2z","M3 18.5h14l1.5 1.3L17 21H3l-1.5-1.2z"],"salvo":["M4 13V8.6L18.5 5v8zM6.5 9.8l9.5-2.3v1.3l-9.5 2.3zm0 2.4 9.5-1.6v1.3l-9.5 1.4z","M2 14h19.5v4H2z","M3 18.5h17l1.5 1.3L20 21H3l-1.5-1.2z"],"warden":["M11.3 10.4 17.5 3l1.4 1.2-6.2 7.4z","M14.1 11.2 20.3 3.8l1.4 1.2-6.2 7.4z","M8 10.5h8V15H8z","M2 15h20v3H2z","M3 18.5h18L19.5 21h-15z"],"wasp":["M2 5.5h20v1.6H2z","M11 7h2v3h-2z","M4 10h11l5 3-5 3H4l-2-3z","M16 14.8h5.5v1.6H16z","M8 16h1.5v2H8z","M12 16h1.5v2H12z","M6 18h9v1.6H6z"],"raptor":["M12 1.5l2 6 7.5 6.5v2.5L14 14l-.8 5 3.3 2.5V23h-9v-1.5L10.8 19 10 14l-7.5 2.5V14L10 7.5z"],"anvil":["M12 4l11 9v3.2l-3.2-1.1-2 2-3-1.6L12 18l-2.8-2.5-3 1.6-2-2L1 16.2V13z"],"picket":["M11 3.5h2V10h-2z","M8.5 5h7v1.6h-7z","M8 10h8v5H8z","M16 11.5h5.5v1.6H16z","M1 15h22l-3 5H4z"],"dreadnought":["M10 6.5h4V14h-4z","M3 11h5v3H3z","M1 11.6h2v1.4H1z","M15 11h5v3h-5z","M20 11.6h3v1.4h-3z","M1 14h22l-2.5 6h-17z"],"barge":["M2 7h5v6H2z","M2 13h14.5l5.5 3-2.2 4H2z"]},"sigils":{"helion":[{"d":"M12 3.5l9 9h-5l-4-4-4 4H3z"},{"d":"M11 14.5h2V21h-2z"},{"d":"M4.6 16.4 6 15l3.6 3.6-1.4 1.4z"},{"d":"M19.4 16.4 18 15l-3.6 3.6 1.4 1.4z"}],"tidewell":[{"d":"M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 1 1 0-19zM12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11zM12 9.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 1 1 0-4.5z","evenodd":true}],"verdant":[{"d":"M12 2.5l9.8 18H2.2zM12 9l-1.3 9h2.6z","evenodd":true}],"kestrel":[{"d":"M12 2l4 6-4 14-4-14z"},{"d":"M1.5 7.5h6.2l2 4.4-8.2-1.4z"},{"d":"M22.5 7.5h-6.2l-2 4.4 8.2-1.4z"}],"choir":[{"d":"M12 1.8l8.8 5.1v10.2L12 22.2l-8.8-5.1V6.9zM12 6.2 7 9.1v5.8l5 2.9 5-2.9V9.1z","evenodd":true},{"d":"M4.6 19.1 18.1 3.9l1.4 1.3L6 20.4z"}],"echo":[{"d":"M2.5 2.5h8V5H5v5.5H2.5zM21.5 2.5h-8V5H19v5.5h2.5zM2.5 21.5h8V19H5v-5.5H2.5zM21.5 21.5h-8V19H19v-5.5h2.5zM10 10h4v4h-4z"}]},"terrain":{"flats":{"base":"terrain-flats","shapes":[{"c":"terrain-flats-detail","d":"M5 8h3v1.5H5zM20 5h3v1.5h-3zM13 17h3v1.5h-3zM24 23h3v1.5h-3zM6 25h3v1.5H6z"}]},"canopy":{"base":"terrain-canopy","shapes":[{"c":"terrain-canopy-detail","d":"M9 5.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 1 1 0-11zM23 4a5 5 0 1 1 0 10 5 5 0 1 1 0-10zM16 15a6.5 6.5 0 1 1 0 13 6.5 6.5 0 1 1 0-13z"}]},"ridge":{"base":"terrain-ridge","shapes":[{"c":"terrain-ridge-detail","d":"M12 4l9.5 18H12zM24 13l6.5 13H24z"},{"c":"terrain-flats","d":"M0 27h32v5H0z"}]},"maglev":{"base":"terrain-flats","shapes":[{"c":"terrain-maglev","d":"M0 10h32v12H0z"},{"c":"terrain-maglev-detail","d":"M0 15.25h32v1.5H0z"}]},"span":{"base":"terrain-sea","shapes":[{"c":"terrain-maglev","d":"M0 9h32v14H0z"},{"c":"terrain-structure-detail","d":"M0 9h32v1.5H0zM0 21.5h32V23H0z"},{"c":"terrain-maglev-detail","d":"M0 15.25h32v1.5H0z"}]},"river":{"base":"terrain-flats","shapes":[{"c":"terrain-sea-detail","d":"M0 11c6-3 10 3 16 0s10-3 16 0v10c-6-3-10 3-16 0s-10-3-16 0z"}]},"sea":{"base":"terrain-sea","shapes":[{"c":"terrain-sea-detail","d":"M4 7h7v1.5H4zM18 12h8v1.5h-8zM7 20h7v1.5H7zM20 25h7v1.5h-7z"}]},"shoal":{"base":"terrain-shoal","shapes":[{"c":"terrain-sea-detail","d":"M0 20c8-3 15 4 32-2v14H0z"}]},"glass":{"base":"terrain-glass","shapes":[{"c":"terrain-glass-detail","d":"M3 4l9 5-6 6zM18 3l11 4-7 7zM9 21l8-3 4.5 10-9.5 1.5z"}]},"arcology":{"base":"terrain-flats","shapes":[{"c":"struct","d":"M4 11h7v18H4zM13 3h7v26h-7zM22 14h6v15h-6z"},{"c":"struct-detail","d":"M6 14h3v2H6zM6 19h3v2H6zM15 6h3v2h-3zM15 11h3v2h-3zM15 16h3v2h-3zM15 21h3v2h-3zM24 17h2v2h-2zM24 22h2v2h-2z"}]},"fabricator":{"base":"terrain-flats","shapes":[{"c":"struct","d":"M3 14l8-5v5l8-5v5l9-5.5V29H3z"},{"c":"struct-detail","d":"M12 21h8v8h-8zM5 17h4v2H5zM23 17h3v2h-3z"}]},"skyport":{"base":"terrain-flats","shapes":[{"c":"struct","d":"M2 20h28v7H2zM22 7h4v13h-4zM19.5 4h9v4h-9z"},{"c":"struct-detail","d":"M5 23h4v1.2H5zM12 23h4v1.2h-4zM19 23h4v1.2h-4zM21 5.3h6.5v1.4H21z"}]},"dock":{"base":"terrain-sea","shapes":[{"c":"terrain-shoal","d":"M0 0h11v32H0z"},{"c":"struct","d":"M8 13h20v6H8zM20 4h3.5v9H20zM15 3h13v2.5H15z"},{"c":"struct-detail","d":"M10 15h3v2h-3zM15 15h3v2h-3zM15 5.5h1.5v5H15z"}]},"uplink":{"base":"terrain-flats","shapes":[{"c":"struct","d":"M14 9h4v18h-4zM10 26h12v3.5H10zM11 6h10v3H11z"},{"c":"struct-detail","d":"M15 12h2v2h-2zM15 17h2v2h-2zM15 22h2v2h-2z"},{"c":"struct","d":"M6.6 2.6l1.3.9a8 8 0 0 0 0 7.9l-1.3.9a9.5 9.5 0 0 1 0-9.7zM25.4 2.6l-1.3.9a8 8 0 0 1 0 7.9l1.3.9a9.5 9.5 0 0 0 0-9.7z"}]},"spire":{"base":"terrain-flats","shapes":[{"c":"struct","d":"M16 1.5l5 8V29H11V9.5zM5 15h5v14H5zM22 15h5v14h-5z"},{"c":"struct-detail","d":"M14.5 12h3v2h-3zM14.5 17h3v2h-3zM14.5 22h3v2h-3zM6.5 18h2v2h-2zM23.5 18h2v2h-2z"}]}}}};

  const cx = (...a) => a.filter(Boolean).join(' ');
  const byId = (list) => list.reduce((m, x) => ((m[x.id] = x), m), {});
  const UNITS = byId(DATA.units);
  const TERRAIN = byId(DATA.terrain);
  const FACTIONS = byId(DATA.factions);

  // Colour roles. faction null/undefined = ECHO / the interface itself, painted in signal.
  const fillOf = (f) => (f ? `var(--${f})` : 'var(--signal)');
  const onOf = (f) => (f ? `var(--on-${f})` : 'var(--on-signal)');
  const inkOf = (f) => (f ? `var(--${f}-ink)` : 'var(--signal)');
  // Sigils on map-shade chips: the fill reads on near-black for every faction except obsidian Choir.
  const markOf = (f) => (f === 'choir' ? 'var(--on-choir)' : fillOf(f));
  const factionName = (f) => (f ? (FACTIONS[f] || {}).name || f : 'ECHO');
  const factionShort = (f) => (f ? (FACTIONS[f] || {}).short || f : 'ECHO');
  const pad2 = (n) => String(n).padStart(2, '0');
  const credits = (n) => Number(n).toLocaleString('en-US');

  const CHAMFER = (c) => `polygon(${c} 0, 100% 0, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, 0 100%, 0 ${c})`;

  // ---------- primitives ----------
  function Paths({ list, color, transform }) {
    return h('g', { transform, style: { fill: color } }, list.map((p, i) =>
      typeof p === 'string' ? h('path', { key: i, d: p }) : h('path', { key: i, d: p.d, fillRule: p.evenodd ? 'evenodd' : undefined })));
  }

  function Sigil({ faction, size = 24, tone = 'ink', title }) {
    const key = faction || 'echo';
    const color = tone === 'fill' ? markOf(faction) : tone === 'on' ? onOf(faction) : tone === 'current' ? 'currentColor' : inkOf(faction);
    const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
    return h('svg', { className: 'aw-sigil', width: size, height: size, viewBox: '0 0 24 24', ...a11y },
      h(Paths, { list: DATA.art.sigils[key] || [], color }));
  }

  function Frame({ size, raised, floating, className, style, children, as = 'div', ...rest }) {
    return h(as, { className: cx('aw-frame', size === 'sm' && 'aw-frame--sm', raised && 'aw-frame--raised', floating && 'aw-float', className), style, ...rest },
      h('div', { className: 'aw-frame-in' }, children));
  }

  const ICONS = {
    bolt: 'M7 1 2 7h3.5L4.5 11 10 5H6.5z',
    ammo: 'M4 1h4v2.5l1 1V11H3V4.5l1-1z',
    flag: 'M2.5 1H4v10H2.5zM4 1.5h6L8.5 4 10 6.5H4z',
    cargo: 'M1.5 3.5h9v7h-9zM4 3.5V1.5h4v2z',
    diamond: 'M6 .8 11.2 6 6 11.2.8 6z',
    cross: 'M2.5 1 6 4.5 9.5 1 11 2.5 7.5 6 11 9.5 9.5 11 6 7.5 2.5 11 1 9.5 4.5 6 1 2.5z',
    dot: 'M6 2a4 4 0 1 1 0 8 4 4 0 1 1 0-8z',
  };
  function Icon({ name, size = 12, color = 'currentColor' }) {
    return h('svg', { className: 'aw-icon', width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true }, h('path', { d: ICONS[name], style: { fill: color } }));
  }

  // ---------- Actions ----------
  function Button({ variant = 'secondary', size = 'md', hotkey, className, children, type = 'button', ...rest }) {
    return h('button', { type, className: cx('aw-btn', 'label', `aw-btn--${variant}`, size === 'sm' && 'aw-btn--sm', className), ...rest },
      h('span', null, children),
      hotkey && h('kbd', { className: 'aw-key' }, hotkey));
  }

  function CommandMenu({ title, items = [], activeId, onSelect, className }) {
    return h(Frame, { size: 'sm', raised: true, floating: true, className: cx('aw-menu', className) },
      title && h('div', { className: 'aw-menu-title caption' }, title),
      h('div', { role: 'menu', 'aria-label': title || 'Commands' }, items.map((it) => {
        const active = it.id === activeId;
        return h('button', {
          key: it.id, type: 'button', role: 'menuitem', disabled: it.disabled, 'aria-current': active ? 'true' : undefined,
          className: cx('aw-row', active && 'aw-row--active'), onClick: () => onSelect && onSelect(it.id),
        },
          h('span', { className: 'aw-row-cursor', 'aria-hidden': true }),
          h('span', { className: 'aw-row-label label' }, it.label),
          it.hint && h('span', { className: 'aw-row-hint stat-sm' }, it.hint));
      })));
  }

  function BuildMenu({ title = 'Fabricator', items, funds = 0, faction, activeId, onSelect, className }) {
    const list = (items || DATA.units.filter((u) => u.domain === 'ground').map((u) => u.id)).map((it) => (typeof it === 'string' ? { unit: it } : it));
    return h(Frame, { size: 'sm', raised: true, floating: true, className: cx('aw-build', className) },
      h('div', { className: 'aw-build-head' },
        h('span', { className: 'label', style: { color: 'var(--ink-muted)' } }, title),
        h('span', { className: 'stat-sm' }, credits(funds), h('span', { className: 'aw-unit-cr' }, ' CR'))),
      h('div', { role: 'menu', 'aria-label': `${title} build list` }, list.map((it) => {
        const u = UNITS[it.unit];
        const cost = it.cost != null ? it.cost : u.cost;
        const short = cost > funds;
        const active = it.unit === activeId;
        return h('button', {
          key: it.unit, type: 'button', role: 'menuitem', 'aria-disabled': short || undefined, 'aria-current': active ? 'true' : undefined,
          className: cx('aw-row', 'aw-build-row', active && 'aw-row--active', short && 'aw-row--short'),
          onClick: () => !short && onSelect && onSelect(it.unit),
        },
          h('span', { className: 'aw-row-cursor', 'aria-hidden': true }),
          h(UnitToken, { unit: it.unit, faction, size: 32, spent: short, decorative: true }),
          h('span', { className: 'aw-build-name' }, h('span', { className: 'aw-row-label label' }, u.name), h('span', { className: 'caption aw-muted' }, u.role)),
          h('span', { className: 'aw-row-hint stat-sm' }, credits(cost)));
      })));
  }

  // ---------- Status ----------
  const TONE_ICON = { signal: 'dot', warn: 'diamond', danger: 'cross' };
  function StatusChip({ tone = 'neutral', faction, icon, children, className }) {
    const style = tone === 'faction' ? { color: inkOf(faction), borderColor: inkOf(faction) } : undefined;
    const ic = icon === false ? null : icon || TONE_ICON[tone];
    return h('span', { className: cx('aw-chip', 'caption', `aw-chip--${tone}`, className), style },
      tone === 'faction' && icon !== false ? h(Sigil, { faction, size: 12, tone: 'ink' }) : ic && h(Icon, { name: ic, size: 10 }),
      h('span', null, children));
  }

  // ---------- Battlefield ----------
  const STATUS_ICON = { 'low-charge': ['bolt', 'var(--warn)'], 'low-ammo': ['ammo', 'var(--warn)'], capturing: ['flag', 'var(--signal)'], loaded: ['cargo', 'var(--map-ink)'] };
  const STATUS_WORD = { 'low-charge': 'low charge', 'low-ammo': 'low ammo', capturing: 'capturing', loaded: 'carrying cargo' };
  function UnitToken({ unit, faction = 'helion', hp = 10, spent, selected, facing = 'right', size = 48, status, decorative, className }) {
    const u = UNITS[unit] || UNITS.trooper;
    const hpShown = Math.max(0, Math.min(10, Math.ceil(hp)));
    const choir = faction === 'choir';
    const label = `${factionName(faction)} ${u.name}, ${hpShown} HP${spent ? ', has acted' : ''}${status ? ', ' + STATUS_WORD[status] : ''}`;
    const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
    const st = status && STATUS_ICON[status];
    return h('svg', { className: cx('aw-unit', spent && 'aw-unit--spent', selected && 'aw-unit--selected', className), width: size, height: size, viewBox: '0 0 48 48', ...a11y },
      h('g', { className: 'aw-unit-body' },
        h('polygon', { points: '12,6 42,6 42,36 36,42 6,42 6,12', style: { fill: fillOf(faction), stroke: choir ? 'var(--on-choir)' : 'var(--map-shade)', strokeWidth: choir ? 1.5 : 2, strokeLinejoin: 'round' } }),
        h(Paths, { list: DATA.art.glyphs[u.id], color: onOf(faction), transform: facing === 'left' ? 'translate(38,9) scale(-1.1667,1.1667)' : 'translate(10,9) scale(1.1667)' })),
      selected && h('polygon', { className: 'aw-unit-ring', points: '11,3.5 44.5,3.5 44.5,37 37,44.5 3.5,44.5 3.5,11' }),
      h('rect', { x: 1, y: 1, width: 15, height: 15, rx: 2, style: { fill: 'var(--map-shade)' } }),
      h('g', { transform: 'translate(2.5,2.5) scale(0.5)' }, h(Paths, { list: DATA.art.sigils[faction] || [], color: markOf(faction) })),
      st && h('g', null,
        h('rect', { x: 32, y: 1, width: 15, height: 15, rx: 2, style: { fill: 'var(--map-shade)' } }),
        h('path', { d: ICONS[st[0]], transform: 'translate(33.5,2.5)', style: { fill: st[1] } })),
      hpShown < 10 && h('g', null,
        h('rect', { x: 31, y: 31, width: 16, height: 16, rx: 2, style: { fill: 'var(--map-shade)' } }),
        h('text', { x: 39, y: 43.6, textAnchor: 'middle', className: 'aw-unit-hp', style: { fill: hpShown <= 3 ? 'var(--danger)' : 'var(--map-ink)' } }, hpShown)));
  }

  function Cursor({ kind }) {
    const target = kind === 'target';
    return h('svg', { className: cx('aw-cursor', target && 'aw-cursor--target'), viewBox: '0 0 48 48', 'aria-hidden': true },
      h('path', { d: 'M2 13V2h11M35 2h11v11M46 35v11H35M13 46H2V35' }),
      target && h('path', { d: 'M24 14v6M24 28v6M14 24h6M28 24h6' }));
  }

  function MapTile({ terrain = 'flats', owner, overlay, cursor, fog, size = 48, children, label, className, ...rest }) {
    const art = DATA.art.terrain[terrain] || DATA.art.terrain.flats;
    const t = TERRAIN[terrain] || TERRAIN.flats;
    const role = (c) => (c === 'struct' ? (owner ? fillOf(owner) : 'var(--terrain-structure)') : c === 'struct-detail' ? (owner ? onOf(owner) : 'var(--terrain-structure-detail)') : `var(--${c})`);
    const name = label || `${t.name}${t.property ? (owner ? `, ${factionName(owner)}` : ', neutral') : ''}`;
    return h('div', { className: cx('aw-tile', className), style: { width: size, height: size }, 'data-terrain': terrain, title: name, ...rest },
      h('svg', { className: 'aw-tile-art', viewBox: '0 0 32 32', width: size, height: size, role: 'img', 'aria-label': name },
        h('rect', { width: 32, height: 32, style: { fill: role(art.base) } }),
        art.shapes.map((s, i) => h('path', { key: i, d: s.d, style: { fill: role(s.c) } })),
        h('rect', { className: 'aw-tile-grid', x: 0.25, y: 0.25, width: 31.5, height: 31.5 })),
      overlay && h('div', { className: `aw-tile-overlay aw-tile-overlay--${overlay}`, 'aria-hidden': true }),
      fog && h('div', { className: 'aw-tile-fog', 'aria-hidden': true }),
      children && h('div', { className: 'aw-tile-unit' }, children),
      cursor && h(Cursor, { kind: cursor }));
  }

  // ---------- Intel ----------
  function Kicker({ children }) { return h('div', { className: 'aw-kicker label' }, children); }

  function Diamonds({ value, total = 4, label }) {
    return h('span', { className: 'aw-diamonds', role: 'img', 'aria-label': label || `${value} of ${total}` },
      Array.from({ length: total }, (_, i) => h('span', { key: i, className: cx('aw-diamond', i < value && 'aw-diamond--on') })));
  }

  function Meter({ value, max, tone }) {
    const pct = Math.max(0, Math.min(1, value / max)) * 100;
    return h('span', { className: cx('aw-meter', tone && `aw-meter--${tone}`), 'aria-hidden': true }, h('span', { style: { width: pct + '%' } }));
  }

  function TerrainCard({ terrain = 'flats', owner, capture, className }) {
    const t = TERRAIN[terrain] || TERRAIN.flats;
    const meta = t.property ? `${owner ? factionShort(owner) : 'Neutral'} · ${t.note}` : t.note;
    return h(Frame, { size: 'sm', className: cx('aw-card', className) },
      h(Kicker, null, 'Terrain'),
      h('div', { className: 'aw-card-head' },
        h(MapTile, { terrain, owner, size: 32 }),
        h('div', null,
          h('div', { className: 'heading aw-card-title' }, t.name),
          h('div', { className: 'caption aw-muted' }, meta))),
      h('div', { className: 'aw-stat-row' },
        h('span', { className: 'label aw-muted' }, 'Def'),
        h(Diamonds, { value: t.def, label: `Defense ${t.def} of 4` }),
        h('span', { className: 'stat-sm' }, t.def)),
      t.property && capture != null && h('div', { className: 'aw-stat-row' },
        h('span', { className: 'label aw-muted' }, 'Capture'),
        h(Meter, { value: 20 - capture, max: 20, tone: capture < 20 ? 'warn' : undefined }),
        h('span', { className: 'stat-sm' }, `${capture}/20`)));
  }

  function UnitCard({ unit = 'trooper', faction = 'helion', hp = 10, charge, ammo, className }) {
    const u = UNITS[unit] || UNITS.trooper;
    const ch = charge != null ? charge : u.charge;
    const am = ammo !== undefined ? ammo : u.ammo;
    const crit = hp <= 3;
    const lowCharge = ch <= Math.round(u.charge * 0.2);
    const lowAmmo = u.ammo != null && am != null && am <= 1;
    return h(Frame, { size: 'sm', className: cx('aw-card', className) },
      h(Kicker, null, 'Unit'),
      h('div', { className: 'aw-card-head' },
        h(UnitToken, { unit, faction, hp, size: 40, decorative: true }),
        h('div', null,
          h('div', { className: 'heading aw-card-title', style: { color: inkOf(faction) } }, u.name),
          h('div', { className: 'caption aw-muted' }, `${u.role} · ${DATA.moveTypes[u.moveType]}`))),
      h('div', { className: 'aw-stat-row' },
        h('span', { className: 'label aw-muted' }, 'HP'),
        h('span', { className: cx('aw-hpbar', crit && 'aw-hpbar--crit'), role: 'img', 'aria-label': `${hp} of 10 HP` },
          Array.from({ length: 10 }, (_, i) => h('span', { key: i, className: i < hp ? 'on' : undefined }))),
        h('span', { className: 'stat-sm', style: crit ? { color: 'var(--danger)' } : undefined }, hp)),
      h('div', { className: 'aw-stat-row' },
        h('span', { className: 'label aw-muted' }, 'Charge'),
        h(Meter, { value: ch, max: u.charge, tone: lowCharge ? 'warn' : undefined }),
        h('span', { className: 'stat-sm', style: lowCharge ? { color: 'var(--warn)' } : undefined }, ch)),
      h('div', { className: 'aw-stat-row' },
        h('span', { className: 'label aw-muted' }, 'Ammo'),
        u.ammo == null ? h('span', { className: 'caption aw-muted aw-grow' }, 'No primary weapon') : h(Meter, { value: am, max: u.ammo, tone: lowAmmo ? 'warn' : undefined }),
        h('span', { className: 'stat-sm', style: lowAmmo ? { color: 'var(--warn)' } : undefined }, u.ammo == null ? '—' : am)),
      (crit || lowCharge || lowAmmo) && h('div', { className: 'aw-chips' },
        crit && h(StatusChip, { tone: 'danger' }, 'Critical'),
        lowCharge && h(StatusChip, { tone: 'warn' }, 'Low charge'),
        lowAmmo && h(StatusChip, { tone: 'warn' }, am === 0 ? 'No ammo' : 'Low ammo')));
  }

  function Side({ who, align }) {
    const u = UNITS[who.unit];
    return h('div', { className: cx('aw-fc-side', align === 'end' && 'aw-fc-side--end') },
      h(UnitToken, { unit: who.unit, faction: who.faction, hp: who.hp, size: 40, facing: align === 'end' ? 'left' : 'right', decorative: true }),
      h('div', null,
        h('div', { className: 'heading', style: { color: inkOf(who.faction) } }, u.name),
        h('div', { className: 'caption aw-muted' }, `${factionShort(who.faction)} · ${Math.ceil(who.hp)} HP`)));
  }
  function BattleForecast({ attacker, defender, damage = [0, 0], counter = null, className }) {
    const left = (hp, d) => Math.max(0, Math.ceil((hp * 10 - d) / 10));
    const after = [left(defender.hp, damage[1]), left(defender.hp, damage[0])];
    const kills = after[1] === 0;
    const range = (r) => (r[0] === r[1] ? `${r[0]}%` : `${r[0]}–${r[1]}%`);
    return h(Frame, { floating: true, className: cx('aw-forecast', className) },
      h(Kicker, null, 'Battle forecast'),
      h('div', { className: 'aw-fc-sides' }, h(Side, { who: attacker }), h('span', { className: 'label aw-muted' }, 'vs'), h(Side, { who: defender, align: 'end' })),
      h('div', { className: 'aw-fc-nums' },
        h('div', null, h('div', { className: 'label aw-muted' }, 'Damage'), h('div', { className: 'stat' }, range(damage))),
        h('div', null, h('div', { className: 'label aw-muted' }, 'Counter'), h('div', { className: 'stat', style: counter ? undefined : { color: 'var(--ink-muted)' } }, counter ? range(counter) : 'None'))),
      h('div', { className: 'aw-fc-foot' },
        kills ? h(StatusChip, { tone: 'signal' }, 'Destroys target')
          : after[0] === 0 ? h(StatusChip, { tone: 'signal' }, `May destroy · leaves 0–${after[1]} HP`)
            : h('span', { className: 'caption aw-muted' }, `Leaves ${after[0] === after[1] ? after[0] : after[0] + '–' + after[1]} HP`)));
  }

  // ---------- Commanders ----------
  function CommanderPortrait({ name, faction, initials, src, size = 96, state, className }) {
    const label = { surge: 'Surge', overclock: 'Overclock' }[state];
    return h('div', {
      className: cx('aw-portrait', className), role: 'img', 'aria-label': `${name || 'Commander'}${label ? ', ' + label + ' active' : ''}`,
      style: { width: size, height: size, background: fillOf(faction), color: onOf(faction), clipPath: CHAMFER(size >= 72 ? 'var(--chamfer)' : 'var(--chamfer-sm)'), outline: faction === 'choir' ? '1.5px solid var(--on-choir)' : undefined, outlineOffset: -1.5 },
    },
      h('span', { className: 'aw-portrait-mark', 'aria-hidden': true }, h(Sigil, { faction, size: Math.round(size * 0.78), tone: 'on' })),
      src ? h('img', { src, alt: '', className: 'aw-portrait-img' })
        : h('span', { className: 'aw-portrait-initials', style: { fontSize: Math.round(size * 0.36) } }, initials || (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2)),
      label && h('span', { className: 'aw-portrait-band label', style: size < 72 ? { fontSize: 9, letterSpacing: '0.04em' } : undefined }, label));
  }

  function PowerMeter({ value = 0, surge = 3, max = 6, showLabel = true, className }) {
    const uid = React.useId().replace(/:/g, '');
    const v = Math.max(0, Math.min(max, value));
    const state = v >= max ? 'Overclock ready' : v >= surge ? 'Surge ready' : 'Charging';
    let x = 0;
    const pips = Array.from({ length: max }, (_, i) => {
      const big = i >= surge;
      const s = big ? 14 : 10;
      const y = big ? 0 : 2;
      const fill = Math.max(0, Math.min(1, v - i));
      const cxp = x + s / 2;
      const d = `M${cxp} ${y}l${s / 2} ${s / 2}-${s / 2} ${s / 2}-${s / 2}-${s / 2}z`;
      const el = h('g', { key: i },
        h('clipPath', { id: `${uid}p${i}` }, h('path', { d })),
        h('path', { d, className: 'aw-pip' }),
        fill > 0 && h('rect', { x, y, width: s * fill, height: s, clipPath: `url(#${uid}p${i})`, className: 'aw-pip-fill' }));
      x += s + 3;
      return el;
    });
    return h('div', { className: cx('aw-power', className) },
      h('svg', { width: x - 3, height: 14, viewBox: `0 0 ${x - 3} 14`, role: 'img', 'aria-label': `Power ${Math.floor(v * 10) / 10} of ${max}: ${state}` }, pips),
      showLabel && h('span', { className: cx('label', 'aw-power-state', v >= surge && 'aw-power-state--ready') }, state));
  }

  function PlayerHud({ commander, funds = 0, power, cycle, className }) {
    const c = commander || {};
    return h(Frame, { floating: true, className: cx('aw-hud', className) },
      h(CommanderPortrait, { ...c, size: 48 }),
      h('div', { className: 'aw-hud-body' },
        h('div', { className: 'aw-hud-top' },
          h('span', { className: 'heading', style: { color: inkOf(c.faction) } }, c.name),
          cycle != null && h('span', { className: 'label aw-muted' }, `Cycle ${pad2(cycle)}`)),
        h('div', { className: 'aw-hud-funds' }, h('span', { className: 'stat' }, credits(funds)), h('span', { className: 'label aw-muted' }, 'CR')),
        power && h(PowerMeter, power)));
  }

  // ---------- Story ----------
  function DialogueBox({ speaker = {}, side = 'left', channel, children, more = true, className }) {
    const f = speaker.faction;
    return h(Frame, { floating: true, className: cx('aw-dialogue', side === 'right' && 'aw-dialogue--right', className) },
      h(CommanderPortrait, { name: speaker.name, faction: f, initials: speaker.initials, src: speaker.src, state: speaker.state }),
      h('div', { className: 'aw-dialogue-body' },
        h('div', { className: 'aw-dialogue-who' },
          h(Sigil, { faction: f, size: 16 }),
          h('span', { className: 'heading', style: { color: inkOf(f) } }, speaker.name),
          speaker.title && h('span', { className: 'caption aw-muted' }, speaker.title)),
        channel && h('div', { className: 'caption aw-muted aw-dialogue-channel' }, channel),
        h('p', { className: 'body aw-dialogue-text' }, children),
        more && h('span', { className: 'aw-dialogue-more', 'aria-hidden': true })));
  }

  function TurnBanner({ cycle = 1, faction = 'helion', commander, className }) {
    return h('div', { className: cx('aw-banner', faction === 'choir' && 'aw-banner--choir', className), role: 'status', style: { background: fillOf(faction), color: onOf(faction) } },
      h('div', { className: 'aw-banner-cycle' }, h('span', { className: 'label' }, 'Cycle'), h('span', { className: 'headline' }, pad2(cycle))),
      h('div', { className: 'aw-banner-rule', 'aria-hidden': true }),
      h('div', { className: 'aw-banner-who' }, h('span', { className: 'heading' }, factionName(faction)), commander && h('span', { className: 'caption' }, `${commander} commanding`)),
      h('span', { className: 'aw-banner-mark', 'aria-hidden': true }, h(Sigil, { faction, size: 72, tone: 'on' })));
  }

  const api = { Button, CommandMenu, BuildMenu, StatusChip, Sigil, UnitToken, MapTile, TerrainCard, UnitCard, BattleForecast, CommanderPortrait, PowerMeter, PlayerHud, DialogueBox, TurnBanner, data: DATA };
  window.Ascendant = Object.assign(window.Ascendant || {}, api);
})();
