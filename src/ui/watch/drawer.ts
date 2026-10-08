// The details drawer's model (G18, D-023): which tab it is on, whether it is open, how many log lines arrived while it was shut, and which keys
// open and close it. Pure: no React and no DOM, so every rule here is tested in node.
//
// The battle screen shows the board, one slim bar and the playback bar. Players, unit intel and the log share ONE drawer the viewer opens (the
// "Details" button or the key D). While it is shut the log keeps growing, and the button says how many lines are new: a small count, never a toast.
import type { KeyInfo, KeyTarget } from './controls';
import type { LogLine } from './format';

export type DrawerTab = 'players' | 'intel' | 'log';

/** The tabs, in the order the drawer shows them (D-023: Players, Intel and Log). */
export const DRAWER_TABS: readonly { tab: DrawerTab; label: string }[] = [
  { tab: 'players', label: 'Players' },
  { tab: 'intel', label: 'Intel' },
  { tab: 'log', label: 'Log' },
];

export const isDrawerTab = (v: unknown): v is DrawerTab => v === 'players' || v === 'intel' || v === 'log';

export interface DrawerState {
  open: boolean;
  tab: DrawerTab;
  /** How many log lines had been read when the drawer was last shut. While it is open every line is read, so this is not consulted. */
  seen: number;
}

/** A drawer that starts shut (or open on a tab, for tests and screenshots) on a log that already holds `lines` lines. */
export function initialDrawer(lines: number, open: DrawerTab | undefined = undefined): DrawerState {
  return { open: open !== undefined, tab: open ?? 'players', seen: lines };
}

export type DrawerAction =
  | { type: 'open'; tab?: DrawerTab }
  | { type: 'close'; lines: number }
  | { type: 'toggle'; lines: number }
  | { type: 'tab'; tab: DrawerTab }
  /** The log is another log now (another viewer): its `lines` lines count as read. */
  | { type: 'rebase'; lines: number };

export function drawerReducer(s: DrawerState, a: DrawerAction): DrawerState {
  switch (a.type) {
    case 'open':
      return s.open && (a.tab === undefined || a.tab === s.tab) ? s : { ...s, open: true, tab: a.tab ?? s.tab };
    case 'close':
      // The lines there are now are the ones read: only what comes after them is new.
      return s.open ? { ...s, open: false, seen: a.lines } : s;
    case 'toggle':
      return s.open ? drawerReducer(s, { type: 'close', lines: a.lines }) : drawerReducer(s, { type: 'open' });
    case 'tab':
      return s.tab === a.tab ? s : { ...s, tab: a.tab };
    case 'rebase':
      return s.seen === a.lines ? s : { ...s, seen: a.lines };
    default:
      return s;
  }
}

/**
 * New log lines since the drawer was shut: what the count on "Details" says. An open drawer has none (the viewer is looking at the log), and
 * a log that is shorter than what was read (the scrubber went back) has none either: only lines past the last one read are new.
 */
export const unreadLines = (s: DrawerState, lines: number): number => (s.open ? 0 : Math.max(0, lines - s.seen));

/** The count as the button writes it: nothing for none, and "99+" for a flood. */
export const countLabel = (n: number): string => (n <= 0 ? '' : n > 99 ? '99+' : String(n));

/**
 * The lines the log shows by default, which is what the count counts: every line but the quiet ones (the moves, behind "Show moves"). The orders
 * the player's agent changed (G14) are information lines, so they count.
 */
export const countLogLines = (lines: readonly Pick<LogLine, 'tone'>[]): number => lines.reduce((n, l) => (l.tone === 'quiet' ? n : n + 1), 0);

// ---------------------------------------------------------------- keys

/** What a key press means to the drawer: D opens and closes it, Escape shuts it. Null: not the drawer's key. */
export type DrawerKey = { type: 'toggle' } | { type: 'close' };

/** A focused field takes its own letters: D typed into a text box is a letter. A checkbox or the scrubber's slider has no use for D. */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time']);
const typing = (t: KeyTarget & { editable?: boolean }): boolean => {
  const tag = (t.tag ?? '').toLowerCase();
  return t.editable === true || tag === 'textarea' || tag === 'select' || (tag === 'input' && (t.type === undefined || TEXT_TYPES.has(t.type)));
};

export function keyToDrawerAction(k: KeyInfo & { repeat?: boolean }, target: KeyTarget & { editable?: boolean } = {}, open = false): DrawerKey | null {
  if (k.ctrlKey || k.metaKey || k.altKey) return null;
  if (k.key === 'Escape') return open ? { type: 'close' } : null;
  if ((k.key === 'd' || k.key === 'D') && !typing(target)) return k.repeat ? null : { type: 'toggle' };
  return null;
}

/** Escape shuts one thing at a time, the smallest first: the View menu, then the drawer. */
export function escapeTarget(open: { menu: boolean; drawer: boolean }): 'menu' | 'drawer' | null {
  return open.menu ? 'menu' : open.drawer ? 'drawer' : null;
}

/**
 * What a key press does to the bar's two pop-ups, given which are open: the watch view's one key handler asks this and does what it answers.
 * D opens and closes the drawer; Escape shuts the View menu if it is open, else the drawer. Null: not these keys (playback's keys, or a letter
 * typed into a field), and the handler goes on to ask playback.
 */
export type KeyRoute = 'toggle-drawer' | 'close-drawer' | 'close-menu';
export function routeKey(k: KeyInfo & { repeat?: boolean }, target: KeyTarget & { editable?: boolean }, open: { menu: boolean; drawer: boolean }): KeyRoute | null {
  const key = keyToDrawerAction(k, target, open.menu || open.drawer);
  if (key === null) return null;
  if (key.type === 'toggle') return 'toggle-drawer';
  const which = escapeTarget(open);
  return which === 'menu' ? 'close-menu' : which === 'drawer' ? 'close-drawer' : null;
}

/** The tab an arrow key moves to from `tab` (the tablist wraps), or null for a key that is not the tablist's. */
export function tabAfterKey(tab: DrawerTab, key: string): DrawerTab | null {
  const at = DRAWER_TABS.findIndex((t) => t.tab === tab);
  const n = DRAWER_TABS.length;
  switch (key) {
    case 'ArrowRight': return DRAWER_TABS[(at + 1) % n].tab;
    case 'ArrowLeft': return DRAWER_TABS[(at + n - 1) % n].tab;
    case 'Home': return DRAWER_TABS[0].tab;
    case 'End': return DRAWER_TABS[n - 1].tab;
    default: return null;
  }
}
