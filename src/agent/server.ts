// The MCP server (A1): the game as tools an AI agent commands its army through. `createAgentServer` only builds the server and registers
// the tools; connecting a transport is the caller's job (main.ts connects stdio, the tests connect an in-memory pair).
//
// stdout belongs to the protocol. Nothing in src/agent writes to stdout; every log line goes to stderr through the session's `log`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgentSession, DESCRIPTIONS, SERVER_INSTRUCTIONS, actInput, legalActionsInput, startMissionInput, unitInfoInput } from './tools';
import type { ToolResult } from './tools';

export const SERVER_NAME = 'ascendant-wars';
export const SERVER_VERSION = '0.1.0';

/** The data as JSON text (for clients that read only text) and as structured content (for those that read it). */
function reply(r: ToolResult): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(r.data) }], structuredContent: r.data, ...(r.isError ? { isError: true } : {}) };
}

const noInput = z.strictObject({});
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const PLAYS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export function createAgentServer(session: AgentSession): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool('list_missions', { title: 'List missions', description: DESCRIPTIONS.list_missions, inputSchema: noInput, annotations: READ_ONLY },
    async () => reply(session.listMissions()));

  server.registerTool('start_mission', { title: 'Start a mission', description: DESCRIPTIONS.start_mission, inputSchema: startMissionInput, annotations: { ...PLAYS, idempotentHint: true } },
    async ({ mission }) => reply(session.startMission(mission)));

  server.registerTool('unit_info', { title: 'Unit table', description: DESCRIPTIONS.unit_info, inputSchema: unitInfoInput, annotations: READ_ONLY },
    async ({ type }) => reply(session.unitInfo(type)));

  server.registerTool('observe', { title: 'Observe the battlefield', description: DESCRIPTIONS.observe, inputSchema: noInput, annotations: READ_ONLY },
    async () => reply(session.observe()));

  server.registerTool('legal_actions', { title: 'List legal actions', description: DESCRIPTIONS.legal_actions, inputSchema: legalActionsInput, annotations: READ_ONLY },
    async ({ unit, kind }) => reply(session.legalActions({ unit, kind })));

  server.registerTool('act', { title: 'Take one action', description: DESCRIPTIONS.act, inputSchema: actInput, annotations: PLAYS },
    async ({ action_id }) => reply(session.act(action_id)));

  server.registerTool('end_turn', { title: 'End your turn', description: DESCRIPTIONS.end_turn, inputSchema: noInput, annotations: PLAYS },
    async () => reply(session.endTurn()));

  server.registerTool('get_orders', { title: 'Get standing orders', description: DESCRIPTIONS.get_orders, inputSchema: noInput, annotations: READ_ONLY },
    async () => reply(session.getOrders()));

  return server;
}
