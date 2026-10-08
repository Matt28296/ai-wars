// Shared helpers for G17's tests (not shipped: nothing in the game imports this file).
//   scriptedMatch()   a short real match played through the real tools and the real feed, and every message the feed sent, in order
//   sseText/parseSse  the feed's wire format, written here from the Server-Sent Events rules and not from feed.ts
//   FakeEventSource   a scripted stand-in for the browser's EventSource
import { MISSIONS } from '../../content/missions';
import { startFeed } from '../../agent/feed';
import type { LiveMessage, LiveRecord } from '../../agent/live';
import { AgentMatch } from '../../agent/match';
import { AgentSession } from '../../agent/tools';
import { openSse } from '../../agent/testkit';
import type { EventSourceLike } from './liveFeed';

export interface Scripted {
  /** setup, step 0..n, result, record: what a viewer connected from the start receives. */
  messages: LiveMessage[];
  record: LiveRecord;
}

/** The first legal action, or the end of the turn when none is left. */
function walk(s: AgentSession): void {
  const l = s.legalActions().data as { units: { actions: { id: string }[] }[]; builds: { id: string }[] };
  const id = [...l.units.flatMap((u) => u.actions.map((a) => a.id)), ...l.builds.map((b) => b.id)][0];
  if (id) s.act(id);
  else s.endTurn();
}

/** Plays `missionId` through the MCP tools' session for `maxCycles` cycles, and reads back what its feed sent over a real socket. */
export async function scriptedMatch(missionId: string, maxCycles = 2): Promise<Scripted> {
  if (!MISSIONS.some((m) => m.id === missionId)) throw new Error(`no mission ${missionId}`);
  const feed = await startFeed({ site: null });
  try {
    let host!: AgentMatch;
    const s = new AgentSession({ feed, makeHost: (m) => (host = new AgentMatch(m, { maxCycles })) });
    s.startMission(missionId);
    while (!host.result()) walk(s);
    const total = host.record().actions.length + 1 + 3;
    const live = await openSse(feed.liveUrl);
    try {
      await live.waitFor(total);
      const record = feed.record();
      if (!record) throw new Error('the match is over and the feed holds no record');
      return { messages: live.frames.map((f) => f.message), record };
    } finally {
      live.close();
    }
  } finally {
    await feed.close();
  }
}

/** Messages as the wire carries them. */
export const sseText = (messages: readonly LiveMessage[]): string => messages.map((m) => `event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`).join('');

/** The (event, data) pairs of a Server-Sent Events text. Comment lines and the retry line are skipped. */
export function parseSse(text: string): { event: string; data: string }[] {
  const out: { event: string; data: string }[] = [];
  for (const block of text.split('\n\n')) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line.startsWith('retry:')) continue;
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length) out.push({ event, data: data.join('\n') });
  }
  return out;
}

/** A scripted EventSource: the test decides when it opens, what arrives and when it fails. */
export class FakeEventSource implements EventSourceLike {
  static made: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onopen: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private readonly listeners = new Map<string, ((e: { data: unknown }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.made.push(this);
  }
  addEventListener(type: string, listener: (e: { data: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  /** The connection dropped and the browser will try again (readyState CONNECTING), or gave up (CLOSED). */
  fail(fatal = false): void {
    this.readyState = fatal ? 2 : 0;
    this.onerror?.({});
  }
  emit(event: string, data: unknown): void {
    for (const l of this.listeners.get(event) ?? []) l({ data });
  }
  /** Delivers a whole SSE text, as the browser would frame it. */
  play(text: string): void {
    for (const { event, data } of parseSse(text)) this.emit(event, data);
  }
}
