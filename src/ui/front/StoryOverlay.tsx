// What the mission says over its battle (G13): a compact dialogue box that slides up over the board when a moment of the script is
// reached, and, at the final step, the debrief: VICTORY, DEFEAT or UNDECIDED over the dimmed board, the debrief read aloud, then the
// result card. The card holds numbers and fixed words only (debrief.ts), so it can never name a later act's reveals.
// G18 (D-023, no paragraphs on a game screen): the card has no paragraph of scoring rules anywhere. The rule is one hover or focus away, on the rank.
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { Mission } from '../../content/types';
import { NUMERALS, pad2 } from './campaign';
import { POWER_RULE, RANK_RULE, SPEED_RULE, VERDICTS, debriefLines } from './debrief';
import type { ResultCard } from './debrief';
import { DialogueRunner } from './DialogueRunner';
import type { OrdersSummary } from './ordersModel';
import type { StoryBeat } from './missionScript';
import { hrefs } from './router';
import type { StoryView } from './storyState';

/** Why a battle has no rank, in the card's own words. */
export function unrankedNote(outcome: ResultCard['outcome']): string {
  return outcome === 'defeat' ? 'Not ranked: the mission was lost.' : 'Not ranked: nobody won.';
}

export interface ResultCardViewProps {
  mission: Mission;
  card: ResultCard;
  /** The mission after this one, if there is one. */
  next?: Mission;
  /** G14: the orders the battle was played under, as the card's one line. Absent, the card has no such line. */
  orders?: OrdersSummary;
  onWatchAgain: () => void;
}

const oneDecimal = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** A bar from 0 to 100, drawn as a width. */
function ScoreBar({ value }: { value: number }): ReactElement {
  return <span className="awf-bar" aria-hidden><span className="awf-bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>;
}

/** The result card: cycles against par, units lost and destroyed, Speed and Power, and the rank, whose rule is its hover and focus hint. Pure markup. */
export function ResultCardView({ mission, card, next, orders, onWatchAgain }: ResultCardViewProps): ReactElement {
  const won = card.outcome === 'victory';
  // The watch view reads Space as play/pause from the window. On this card Space belongs to the button that has focus.
  const keepSpace = (e: { key: string; stopPropagation: () => void }): void => {
    if (e.key === ' ' || e.key === 'Spacebar') e.stopPropagation();
  };
  return (
    <section
      className="awf-result awf-cut"
      tabIndex={-1}
      aria-label="Result"
      data-phase="result"
      data-outcome={card.outcome}
      data-rank={card.rank ?? 'none'}
      data-orders={orders ? 'yes' : undefined}
      onKeyDown={keepSpace}
      onKeyUp={keepSpace}
    >
      <div className="awf-result-rank" data-rank={card.rank ?? 'none'} tabIndex={0} title={`${RANK_RULE} ${SPEED_RULE} ${POWER_RULE}`}>
        <span className="awf-result-rank-label label">Rank</span>
        <span className="awf-rank-letter" aria-label={card.rank ? `Rank ${card.rank}` : 'Not ranked'}>{card.rank ?? '–'}</span>
        <span className="awf-result-rank-note caption">{card.rank ? `Speed ${card.speed} + Power ${card.power}` : unrankedNote(card.outcome)}</span>
      </div>
      <dl className="awf-stats">
        <div className="awf-stat" data-stat="cycles">
          <dt className="awf-stat-name label">Cycles taken</dt>
          <dd className="awf-stat-val"><span className="stat">{card.cycles}</span><span className="awf-par caption">par {card.parCycles}</span></dd>
          <dd className="awf-stat-score"><span className="awf-score-name caption">Speed</span><span className="awf-score-num stat-sm">{card.speed}</span><ScoreBar value={card.speed} /></dd>
        </div>
        <div className="awf-stat" data-stat="lost">
          <dt className="awf-stat-name label">Your side lost</dt>
          <dd className="awf-stat-val"><span className="stat">{card.lost}</span><span className="awf-par caption">units</span></dd>
        </div>
        <div className="awf-stat" data-stat="destroyed">
          <dt className="awf-stat-name label">Enemy destroyed</dt>
          <dd className="awf-stat-val"><span className="stat">{card.destroyed}</span><span className="awf-par caption">units</span></dd>
        </div>
        <div className="awf-stat" data-stat="ratio">
          <dt className="awf-stat-name label">Destroyed per loss</dt>
          <dd className="awf-stat-val"><span className="stat">{oneDecimal(card.ratio)}</span><span className="awf-par caption">par {oneDecimal(card.parPower)}</span></dd>
          <dd className="awf-stat-score"><span className="awf-score-name caption">Power</span><span className="awf-score-num stat-sm">{card.power}</span><ScoreBar value={card.power} /></dd>
        </div>
      </dl>
      {orders && (
        <p className="awf-result-orders caption" title={orders.all.join('\n')}>
          <span className="awf-result-orders-name label">Orders</span>
          <span className="awf-result-orders-text" data-orders-line="yes">{orders.line}</span>
        </p>
      )}
      <div className="awf-result-actions">
        <button type="button" className={`aw-btn label ${won && next ? 'aw-btn--secondary' : 'aw-btn--primary'}`} onClick={onWatchAgain} data-action="again">
          <span className="aw-btn-label">Watch again</span>
        </button>
        <a className="aw-btn aw-btn--secondary label" href={hrefs.briefing(mission.id)} data-action="briefing">
          <span className="aw-btn-label">Back to briefing</span>
        </a>
        {next && (
          <a className={`aw-btn label ${won ? 'aw-btn--primary' : 'aw-btn--secondary'}`} href={hrefs.briefing(next.id)} data-action="next" aria-label={`Next mission, number ${pad2(next.order)}`}>
            <span className="aw-btn-label">Next mission</span>
          </a>
        )}
      </div>
    </section>
  );
}

export interface DebriefScreenProps extends ResultCardViewProps {
  /** The debrief's lines were read, so the card shows. */
  read: boolean;
  onRead: () => void;
}

/** The final step: the verdict over the dimmed board, then the debrief lines, then the result card. */
export function DebriefScreen({ mission, card, next, orders, onWatchAgain, read, onRead }: DebriefScreenProps): ReactElement {
  const cardRef = useRef<HTMLDivElement>(null);
  // The card takes focus when it opens, so a screen reader reads the result and Tab reaches the buttons.
  useEffect(() => {
    if (read) cardRef.current?.querySelector<HTMLElement>('section')?.focus({ preventScroll: true });
  }, [read]);
  return (
    <section className="awf-debrief" aria-label="Debrief" data-story="debrief" data-outcome={card.outcome} data-stage={read ? 'result' : 'talk'}>
      <div className="awf-debrief-body">
        <header className="awf-debrief-head">
          <p className="awf-kicker label">Act {NUMERALS[mission.act]} · Mission {pad2(mission.order)} · {mission.title}</p>
          <h2 className="awf-verdict" data-outcome={card.outcome}>{VERDICTS[card.outcome]}</h2>
        </header>
        {read ? (
          <div ref={cardRef} className="awf-debrief-card"><ResultCardView mission={mission} card={card} next={next} orders={orders} onWatchAgain={onWatchAgain} /></div>
        ) : (
          <div className="awf-debrief-talk"><DialogueRunner key="debrief" lines={debriefLines(mission, card)} onDone={onRead} compact /></div>
        )}
      </div>
    </section>
  );
}

export interface StoryOverlayProps {
  mission: Mission;
  beats: readonly StoryBeat[];
  view: StoryView;
  card: ResultCard;
  next?: Mission;
  orders?: OrdersSummary;
  debriefRead: boolean;
  onBeatDone: () => void;
  onDebriefRead: () => void;
  onWatchAgain: () => void;
}

/** The watch view's overlay slot: nothing, a beat's dialogue, or the debrief. */
export function StoryOverlay({ mission, beats, view, card, next, orders, debriefRead, onBeatDone, onDebriefRead, onWatchAgain }: StoryOverlayProps): ReactElement | null {
  if (view.kind === 'none') return null;
  if (view.kind === 'beat') {
    return (
      <section className="awf-story" aria-label="Mission dialogue" aria-live="polite" data-story="beat" data-beat={view.index}>
        <DialogueRunner key={`beat-${view.index}`} lines={beats[view.index].lines} onDone={onBeatDone} />
      </section>
    );
  }
  return <DebriefScreen mission={mission} card={card} next={next} orders={orders} onWatchAgain={onWatchAgain} read={debriefRead} onRead={onDebriefRead} />;
}
