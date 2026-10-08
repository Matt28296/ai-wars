// Single source for tokens.json. Dark ("Night Ops") is the primary theme; light ("Briefing") second.
// A plain string = same value in both themes (the battlefield is a world, not chrome).

export const themes = [
  { id: 'dark', name: 'Night Ops' },
  { id: 'light', name: 'Briefing' },
];

const c = (name, dark, light, usage) => ({ name, value: light === undefined ? dark : { dark, light }, usage });

export const colors = [
  // Chrome
  c('void', '#0a0e14', '#e6eaef', 'Page ground: behind the battlefield and between HUD panels.'),
  c('panel', '#111821', '#ffffff', 'HUD panels, intel cards, dialogue boxes.'),
  c('panel-raised', '#19222e', '#f3f5f8', 'Menus and anything stacked on a panel (command menu, build list, tooltips).'),
  c('line', '#273243', '#d3d9e1', 'Hairline dividers inside panels. Decorative only — never the sole edge of a control.'),
  c('line-strong', '#6b7b92', '#76838f', 'Control and panel edges; at least 3:1 on void, panel and panel-raised in both themes.'),
  c('ink', '#e8edf3', '#0e1520', 'Primary text on void, panel, panel-raised and signal-soft.'),
  c('ink-muted', '#9aa8ba', '#4b5768', 'Secondary text, HUD labels and metadata on void, panel and panel-raised.'),
  c('signal', '#5ce1ff', '#006b8f', 'The interface accent: cursor, focus, selection, the active menu row, positive status. As text, on void, panel, panel-raised and signal-soft. Never a faction colour.'),
  c('on-signal', '#03161d', '#ffffff', 'Text and glyphs on a signal fill (the primary button label).'),
  c('signal-soft', '#0c2a35', '#ddf4fb', 'Tinted ground for the selected row or active item, under ink or signal text.'),
  c('warn', '#ffc44d', '#8a5800', 'Low fuel, low ammo, capture in progress. As text or icon on void, panel and panel-raised; always paired with a word or the warn diamond.'),
  c('danger', '#ff7070', '#bf2129', 'Critical HP, destroyed, mission-fail states. As text or icon on void, panel and panel-raised; always paired with a word or icon.'),

  // Factions — fills are the same in both themes; each has an on- token for marks on the fill and an -ink token for text on chrome.
  c('helion', '#f28c28', undefined, 'Helion Accord identity fill: unit plates, owned properties, banners.'),
  c('on-helion', '#1a1005', undefined, 'Glyphs, sigils and text on a helion fill.'),
  c('helion-ink', '#ffa95c', '#9e4a00', 'Helion names and labels as text on void, panel and panel-raised.'),
  c('tidewell', '#2f6fd8', undefined, 'Tidewell Union identity fill.'),
  c('on-tidewell', '#ffffff', undefined, 'Glyphs, sigils and text on a tidewell fill.'),
  c('tidewell-ink', '#8ab6ff', '#1c56b8', 'Tidewell names and labels as text on void, panel and panel-raised.'),
  c('verdant', '#2ea36a', undefined, 'Verdant Compact identity fill.'),
  c('on-verdant', '#03140b', undefined, 'Glyphs, sigils and text on a verdant fill.'),
  c('verdant-ink', '#5fd49b', '#16704a', 'Verdant names and labels as text on void, panel and panel-raised.'),
  c('kestrel', '#e6c95e', undefined, 'Kestrel Dominion identity fill.'),
  c('on-kestrel', '#1b1503', undefined, 'Glyphs, sigils and text on a kestrel fill.'),
  c('kestrel-ink', '#efd77a', '#755d0b', 'Kestrel names and labels as text on void, panel and panel-raised.'),
  c('choir', '#1c1b23', undefined, 'Hollow Choir identity fill (obsidian). Always rimmed in on-choir so it reads on dark terrain.'),
  c('on-choir', '#ff4d63', undefined, 'The Choir’s red signal: glyphs, rims and sigils on a choir fill.'),
  c('choir-ink', '#ff7a8a', '#b0142b', 'Hollow Choir names and labels as text on void, panel and panel-raised.'),

  // Battlefield
  c('map-ink', '#ffffff', undefined, 'HP digits and map labels, on map-shade only.'),
  c('map-shade', '#0a0e14', undefined, 'Unit outlines, the HP chip, tile grid lines on the battlefield.'),
  c('overlay-move', '#5ce1ff59', undefined, 'Movement-range wash over terrain (signal at 35%).'),
  c('overlay-attack', '#ff4d4d66', undefined, 'Attack-range wash over terrain (red at 40%). Paired with the crosshair cursor, never alone.'),
  c('overlay-fog', '#0a0e14a6', undefined, 'Fog of war and Ion Storm darkening over unseen tiles.'),
  c('terrain-flats', '#86a86c', undefined, 'Flats: open ground.'),
  c('terrain-flats-detail', '#6f9258', undefined, 'Grass ticks and field marks on flats.'),
  c('terrain-canopy', '#2f6a46', undefined, 'Canopy (engineered forest) ground.'),
  c('terrain-canopy-detail', '#4c9262', undefined, 'Tree crowns on canopy.'),
  c('terrain-ridge', '#857a6d', undefined, 'Ridge (mountain) rock.'),
  c('terrain-ridge-detail', '#bdb19f', undefined, 'Lit faces of ridge peaks.'),
  c('terrain-sea', '#1d4a73', undefined, 'Open sea.'),
  c('terrain-sea-detail', '#3a76a6', undefined, 'Wave marks; rivers and the water edge of shoals.'),
  c('terrain-shoal', '#cbb98b', undefined, 'Shoal (beach and reef shallows) sand.'),
  c('terrain-maglev', '#59626f', undefined, 'Maglev road and bridge deck.'),
  c('terrain-maglev-detail', '#b8e9f5', undefined, 'The live rail line down a maglev.'),
  c('terrain-glass', '#a9bcc2', undefined, 'Glass Waste: vitrified old-war desert.'),
  c('terrain-glass-detail', '#e0ebee', undefined, 'Fracture facets on glass waste.'),
  c('terrain-structure', '#9ba4af', undefined, 'Unowned (neutral) property body. Owned properties take their faction fill instead.'),
  c('terrain-structure-detail', '#5f6976', undefined, 'Windows and seams on neutral properties.'),
];

export const type = {
  fonts: [
    { family: 'Chakra Petch', file: 'fonts/ChakraPetch-600.woff2', weight: '600', style: 'normal' },
    { family: 'Chakra Petch', file: 'fonts/ChakraPetch-700.woff2', weight: '700', style: 'normal' },
    { family: 'Barlow', file: 'fonts/Barlow-400.woff2', weight: '400', style: 'normal' },
    { family: 'Barlow', file: 'fonts/Barlow-500.woff2', weight: '500', style: 'normal' },
    { family: 'Barlow', file: 'fonts/Barlow-600.woff2', weight: '600', style: 'normal' },
    { family: 'IBM Plex Mono', file: 'fonts/IBMPlexMono-500.woff2', weight: '500', style: 'normal' },
    { family: 'IBM Plex Mono', file: 'fonts/IBMPlexMono-600.woff2', weight: '600', style: 'normal' },
  ],
  families: {
    display: '"Chakra Petch", "Bahnschrift", "DIN Alternate", sans-serif',
    sans: 'Barlow, "Segoe UI", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
  },
  groups: [
    {
      name: 'Display', family: 'display', note: 'Chakra Petch: angular, engineered. Titles, banners and every HUD label.',
      styles: [
        { name: 'title', fontSize: '48px', lineHeight: '52px', fontWeight: 700, letterSpacing: '-0.01em', sample: 'Act II — False Colors', usage: 'Act and mission titles, Overclock call-outs. One per screen.' },
        { name: 'headline', fontSize: '28px', lineHeight: '32px', fontWeight: 700, letterSpacing: '0.02em', sample: 'CYCLE 04', usage: 'Turn banner, results screens, panel titles in briefings.' },
        { name: 'heading', fontSize: '18px', lineHeight: '24px', fontWeight: 600, letterSpacing: '0.02em', sample: 'Lancer · Hover tank', usage: 'Card and panel headings, speaker names in dialogue.' },
        { name: 'label', fontSize: '13px', lineHeight: '16px', fontWeight: 600, letterSpacing: '0.08em', sample: 'FIRE · CAPTURE · WAIT', usage: 'Commands, HUD labels, button text. Always set in capitals.' },
      ],
    },
    {
      name: 'Text', family: 'sans', note: 'Barlow: a plain-spoken grotesque for anything read as sentences.',
      styles: [
        { name: 'body', fontSize: '17px', lineHeight: '26px', fontWeight: 500, sample: 'They fired first at Calder. Nobody on our side gave that order.', usage: 'Dialogue and briefings — the story voice.' },
        { name: 'body-sm', fontSize: '14px', lineHeight: '20px', fontWeight: 400, sample: 'Hover units cross shoals and rivers at no extra cost.', usage: 'Descriptions, tooltips, rules text on cards.' },
        { name: 'caption', fontSize: '12px', lineHeight: '16px', fontWeight: 500, letterSpacing: '0.01em', sample: 'Move 6 · Vision 3 · Hover', usage: 'Metadata under headings; never below 12px.' },
      ],
    },
    {
      name: 'Numbers', family: 'mono', note: 'IBM Plex Mono: tabular figures so HP, funds and damage never jitter.',
      styles: [
        { name: 'stat', fontSize: '22px', lineHeight: '26px', fontWeight: 600, sample: '12,400', usage: 'Funds, damage forecasts, the big number on a card.' },
        { name: 'stat-sm', fontSize: '13px', lineHeight: '16px', fontWeight: 500, sample: 'FUEL 38 · AMMO 4', usage: 'Fuel, ammo, costs, capture points.' },
      ],
    },
  ],
};

export const spacing = {
  note: '4px base; the battlefield runs on the tile, not on these.',
  tokens: [
    { name: 'space-1', value: '4px', usage: 'Glyph-to-label gap, pip gaps in meters.' },
    { name: 'space-2', value: '8px', usage: 'Inside controls and chips; between menu rows.' },
    { name: 'space-3', value: '12px', usage: 'Between related rows on a card.' },
    { name: 'space-4', value: '16px', usage: 'Panel and card padding.' },
    { name: 'space-6', value: '24px', usage: 'Between panels; dialogue box padding.' },
    { name: 'space-8', value: '32px', usage: 'Screen margins around the HUD.' },
  ],
};

export const radius = {
  note: 'Chamfer, not curve: panels cut their corners (see chamfer); radii stay tiny.',
  tokens: [
    { name: 'radius-xs', value: '2px', usage: 'HP chip, meter pips, buttons.' },
    { name: 'radius-sm', value: '4px', usage: 'Status chips and unit plates.' },
    { name: 'radius-full', value: '9999px', usage: 'Only round things: the Tidewell sigil, status dots.' },
  ],
};

export const size = {
  note: 'The battlefield grid and the cut-corner geometry.',
  tokens: [
    { name: 'tile', value: '48px', usage: 'One battlefield tile at 1×. Units, overlays and the cursor are sized from it.' },
    { name: 'tile-sm', value: '32px', usage: 'Tiles inside intel cards and the minimap.' },
    { name: 'portrait', value: '96px', usage: 'Commander portrait in dialogue and the CO select screen.' },
    { name: 'portrait-sm', value: '48px', usage: 'Commander portrait in the player HUD.' },
    { name: 'chamfer', value: '12px', usage: 'Corner cut on panels, dialogue boxes and banners (top-left and bottom-right).' },
    { name: 'chamfer-sm', value: '6px', usage: 'Corner cut on menus, cards and unit plates.' },
  ],
};

export const shadow = {
  note: 'Edges do the work; shadows only lift floating things and mark focus.',
  tokens: [
    { name: 'shadow-panel', value: { dark: '0 10px 28px #000000a6', light: '0 8px 22px #0e152029' }, usage: 'Menus, dialogue boxes, anything floating over the battlefield.' },
    { name: 'focus-ring', value: { dark: '0 0 0 2px #111821, 0 0 0 4px #5ce1ff', light: '0 0 0 2px #ffffff, 0 0 0 4px #006b8f' }, usage: 'Keyboard focus: a 2px panel-colour gap, then 2px of solid signal. Applied as box-shadow so it follows the radius.' },
    { name: 'glow-select', value: '0 0 0 2px #5ce1ff, 0 0 14px #5ce1ff8c', usage: 'The selected unit and the battlefield cursor. Signal, same in both themes because it sits on terrain.' },
  ],
};
