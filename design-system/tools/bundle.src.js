(() => {
  const React = window.React;
  const h = React.createElement;
  const DATA = __DATA__;

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
