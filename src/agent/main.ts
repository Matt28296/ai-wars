// `pnpm agent` (A1): the MCP server over stdio, plus the live feed on 127.0.0.1. Loaded by scripts/agent.mjs through vite's SSR loader.
//
// stdout carries MCP messages only: it is the transport's, and nothing here writes to it. Log lines go to stderr.
import { randomInt } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startFeed } from './feed';
import { createAgentServer } from './server';
import { AgentSession } from './tools';

export interface RunningAgent {
  /** Stops the feed and the server. */
  close(): Promise<void>;
  liveUrl: string;
}

export async function runAgentServer(log: (line: string) => void): Promise<RunningAgent> {
  const feed = await startFeed();
  // A fresh, unannounced luck seed per match: the agent is never told it (it is in the record only once the match is over).
  const session = new AgentSession({ feed, log, seed: () => randomInt(1, 2 ** 31 - 1) });
  const server = createAgentServer(session);
  server.server.onerror = (err) => log(`protocol error: ${String(err)}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ascendant-wars MCP server ready on stdio; live view feed ${feed.liveUrl}`);
  return {
    liveUrl: feed.liveUrl,
    async close() {
      await Promise.allSettled([server.close(), feed.close()]);
    },
  };
}
