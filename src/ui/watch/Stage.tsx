// The stage: the board with its units and effects, the turn-banner sweep and the power cut-in. It draws one timeline step, and while a
// step's transition plan is running it samples the plan every animation frame (transition.ts) and draws the in-between picture.
// Only the viewer's own frame and filtered events reach this file, so a fogged viewer's board can only show what it was told.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { displayHp } from '../../game/aw';
import type { Coord, Unit } from '../../game/aw';
import { CutIn } from './CutIn';
import { MapTile, Sigil, TurnBanner, UnitToken, cx, factionShort } from './kit';
import { boardPixelSize, cameraScroll, chooseTileSize } from './layout';
import type { Timeline, ViewFrame } from './timeline';
import { commanderNameOf } from './format';
import { sampleTransition } from './transition';
import type { FxSample, GhostSample, NumberSample, TransitionPlan, TransitionSample } from './transition';
import { actorIds, focusOf, homeFacings, isSpent, unitStatus } from './unitview';
import type { Facing } from './unitview';

export interface StageProps {
  timeline: Timeline;
  step: number;
  plan: TransitionPlan | null;
  /** Called once when a plan has run to its end. */
  onDone: (plan: TransitionPlan) => void;
  reducedMotion: boolean;
  /** Shown at the right of the chips row under the turn banner (the viewer toggle). */
  toolbar?: ReactNode;
}

interface Clock { plan: TransitionPlan | null; t: number }

// ---------------------------------------------------------------- the terrain layer (static between steps)

interface TerrainLayerProps { frame: ViewFrame; tile: number; cursor?: Coord }

const TerrainLayer = memo(function TerrainLayer({ frame, tile, cursor }: TerrainLayerProps): ReactElement {
  return (
    <div className="aww-terrain" style={{ gridTemplateColumns: `repeat(${frame.width}, ${tile}px)` }}>
      {frame.tiles.map((row, y) =>
        row.map((t, x) => (
          <MapTile
            key={`${x},${y}`}
            terrain={t.terrain}
            owner={t.owner !== null ? frame.players[t.owner]?.faction : undefined}
            fog={!frame.visible[y][x]}
            size={tile}
            cursor={cursor && cursor.x === x && cursor.y === y ? 'select' : undefined}
            decorative
          />
        )),
      )}
    </div>
  );
});

/**
 * A property's owner is told by its fill AND by its sigil, so the two sides read apart without colour (colour-blind safe). Ownership is
 * public, so a fogged viewer sees every owner. The layer sits under the units: a unit standing on a property hides its chip.
 */
const PropertyLayer = memo(function PropertyLayer({ frame, tile }: { frame: ViewFrame; tile: number }): ReactElement {
  const chip = Math.round(tile * 0.34);
  const marks: ReactElement[] = [];
  frame.tiles.forEach((row, y) => row.forEach((t, x) => {
    if (t.owner === null) return;
    const faction = frame.players[t.owner]?.faction;
    if (!faction) return;
    marks.push(
      <div
        key={`${x},${y}`}
        className="aww-prop-chip"
        style={{ left: x * tile + 2, top: y * tile + tile - chip - 2, width: chip, height: chip, opacity: frame.visible[y][x] ? 1 : 0.7 }}
        aria-hidden
      >
        <Sigil faction={faction} size={Math.round(chip * 0.8)} tone="fill" />
      </div>,
    );
  }));
  return <>{marks}</>;
});

/** Capture progress on properties being taken: a small bar along the tile's foot, warn-coloured, with its number. */
const CaptureLayer = memo(function CaptureLayer({ frame, tile }: { frame: ViewFrame; tile: number }): ReactElement {
  const bars: ReactElement[] = [];
  frame.tiles.forEach((row, y) => row.forEach((t, x) => {
    if (t.capture === undefined || t.capture >= 20) return;
    bars.push(
      <div key={`${x},${y}`} className="aww-capture" style={{ left: x * tile, top: y * tile + tile - 8, width: tile }} title={`Capture ${t.capture} of 20 left`}>
        <span style={{ width: `${((20 - t.capture) / 20) * 100}%` }} />
      </div>,
    );
  }));
  return <>{bars}</>;
});

// ---------------------------------------------------------------- units

interface UnitSlotProps {
  unit: Unit;
  frame: ViewFrame;
  x: number;
  y: number;
  hp: number;
  facing: Facing;
  tile: number;
  selected: boolean;
  fade?: number;
}

const UnitSlot = memo(function UnitSlot({ unit, frame, x, y, hp, facing, tile, selected, fade = 0 }: UnitSlotProps): ReactElement {
  const faction = frame.players[unit.owner]?.faction ?? 'helion';
  const spent = isSpent(frame, unit);
  const style: CSSProperties = { width: tile, height: tile, transform: `translate(${x * tile}px, ${y * tile}px)` };
  if (fade > 0) style.opacity = 1 - fade;
  const inner: CSSProperties = { animationDelay: `${-((unit.id * 97) % 560)}ms` };
  return (
    <div className="aww-unit-slot" style={style} data-unit={unit.id}>
      <div className={cx('aww-unit-inner', !spent && 'aww-bob')} style={inner}>
        <UnitToken
          unit={unit.type}
          faction={faction}
          hp={Math.max(1, displayHp(hp))}
          spent={spent}
          selected={selected}
          facing={facing}
          size={tile}
          status={unitStatus(frame, unit)}
        />
      </div>
    </div>
  );
});

function UnitLayer(props: { frame: ViewFrame; tile: number; sample: TransitionSample | null; homes: Facing[]; actors: Set<number> }): ReactElement {
  const { frame, tile, sample, homes, actors } = props;
  const items = [...frame.units]
    .filter((u) => !sample?.hidden.has(u.id))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const facingOf = (u: Unit, heading?: Facing): Facing => heading ?? homes[u.owner] ?? 'right';
  return (
    <div className="aww-units">
      {items.map((u) => {
        const place = sample?.placements.get(u.id);
        return (
          <UnitSlot
            key={u.id}
            unit={u}
            frame={frame}
            x={place?.x ?? u.x}
            y={place?.y ?? u.y}
            hp={sample?.hp.get(u.id) ?? u.hp}
            facing={facingOf(u, place?.heading)}
            tile={tile}
            selected={actors.has(u.id)}
          />
        );
      })}
      {sample?.ghosts.map((g: GhostSample) => (
        <UnitSlot
          key={`ghost-${g.unit.id}`}
          unit={g.unit}
          frame={frame}
          x={g.x}
          y={g.y}
          hp={sample.hp.get(g.unit.id) ?? g.unit.hp}
          facing={facingOf(g.unit, g.heading)}
          tile={tile}
          selected={false}
          fade={g.fade}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- effects

function FxItem({ fx, tile }: { fx: FxSample; tile: number }): ReactElement {
  const p = fx.progress;
  const base: CSSProperties = { left: fx.at.x * tile, top: fx.at.y * tile, width: tile, height: tile };
  switch (fx.kind) {
    case 'hit':
      return <div className="aww-fx aww-fx-hit" style={{ ...base, opacity: Math.max(0, 1 - p) * 0.9 }} />;
    case 'explosion':
      return (
        <div className="aww-fx aww-fx-boom" style={{ ...base, opacity: Math.max(0, 1 - p * p), transform: `scale(${0.35 + 1.25 * p})` }} />
      );
    case 'pulse':
      return <div className="aww-fx aww-fx-pulse" style={{ ...base, opacity: 1 - p, transform: `scale(${0.7 + 0.6 * p})` }} />;
    case 'spawn':
      return <div className="aww-fx aww-fx-spawn" style={{ ...base, opacity: 1 - p, transform: `scale(${1.5 - 0.5 * p})` }} />;
    case 'ambush':
      return (
        <div className="aww-fx aww-fx-ambush" style={{ ...base, fontSize: tile * 0.7, transform: `translateY(${-tile * 0.55 - Math.sin(p * Math.PI) * tile * 0.25}px)`, opacity: p > 0.85 ? (1 - p) / 0.15 : 1 }}>
          !
        </div>
      );
    default:
      return <></>;
  }
}

function NumberItem({ n, tile }: { n: NumberSample; tile: number }): ReactElement {
  const p = n.progress;
  const style: CSSProperties = {
    left: n.at.x * tile,
    top: n.at.y * tile,
    width: tile,
    transform: `translateY(${-tile * 0.15 - p * tile * 0.55}px)`,
    opacity: p < 0.65 ? 1 : (1 - p) / 0.35,
    fontSize: Math.max(13, Math.round(tile * 0.34)),
  };
  return <div className={cx('aww-number', `aww-number--${n.tone}`)} style={style}>{n.text}</div>;
}

// ---------------------------------------------------------------- the stage

export function Stage({ timeline, step, plan, onDone, reducedMotion, toolbar }: StageProps): ReactElement {
  const cur = timeline.steps[step];
  const frame = cur.frame;
  const homes = useMemo(() => homeFacings(timeline.steps[0].frame), [timeline]);

  // The clock belongs to the plan it is running, so a new plan always starts from zero, never from the last plan's final time.
  const [clock, setClock] = useState<Clock>({ plan: null, t: 0 });
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!plan || plan.durationMs <= 0) return undefined;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number): void => {
      const t = now - t0;
      if (t >= plan.durationMs) {
        setClock({ plan, t: plan.durationMs });
        onDoneRef.current(plan);
        return;
      }
      setClock({ plan, t });
      raf = requestAnimationFrame(tick);
    };
    setClock({ plan, t: 0 });
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [plan]);

  const t = plan && clock.plan === plan ? clock.t : 0;
  const running = plan !== null && plan.durationMs > 0 && t < plan.durationMs;
  const sample = useMemo(() => (plan && running ? sampleTransition(plan, t) : null), [plan, running, t]);

  // Board size: the largest tile that fits the space, else the smallest with the board scrolling inside its frame.
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      setAvail({ w: el.clientWidth, h: Math.max(280, window.innerHeight - 210) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const tile = avail.w > 0 ? chooseTileSize(avail.w - 2, avail.h, frame.width, frame.height) : 32;
  const board = boardPixelSize(frame.width, frame.height, tile);

  const focus = useMemo(() => (step > 0 ? focusOf(cur.events, frame) : undefined), [cur, frame, step]);
  const actors = useMemo(() => (step > 0 ? actorIds(cur.events) : new Set<number>()), [cur, step]);

  // The camera: keep the action in view when the board is bigger than its frame.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !focus) return;
    const next = cameraScroll(
      { left: el.scrollLeft, top: el.scrollTop },
      { width: el.clientWidth, height: el.clientHeight },
      board, tile, focus,
    );
    if (Math.abs(next.left - el.scrollLeft) > 1 || Math.abs(next.top - el.scrollTop) > 1) {
      el.scrollTo({ left: next.left, top: next.top, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [step, tile, focus]);

  const winner = frame.winnerTeam;
  const bannerFaction = frame.players[frame.current]?.faction ?? 'helion';
  const bannerCommander = commanderNameOf(frame.players[frame.current]?.commander ?? '');

  return (
    <div className="aww-stage" ref={wrapRef}>
      <div className="aww-banner-row">
        <TurnBanner key={`${frame.cycle}-${frame.current}`} className="aww-turn-banner" cycle={frame.cycle} faction={bannerFaction} commander={bannerCommander} />
        <div className="aww-chips">
          {winner !== null && (
            <span className="aww-victory label">
              <Sigil faction={frame.players.find((p) => p.team === winner)?.faction ?? null} size={18} tone="ink" />
              Victory: {frame.players.filter((p) => p.team === winner).map((p) => factionShort(p.faction)).join(' and ')}
            </span>
          )}
          <span className="aww-chip caption">{frame.viewer === 'all' ? 'Omniscient view' : frame.fogActive ? 'Fog of war' : 'No fog'}</span>
          {frame.weather === 'ionstorm' && <span className="aww-chip caption aww-chip--warn">Ion storm</span>}
          {toolbar && <div className="aww-toolbar">{toolbar}</div>}
        </div>
      </div>
      <div className="aww-board-wrap">
        <div className="aww-frame" ref={frameRef} role="group" aria-label={`Battlefield, cycle ${frame.cycle}, ${factionShort(bannerFaction)} turn`}>
          <div className="aww-board" style={{ width: board.width, height: board.height }} data-tile={tile} data-step={step}>
            <TerrainLayer frame={frame} tile={tile} cursor={running ? undefined : focus} />
            <PropertyLayer frame={frame} tile={tile} />
            <CaptureLayer frame={frame} tile={tile} />
            <UnitLayer frame={frame} tile={tile} sample={sample} homes={homes} actors={actors} />
            <div className="aww-fx-layer" aria-hidden>
              {sample?.fx.map((f, i) => <FxItem key={`fx${i}`} fx={f} tile={tile} />)}
              {sample?.numbers.map((n, i) => <NumberItem key={`n${i}`} n={n} tile={tile} />)}
            </div>
          </div>
        </div>
        {sample?.banner && (
          <div
            className="aww-sweep"
            aria-hidden
            style={reducedMotion ? { opacity: 1 - Math.abs(sample.banner.slide) } : { transform: `translateX(${sample.banner.slide * 105}%)` }}
          >
            <TurnBanner
              cycle={sample.banner.beat.cycle}
              faction={frame.players[sample.banner.beat.player]?.faction ?? 'helion'}
              commander={commanderNameOf(frame.players[sample.banner.beat.player]?.commander ?? '')}
              className="aww-sweep-band"
            />
          </div>
        )}
      </div>
      {sample?.cutIn && <CutIn sample={sample.cutIn} reducedMotion={reducedMotion} />}
    </div>
  );
}
