// The real thing (A1): `scripts/agent.mjs` as a child process, spoken to over stdio. It must start in under 5 s, print nothing on stdout that is
// not a JSON-RPC message (stdout belongs to the protocol), log to stderr, and answer a real MCP client.
// It is run with `node scripts/agent.mjs`, which is what `pnpm agent` runs; pnpm itself prints a banner on stdout unless it is given --silent
// (docs/AGENT.md), and that banner is pnpm's, not the server's.
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../content/missions';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/agent.mjs', import.meta.url));
const START_BUDGET_MS = 5000;

/** The lines of `stdout` that are not a JSON-RPC 2.0 message. [] = the protocol had the stream to itself. */
function nonProtocolLines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => l.trim() !== '').filter((l) => {
    try {
      const m = JSON.parse(l) as { jsonrpc?: unknown };
      return m === null || typeof m !== 'object' || m.jsonrpc !== '2.0';
    } catch {
      return true;
    }
  });
}

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
});

describe('the checker for a clean stdout', () => {
  it('passes JSON-RPC lines and flags a banner, a log line or half a message (planted)', () => {
    const good = '{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","method":"notifications/x"}\n';
    expect(nonProtocolLines(good)).toStrictEqual([]);
    expect(nonProtocolLines(`> ascendant-wars@0.1.0 agent /x\n${good}`)).toStrictEqual(['> ascendant-wars@0.1.0 agent /x']);
    expect(nonProtocolLines(`${good}ready\n`)).toStrictEqual(['ready']);
    expect(nonProtocolLines('{"id":1,"result":{}}\n')).toHaveLength(1);
    expect(nonProtocolLines('{"jsonrpc":"2.0","id":1,\n')).toHaveLength(1);
    expect(nonProtocolLines('42\nnull\n')).toHaveLength(2);
  });
});

describe('scripts/agent.mjs over stdio', () => {
  it('starts in under 5 s, writes only JSON-RPC to stdout and its log to stderr, and serves the tools', async () => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { out += d; });
    child.stderr.on('data', (d: string) => { err += d; });
    const send = (m: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    const lines = () => out.split('\n').filter(Boolean);
    const until = (pred: () => boolean) => new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        if (pred()) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 30_000) { clearInterval(timer); reject(new Error(`timed out; stdout so far: ${out.slice(0, 300)}; stderr: ${err.slice(0, 300)}`)); }
      }, 20);
    });

    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } });
    // nothing on stdout until the client has said something: the first stdout byte is the answer to initialize
    await until(() => lines().length >= 1);
    const handshakeMs = Date.now() - t0;
    expect(handshakeMs, 'the handshake was answered within the start budget').toBeLessThan(START_BUDGET_MS);
    expect(JSON.parse(lines()[0])).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'ascendant-wars' } } });

    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    send({ id: 3, method: 'tools/call', params: { name: 'start_mission', arguments: { mission: 'first-light' } } });
    send({ id: 4, method: 'tools/call', params: { name: 'observe', arguments: {} } });
    send({ id: 5, method: 'tools/call', params: { name: 'end_turn', arguments: {} } });
    await until(() => lines().length >= 5);
    child.stdin.end();
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    expect(nonProtocolLines(out), 'stdout carried only JSON-RPC').toStrictEqual([]);
    const byId = new Map(lines().map((l) => JSON.parse(l)).filter((m) => m.id !== undefined).map((m) => [m.id, m]));
    expect(byId.get(2).result.tools.map((t: { name: string }) => t.name).sort()).toStrictEqual(['act', 'end_turn', 'get_orders', 'legal_actions', 'list_missions', 'observe', 'start_mission', 'unit_info']);
    const started = JSON.parse(byId.get(3).result.content[0].text);
    expect(started).toMatchObject({ ok: true, mission: 'first-light', seat: 0, cycleCap: 30 });
    expect(started.live.events).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/live$/);
    expect(JSON.parse(byId.get(4).result.content[0].text)).toMatchObject({ ok: true, cycle: 1, yourTurn: true });
    expect(JSON.parse(byId.get(5).result.content[0].text).status).toMatchObject({ cycle: 2, yourTurn: true });

    // the log is on stderr
    expect(err).toMatch(/ready on stdio/);
    expect(err).toMatch(/live view feed http:\/\/127\.0\.0\.1:\d+\/live/);
    const startedIn = /started in (\d+) ms/.exec(err);
    expect(startedIn, 'stderr says how long the start took').not.toBeNull();
    expect(Number(startedIn![1])).toBeLessThan(START_BUDGET_MS);
  }, 60_000);

  it('answers the SDK\'s own stdio client: list the tools, start a mission, observe, end the turn; the live address answers', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [SCRIPT], cwd: ROOT, stderr: 'pipe' });
    let err = '';
    transport.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    const protocolErrors: unknown[] = [];
    transport.onerror = (e) => protocolErrors.push(e);
    const client = new Client({ name: 'a1-stdio-test', version: '0.0.0' });
    const t0 = Date.now();
    await client.connect(transport);
    try {
      expect(Date.now() - t0).toBeLessThan(START_BUDGET_MS);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(8);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r = await client.callTool({ name, arguments: args });
        return JSON.parse((r.content as { text: string }[])[0].text);
      };
      const missions = await call('list_missions');
      expect(missions.missions).toHaveLength(MISSIONS.length);
      const started = await call('start_mission', { mission: 'first-light' });
      expect(started.ok).toBe(true);
      expect((await call('observe')).units.length).toBeGreaterThan(0);
      const ended = await call('end_turn');
      expect(ended.status.cycle).toBe(2);
      // unit_info answers over stdio too
      const info = await call('unit_info', { type: 'trooper' });
      expect(info.units[0]).toMatchObject({ type: 'trooper', cost: 1000 });
      // the live feed the server announced is up, on loopback; the match is on, so the whole record is not served yet (D-016)
      const rec = await fetch(started.live.record);
      expect(rec.status).toBe(409);
      expect(protocolErrors, 'the client saw no malformed line').toStrictEqual([]);
      expect(err).toMatch(/ready on stdio/);
    } finally {
      await client.close();
    }
  }, 60_000);
});
