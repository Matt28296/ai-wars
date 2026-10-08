import { useRef, useState } from 'react';
import { Sigil } from '../kit/primitives';
import { sound } from './bridges';
import { useNavLayer } from './input';

const IGNORE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Dead', 'Unidentified']);

/** Title: the name over the living tile field. Any key / click / tap wakes the audio and opens the menu. */
export function TitleScreen({ onStart }: { onStart(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const start = () => {
    if (leaving) return;
    setLeaving(true);
    void sound.init().then(() => sound.sfx('confirm'));
    window.setTimeout(onStart, 200);
  };
  useNavLayer(ref, {
    autoFocus: false,
    onKey: (e) => {
      if (IGNORE.has(e.key) || /^F\d+$/.test(e.key) || e.repeat) return false;
      start();
      return true;
    },
  });
  return (
    <div ref={ref} className={`sh-screen sh-title${leaving ? ' sh-title--leaving' : ''}`} onPointerUp={(e) => { if (e.button === 0) start(); }}>
      <div className="sh-title-top">
        <Sigil faction={null} size={16} />
        <span className="label">Meridia · Rebuild Era 104</span>
      </div>
      <div className="sh-title-lockup">
        <h1 className="sh-logo" aria-label="Ascendant Wars">
          <span className="sh-logo-a">Ascendant</span>
          <span className="sh-logo-b"><span className="sh-logo-rule" aria-hidden />Wars</span>
        </h1>
        <p className="body sh-title-tag">Somebody fired first. Everybody says it was us.</p>
      </div>
      <div className="sh-press" role="button" tabIndex={0} aria-label="Start">
        <span className="label sh-press-key">Press any key</span>
        <span className="label sh-press-touch">Tap to start</span>
      </div>
      <footer className="sh-title-foot">
        <span className="caption">An original turn-based tactics game · v0.1</span>
        <span className="caption">Five nations · Eleven commanders · Fourteen operations</span>
      </footer>
    </div>
  );
}
