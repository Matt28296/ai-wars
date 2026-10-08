// The full-screen power cut-in (quality-bar 7.1): the map dims, a band sweeps in with the commander's portrait, the power's name in
// display type and the commander's quote typed in, then it sweeps out. Surge is a single band, Overclock a double band with flares.
// All timing is in transition.ts; this file only draws a sample of it.
import type { CSSProperties, ReactElement } from 'react';
import { CommanderPortrait, Sigil, cx, fillOf, inkOf, onOf } from './kit';
import type { CutInSample } from './transition';

export function CutIn({ sample, reducedMotion }: { sample: CutInSample; reducedMotion: boolean }): ReactElement {
  const b = sample.beat;
  const overclock = b.level === 'overclock';
  const slide = (v: number, scale = 100): CSSProperties =>
    reducedMotion ? { opacity: 1 - Math.min(1, Math.abs(v)) } : { transform: `translateX(${v * scale}%)` };
  const label = `${b.commanderName} activates ${b.powerName} (${overclock ? 'Overclock' : 'Surge'})`;
  return (
    <div className="aww-cutin" style={{ background: `rgba(10, 14, 20, ${sample.dim.toFixed(3)})` }} role="status" aria-label={label}>
      {overclock && <div className="aww-cutin-flare aww-cutin-flare--top" style={{ ...slide(-sample.slide), background: inkOf(b.faction) }} aria-hidden />}
      <div
        className={cx('aww-cutin-band', overclock && 'aww-cutin-band--double', b.faction === 'choir' && 'aww-cutin-band--choir')}
        style={{ ...slide(sample.slide), background: fillOf(b.faction), color: onOf(b.faction) }}
      >
        <div className="aww-cutin-portrait" style={slide(sample.portraitSlide, 60)}>
          <CommanderPortrait name={b.commanderName} faction={b.faction} initials={b.initials} size={96} state={b.level} />
        </div>
        <div className="aww-cutin-text">
          <span className="label aww-cutin-kicker">{b.commanderName} / {overclock ? 'Overclock' : 'Surge'}</span>
          <span className="title aww-cutin-name">{b.powerName}</span>
          <span className="body aww-cutin-quote">{sample.quote ? `“${sample.quote}${sample.quote.length >= b.quote.length ? '”' : ''}` : ' '}</span>
        </div>
        <span className="aww-cutin-mark" aria-hidden>
          <Sigil faction={b.faction} size={190} tone="on" />
        </span>
      </div>
      {overclock && <div className="aww-cutin-flare aww-cutin-flare--bottom" style={{ ...slide(-sample.slide), background: inkOf(b.faction) }} aria-hidden />}
    </div>
  );
}
