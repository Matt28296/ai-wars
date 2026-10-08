// Shared helpers for the kit. Colour roles mirror design-system/tools/bundle.src.js exactly.
import type { FactionId } from '../../engine/types';
import { FACTIONS } from '../../data';

export type FactionOrEcho = FactionId | null | undefined;

export const cx = (...a: (string | false | null | undefined | 0)[]) => a.filter(Boolean).join(' ');

/** Identity fill: unit plates, owned properties, banners. null = ECHO / the interface itself (signal). */
export const fillOf = (f: FactionOrEcho) => (f ? `var(--${f})` : 'var(--signal)');
/** Marks on a faction fill. */
export const onOf = (f: FactionOrEcho) => (f ? `var(--on-${f})` : 'var(--on-signal)');
/** Faction names as text on chrome. */
export const inkOf = (f: FactionOrEcho) => (f ? `var(--${f}-ink)` : 'var(--signal)');
/** Sigils on map-shade chips: the fill reads on near-black for every faction except obsidian Choir. */
export const markOf = (f: FactionOrEcho) => (f === 'choir' ? 'var(--on-choir)' : fillOf(f));

export const factionName = (f: FactionOrEcho) => (f ? FACTIONS[f]?.name ?? f : 'ECHO');
export const factionShort = (f: FactionOrEcho) => (f ? FACTIONS[f]?.short ?? f : 'ECHO');
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const credits = (n: number) => Number(n).toLocaleString('en-US');

export const chamfer = (c: string) =>
  `polygon(${c} 0, 100% 0, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, 0 100%, 0 ${c})`;
