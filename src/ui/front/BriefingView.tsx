// The briefing scene (G9), the source games' signature: the mission's map as a dimmed 3D backdrop, a dialogue box over it with the
// speaker's portrait on the side the line names, a nameplate, a channel label and typewriter text. A press, a click, Space or Enter
// first completes the line and then advances; Skip goes to the objective card; Escape returns to the campaign map.
// Text is shown as authored, as React text, never as markup.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Mission } from '../../content/types';
import { FACTIONS } from '../../data';
import { Button, Sigil, inkOf } from '../watch/kit';
import { BoardPreview } from './BoardPreview';
import { charsAfter, initialBriefing, lengthOf, lineView, objectiveChips, revealed, stepBriefing } from './briefing';
import type { BriefingState, LineView } from './briefing';
import { NUMERALS, goalOf, missionById, pad2, teamGroups } from './campaign';
import { useDocumentTitle, useReducedMotion } from './hooks';
import { Lost } from './Lost';
import { BRIEFING_ORBIT } from './orbit';
import { Portrait } from './Portrait';
import { hrefs } from './router';
import { missionScene } from './missionScene';

const NARROW = '(max-width: 640px)';

/** True on a phone-width screen, where the portrait is smaller. The server and the first paint assume the wide layout. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const q = window.matchMedia(NARROW);
    const on = (): void => setNarrow(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return narrow;
}

export interface DialogueBoxProps {
  view: LineView;
  /** Characters of the line showing. */
  shown: number;
  index: number;
  total: number;
  narrow?: boolean;
  /** The smaller box that slides up over a battle (G13): a shorter panel and a smaller portrait. The same markup otherwise. */
  compact?: boolean;
  /** When given, a Skip button sits in the footer (the briefing has its own, in its header; the battle's dialogue puts it here). */
  onSkip?: () => void;
}

/** One line of dialogue: portrait on its side, nameplate, channel, text typed so far. Pure markup from props, so tests can render it. */
export function DialogueBox({ view, shown, index, total, narrow = false, compact = false, onSkip }: DialogueBoxProps): ReactElement {
  const p = view.person;
  const typed = revealed(view.text, shown);
  const rest = view.text.slice(typed.length);
  const complete = rest.length === 0;
  const panelNameStyle = p.faction ? { color: inkOf(p.faction) } : p.kind === 'commander' || p.kind === 'agent' ? { color: 'var(--signal)' } : undefined;
  return (
    <div
      className={`${view.side ? 'awf-dlg' : 'awf-dlg awf-dlg--narrator'}${compact ? ' awf-dlg--compact' : ''}`}
      data-side={view.side ?? 'none'}
      data-mood={view.mood}
      data-speaker={p.name}
      data-complete={complete ? 'yes' : 'no'}
    >
      {view.side && (
        <div className="awf-dlg-portrait" key={`${p.name}|${view.side}`}>
          <Portrait person={p} mood={view.mood} size={compact ? (narrow ? 72 : 124) : narrow ? 88 : 196} />
        </div>
      )}
      <div className="awf-dlg-panel awf-cut">
        <div className="awf-dlg-who">
          {p.kind !== 'narrator' && p.kind !== 'station' && p.kind !== 'unmarked' && <Sigil faction={p.faction} size={18} tone="ink" />}
          <span className="awf-dlg-name heading" style={panelNameStyle}>{p.name}</span>
          {p.role && p.kind !== 'station' && <span className="awf-dlg-role caption">{p.role}</span>}
        </div>
        {view.channel && <div className="awf-dlg-channel caption">{view.channel}</div>}
        <p className="awf-dlg-text body">
          <span className="awf-sr">{view.text}</span>
          <span aria-hidden>{typed}</span>
          <span aria-hidden className="awf-dlg-rest">{rest}</span>
        </p>
        <div className="awf-dlg-foot">
          <span className="awf-dlg-count stat-sm" aria-label={`Line ${index + 1} of ${total}`}>{pad2(index + 1)}/{pad2(total)}</span>
          {onSkip && (
            <button type="button" className="awf-dlg-skip aw-btn aw-btn--ghost aw-btn--sm label" onClick={onSkip} data-action="skip-lines">
              <span className="aw-btn-label">Skip all</span>
            </button>
          )}
          <span className="awf-dlg-hint caption" aria-hidden>{complete ? 'Next' : 'Skip text'}<kbd className="aw-key">Space</kbd></span>
        </div>
        {complete && <span className="awf-dlg-more" aria-hidden />}
      </div>
    </div>
  );
}

export function ObjectiveCard({ mission, onReplay }: { mission: Mission; onReplay: () => void }): ReactElement {
  const groups = teamGroups(mission);
  const chips = objectiveChips(mission);
  return (
    <section className="awf-objective awf-cut" tabIndex={-1} aria-labelledby="awf-objective-h" data-phase="objective">
      <div className="awf-objective-main">
        <p className="awf-kicker label">Objective</p>
        <h2 className="awf-objective-text" id="awf-objective-h">{mission.objectiveText}</h2>
        <ul className="awf-chips" aria-label="Conditions">
          <li className="awf-pill awf-pill--goal caption">{goalOf(mission.objective)}</li>
          {chips.map((c) => <li key={c.label} className={c.tone === 'warn' ? 'awf-pill awf-pill--warn caption' : 'awf-pill caption'}>{c.label}</li>)}
        </ul>
        <div className="awf-objective-actions">
          <span className="awf-deploy-wrap">
            <a className="aw-btn aw-btn--primary label awf-deploy-btn" href={hrefs.deploy(mission.id)} data-action="deploy">
              <span className="aw-btn-label">Deploy</span>
            </a>
          </span>
          <Button variant="ghost" onClick={onReplay} data-action="replay">Replay briefing</Button>
        </div>
        <p className="awf-objective-note caption">Deploy plays this mission with Doctrine (local rules) on every side. Your agent commands; you watch.</p>
      </div>
      <div className="awf-objective-sides">
        {groups.map((g) => (
          <div key={g.team} className="awf-team" data-yours={g.yours ? 'yes' : 'no'}>
            <h3 className="awf-team-h label">{g.yours ? 'Your side' : 'Opposition'}<span className="awf-team-no stat-sm">Team {g.team + 1}</span></h3>
            <ul className="awf-team-list">
              {g.sides.map((s) => (
                <li key={s.slot} className="awf-side" data-slot={s.slot}>
                  <Portrait person={s.person} size={56} />
                  <span className="awf-side-text">
                    <span className="awf-side-name heading" style={s.person.faction ? { color: inkOf(s.person.faction) } : undefined}>{s.person.name}</span>
                    <span className="awf-side-nation caption">
                      {s.person.faction && <Sigil faction={s.person.faction} size={14} tone="ink" />}
                      {s.person.faction ? FACTIONS[s.person.faction].name : 'No nation named'}
                    </span>
                    <span className="awf-side-role caption">{s.person.role}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface BriefingViewProps {
  mission: Mission;
  /** Forces the answer to "can this browser do WebGL2?" (tests and screenshots). */
  webgl2?: boolean;
  /** Where the briefing starts (tests and screenshots); by default at the first line. */
  initial?: BriefingState;
}

export function BriefingView({ mission, webgl2, initial }: BriefingViewProps): ReactElement {
  const lines = mission.briefing;
  const scene = useMemo(() => missionScene(mission), [mission]);
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const [state, dispatch] = useReducer(
    (s: BriefingState, a: Parameters<typeof stepBriefing>[1]) => stepBriefing(s, a, lines),
    undefined,
    () => initial ?? initialBriefing(lines),
  );
  const objectiveRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(`${mission.title} · Ascendant Wars`);

  const len = state.phase === 'dialogue' ? lengthOf(lines[state.index].text) : 0;
  const lineDone = state.phase !== 'dialogue' || state.shown >= len;

  // The typewriter: about 30 characters a second, from the moment a line appears. Reduced motion shows each line whole.
  useEffect(() => {
    if (state.phase !== 'dialogue' || lineDone) return undefined;
    if (reduced) {
      dispatch({ type: 'complete' });
      return undefined;
    }
    const began = performance.now() - (state.shown / 30) * 1000;
    const id = window.setInterval(() => dispatch({ type: 'tick', shown: charsAfter(performance.now() - began) }), 33);
    return () => window.clearInterval(id);
    // `state.shown` is read only to resume where the line was; the timer is restarted by the line, not by each character.
  }, [state.phase, state.index, lineDone, reduced]);

  const confirm = useCallback(() => dispatch({ type: 'confirm' }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);
  const replay = useCallback(() => dispatch({ type: 'restart' }), []);

  // The card takes focus when it opens, so a screen reader reads the objective and Tab reaches Deploy next.
  useEffect(() => {
    if (state.phase === 'objective') objectiveRef.current?.querySelector<HTMLElement>('section')?.focus({ preventScroll: true });
  }, [state.phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        window.location.hash = hrefs.campaign;
        return;
      }
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('a, button, input, select, textarea')) return;
      if (state.phase === 'dialogue' && (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar')) {
        e.preventDefault();
        if (!e.repeat) confirm();
      } else if (state.phase === 'dialogue' && (e.key === 's' || e.key === 'S')) {
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase, confirm, skip]);

  const view = state.phase === 'dialogue' ? lineView(lines[state.index]) : null;
  return (
    <main
      className="awf-root awf-briefing"
      data-screen="briefing"
      data-phase={state.phase}
      data-line={state.phase === 'dialogue' ? state.index : undefined}
      onClick={(e) => {
        if (state.phase !== 'dialogue') return;
        if ((e.target as HTMLElement).closest('a, button')) return;
        confirm();
      }}
    >
      <BoardPreview scene={scene} orbit={BRIEFING_ORBIT} webgl2={webgl2} className="awf-backdrop awf-backdrop--dim" />
      <div className="awf-brief-scrim" aria-hidden />
      <header className="awf-brief-top">
        <a className="awf-back label" href={hrefs.campaign}>Campaign<kbd className="aw-key">Esc</kbd></a>
        <div className="awf-brief-id">
          <p className="awf-kicker label">Act {NUMERALS[mission.act]} · Mission {pad2(mission.order)}</p>
          <h1 className="awf-brief-title">{mission.title}</h1>
          <p className="awf-brief-where caption">{mission.location}</p>
        </div>
        {state.phase === 'dialogue' && <Button variant="secondary" size="sm" hotkey="S" onClick={skip} data-action="skip">Skip</Button>}
      </header>
      {view ? (
        <div className="awf-brief-stage">
          <DialogueBox view={view} shown={state.shown} index={state.index} total={lines.length} narrow={narrow} />
        </div>
      ) : (
        <div className="awf-brief-stage awf-brief-stage--objective" ref={objectiveRef}>
          <ObjectiveCard mission={mission} onReplay={replay} />
        </div>
      )}
    </main>
  );
}

/** The route's own entry: finds the mission by id, or says there is none. */
export function BriefingRoute({ missionId, webgl2 }: { missionId: string; webgl2?: boolean }): ReactElement {
  const mission = missionById(missionId);
  if (!mission) return <Lost title="No such mission" body={`The campaign has no mission called "${missionId}".`} />;
  return <BriefingView key={mission.id} mission={mission} webgl2={webgl2} />;
}
