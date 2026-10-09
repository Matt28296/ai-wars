// The watch view with the mission's story laid over it (G13). It records the match once more for itself (Deploy hands over only the
// actions), works out when each authored event fires (missionScript.ts) and how the battle ended (debrief.ts), and wires the watch
// view's optional slots to the story: `onStep` tells the story where the battle is, `hold` stops the battle while a beat talks,
// and `overlay` draws the beat or the debrief. The viewer's own controls, log and board are the watch view's, untouched.
//
// G14: the battle can be LIVE. Then `result.actions` grows while it plays and `live` says whether more may still come: the watch view waits
// at the edge of what is computed, the command row (G19: Charge, Hold, Fall back, Take bases, power and More, which opens the Orders panel) is the
// bar's second row, the log gets a line where the player's orders changed, and the
// debrief says which orders were used. Nothing of that is there without `live`, and a battle without it is drawn as it always was.
//
// G18 (D-023): the battle screen's one slim bar is the watch view's own, and this is where its left end comes from: the way back to the briefing and
// the mission's name. Deploy's old strip above the view says the same and is hidden (front.css), because DeployView sits outside this order's files.
import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Mission } from '../../content/types';
import type { OrderChange } from '../../agent/match';
import type { StandingOrders } from '../../game/doctrine';
import { WatchView } from '../watch';
import type { DrawerTab } from '../watch/drawer';
import { extendRecord } from '../watch/timeline';
import type { MatchRecord, Viewer } from '../watch/timeline';
import { pad2 } from './campaign';
import { CommandBar } from './CommandBar';
import { nextMissionOf, resultCardOf } from './debrief';
import type { DeployResult } from './deploy';
import { scriptFor } from './missionScript';
import { notesOf, summariseOrders } from './ordersModel';
import { hrefs } from './router';
import { seatsOfMission } from './seats';
import { StoryOverlay } from './StoryOverlay';
import { holdsPlayback, initialStory, storyReducer, viewOf } from './storyState';
import type { StoryAction, StoryState } from './storyState';

/** What a battle that is still being fought hands the screen. */
export interface LiveControl {
  /** More of the battle may still come. */
  open: boolean;
  /** The orders the player has set, and whether they wait for the player's next turn. */
  orders: StandingOrders;
  pending: boolean;
  onOrders: (next: StandingOrders) => void;
  /** Told each step playback shows (the host is handed the player's next turn when playback reaches it). */
  onReach: (step: number) => void;
}

export interface MissionWatchProps {
  mission: Mission;
  /** The recorded battle: Deploy's setup and actions, and (G14) the orders each of the player's turns was played under. */
  result: Pick<DeployResult, 'setup' | 'actions'> & { orderChanges?: readonly OrderChange[] };
  /** Where the viewing opens and whose eyes it opens through (tests and screenshots); by default the first step, seen as the agent. */
  initialStep?: number;
  initialViewer?: Viewer;
  /** G14: the battle is being fought now. Absent, `result` is the whole battle. */
  live?: LiveControl;
  /** Opens the Orders panel when the view opens (tests and screenshots). */
  ordersOpen?: boolean;
  /** Opens the details drawer on this tab when the view opens (tests and screenshots). */
  drawerOpen?: DrawerTab;
}

/** The battle with its story. "Watch again" starts the whole viewing over: a new watch view and a new story, so every line is heard again. */
export function MissionWatch({ mission, result, initialStep, initialViewer, live, ordersOpen, drawerOpen }: MissionWatchProps): ReactElement {
  const [viewing, setViewing] = useState(0);
  const again = useCallback(() => setViewing((n) => n + 1), []);
  return <Viewing key={viewing} mission={mission} result={result} initialStep={initialStep} initialViewer={initialViewer} live={live} ordersOpen={ordersOpen} drawerOpen={drawerOpen} onWatchAgain={again} />;
}

function Viewing({ mission, result, initialStep, initialViewer, live, ordersOpen, drawerOpen, onWatchAgain }: MissionWatchProps & { onWatchAgain: () => void }): ReactElement {
  const [viewer, setViewer] = useState<Viewer>(initialViewer ?? 0);
  // The battle screen names the sides as the mission's own briefing does (people.ts sidePerson), so it cannot name a nation the story has
  // not: mission 1's drones are "Unmarked drones" here too, and the player's agent is "You", not a second "Helion".
  const people = useMemo(() => seatsOfMission(mission), [mission]);
  const open = live?.open === true;
  const recorded = useRef<MatchRecord | null>(null);
  const story = useMemo(() => {
    // A battle that grows keeps what it has recorded and applies only the actions that arrived since.
    recorded.current = extendRecord(recorded.current, result.setup, result.actions);
    const record = recorded.current;
    return {
      beats: scriptFor(mission, record),
      card: resultCardOf(mission, record.states),
      // While the battle is still being fought the last step computed is not the last step: no debrief until it is over.
      last: open ? Number.POSITIVE_INFINITY : record.actions.length,
      next: nextMissionOf(mission),
    };
  }, [mission, result.setup, result.actions, open]);
  const notes = useMemo(() => (result.orderChanges ? notesOf(result.orderChanges) : undefined), [result.orderChanges]);
  const orders = useMemo(() => (result.orderChanges ? summariseOrders(result.orderChanges) : undefined), [result.orderChanges]);
  const [state, dispatch] = useReducer((s: StoryState, a: StoryAction) => storyReducer(s, a, story.beats), undefined, () => initialStory(story.beats));
  const onReach = live?.onReach;
  const onStep = useCallback((step: number) => {
    dispatch({ type: 'step', step });
    onReach?.(step);
  }, [onReach]);
  const onBeatDone = useCallback(() => dispatch({ type: 'close' }), []);
  const onDebriefRead = useCallback(() => dispatch({ type: 'debriefRead' }), []);

  // Under fog, the other sides' views and the omniscient one are for after the battle: while it is being fought, what the player sees
  // is what the agent sees, so what is hidden cannot guide the orders they give (D-016).
  const lockView = open && mission.fog;
  return (
    <WatchView
      setup={result.setup}
      actions={result.actions as DeployResult['actions']}
      viewer={viewer}
      onViewerChange={lockView ? undefined : setViewer}
      people={people}
      initialStep={initialStep}
      autoPlay
      onStep={onStep}
      hold={holdsPlayback(state)}
      live={live ? { open } : undefined}
      logNotes={notes}
      ordersSlot={open && live ? <CommandBar orders={live.orders} pending={live.pending} onChange={live.onOrders} initialOpen={ordersOpen} /> : undefined}
      lead={
        <>
          <a className="awf-back label" href={hrefs.briefing(mission.id)}>Back<span className="awf-back-more"> to briefing</span></a>
          <span className="awf-watchbar-id label">Mission {pad2(mission.order)} · {mission.title}</span>
        </>
      }
      initialDrawer={drawerOpen}
      overlay={
        <StoryOverlay
          mission={mission}
          beats={story.beats}
          view={viewOf(state, story.last)}
          card={story.card}
          next={story.next}
          orders={orders}
          debriefRead={state.debriefRead}
          onBeatDone={onBeatDone}
          onDebriefRead={onDebriefRead}
          onWatchAgain={onWatchAgain}
        />
      }
    />
  );
}
