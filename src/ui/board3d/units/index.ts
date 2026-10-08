// The 16 unit miniatures (D-018). `createUnitView` is the contract's CreateUnitView; the rest is for tests and the gallery.
import type { CreateUnitView } from '../contract';
import { createUnitView as create } from './view';

export const createUnitView: CreateUnitView = create;
export { createUnitViewWithPhase, recoilCurve } from './view';
export type { UnitKit } from './view';
export { resourceStats, setRimStrength } from './resources';
export { FACTION_IDS, UNIT_IDS } from './models';
export { squadSize } from './recipe';
