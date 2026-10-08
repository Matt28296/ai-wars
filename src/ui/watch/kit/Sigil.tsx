import type { ReactElement } from 'react';
import { ART } from '../../../data';
import { Paths, inkOf, markOf, onOf } from './roles';
import type { Faction, PathSpec } from './roles';

export interface SigilProps {
  faction: Faction | null;
  size?: number;
  /** ink = faction text colour (on chrome), fill = faction fill (on map-shade), on = on-faction (on a faction fill), current = inherit. */
  tone?: 'ink' | 'fill' | 'on' | 'current';
  /** Accessible name; omit when a visible word already names the faction. */
  title?: string;
}

const SIGILS = ART.sigils as unknown as Record<string, readonly PathSpec[]>;

/** A nation's mark: the shape that tells factions apart when colour can't. */
export function Sigil({ faction, size = 24, tone = 'ink', title }: SigilProps): ReactElement {
  const key = faction ?? 'echo';
  const color = tone === 'fill' ? markOf(faction) : tone === 'on' ? onOf(faction) : tone === 'current' ? 'currentColor' : inkOf(faction);
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg className="aw-sigil" width={size} height={size} viewBox="0 0 24 24" {...a11y}>
      <Paths list={SIGILS[key] ?? []} color={color} />
    </svg>
  );
}
