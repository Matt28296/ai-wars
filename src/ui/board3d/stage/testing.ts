// Fixtures for the 3D stage's tests: small matches written as text (the viewer's own fixtures), and the frames and plans made from them.
import type { GameEvent } from '../../../game/aw';
import type { FixtureUnit } from '../../../game/aw/testing';
import { recordMatch, viewTimeline } from '../../watch/timeline';
import type { Timeline, Viewer, ViewFrame } from '../../watch/timeline';
import { fieldSetup } from '../../watch/testing';
import { planTransition } from '../../watch/transition';
import type { TransitionPlan } from '../../watch/transition';

/** A 10 x 3 open field with the given units, as one viewer's timeline (step 0 only). */
export function fieldTimeline(units: FixtureUnit[], viewer: Viewer, fog: boolean): Timeline {
  return viewTimeline(recordMatch(fieldSetup(units, { fog }), []), viewer);
}

export function fieldFrame(units: FixtureUnit[], viewer: Viewer = 'all', fog = false): ViewFrame {
  return fieldTimeline(units, viewer, fog).steps[0].frame;
}

/** The animation plan of `events` between two frames at 1x. */
export function planOf(prev: ViewFrame, next: ViewFrame, events: GameEvent[], speed: 1 | 2 | 4 = 1): TransitionPlan {
  return planTransition(prev, next, events, { speed, reducedMotion: false });
}

export const idOf = (frame: ViewFrame, type: string, owner?: number): number => {
  const u = frame.units.find((x) => x.type === type && (owner === undefined || x.owner === owner));
  if (!u) throw new Error(`no ${type} in the fixture`);
  return u.id;
};
