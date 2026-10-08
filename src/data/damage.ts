import type { UnitTypeId } from '../engine/types';

// Base damage (% of a full-HP defender) before CO, luck, HP and terrain modifiers.
// primary consumes 1 ammo; secondary (cannon-less machine guns, AA mounts) is unlimited and used when
// the primary has no entry against the defender or ammo is 0. Missing entry in both = cannot attack.
// Baseline mapped from each unit's GBA analog (see docs/research/balance.md for the audit).
export interface DamageRow { primary?: Partial<Record<UnitTypeId, number>>; secondary?: Partial<Record<UnitTypeId, number>> }

export const DAMAGE: Record<UnitTypeId, DamageRow> = {
  trooper: {
    secondary: { trooper: 55, breacher: 45, skimmer: 12, lancer: 5, bastion: 1, colossus: 1, mule: 14, arc: 15, salvo: 25, warden: 5, wasp: 7 },
  },
  breacher: {
    primary: { skimmer: 85, lancer: 55, bastion: 15, colossus: 10, mule: 75, arc: 70, salvo: 85, warden: 65 },
    secondary: { trooper: 65, breacher: 55, skimmer: 18, lancer: 6, bastion: 1, colossus: 1, mule: 20, arc: 32, salvo: 35, warden: 6, wasp: 9 },
  },
  skimmer: {
    secondary: { trooper: 65, breacher: 60, skimmer: 35, lancer: 6, bastion: 1, colossus: 1, mule: 45, arc: 45, salvo: 55, warden: 4, wasp: 12 },
  },
  lancer: {
    primary: { skimmer: 85, lancer: 55, bastion: 15, colossus: 10, mule: 75, arc: 70, salvo: 85, warden: 65, picket: 5, dreadnought: 1, barge: 10 },
    secondary: { trooper: 70, breacher: 65, wasp: 10, skimmer: 40, lancer: 6, bastion: 1, colossus: 1, mule: 45, arc: 45, salvo: 55, warden: 5 },
  },
  bastion: {
    primary: { skimmer: 105, lancer: 85, bastion: 55, colossus: 40, mule: 105, arc: 105, salvo: 105, warden: 105, picket: 45, dreadnought: 10, barge: 35 },
    secondary: { trooper: 105, breacher: 95, wasp: 12, skimmer: 45, lancer: 8, bastion: 1, colossus: 1, mule: 45, arc: 45, salvo: 55, warden: 7 },
  },
  colossus: {
    primary: { skimmer: 145, lancer: 130, bastion: 95, colossus: 65, mule: 145, arc: 145, salvo: 145, warden: 145, picket: 55, dreadnought: 25, barge: 65 },
    secondary: { trooper: 130, breacher: 120, wasp: 22, skimmer: 65, lancer: 10, bastion: 1, colossus: 1, mule: 65, arc: 65, salvo: 75, warden: 17 },
  },
  mule: {},
  arc: {
    primary: { trooper: 90, breacher: 85, skimmer: 80, lancer: 70, bastion: 45, colossus: 35, mule: 70, arc: 75, salvo: 80, warden: 75, picket: 65, dreadnought: 40, barge: 55 },
  },
  salvo: {
    primary: { trooper: 95, breacher: 90, skimmer: 90, lancer: 80, bastion: 55, colossus: 45, mule: 80, arc: 80, salvo: 85, warden: 85, picket: 85, dreadnought: 55, barge: 60 },
  },
  warden: {
    primary: { trooper: 105, breacher: 105, skimmer: 60, lancer: 25, bastion: 10, colossus: 5, mule: 50, arc: 50, salvo: 55, warden: 45, wasp: 120, raptor: 65, anvil: 75 },
  },
  wasp: {
    primary: { skimmer: 55, lancer: 55, bastion: 25, colossus: 20, mule: 60, arc: 65, salvo: 65, warden: 25, picket: 55, dreadnought: 25, barge: 25 },
    secondary: { trooper: 75, breacher: 75, wasp: 65, skimmer: 30, lancer: 6, bastion: 1, colossus: 1, mule: 20, arc: 25, salvo: 35, warden: 6 },
  },
  raptor: {
    primary: { wasp: 100, raptor: 55, anvil: 100 },
  },
  anvil: {
    primary: { trooper: 110, breacher: 110, skimmer: 105, lancer: 105, bastion: 95, colossus: 80, mule: 105, arc: 105, salvo: 105, warden: 95, picket: 85, dreadnought: 75, barge: 95 },
  },
  picket: {
    primary: { picket: 25, dreadnought: 25, barge: 40 },
    secondary: { wasp: 115, raptor: 55, anvil: 65 },
  },
  dreadnought: {
    primary: { trooper: 95, breacher: 90, skimmer: 90, lancer: 80, bastion: 55, colossus: 45, mule: 80, arc: 80, salvo: 85, warden: 85, picket: 95, dreadnought: 50, barge: 95 },
  },
  barge: {},
};
