// A person's frame on the front door's screens: a commander's bust, the agent's monogram, or, for a voice that is a place (a watch
// post, a control tower) and for drones nobody has named yet, a plate with no nation on it.
import type { ReactElement } from 'react';
import type { Mood } from '../../content/types';
import { CommanderPortrait } from '../watch/kit';
import { cx } from '../watch/kit';
import type { Person } from './people';

export interface PortraitProps {
  person: Person;
  mood?: Mood;
  size?: number;
  className?: string;
}

/** Concentric arcs: a voice on a net. */
function RadioMark({ size }: { size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="awf-plate-mark">
      <circle cx="12" cy="17" r="2.2" fill="currentColor" />
      <path d="M7.2 12.4a6.8 6.8 0 0 1 9.6 0M4.4 9.6a10.8 10.8 0 0 1 15.2 0M9.7 14.9a3.2 3.2 0 0 1 4.6 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" />
    </svg>
  );
}

/** Three bars struck through: nothing is known. */
function RedactedMark({ size }: { size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="awf-plate-mark">
      <path d="M4 6h16v3H4zM4 10.5h11v3H4zM4 15h16v3H4z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

export function Portrait({ person, mood, size = 96, className }: PortraitProps): ReactElement {
  if (person.kind === 'station' || person.kind === 'unmarked') {
    return (
      <div
        className={cx('awf-plate', person.kind === 'unmarked' && 'awf-plate--unmarked', className)}
        style={{ width: size, height: size }}
        role="img"
        aria-label={person.name}
      >
        {person.kind === 'station' ? <RadioMark size={Math.round(size * 0.46)} /> : <RedactedMark size={Math.round(size * 0.46)} />}
        {size >= 56 && <span className="awf-plate-initials" style={{ fontSize: Math.max(11, Math.round(size * 0.16)) }} aria-hidden>{person.initials}</span>}
      </div>
    );
  }
  return (
    <CommanderPortrait
      name={person.name}
      id={person.portraitId}
      mood={mood}
      faction={person.faction}
      initials={person.initials}
      size={size}
      className={className}
    />
  );
}
