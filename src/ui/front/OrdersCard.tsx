// The orders card (G14): the player's standing orders for their agent, one row per group of units (D-022) and one for powers, drawn the same on
// the objective screen and in the battle's Orders panel. D-023: one posture per group at rest, and everything else a quiet "More" away; a control
// explains itself in one short line on hover or focus; no paragraphs. The card holds no orders of its own: it draws the orders it is given and
// hands back the next ones, made only by ordersModel's setters, which end in `validateOrders` (D-005: fixed options and whole numbers).
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { ART } from '../../data';
import type { UnitTypeId } from '../../game/aw';
import type { Mission as GroupMission, Posture, PowerPolicy, StandingOrders, TargetPriority, UnitGroup } from '../../game/doctrine';
import { MAX_RETREAT_HP, POSTURES } from '../../game/doctrine';
import { Paths } from '../watch/kit/roles';
import type { PathSpec } from '../watch/kit/roles';
import {
  GROUP_ICON_UNIT, GROUP_MEMBERS, GROUP_MISSIONS, GROUP_NAMES, HINTS, MAX_TARGETS, MISSION_NAMES, POSTURE_SHORT, POWER_POLICIES, POWER_POLICY_NAMES,
  POWER_SHORT, TARGET_PRIORITIES, TARGET_PRIORITY_NAMES, UNIT_GROUPS, consequenceOf, followGroup, freshOrders, hasOwnOrders, isDefaultOrders,
  resolve, retreatText, setMission, setPosture, setPowerPolicy, setRetreat, setTargets, toggleTarget, unitName,
} from './ordersModel';
import type { Level } from './ordersModel';

const GLYPHS = ART.glyphs as unknown as Record<string, readonly PathSpec[]>;
const DIAMOND = 'M6 .8 11.2 6 6 11.2.8 6z';

/** The picture of a group: the glyph of the unit that stands for it. */
function GroupIcon({ group }: { group: UnitGroup }): ReactElement {
  return (
    <svg className="awf-ord-icon" width={22} height={22} viewBox="0 0 24 24" aria-hidden data-icon={group}>
      <Paths list={GLYPHS[GROUP_ICON_UNIT[group]] ?? []} color="currentColor" />
    </svg>
  );
}

interface Option<T extends string> { value: T; text: string; hint: string }

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onPick: (v: T) => void;
  onHint: (h: string | null) => void;
  describedBy: string;
  /** Marks which control it is, for tests and for styling the one that is not at rest. */
  field: string;
}

/**
 * A row of choices, one of them on: a radio group, so the keyboard stops once on it (the one that is on) and the arrow keys move the choice.
 * Never a menu. The arrows are kept from the watch view, which reads them as "step back" and "step forward".
 */
function Seg<T extends string>({ label, value, options, onPick, onHint, describedBy, field }: SegProps<T>): ReactElement {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    const to = (at + step + options.length) % options.length;
    onPick(options[to].value);
    buttons.current[to]?.focus();
  };
  return (
    <div className="awf-seg" role="radiogroup" aria-label={label} data-field={field} onKeyDown={move}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { buttons.current[i] = el; }}
          type="button"
          role="radio"
          className="awf-seg-opt label"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          aria-describedby={describedBy}
          data-value={o.value}
          onClick={() => onPick(o.value)}
          onMouseEnter={() => onHint(o.hint)}
          onMouseLeave={() => onHint(null)}
          onFocus={() => onHint(o.hint)}
          onBlur={() => onHint(null)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

const postureOptions = (): Option<Posture>[] => POSTURES.map((p) => ({ value: p, text: POSTURE_SHORT[p], hint: HINTS.posture[p] }));
const missionOptions = (g: UnitGroup): Option<GroupMission>[] => GROUP_MISSIONS[g].map((m) => ({ value: m, text: MISSION_NAMES[m], hint: HINTS.mission[m] }));
const powerOptions = (): Option<PowerPolicy>[] => POWER_POLICIES.map((p) => ({ value: p, text: POWER_SHORT[p], hint: p === 'saveForOverclock' ? `${POWER_POLICY_NAMES[p]}: ${HINTS.power[p]}` : HINTS.power[p] }));

interface FieldsProps {
  orders: StandingOrders;
  level: Level;
  group: UnitGroup;
  name: string;
  onChange: (next: StandingOrders) => void;
  onHint: (h: string | null) => void;
  describedBy: string;
}

/** The mission, retreat and targets of one level: what "More" holds. */
function MoreFields({ orders, level, group, name, onChange, onHint, describedBy }: FieldsProps): ReactElement {
  const r = resolve(orders, level);
  const hint = (h: string) => ({ onMouseEnter: () => onHint(h), onMouseLeave: () => onHint(null), onFocus: () => onHint(h), onBlur: () => onHint(null) });
  return (
    <div className="awf-more" data-level={'type' in level ? level.type : level.group}>
      <div className="awf-field">
        <span className="awf-field-name label">Mission</span>
        <Seg
          label={`${name} mission`} field="mission" value={r.mission} options={missionOptions(group)} describedBy={describedBy} onHint={onHint}
          onPick={(m) => onChange(setMission(orders, level, m))}
        />
      </div>
      <div className="awf-field">
        <span className="awf-field-name label">Retreat at</span>
        <div className="awf-step" role="group" aria-label={`${name} retreat`} data-field="retreat">
          <button
            type="button" className="awf-step-btn" aria-label={`${name} retreat lower`} disabled={r.retreatAtHp <= 0} aria-describedby={describedBy}
            onClick={() => onChange(setRetreat(orders, level, r.retreatAtHp - 1))} {...hint(HINTS.retreat)}
          >
            <span aria-hidden>−</span>
          </button>
          <output className="awf-step-val stat-sm" data-value={r.retreatAtHp}>{retreatText(r.retreatAtHp)}</output>
          <button
            type="button" className="awf-step-btn" aria-label={`${name} retreat higher`} disabled={r.retreatAtHp >= MAX_RETREAT_HP} aria-describedby={describedBy}
            onClick={() => onChange(setRetreat(orders, level, r.retreatAtHp + 1))} {...hint(HINTS.retreat)}
          >
            <span aria-hidden>+</span>
          </button>
        </div>
      </div>
      <div className="awf-field awf-field--targets">
        <span className="awf-field-name label">Targets</span>
        <div className="awf-chips-pick" role="group" aria-label={`${name} targets, in order`} data-field="targets">
          {TARGET_PRIORITIES.map((t: TargetPriority) => {
            const rank = r.targetPriority.indexOf(t) + 1;
            const full = rank === 0 && r.targetPriority.length >= MAX_TARGETS;
            return (
              <button
                key={t} type="button" className="awf-pick label" aria-pressed={rank > 0} aria-disabled={full || undefined} data-value={t} data-rank={rank || undefined}
                aria-describedby={describedBy}
                onClick={() => onChange(setTargets(orders, level, toggleTarget(r.targetPriority, t)))} {...hint(HINTS.targets)}
              >
                {rank > 0 && <span className="awf-pick-rank stat-sm" aria-hidden>{rank}</span>}
                {TARGET_PRIORITY_NAMES[t]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface OrdersCardProps {
  orders: StandingOrders;
  onChange: (next: StandingOrders) => void;
  /** The card on the objective screen, or the compact panel in the battle. */
  variant?: 'card' | 'panel';
  /** The orders shown are not in force yet: they start with the player's next turn (the panel says so). */
  pending?: boolean;
  /** What the panel says while they wait (G19: with a connected agent it is "From your agent's next turn"). */
  pendingText?: string;
  /** Given by the battle's panel: a Close in its header (on a phone the panel covers the Orders button that opened it). */
  onClose?: () => void;
  /** Groups whose More starts open, and groups whose Unit types start open (tests and screenshots). */
  initialOpen?: { more?: readonly UnitGroup[]; types?: readonly UnitGroup[]; type?: readonly UnitTypeId[] };
}

export function OrdersCard({ orders, onChange, variant = 'card', pending = false, pendingText = 'From your next turn', onClose, initialOpen }: OrdersCardProps): ReactElement {
  const uid = useId();
  const hintId = `${uid}-hint`;
  const [hint, setHint] = useState<string | null>(null);
  const [openMore, setOpenMore] = useState<ReadonlySet<UnitGroup>>(() => new Set(initialOpen?.more ?? []));
  const [openTypes, setOpenTypes] = useState<ReadonlySet<UnitGroup>>(() => new Set(initialOpen?.types ?? []));
  const [openType, setOpenType] = useState<ReadonlySet<UnitTypeId>>(() => new Set(initialOpen?.type ?? []));
  const flip = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };
  const pristine = isDefaultOrders(orders);
  const hintOf = (h: string) => ({ onMouseEnter: () => setHint(h), onMouseLeave: () => setHint(null), onFocus: () => setHint(h), onBlur: () => setHint(null) });

  return (
    <section className="awf-orders" aria-label="Orders" data-variant={variant} data-state={pristine ? 'default' : 'custom'}>
      <header className="awf-orders-head">
        <h3 className="awf-orders-title label">Orders</h3>
        {variant === 'card' && <p className="awf-orders-hint caption" id={hintId} aria-live="polite" data-hint={hint ? 'yes' : 'no'}>{hint ?? ''}</p>}
        {pending && <span className="awf-orders-pending caption" role="status" data-pending="yes">{pendingText}</span>}
        <button
          type="button" className="awf-quiet label" data-action="reset" disabled={pristine} aria-describedby={hintId}
          onClick={() => onChange(freshOrders())} {...hintOf(HINTS.reset)}
        >
          Reset
        </button>
        {onClose && <button type="button" className="awf-quiet label" data-action="close" onClick={onClose}>Close</button>}
      </header>
      <ul className="awf-orders-list">
        {UNIT_GROUPS.map((g) => {
          const level: Level = { group: g };
          const r = resolve(orders, level);
          const more = openMore.has(g);
          const note = consequenceOf(g, r);
          const panelId = `${uid}-${g}-more`;
          return (
            <li key={g} className="awf-ord" data-group={g} data-open={more ? 'yes' : 'no'}>
              <div className="awf-ord-row">
                <span className="awf-ord-name"><GroupIcon group={g} /><span className="heading">{GROUP_NAMES[g]}</span></span>
                <Seg
                  label={`${GROUP_NAMES[g]} posture`} field="posture" value={r.posture} options={postureOptions()} describedBy={hintId} onHint={setHint}
                  onPick={(p) => onChange(setPosture(orders, level, p))}
                />
                <button
                  type="button" className="awf-quiet label awf-ord-more" aria-expanded={more} aria-controls={panelId} data-action="more"
                  onClick={() => setOpenMore(flip(openMore, g))}
                >
                  More
                </button>
              </div>
              {note && <p className="awf-ord-note caption" data-consequence={g}>{note}</p>}
              {more && (
                <div className="awf-ord-detail" id={panelId}>
                  <MoreFields orders={orders} level={level} group={g} name={GROUP_NAMES[g]} onChange={onChange} onHint={setHint} describedBy={hintId} />
                  <button
                    type="button" className="awf-quiet label awf-types-toggle" aria-expanded={openTypes.has(g)} data-action="types" aria-describedby={hintId}
                    onClick={() => setOpenTypes(flip(openTypes, g))} {...hintOf(HINTS.types)}
                  >
                    Unit types
                  </button>
                  {openTypes.has(g) && (
                    <ul className="awf-types">
                      {GROUP_MEMBERS[g].map((t) => {
                        const own = hasOwnOrders(orders, t);
                        const shown = own || openType.has(t);
                        const tl: Level = { type: t };
                        return (
                          <li key={t} className="awf-type" data-type={t} data-own={own ? 'yes' : 'no'}>
                            <div className="awf-type-row">
                              <span className="awf-type-name body-sm">{unitName(t)}</span>
                              <button
                                type="button" className="awf-quiet label awf-follows" aria-expanded={shown} data-action="follows" aria-describedby={hintId}
                                onClick={() => {
                                  if (own) onChange(followGroup(orders, t));
                                  setOpenType(own ? new Set([...openType].filter((x) => x !== t)) : flip(openType, t));
                                }}
                                {...hintOf(own ? HINTS.back : HINTS.follows)}
                              >
                                {own ? 'Back to group' : 'Follows group'}
                              </button>
                            </div>
                            {shown && (
                              <div className="awf-type-body">
                                <div className="awf-field">
                                  <span className="awf-field-name label">Posture</span>
                                  <Seg
                                    label={`${unitName(t)} posture`} field="posture" value={resolve(orders, tl).posture} options={postureOptions()} describedBy={hintId} onHint={setHint}
                                    onPick={(p) => onChange(setPosture(orders, tl, p))}
                                  />
                                </div>
                                <MoreFields orders={orders} level={tl} group={g} name={unitName(t)} onChange={onChange} onHint={setHint} describedBy={hintId} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
        <li className="awf-ord awf-ord--powers" data-group="powers">
          <div className="awf-ord-row">
            <span className="awf-ord-name">
              <svg className="awf-ord-icon" width={22} height={22} viewBox="-6 -6 24 24" aria-hidden data-icon="powers"><path d={DIAMOND} fill="currentColor" /></svg>
              <span className="heading">Powers</span>
            </span>
            <Seg
              label="Powers" field="power" value={orders.powerPolicy} options={powerOptions()} describedBy={hintId} onHint={setHint}
              onPick={(p) => onChange(setPowerPolicy(orders, p))}
            />
          </div>
        </li>
      </ul>
      {variant === 'panel' && <p className="awf-orders-hint caption" id={hintId} aria-live="polite" data-hint={hint ? 'yes' : 'no'}>{hint ?? ' '}</p>}
    </section>
  );
}
