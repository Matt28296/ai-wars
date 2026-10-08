// Public names from the audio contract (docs/ARCHITECTURE.md → "Audio contract").

export type SfxName =
  | 'cursor' | 'select' | 'cancel' | 'move' | 'menuOpen' | 'confirm' | 'error'
  | 'fire' | 'cannon' | 'laser' | 'missile' | 'explosion'
  | 'capture' | 'captured' | 'build'
  | 'powerReady' | 'surge' | 'overclock'
  | 'turnStart' | 'victory' | 'defeat' | 'text';

export type TrackName =
  | 'title' | 'map' | 'briefing'
  | 'helion' | 'tidewell' | 'verdant' | 'kestrel' | 'choir'
  | 'power' | 'victory' | 'defeat' | 'finale';

export const SFX_NAMES: readonly SfxName[] = [
  'cursor', 'select', 'cancel', 'move', 'menuOpen', 'confirm', 'error',
  'fire', 'cannon', 'laser', 'missile', 'explosion',
  'capture', 'captured', 'build',
  'powerReady', 'surge', 'overclock',
  'turnStart', 'victory', 'defeat', 'text',
];

export const TRACK_NAMES: readonly TrackName[] = [
  'title', 'map', 'briefing',
  'helion', 'tidewell', 'verdant', 'kestrel', 'choir',
  'power', 'victory', 'defeat', 'finale',
];

export type VolumeKind = 'music' | 'sfx';
