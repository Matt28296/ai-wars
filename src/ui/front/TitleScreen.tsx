// The title screen (G9): the game's name over a slow, low-angle orbit of a real skirmish board, the five nations' sigils and three
// choices. The 3D board is a lazy chunk drawn over a tile still, so the first paint never waits for three.js; with no WebGL2 (or with
// reduced motion) the picture is the still, or a frozen frame, and the choices work the same.
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { FACTIONS } from '../../data';
import type { FactionId } from '../../game/aw';
import { Sigil } from '../watch/kit';
import { BoardPreview } from './BoardPreview';
import { TITLE_ORBIT } from './orbit';
import { hrefs } from './router';
import { titleScene } from './scene';

const NATIONS: readonly FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];

/** The logo rule under the name: the cover's blocks, one per nation, each corner cut. Widths step down like the nations' fills do. */
const RULE_WIDTHS: Record<FactionId, number> = { helion: 112, tidewell: 80, verdant: 64, kestrel: 48, choir: 32 };

export interface TitleScreenProps {
  /** Forces the answer to "can this browser do WebGL2?" (tests and screenshots). By default the browser is asked. */
  webgl2?: boolean;
}

export function TitleScreen({ webgl2 }: TitleScreenProps): ReactElement {
  const scene = useMemo(titleScene, []);
  const menu = useRef<HTMLElement>(null);

  // Keyboard first: the first choice has focus on arrival, and the arrow keys walk the choices that can be chosen.
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[data-choice]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, []);
  const onMenuKey = (e: KeyboardEvent<HTMLElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[data-choice]:not([aria-disabled="true"])') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <main className="awf-root awf-title" data-screen="title">
      <BoardPreview scene={scene} orbit={TITLE_ORBIT} webgl2={webgl2} className="awf-backdrop" />
      <div className="awf-title-scrim" aria-hidden />
      <div className="awf-title-body">
        <p className="awf-kicker label">Turn-based tactics for the war after the Long Silence</p>
        <h1 className="awf-name">Ascendant<br />Wars</h1>
        <div className="awf-rule" aria-hidden>
          {NATIONS.map((f) => <span key={f} className={`awf-rule-block awf-rule-block--${f}`} style={{ width: RULE_WIDTHS[f] }} />)}
        </div>
        <nav className="awf-menu" aria-label="Main menu" ref={menu} onKeyDown={onMenuKey}>
          <a className="awf-choice awf-choice--primary awf-cut" href={hrefs.campaign} data-choice="campaign">
            <span className="awf-choice-text">
              <span className="awf-choice-label">Campaign</span>
              <span className="awf-choice-desc body-sm">Fourteen missions across four acts. Brief, deploy, watch.</span>
            </span>
            <span className="awf-choice-go" aria-hidden />
          </a>
          <a className="awf-choice awf-cut" href={hrefs.demo} data-choice="watch">
            <span className="awf-choice-text">
              <span className="awf-choice-label">Watch a battle</span>
              <span className="awf-choice-desc body-sm">Calder Fields: Helion against Tidewell, fought by Doctrine.</span>
            </span>
            <span className="awf-choice-go" aria-hidden />
          </a>
          <button type="button" className="awf-choice awf-cut" data-choice="console" disabled aria-disabled="true" aria-label="Agent console (coming with the platform)">
            <span className="awf-choice-text">
              <span className="awf-choice-label">Agent console</span>
              <span className="awf-choice-desc body-sm">Coming with the platform</span>
            </span>
          </button>
        </nav>
        <ul className="awf-nations" aria-label="The five nations">
          {NATIONS.map((f) => (
            <li key={f} className="awf-nation" title={`${FACTIONS[f].name}: ${FACTIONS[f].motto}`}>
              <Sigil faction={f} size={26} tone="ink" />
              <span className="awf-nation-name caption">{FACTIONS[f].short}</span>
            </li>
          ))}
        </ul>
        <p className="awf-credo caption">Your agent commands. You direct it. No unit is ever moved by hand.</p>
      </div>
    </main>
  );
}
