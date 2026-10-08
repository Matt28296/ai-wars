// Full-screen presentation: battle cut-in, CO power activation, turn banner sweep, capture cut-in,
// hot-seat handover, end banner and toasts. All are time-driven, skippable and respect reduced motion.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FactionId, TerrainId, UnitTypeId, Weather } from '../../engine/types';
import { DAMAGE } from '../../data/damage';
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { Frame, Meter, Sigil, TerrainArt, TurnBanner, UnitToken, CommanderFace, cx, factionName, fillOf, inkOf, onOf, pad2 } from '../kit';
import { art, type CommanderView } from './bridges';
import { T } from './timings';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Elapsed time (ms, scaled by speed()) driven by rAF; re-renders each frame while running. */
function useClock(speed: () => number, running = true) {
  const [t, setT] = useState(0);
  const sp = useRef(speed);
  sp.current = speed;
  useEffect(() => {
    if (!running) return;
    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => {
      acc += (now - last) * sp.current();
      last = now;
      setT(acc);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return t;
}

// ================================================================ battle cut-in
export interface CutSide {
  unit: UnitTypeId;
  faction: FactionId;
  terrain: TerrainId;
  hpBefore: number; // internal 0–100
  hpAfter: number;
  commander: string;
}
export type WeaponKind = 'bullets' | 'shell' | 'arc' | 'missile' | 'laser' | 'bomb' | 'rail';
export function weaponOf(att: UnitTypeId, def: UnitTypeId): { kind: WeaponKind; sfx: 'fire' | 'cannon' | 'laser' | 'missile' } {
  const primary = DAMAGE[att]?.primary?.[def] != null;
  switch (att) {
    case 'trooper': case 'skimmer': return { kind: 'bullets', sfx: 'fire' };
    case 'breacher': return primary ? { kind: 'rail', sfx: 'cannon' } : { kind: 'bullets', sfx: 'fire' };
    case 'lancer': case 'bastion': case 'colossus': return primary ? { kind: 'shell', sfx: 'cannon' } : { kind: 'bullets', sfx: 'fire' };
    case 'arc': case 'dreadnought': return { kind: 'arc', sfx: 'cannon' };
    case 'salvo': return { kind: 'missile', sfx: 'missile' };
    case 'warden': return { kind: 'laser', sfx: 'laser' };
    case 'wasp': return primary ? { kind: 'missile', sfx: 'missile' } : { kind: 'bullets', sfx: 'fire' };
    case 'raptor': return { kind: 'missile', sfx: 'missile' };
    case 'anvil': return { kind: 'bomb', sfx: 'cannon' };
    case 'picket': return primary ? { kind: 'shell', sfx: 'cannon' } : { kind: 'missile', sfx: 'missile' };
    default: return { kind: 'bullets', sfx: 'fire' };
  }
}
const disp = (hp: number) => Math.max(0, Math.ceil(hp / 10));
/** QB 6.2: foot/exo show ceil(hp/2) figures; vehicles 3/2/1 hulls by HP band; ships one hull. */
export function squadSize(type: UnitTypeId, displayHp: number) {
  if (displayHp <= 0) return 0;
  const u = UNIT_TYPES[type];
  if (u.moveType === 'foot' || u.moveType === 'exo') return Math.ceil(displayHp / 2);
  if (u.domain === 'sea' || type === 'colossus') return 1;
  return displayHp >= 7 ? 3 : displayHp >= 4 ? 2 : 1;
}

interface Phase { at: number; dur: number }
function cutSchedule(defLoss: number, attLoss: number, counter: boolean) {
  let t = 0;
  const open: Phase = { at: t, dur: T.cutOpen }; t += T.cutOpen;
  t += T.cutBeat;
  const fire1: Phase = { at: t, dur: T.cutFire }; t += T.cutFire;
  const hit1: Phase = { at: t, dur: T.cutImpact };
  const tick1: Phase = { at: t + 120, dur: Math.max(1, defLoss) * T.cutHpTick };
  t += Math.max(T.cutImpact, 120 + tick1.dur);
  let fire2: Phase | null = null, hit2: Phase | null = null, tick2: Phase | null = null;
  if (counter) {
    fire2 = { at: t, dur: T.cutFire }; t += T.cutFire;
    hit2 = { at: t, dur: T.cutImpact };
    tick2 = { at: t + 120, dur: Math.max(1, attLoss) * T.cutHpTick };
    t += Math.max(T.cutImpact, 120 + tick2.dur);
  }
  t += T.cutHold;
  const close: Phase = { at: t, dur: T.cutClose }; t += T.cutClose;
  return { open, fire1, hit1, tick1, fire2, hit2, tick2, close, total: t };
}
const within = (t: number, p: Phase | null) => !!p && t >= p.at && t < p.at + p.dur;
const lerpHp = (t: number, p: Phase | null, from: number, to: number) => {
  if (!p || t < p.at) return disp(from);
  const steps = disp(from) - disp(to);
  const k = Math.min(steps, Math.floor((t - p.at) / T.cutHpTick) + 1);
  return disp(from) - Math.max(0, k);
};

export function BattleCutIn({ attacker, defender, attackerLeft, counter, weather, speed, skipped, onDone, onSfx }: {
  attacker: CutSide; defender: CutSide; attackerLeft: boolean; counter: boolean; weather: Weather;
  speed: () => number; skipped: boolean; onDone: () => void; onSfx: (n: 'fire' | 'cannon' | 'laser' | 'missile' | 'explosion') => void;
}) {
  const defLoss = disp(defender.hpBefore) - disp(defender.hpAfter);
  const attLoss = disp(attacker.hpBefore) - disp(attacker.hpAfter);
  const S = useMemo(() => cutSchedule(defLoss, attLoss, counter), [defLoss, attLoss, counter]);
  const t = useClock(speed);
  const done = useRef(false);
  const fired = useRef(new Set<string>());
  const w1 = weaponOf(attacker.unit, defender.unit);
  const w2 = weaponOf(defender.unit, attacker.unit);

  const cue = (id: string, at: number, f: () => void) => { if (t >= at && !fired.current.has(id)) { fired.current.add(id); f(); } };
  cue('f1', S.fire1.at + 60, () => onSfx(w1.sfx));
  cue('h1', S.hit1.at, () => onSfx('explosion'));
  if (S.fire2) cue('f2', S.fire2.at + 60, () => onSfx(w2.sfx));
  if (S.hit2) cue('h2', S.hit2.at, () => onSfx('explosion'));

  useEffect(() => {
    if (done.current) return;
    if (skipped) { done.current = true; const id = window.setTimeout(onDone, T.cutSkipClose); return () => window.clearTimeout(id); }
    if (t >= S.total) { done.current = true; onDone(); }
  }, [t, skipped, S.total, onDone]);

  const final = skipped;
  const defHp = final ? disp(defender.hpAfter) : lerpHp(t, S.tick1, defender.hpBefore, defender.hpAfter);
  const attHp = final ? disp(attacker.hpAfter) : lerpHp(t, S.tick2, attacker.hpBefore, attacker.hpAfter);
  const closing = final || t >= S.close.at;

  const att = (
    <CutHalf key="a" side={attacker} hp={attHp} hpStart={disp(attacker.hpBefore)} left={attackerLeft}
      firing={!final && within(t, S.fire1) ? w1.kind : null} impact={!final && within(t, S.hit2)}
      incoming={!final && S.fire2 && within(t, S.fire2) ? w2.kind : null} />
  );
  const def = (
    <CutHalf key="d" side={defender} hp={defHp} hpStart={disp(defender.hpBefore)} left={!attackerLeft}
      firing={!final && S.fire2 && within(t, S.fire2) ? w2.kind : null} impact={!final && within(t, S.hit1)}
      incoming={!final && within(t, S.fire1) ? w1.kind : null} />
  );
  return (
    <div className={cx('bs-cut', closing && 'bs-cut--closing', weather === 'ionstorm' && 'bs-cut--storm')} role="dialog" aria-label={`Battle: ${UNIT_TYPES[attacker.unit].name} attacks ${UNIT_TYPES[defender.unit].name}`}>
      <div className="bs-cut-stage">
        {attackerLeft ? [att, def] : [def, att]}
        <div className="bs-cut-divider" aria-hidden />
      </div>
      <div className="bs-cut-hint caption">Z skip · hold Z ×2</div>
    </div>
  );
}

const CutBackdrop = memo(function CutBackdrop({ terrain, air, left }: { terrain: TerrainId; air: boolean; left: boolean }) {
  const BB = art.BattleBackdrop;
  if (BB) return <div className="bs-cut-bg">{air ? <BB terrain={'flats'} side={left ? 'left' : 'right'} /> : <BB terrain={terrain} side={left ? 'left' : 'right'} />}</div>;
  return <FallbackBackdrop terrain={terrain} air={air} />;
});

/** Token-painted backdrop: sky band, horizon silhouettes per terrain, ground plane. */
function FallbackBackdrop({ terrain, air }: { terrain: TerrainId; air: boolean }) {
  const ground: Record<string, string> = {
    flats: 'terrain-flats', canopy: 'terrain-canopy', ridge: 'terrain-ridge', maglev: 'terrain-maglev', span: 'terrain-maglev', river: 'terrain-flats',
    sea: 'terrain-sea', shoal: 'terrain-shoal', glass: 'terrain-glass', arcology: 'terrain-flats', fabricator: 'terrain-flats', skyport: 'terrain-flats',
    dock: 'terrain-shoal', uplink: 'terrain-flats', spire: 'terrain-flats',
  };
  const g = `var(--${ground[terrain] ?? 'terrain-flats'})`;
  const struct = TERRAIN_TYPES[terrain]?.property;
  return (
    <svg className="bs-cut-bg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id={`sky-${terrain}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--void)' }} />
          <stop offset="1" style={{ stopColor: 'var(--panel-raised)' }} />
        </linearGradient>
      </defs>
      <rect width={400} height={240} style={{ fill: `url(#sky-${terrain})` }} />
      {air ? (
        <g style={{ fill: 'var(--line)' }}>
          <path d="M20 60h90v6H20zM200 40h120v5H200zM120 120h70v4h-70zM260 150h110v5H260zM40 190h80v4H40z" />
        </g>
      ) : (
        <>
          {terrain === 'ridge' && <path d="M0 170 60 90 110 150 170 70 240 160 300 100 400 170V240H0z" style={{ fill: 'var(--terrain-ridge)' }} />}
          {terrain === 'ridge' && <path d="M60 90 80 118 70 120zM170 70 196 108 182 110zM300 100 322 130 312 132z" style={{ fill: 'var(--terrain-ridge-detail)' }} />}
          {terrain === 'canopy' && <path d="M0 175c20-40 50-40 70 0 15-35 45-38 65 0 18-45 52-45 72 0 16-36 46-36 64 0 20-42 52-42 74 0 15-30 40-30 55 0V240H0z" style={{ fill: 'var(--terrain-canopy-detail)' }} />}
          {(struct || terrain === 'maglev' || terrain === 'span') && (
            <g style={{ fill: 'var(--terrain-structure-detail)' }} opacity={0.75}>
              <path d="M20 180V110h30v70zM60 180V80h26v100zM96 180v-50h40v50zM250 180V96h34v84zM292 180v-60h22v60zM322 180V70h28v110zM356 180v-40h30v40z" />
            </g>
          )}
          {terrain === 'glass' && <path d="M0 185 40 170 90 182 150 165 220 180 300 168 400 182V240H0z" style={{ fill: 'var(--terrain-glass-detail)' }} />}
          {(terrain === 'sea' || terrain === 'shoal' || terrain === 'dock' || terrain === 'river') && (
            <rect y={170} width={400} height={70} style={{ fill: 'var(--terrain-sea)' }} />
          )}
          <rect y={terrain === 'sea' ? 240 : 180} width={400} height={60} style={{ fill: g }} />
          {(terrain === 'sea' || terrain === 'river') && <path d="M20 190h40v3H20zM120 205h50v3h-50zM250 195h45v3h-45zM330 215h40v3h-40z" style={{ fill: 'var(--terrain-sea-detail)' }} />}
          {terrain !== 'sea' && <rect y={180} width={400} height={2} style={{ fill: 'var(--map-shade)', opacity: 0.35 }} />}
        </>
      )}
    </svg>
  );
}

const Figure = memo(function Figure({ type, faction, facing, size }: { type: UnitTypeId; faction: FactionId; facing: 'left' | 'right'; size: number }) {
  const BS = art.BattleSprite;
  if (BS) return <BS type={type} faction={faction} facing={facing} size={size} />;
  return <UnitToken unit={type} faction={faction} facing={facing} size={size} bare decorative />;
});

function CutHalf({ side, hp, hpStart, left, firing, impact, incoming }: {
  side: CutSide; hp: number; hpStart: number; left: boolean; firing: WeaponKind | null; impact: boolean; incoming: WeaponKind | null;
}) {
  const u = UNIT_TYPES[side.unit];
  const air = u.domain === 'air';
  const facing = left ? 'right' : 'left';
  const max = squadSize(side.unit, hpStart);
  const alive = squadSize(side.unit, hp);
  const foot = u.moveType === 'foot' || u.moveType === 'exo';
  const size = foot ? 'var(--bs-fig-sm)' : 'var(--bs-fig)';
  const figs = Array.from({ length: max }, (_, i) => i);
  return (
    <div className={cx('bs-cut-half', left ? 'bs-cut-half--left' : 'bs-cut-half--right', impact && 'bs-cut-half--hit')} style={{ ['--fac' as string]: fillOf(side.faction) }}>
      <CutBackdrop terrain={side.terrain} air={air} left={left} />
      <div className={cx('bs-cut-squad', foot && 'bs-cut-squad--foot', air && 'bs-cut-squad--air', u.domain === 'sea' && 'bs-cut-squad--sea')} data-count={max}>
        {figs.map((i) => (
          <div key={i} className={cx('bs-fig', i >= alive && 'bs-fig--dead', firing && i < alive && 'bs-fig--firing')} style={{ ['--i' as string]: i, width: size, height: size }}>
            <Figure type={side.unit} faction={side.faction} facing={facing} size={160} />
            {firing && i < alive && <span className={`bs-muzzle bs-muzzle--${firing}`} />}
          </div>
        ))}
      </div>
      {incoming && <Projectiles kind={incoming} fromLeft={!left} />}
      {impact && <Impacts />}
      <div className="bs-cut-plate" style={{ background: fillOf(side.faction), color: onOf(side.faction) }}>
        <Sigil faction={side.faction} size={20} tone="on" />
        <span className="label">{u.name}</span>
      </div>
      <div className="bs-cut-hp" aria-live="polite">
        <span className="label">HP</span>
        <span className={cx('bs-cut-hpnum', hp <= 3 && 'bs-cut-hpnum--crit')}>{hp}</span>
      </div>
    </div>
  );
}

function Projectiles({ kind, fromLeft }: { kind: WeaponKind; fromLeft: boolean }) {
  const n = kind === 'bullets' ? 7 : kind === 'missile' ? 4 : kind === 'bomb' ? 3 : kind === 'laser' ? 1 : 2;
  return (
    <div className={cx('bs-proj', `bs-proj--${kind}`, fromLeft ? 'bs-proj--from-left' : 'bs-proj--from-right')} aria-hidden>
      {Array.from({ length: n }, (_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}
    </div>
  );
}

function Impacts() {
  return (
    <div className="bs-impacts" aria-hidden>
      {[0, 1, 2, 3].map((i) => <span key={i} style={{ ['--i' as string]: i }} />)}
    </div>
  );
}

// ================================================================ CO power
export function PowerCinematic({ commander, faction, level, name, quote, skipped, onDone }: {
  commander: CommanderView; faction: FactionId; level: 'surge' | 'overclock'; name: string; quote: string; skipped: boolean; onDone: () => void;
}) {
  const t = useClock(() => 1);
  const done = useRef(false);
  const typeStart = T.powerDim + T.powerBandIn + T.powerPortrait;
  const chars = Math.max(0, Math.min(quote.length, Math.floor(((t - typeStart) / 900) * quote.length)));
  useEffect(() => {
    if (done.current) return;
    if (skipped || t >= T.powerTotal + T.powerBandOut) { done.current = true; onDone(); }
  }, [t, skipped, onDone]);
  const out = t >= T.powerTotal;
  return (
    <div className={cx('bs-power', `bs-power--${level}`, out && 'bs-power--out')} role="dialog" aria-label={`${commander.name}: ${level === 'surge' ? 'Surge' : 'Overclock'} — ${name}`}
      style={{ ['--fac' as string]: fillOf(faction), ['--on-fac' as string]: onOf(faction), ['--ink-fac' as string]: inkOf(faction) }}>
      <div className="bs-power-flash" />
      <div className="bs-power-band">
        {level === 'overclock' && <div className="bs-power-band2" />}
        <div className="bs-power-portrait"><CommanderFace id={commander.id} name={commander.name} faction={faction} initials={commander.initials} size={160} mood="angry" /></div>
        <div className="bs-power-text">
          <div className="bs-power-kind label"><Sigil faction={faction} size={16} tone="on" />{level === 'surge' ? 'Surge' : 'Overclock'}</div>
          <div className={level === 'overclock' ? 'title bs-power-name' : 'headline bs-power-name'}>{name}</div>
          <div className="body bs-power-quote">{quote ? `“${quote.slice(0, chars)}${chars < quote.length ? '' : '”'}` : ''}</div>
        </div>
        <span className="bs-power-mark" aria-hidden><Sigil faction={faction} size={220} tone="on" /></span>
      </div>
    </div>
  );
}

// ================================================================ turn banner sweep
export function TurnSweep({ faction, cycle, commander, subtitle, skipped, onDone }: {
  faction: FactionId; cycle: number; commander: CommanderView; subtitle?: string; skipped: boolean; onDone: () => void;
}) {
  const total = T.bannerIn + T.bannerHold + T.bannerOut;
  useEffect(() => {
    const id = window.setTimeout(onDone, skipped ? 0 : reduced() ? total : total);
    return () => window.clearTimeout(id);
  }, [skipped, onDone, total]);
  return (
    <div className="bs-sweep" style={{ ['--in' as string]: `${T.bannerIn}ms`, ['--hold' as string]: `${T.bannerHold}ms`, ['--out' as string]: `${T.bannerOut}ms` }}>
      <div className="bs-sweep-band">
        <div className="bs-sweep-portrait"><CommanderFace id={commander.id} name={commander.name} faction={faction} initials={commander.initials} size={72} /></div>
        <TurnBanner cycle={cycle} faction={faction} commander={commander.name} subtitle={subtitle} className="bs-sweep-banner" />
      </div>
    </div>
  );
}

// ================================================================ capture cut-in
export function CaptureCutIn({ terrain, from, by, unit, before, after, skipped, onDone, onTick }: {
  terrain: TerrainId; from: FactionId | null; by: FactionId; unit: UnitTypeId; before: number; after: number; skipped: boolean; onDone: () => void; onTick: (captured: boolean) => void;
}) {
  const t = useClock(() => 1);
  const done = useRef(false);
  const captured = after <= 0;
  const pts = before - Math.max(0, after);
  const tickEnd = T.captureIntro + pts * T.captureTick;
  const total = tickEnd + (captured ? T.captureStamp : 450);
  const shown = skipped ? Math.max(0, after) : Math.max(Math.max(0, after), before - Math.max(0, Math.floor((t - T.captureIntro) / T.captureTick)));
  const lastShown = useRef(before);
  useEffect(() => {
    if (shown !== lastShown.current) { lastShown.current = shown; onTick(shown <= 0); }
  }, [shown, onTick]);
  useEffect(() => {
    if (done.current) return;
    if (skipped || t >= total) { done.current = true; window.setTimeout(onDone, skipped ? 120 : 0); }
  }, [t, skipped, total, onDone]);
  const flipped = captured && (skipped || t >= tickEnd);
  const t0 = TERRAIN_TYPES[terrain];
  return (
    <div className="bs-capture" role="dialog" aria-label={`Capturing ${t0.name}: ${shown} of 20 points left`}>
      <Frame floating className="bs-capture-frame">
        <div className="bs-capture-stage">
          <svg className={cx('bs-capture-prop', flipped && 'bs-capture-prop--flip')} viewBox="0 0 32 32" aria-hidden>
            <TerrainArt terrain={terrain} owner={flipped ? by : from} />
          </svg>
          <div className="bs-capture-unit"><Figure type={unit} faction={by} facing="left" size={96} /></div>
          {flipped && <div className="bs-capture-stamp headline" style={{ color: inkOf(by), borderColor: inkOf(by) }}>Captured</div>}
        </div>
        <div className="bs-capture-foot">
          <div>
            <div className="label aw-muted">{t0.name}</div>
            <div className="caption aw-muted">{flipped ? `Now ${factionName(by)}` : from ? factionName(from) : 'Neutral'}</div>
          </div>
          <div className="bs-capture-count"><span className="stat">{shown}</span><span className="stat-sm aw-muted">/20</span></div>
        </div>
        <Meter value={20 - shown} max={20} tone="warn" />
      </Frame>
    </div>
  );
}

// ================================================================ hot-seat handover (QB 1.6)
export function Handover({ faction, commander, cycle, onGo }: { faction: FactionId; commander: CommanderView; cycle: number; onGo: () => void }) {
  return (
    <div className="bs-handover" role="dialog" aria-label={`Pass to ${factionName(faction)}`} onClick={onGo}>
      <Sigil faction={faction} size={96} tone="fill" />
      <div className="label aw-muted">{`Cycle ${pad2(cycle)}`}</div>
      <div className="headline" style={{ color: inkOf(faction) }}>{`Pass to ${factionName(faction)}`}</div>
      <div className="body-sm aw-muted">{`${commander.name} commanding. The map stays hidden until you are ready.`}</div>
      <div className="bs-handover-go label"><kbd className="aw-key">Z</kbd> Begin turn</div>
    </div>
  );
}

// ================================================================ end banner
export function EndBanner({ outcome, faction, onDone }: { outcome: 'victory' | 'defeat'; faction: FactionId | null; onDone: () => void }) {
  useEffect(() => { const id = window.setTimeout(onDone, 1900); return () => window.clearTimeout(id); }, [onDone]);
  return (
    <div className={cx('bs-end', `bs-end--${outcome}`)} role="status">
      <div className="bs-end-band" style={faction ? { ['--fac' as string]: fillOf(faction) } : undefined}>
        {faction && <Sigil faction={faction} size={40} tone="fill" />}
        <span className="title">{outcome === 'victory' ? 'Victory' : 'Defeat'}</span>
      </div>
    </div>
  );
}

// ================================================================ toasts
export interface Toast { id: number; text: ReactNode; tone?: 'signal' | 'warn' | 'danger' | 'neutral'; faction?: FactionId | null }
export function Toasts({ list }: { list: Toast[] }) {
  return (
    <div className="bs-toasts" aria-live="polite">
      {list.map((t) => (
        <Frame key={t.id} size="sm" floating className={cx('bs-toast', t.tone && `bs-toast--${t.tone}`)}>
          {t.faction !== undefined && <Sigil faction={t.faction} size={14} />}
          <span className="body-sm">{t.text}</span>
        </Frame>
      ))}
    </div>
  );
}
