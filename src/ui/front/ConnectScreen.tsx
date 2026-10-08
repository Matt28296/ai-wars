// The connect screen (G17, D-023): three short steps, each with a Copy button, one line after them, the JSON for other apps on demand, and a
// quiet way to the built-in commander. No paragraphs. `ConnectSteps` is also what `#/live` shows when the page was not opened from an agent's
// own link (the dev server, a hosted copy), so a person who lands there is told what to do instead of looking at nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { AFTER_STEPS, CONNECT_STEPS, GAME_FOLDER, OTHER_APPS_TEXT, copyText } from './connect';
import type { CopyResult } from './connect';
import { hrefs } from './router';

/** Selects everything in an element, so Ctrl+C / Cmd+C copies it. */
function selectContents(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return;
  const sel = window.getSelection?.();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The text with the `<game folder>` placeholder drawn as a placeholder (the text itself is unchanged, so what is selected and copied is the same). */
function WithPlaceholder({ text }: { text: string }): ReactElement {
  const at = text.indexOf(GAME_FOLDER);
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<span className="awf-ph">{GAME_FOLDER}</span>{text.slice(at + GAME_FOLDER.length)}</>;
}

const LABEL: Record<'idle' | CopyResult, string> = { idle: 'Copy', copied: 'Copied', selected: 'Selected' };

/** A line of text on a cut panel with its Copy button. Without a clipboard the button selects the text instead. */
export function CopyLine({ text, name }: { text: string; name: string }): ReactElement {
  const code = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [state, setState] = useState<'idle' | CopyResult>('idle');
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onCopy = useCallback(() => {
    void copyText(text, { clipboard: navigator.clipboard, select: () => selectContents(code.current) }).then((r) => {
      setState(r);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState('idle'), 2400);
    });
  }, [text]);
  return (
    <div className="awf-copy awf-cut" data-block={text.includes('\n') ? 'yes' : undefined}>
      <code ref={code} className="awf-copy-text" data-copy-text>
        <WithPlaceholder text={text} />
      </code>
      <button
        type="button"
        className="aw-btn aw-btn--secondary aw-btn--sm label awf-copy-btn"
        data-copy={name}
        data-state={state}
        onClick={onCopy}
        aria-label={`Copy: ${text}`}
        title={state === 'selected' ? 'Selected. Press Ctrl+C (or Cmd+C) to copy.' : undefined}
      >
        <span className="aw-btn-label">{LABEL[state]}</span>
      </button>
      <span className="awf-sr" role="status">{state === 'copied' ? 'Copied' : state === 'selected' ? 'Selected, press Ctrl+C to copy' : ''}</span>
    </div>
  );
}

/** The three steps, and the one line after them. */
export function ConnectSteps(): ReactElement {
  return (
    <>
      <ol className="awf-steps" aria-label="Connect your agent">
        {CONNECT_STEPS.map((step, i) => (
          <li key={step.id} className="awf-step" data-step={step.id}>
            <span className="awf-step-n stat-sm" aria-hidden>{i + 1}</span>
            <div className="awf-step-body">
              <p className="awf-step-lead body-sm">{step.lead}</p>
              <CopyLine text={step.copy} name={step.id} />
            </div>
          </li>
        ))}
      </ol>
      <p className="awf-then body-sm" data-then>{AFTER_STEPS}</p>
    </>
  );
}

/** The JSON for any other app, folded away until asked for. */
export function OtherApps(): ReactElement {
  return (
    <details className="awf-other" data-other>
      <summary className="awf-other-sum label">Other apps</summary>
      <div className="awf-other-body">
        <CopyLine text={OTHER_APPS_TEXT} name="other-apps" />
      </div>
    </details>
  );
}

export function ConnectScreen(): ReactElement {
  return (
    <main className="awf-root awf-connect" data-screen="connect">
      <div className="awf-connect-body">
        <a className="awf-back label" href={hrefs.title}>Title</a>
        <h1 className="awf-h1">Connect your agent</h1>
        <ConnectSteps />
        <OtherApps />
        <a className="awf-quiet label" href={hrefs.campaign} data-action="campaign">Or watch the built-in commander</a>
      </div>
    </main>
  );
}
