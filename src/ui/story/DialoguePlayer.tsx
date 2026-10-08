// DialoguePlayer — the story voice (docs/ARCHITECTURE.md "UI contract").
//   Z / Enter / Space / click / tap   first press completes the line, the next advances
//   hold any of those (≈0.9 s)        skip the whole scene (a meter shows the hold)
//   X / Esc / Backspace / right-click / two-finger tap   skip the whole scene
//   L (or the Log button)             backlog of every line so far; ↑/↓ scroll, X/L closes
// Portraits slide in on their side and dim when not speaking; narrator lines are centred location cards.
// While mounted it owns the keyboard (capture phase), so the battle screen and shell menus stay still.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DialogueLine, Mood } from '../../content/types';
import type { FactionId } from '../../engine/types';
import { Button, Frame, Sigil, inkOf, cx } from '../kit';
import { sound, speakerInfo } from '../shell/bridges';
import { TEXT_CPS, useSettings } from '../shell/save';
import { Face } from '../shell/ui';
import './story.css';

export interface DialoguePlayerProps { lines: DialogueLine[]; onDone(): void; backdrop?: 'none' | 'dim' | 'briefing' }

type Side = 'left' | 'right';
interface Slot { speaker: string; mood: Mood }
interface Stage { left: Slot | null; right: Slot | null; active: Side | null }

/** Works out who stands where for each line: explicit side wins; otherwise a speaker keeps their side,
 *  and a newcomer takes the side opposite the previous speaker. */
function computeStages(lines: DialogueLine[]): Stage[] {
  const out: Stage[] = [];
  let left: Slot | null = null, right: Slot | null = null, prev: Side | null = null;
  for (const l of lines) {
    if (l.speaker === 'narrator') { out.push({ left, right, active: null }); continue; }
    let side: Side;
    if (l.side) side = l.side;
    else if (left?.speaker === l.speaker) side = 'left';
    else if (right?.speaker === l.speaker) side = 'right';
    else side = prev === 'left' ? 'right' : prev === 'right' ? 'left' : 'left';
    const slot = { speaker: l.speaker, mood: l.mood ?? 'neutral' };
    if (side === 'left') { left = slot; if (right?.speaker === l.speaker) right = null; }
    else { right = slot; if (left?.speaker === l.speaker) left = null; }
    prev = side;
    out.push({ left, right, active: side });
  }
  return out;
}

/** Typewriter schedule: each character costs 1, with short pauses after punctuation. */
function schedule(text: string): number[] {
  const at: number[] = [];
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    at.push(t);
    const c = text[i]!;
    t += 1;
    if ('.!?'.includes(c) && text[i + 1] === ' ') t += 7;
    else if (',;:—'.includes(c)) t += 3;
  }
  at.push(t);
  return at;
}

const HOLD_START = 260;   // ms before the hold meter appears
const HOLD_SKIP = 900;    // ms of holding that skips the scene

export function DialoguePlayer({ lines, onDone, backdrop = 'dim' }: DialoguePlayerProps) {
  const { textSpeed } = useSettings();
  const cps = TEXT_CPS[textSpeed];
  const sig = useMemo(() => lines.map((l) => l.speaker + '\u0001' + l.text).join('\u0002'), [lines]);
  const stages = useMemo(() => computeStages(lines), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [hold, setHold] = useState(0);
  const line = lines[index];
  const text = line?.text ?? '';
  const complete = shown >= text.length;
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  // New script → start over.
  useEffect(() => { doneRef.current = false; setIndex(0); setLogOpen(false); }, [sig]);
  useEffect(() => { if (!lines.length) finish(); }, [lines.length, finish]);

  // Typewriter.
  useEffect(() => {
    if (!line) return;
    if (!isFinite(cps)) { setShown(text.length); return; }
    setShown(0);
    const at = schedule(text);
    const t0 = performance.now();
    let raf = 0, last = 0, blips = 0, lastBlip = 0;
    const tick = (now: number) => {
      const units = ((now - t0) / 1000) * cps;
      let n = last;
      while (n < text.length && at[n + 1]! <= units) n++;
      if (n !== last) {
        for (let k = last; k < n; k++) if (text[k] !== ' ') blips++;
        if (blips >= 2 && now - lastBlip > 38) { sound.sfx('text'); blips = 0; lastBlip = now; }
        last = n;
        setShown(n);
      }
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, sig, cps]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = useCallback(() => {
    if (!line) return;
    if (!complete) { setShown(text.length); return; }
    if (index < lines.length - 1) { sound.sfx('cursor'); setIndex(index + 1); }
    else { sound.sfx('confirm'); finish(); }
  }, [line, complete, text.length, index, lines.length, finish]);

  const skipAll = useCallback(() => { sound.sfx('cancel'); finish(); }, [finish]);

  // Hold-to-skip.
  const holdRef = useRef<{ t0: number; raf: number } | null>(null);
  const startHold = useCallback(() => {
    if (holdRef.current) return;
    const h = { t0: performance.now(), raf: 0 };
    holdRef.current = h;
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - h.t0 - HOLD_START) / (HOLD_SKIP - HOLD_START)));
      setHold(p);
      if (p >= 1) { holdRef.current = null; setHold(0); skipAll(); return; }
      h.raf = requestAnimationFrame(tick);
    };
    h.raf = requestAnimationFrame(tick);
  }, [skipAll]);
  const endHold = useCallback(() => {
    if (holdRef.current) cancelAnimationFrame(holdRef.current.raf);
    holdRef.current = null;
    setHold(0);
  }, []);
  useEffect(() => endHold, [endHold]);

  // Keyboard (capture: the dialogue owns input while it is up).
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const isConfirm = (k: string) => k === 'Enter' || k === ' ' || k === 'z' || k === 'Z';
    const isCancel = (k: string) => k === 'Escape' || k === 'x' || k === 'X' || k === 'Backspace';
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const nav = k.startsWith('Arrow') || 'wasdWASD'.includes(k) && k.length === 1;
      if (!isConfirm(k) && !isCancel(k) && !nav && k !== 'l' && k !== 'L' && k !== 'Tab') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (logOpen) {
        if (isCancel(k) || k === 'l' || k === 'L' || (isConfirm(k) && !e.repeat)) { sound.sfx('cancel'); setLogOpen(false); }
        else if (k === 'ArrowUp' || k === 'w' || k === 'W') logRef.current?.scrollBy({ top: -80 });
        else if (k === 'ArrowDown' || k === 's' || k === 'S') logRef.current?.scrollBy({ top: 80 });
        return;
      }
      if (k === 'l' || k === 'L') { if (!e.repeat) { sound.sfx('menuOpen'); setLogOpen(true); } return; }
      if (isCancel(k)) { if (!e.repeat) skipAll(); return; }
      if (isConfirm(k)) { if (!e.repeat) { advance(); startHold(); } }
    };
    const up = (e: KeyboardEvent) => { if (isConfirm(e.key)) endHold(); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', endHold);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', endHold);
    };
  }, [logOpen, advance, skipAll, startHold, endHold]);

  useEffect(() => { if (logOpen) logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logOpen]);

  // Pointer: tap = confirm (on release, unless the press turned into a hold-skip); right-click / two fingers = skip.
  const pressRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || logOpen) return;
    pressRef.current = true;
    startHold();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0 || !pressRef.current) return;
    pressRef.current = false;
    const held = hold > 0;
    endHold();
    if (!held) advance();
  };
  const onPointerCancel = () => { pressRef.current = false; endHold(); };
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); if (!logOpen) skipAll(); };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) { e.preventDefault(); e.stopPropagation(); pressRef.current = false; endHold(); skipAll(); }
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (!line) return <div className={cx('dp', `dp--${backdrop}`)} aria-hidden />;
  const stage = stages[index] ?? { left: null, right: null, active: null };
  const narrator = line.speaker === 'narrator';
  const who = speakerInfo(line.speaker);
  const side: Side = stage.active ?? 'left';

  return (
    <div
      className={cx('dp', `dp--${backdrop}`, narrator && 'dp--narrating')}
      role="dialog"
      aria-modal="true"
      aria-label="Dialogue"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
    >
      {backdrop === 'briefing' && <BriefingGrid />}

      <div className="dp-controls" onPointerDown={stop} onPointerUp={stop}>
        <Button variant="ghost" size="sm" hotkey="L" onClick={() => { sound.sfx('menuOpen'); setLogOpen(true); }}>Log</Button>
        <Button variant="ghost" size="sm" hotkey="X" onClick={skipAll}>Skip</Button>
      </div>

      {narrator ? (
        <div className="dp-loc-wrap">
          <Frame floating className="dp-loc" key={index}>
            <div className="label dp-loc-kicker">{line.channel ?? 'Location'}</div>
            <p className="heading dp-loc-text">
              <span className="dp-text-shown">{text.slice(0, shown)}</span>
              <span className="dp-text-rest" aria-hidden>{text.slice(shown)}</span>
            </p>
            {complete && <span className="dp-more dp-more--loc" aria-hidden />}
          </Frame>
        </div>
      ) : (
        <div className="dp-bottom">
          <div className="dp-portraits" aria-hidden>
            {(['left', 'right'] as Side[]).map((s) => {
              const slot = stage[s];
              if (!slot) return null;
              const active = stage.active === s;
              return (
                <div key={s + slot.speaker} className={cx('dp-portrait', `dp-portrait--${s}`, !active && 'dp-portrait--idle')}>
                  <div key={slot.mood + (active ? index : '')} className={cx('dp-emote', active && `dp-emote--${slot.mood}`)}>
                    <Face speaker={slot.speaker} mood={slot.mood} size={PORTRAIT} className="dp-face" style={{ '--dp-size': PORTRAIT + 'px' } as CSSProperties} />
                  </div>
                </div>
              );
            })}
          </div>
          <Frame floating className={cx('dp-box', side === 'right' && 'dp-box--right')}>
            {hold > 0 && (
              <div className="dp-hold" aria-hidden>
                <span className="label">Hold to skip</span>
                <span className="dp-hold-bar"><span style={{ width: `${hold * 100}%` }} /></span>
              </div>
            )}
            <div className="dp-who">
              {who.known && <Sigil faction={who.faction} size={16} />}
              <span className="heading" style={{ color: who.known ? inkOf(who.faction as FactionId | null) : 'var(--ink)' }}>{who.name}</span>
              {who.title && <span className="caption dp-title">{who.title}</span>}
            </div>
            {line.channel && <div className="caption dp-channel"><span className="dp-channel-dot" />{line.channel}</div>}
            <p className="body dp-text">
              <span className="dp-text-shown">{text.slice(0, shown)}</span>
              <span className="dp-text-rest" aria-hidden>{text.slice(shown)}</span>
            </p>
            {complete && <span className="dp-more" aria-hidden />}
            <span className="dp-count stat-sm" aria-hidden>{index + 1}/{lines.length}</span>
          </Frame>
        </div>
      )}

      <div className="sr-only" aria-live="polite">{(who.name ? who.name + ': ' : '') + text}</div>

      {logOpen && (
        <div className="dp-log-scrim" onPointerDown={stop} onPointerUp={stop} onClick={() => { sound.sfx('cancel'); setLogOpen(false); }}>
          <Frame floating raised className="dp-log" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-label="Dialogue log">
            <div className="dp-log-head">
              <span className="label">Log</span>
              <Button variant="ghost" size="sm" hotkey="X" onClick={() => { sound.sfx('cancel'); setLogOpen(false); }}>Close</Button>
            </div>
            <div className="dp-log-list" ref={logRef} tabIndex={-1}>
              {lines.slice(0, index + 1).map((l, i) => {
                const w = speakerInfo(l.speaker);
                return w.narrator ? (
                  <div key={i} className="dp-log-loc caption">{l.text}</div>
                ) : (
                  <div key={i} className="dp-log-row">
                    <div className="dp-log-who">
                      {w.known && <Sigil faction={w.faction} size={12} />}
                      <span className="label" style={{ color: w.known ? inkOf(w.faction) : 'var(--ink)' }}>{w.name}</span>
                    </div>
                    <p className="body-sm dp-log-text">{l.text}</p>
                  </div>
                );
              })}
            </div>
          </Frame>
        </div>
      )}
    </div>
  );
}

const PORTRAIT = 176;

function BriefingGrid() {
  return (
    <svg className="dp-grid" aria-hidden>
      <defs>
        <pattern id="dp-grid-p" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" style={{ fill: 'none', stroke: 'var(--line)', strokeWidth: 1 }} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dp-grid-p)" />
    </svg>
  );
}

export default DialoguePlayer;
