// Every unit type's model builder, by id.
import type { FactionId, UnitTypeId } from '../../../game/aw';
import { anvil, raptor, wasp } from './air';
import { breacher, trooper } from './foot';
import { arc, bastion, colossus, lancer, mule, salvo, skimmer, warden } from './ground';
import type { Recipe } from './recipe';
import { barge, dreadnought, picket } from './sea';

export const MODELS: Record<UnitTypeId, (faction: FactionId) => Recipe> = {
  trooper, breacher, skimmer, lancer, bastion, colossus, mule, arc, salvo, warden, wasp, raptor, anvil, picket, dreadnought, barge,
};

export const UNIT_IDS = Object.keys(MODELS) as UnitTypeId[];
export const FACTION_IDS: FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];
