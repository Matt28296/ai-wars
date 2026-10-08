// Minimal stand-in for src/ui/story/DialoguePlayer (shell worker) so mission events play before it lands.
// Same contract: Z/Enter/Space/click advance (first press completes the line), X/Esc skip all.
import { useEffect, useRef, useState } from 'react';
import type { DialogueLine } from '../../content/types';
import { COMMANDERS } from '../../content/commanders';
import { COMMANDER_BASE } from '../../data';
import { DialogueBox } from '../kit';
import type { FactionId } from '../../engine/types';

export function FallbackDialogue({ lines, onDone, backdrop = 'dim' }: { lines: DialogueLine[]; onDone(): void; backdrop?: 'none' | 'dim' | 'briefing' }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0);
  const line = lines[i];
  const full = line?.text ?? '';
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => { if (!line) done.current(); }, [line]);
  useEffect(() => {
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= full.length ? n : n + 2)), 22);
    return () => clearInterval(id);
  }, [i, full]);

  useEffect(() => {
    const advance = () => { if (shown < full.length) setShown(full.length); else setI((n) => n + 1); };
    const onKey = (e: KeyboardEvent) => {
      if (['z', 'Z', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) advance(); }
      else if (['x', 'X', 'Escape', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); done.current(); }
    };
    window.addEventListener('keydown', onKey, true);
    const el = document.getElementById('bs-dialogue-fallback');
    const onClick = () => advance();
    el?.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey, true); el?.removeEventListener('click', onClick); };
  }, [shown, full]);

  if (!line) return null;
  const def = COMMANDERS[line.speaker];
  const base = (COMMANDER_BASE as unknown as { id: string; name: string; initials: string; faction: FactionId | null; title: string }[]).find((c) => c.id === line.speaker);
  const name = def?.name ?? base?.name ?? (line.speaker === 'narrator' ? '' : line.speaker);
  const faction = def?.faction ?? base?.faction ?? null;
  return (
    <div id="bs-dialogue-fallback" className={`bs-dialogue bs-dialogue--${backdrop}`}>
      <DialogueBox
        speaker={{ id: line.speaker, name, faction, initials: def?.initials ?? base?.initials, title: def?.title ?? base?.title, mood: line.mood }}
        side={line.side ?? 'left'}
        channel={line.channel}
        more={shown >= full.length}
      >
        {full.slice(0, shown)}
      </DialogueBox>
    </div>
  );
}
