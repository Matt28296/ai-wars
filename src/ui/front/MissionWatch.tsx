// The watch view with the mission's story laid over it (G13). It records the match once more for itself (Deploy hands over only the
// actions), works out when each authored event fires (missionScript.ts) and how the battle ended (debrief.ts), and wires the watch
// view's three optional slots to the story: `onStep` tells the story where the battle is, `hold` stops the battle while a beat talks,
// and `overlay` draws the beat or the debrief. The viewer's own controls, log and board are the watch view's, untouched.
import { useCallback, useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';
import type { Mission } from '../../content/types';
import { WatchView } from '../watch';
import { recordMatch } from '../watch/timeline';
import type { Viewer } from '../watch/timeline';
import { nextMissionOf, resultCardOf } from './debrief';
import type { DeployResult } from './deploy';
import { scriptFor } from './missionScript';
import { StoryOverlay } from './StoryOverlay';
import { holdsPlayback, initialStory, storyReducer, viewOf } from './storyState';
import type { StoryAction, StoryState } from './storyState';

export interface MissionWatchProps {
  mission: Mission;
  /** The recorded battle: Deploy's setup and actions. */
  result: Pick<DeployResult, 'setup' | 'actions'>;
}

/** The battle with its story. "Watch again" starts the whole viewing over: a new watch view and a new story, so every line is heard again. */
export function MissionWatch({ mission, result }: MissionWatchProps): ReactElement {
  const [viewing, setViewing] = useState(0);
  const again = useCallback(() => setViewing((n) => n + 1), []);
  return <Viewing key={viewing} mission={mission} result={result} onWatchAgain={again} />;
}

function Viewing({ mission, result, onWatchAgain }: MissionWatchProps & { onWatchAgain: () => void }): ReactElement {
  const [viewer, setViewer] = useState<Viewer>(0);
  const story = useMemo(() => {
    const record = recordMatch(result.setup, result.actions);
    return {
      beats: scriptFor(mission, record),
      card: resultCardOf(mission, record.states),
      last: record.actions.length,
      next: nextMissionOf(mission),
    };
  }, [mission, result]);
  const [state, dispatch] = useReducer((s: StoryState, a: StoryAction) => storyReducer(s, a, story.beats), undefined, () => initialStory(story.beats));
  const onStep = useCallback((step: number) => dispatch({ type: 'step', step }), []);
  const onBeatDone = useCallback(() => dispatch({ type: 'close' }), []);
  const onDebriefRead = useCallback(() => dispatch({ type: 'debriefRead' }), []);

  return (
    <WatchView
      setup={result.setup}
      actions={result.actions}
      viewer={viewer}
      onViewerChange={setViewer}
      autoPlay
      onStep={onStep}
      hold={holdsPlayback(state)}
      overlay={
        <StoryOverlay
          mission={mission}
          beats={story.beats}
          view={viewOf(state, story.last)}
          card={story.card}
          next={story.next}
          debriefRead={state.debriefRead}
          onBeatDone={onBeatDone}
          onDebriefRead={onDebriefRead}
          onWatchAgain={onWatchAgain}
        />
      }
    />
  );
}
