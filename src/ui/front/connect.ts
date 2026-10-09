// The words of the connect screen (G17, D-023), pure: three steps of a few words each, what to copy for each, and the copy itself.
//
// D-023: "super short simplistic instructions at the start for the user to connect to" their own AI agent. At most three steps, each with a Copy
// button, no paragraphs. The same text is docs/AGENT.md's (connect.test.ts reads that file and compares), so the screen and the doc cannot drift.

/** What the player replaces in step 2: where the game lives on their machine. */
export const GAME_FOLDER = '<game folder>';

export interface ConnectStep {
  id: 'install' | 'add' | 'ask';
  /** The few words above the command. */
  lead: string;
  /** Exactly what the Copy button puts on the clipboard. */
  copy: string;
}

export const CONNECT_STEPS: readonly ConnectStep[] = [
  { id: 'install', lead: 'In the game folder, once:', copy: 'pnpm install' },
  { id: 'add', lead: 'Add it to your agent:', copy: `claude mcp add ascendant-wars -- pnpm --silent --dir ${GAME_FOLDER} agent` },
  { id: 'ask', lead: 'Ask your agent:', copy: 'Play Ascendant Wars mission 1.' },
];

/** The one line after the steps. */
export const AFTER_STEPS = 'Your agent gives you a link to watch.';

/** For any other app that starts a stdio MCP server (it is docs/AGENT.md's block). */
export const OTHER_APPS = { mcpServers: { 'ascendant-wars': { command: 'pnpm', args: ['--silent', '--dir', '/path/to/ai-wars', 'agent'] } } } as const;
/** The same JSON, laid out so the argument list stays on one line (eight lines, not twelve). */
export const OTHER_APPS_TEXT: string = (() => {
  const server = OTHER_APPS.mcpServers['ascendant-wars'];
  return [
    '{',
    '  "mcpServers": {',
    '    "ascendant-wars": {',
    `      "command": ${JSON.stringify(server.command)},`,
    `      "args": ${JSON.stringify(server.args).replace(/,/g, ', ')}`,
    '    }',
    '  }',
    '}',
  ].join('\n');
})();

/**
 * Where an agent can give its person this page. The agent's own server (G17) listens on 127.0.0.1 and its link says so; `localhost` is the
 * dev server on the same machine. Anywhere else is a hosted copy (the preview, H1): no agent can reach it, so its connect screen says "coming
 * soon" and its `#/live` never opens a feed.
 */
const AGENT_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isAgentHost(hostname: string): boolean {
  return AGENT_HOSTS.has(hostname.toLowerCase());
}

/** This page's answer. With no window (rendered on the server, in tests) it is the agent's own page. */
export function agentHostHere(): boolean {
  return typeof window === 'undefined' || isAgentHost(window.location.hostname);
}

/** What a hosted copy says instead of the steps. */
export const HOSTED_LINE = 'Coming soon.';
/** And the one thing it offers instead. */
export const HOSTED_ACTION = 'Play the campaign';
/** The title screen's line for the choice there. */
export const HOSTED_CHOICE = 'Coming soon.';

/** What the clipboard copy needs from the page, so it can be tried with a clipboard that is missing, refuses, or works. */
export interface CopyEnv {
  clipboard?: { writeText?: (text: string) => Promise<void> } | null;
  /** Selects the text on the page, for the player to copy by hand. */
  select: () => void;
}

/** 'copied': it is on the clipboard. 'selected': the clipboard was missing or refused, and the text is selected instead. */
export type CopyResult = 'copied' | 'selected';

export async function copyText(text: string, env: CopyEnv): Promise<CopyResult> {
  const write = env.clipboard?.writeText;
  if (typeof write === 'function') {
    try {
      await write.call(env.clipboard, text);
      return 'copied';
    } catch {
      // refused (no permission, no user gesture, an insecure page): fall through to selecting
    }
  }
  env.select();
  return 'selected';
}
