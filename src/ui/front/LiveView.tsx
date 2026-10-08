// `#/live` (G17): the battle the connected agent is fighting, as its side sees it. The agent's feed (`/live`, same origin as this page) sends one
// step at a time; the watch view plays them as they arrive and waits at the edge with "Thinking…". The mission's people and story beats are the
// ones Deploy shows, worked out from the seat's own view only (a beat that fires on a hidden event waits until the seat sees it).
//
// D-016: DURING THE MATCH only the agent's own view exists on this page: no viewer switch, and nothing is built from a record (there is none, and
// `/record` is never asked for). The `record` message arrives after the result; only then do the result card, the debrief and the viewer switch
// ("All" included, built by the watch view from the record) appear.
//
// Opened where there is no feed (the dev server, a hosted copy), the page shows the three connect steps instead of an empty screen.
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { LiveStep } from '../../agent/live';
import type { Mission } from '../../content/types';
import { WatchView } from '../watch';
import type { Viewer } from '../watch';
import type { DrawerTab } from '../watch/drawer';
import { recordMatch } from '../watch/timeline';
import { missionById, pad2 } from './campaign';
import { ConnectScreen } from './ConnectScreen';
import { resultCardOf } from './debrief';
import type { ResultCard } from './debrief';
import { useDocumentTitle } from './hooks';
import { WAITING, openLive, reduceLive } from './liveFeed';
import type { LinkStatus, LiveViewState, MakeEventSource } from './liveFeed';
import { scriptFor } from './missionScript';
import type { ScriptMatch } from './missionScript';
import { hrefs } from './router';
import { seatsOfMission } from './seats';
import { StoryOverlay } from './StoryOverlay';
import { holdsPlayback, initialStory, storyReducer, viewOf } from './storyState';
import type { StoryAction, StoryState } from './storyState';

/** The one quiet line before a mission starts. */
export const WAITING_LINE = 'Waiting for your agent to start a mission.';

/**
 * What the mission's script reads, from the seat's own view alone: the cycle and the winner each frame shows, and the events the seat saw.
 * (Deploy reads the true events; here there are none, and a beat about something the seat has not seen waits until it has.)
 */
export function seatScript(steps: readonly LiveStep[]): ScriptMatch {
  return {
    states: steps.map((s) => ({ cycle: s.frame.cycle, winnerTeam: s.frame.winnerTeam })),
    rawEvents: steps.slice(1).map((s) => s.events),
  };
}

/** The card while the match is on. It is never drawn: the debrief takes the final step, and the final step is unknown until the record is. */
/** Where the view opens (tests and screenshots): a step, and whether the debrief has been read, so the result card is up. By default the first step. */
export interface Shown {
  step: number;
  resultRead?: boolean;
  /** Opens the details drawer on this tab (G18). */
  drawer?: DrawerTab;
}

const NO_CARD: ResultCard = { outcome: 'undecided', cycles: 0, parCycles: 0, lost: 0, destroyed: 0, ratio: 0, parPower: 0, speed: 0, power: 0, rank: null };

function LiveWatch({ mission, state, shown, lead, onWatchAgain }: { mission: Mission | undefined; state: LiveViewState; shown?: Shown; lead: ReactNode; onWatchAgain: () => void }): ReactElement {
  const over = state.phase === 'over';
  const record = state.record;
  const [viewer, setViewer] = useState<Viewer>(state.seat);
  const people = useMemo(() => (mission ? seatsOfMission(mission) : undefined), [mission]);
  const beats = useMemo(() => (mission ? scriptFor(mission, seatScript(state.steps)) : []), [mission, state.steps]);
  // The result card needs the whole match, so it is made once the record is here and not before.
  const card = useMemo(() => (mission && record ? resultCardOf(mission, recordMatch(record.setup, record.actions).states) : null), [mission, record]);
  const [story, dispatch] = useReducer((s: StoryState, a: StoryAction) => storyReducer(s, a, beats), undefined, () => {
    const first = initialStory(beats, shown?.step ?? 0);
    // opened on the result card: the beat at the last step closed, the debrief read
    return shown?.resultRead ? { ...storyReducer(first, { type: 'close' }, beats), debriefRead: true } : first;
  });
  const onStep = useCallback((step: number) => dispatch({ type: 'step', step }), []);
  const onBeatDone = useCallback(() => dispatch({ type: 'close' }), []);
  const onDebriefRead = useCallback(() => dispatch({ type: 'debriefRead' }), []);
  // The debrief takes the last step, which is unknown while the match runs.
  const view = viewOf(story, over && record ? record.actions.length : Number.POSITIVE_INFINITY);

  return (
    <WatchView
      viewed={state.steps}
      {...(record ? { setup: record.setup, actions: record.actions } : {})}
      viewer={viewer}
      // only the agent's own view exists until the record has arrived (D-016)
      onViewerChange={over ? setViewer : undefined}
      people={people}
      initialStep={shown?.step}
      initialDrawer={shown?.drawer}
      lead={lead}
      autoPlay
      onStep={onStep}
      hold={holdsPlayback(story)}
      live={{ open: !over }}
      overlay={
        mission ? (
          <StoryOverlay
            mission={mission}
            beats={beats}
            view={view}
            card={card ?? NO_CARD}
            // The agent plays this mission and the person watches (D-023): the card says Watch again. "Next mission" would lead to a mission
            // Doctrine plays for them, which is not what this screen is for.
            debriefRead={story.debriefRead}
            onBeatDone={onBeatDone}
            onDebriefRead={onDebriefRead}
            onWatchAgain={onWatchAgain}
          />
        ) : undefined
      }
    />
  );
}

const PILL: Record<LinkStatus, string> = { connecting: 'Live', open: 'Live', reconnecting: 'Reconnecting', unavailable: 'Disconnected' };

/** The battle, whose slim top bar is the watch view's own (G18): the way back to the title, the mission's name and the link's status sit at its left end. "Watch again" starts the whole viewing over (a new watch view and a new story), as in Deploy. */
function LiveBattle({ state, link, shown }: { state: LiveViewState; link: LinkStatus; shown?: Shown }): ReactElement {
  const mission = useMemo(() => (state.mission ? missionById(state.mission) : undefined), [state.mission]);
  const [viewing, setViewing] = useState(0);
  const again = useCallback(() => setViewing((n) => n + 1), []);
  const over = state.phase === 'over';
  return (
    <div className="awf-watch awf-live" data-screen="live" data-phase={over ? 'over' : 'playing'} data-link={link}>
      <LiveWatch
        key={viewing}
        mission={mission}
        state={state}
        shown={shown}
        onWatchAgain={again}
        lead={
          <>
            <a className="awf-back label" href={hrefs.title}>Title</a>
            <span className="awf-watchbar-id label">{mission ? `Mission ${pad2(mission.order)} · ${mission.title}` : 'Your agent'}</span>
            <span className="awf-pill caption" data-pill>{over && link === 'open' ? 'Finished' : PILL[link]}</span>
          </>
        }
      />
    </div>
  );
}

/** The screen for a state of the feed and the link to it. Pure of effects, so it can be drawn for any moment of a match. */
export function LiveScreen({ state, link, shown }: { state: LiveViewState; link: LinkStatus; shown?: Shown }): ReactElement {
  if (state.phase === 'waiting' || state.steps.length === 0) {
    // No feed here (the dev server, a hosted copy): say what to do instead of showing nothing.
    if (link === 'unavailable') return <ConnectScreen />;
    return (
      <main className="awf-root awf-live-wait" data-screen="live" data-phase={link === 'connecting' ? 'connecting' : 'waiting'}>
        {link !== 'connecting' && <p className="awf-live-line body-sm" role="status">{WAITING_LINE}</p>}
        <a className="awf-back label awf-live-back" href={hrefs.title}>Title</a>
      </main>
    );
  }
  // A new setup is a new epoch: the view starts over, with a fresh playback, story and viewer.
  return <LiveBattle key={state.epoch} state={state} link={link} shown={shown} />;
}

/** The feed's address on this page's own origin. */
export const LIVE_URL = '/live';

export function LiveView({ url = LIVE_URL, make }: { url?: string; make?: MakeEventSource }): ReactElement {
  const [state, dispatch] = useReducer(reduceLive, WAITING);
  const [link, setLink] = useState<LinkStatus>('connecting');
  useDocumentTitle('Your agent · Ascendant Wars');
  useEffect(() => {
    const l = openLive(url, { message: dispatch, status: setLink }, make);
    return () => l.close();
  }, [url, make]);
  return <LiveScreen state={state} link={link} />;
}

/** The route's own entry. */
export function LiveRoute(): ReactElement {
  return <LiveView />;
}

