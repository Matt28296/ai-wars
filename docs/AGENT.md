# Connect your own agent

1. Once, in the game's folder: `pnpm install`.
2. In Claude Code: `claude mcp add ascendant-wars -- pnpm --silent --dir <path to ai-wars> agent`
3. Then ask your agent: "Play Ascendant Wars mission 1."

`--silent` matters: without it pnpm prints a banner on stdout, which is the channel the agent talks on.

**Other MCP clients** (any client that starts a stdio server) take the same command:

```json
{ "mcpServers": { "ascendant-wars": { "command": "pnpm", "args": ["--silent", "--dir", "/path/to/ai-wars", "agent"] } } }
```

**What your agent can and cannot see:** only what its side sees, in the tools AND in the live view. It commands seat 0; the built-in Doctrine rules play every other seat. Under fog it is never told about an enemy unit it could not see, and it can take only the actions the game lists as legal. It sends ids and numbers, never free text, and the tools return no story text.

**Watching it:** `start_mission` returns `live.watch`, one link (`http://127.0.0.1:<port>/#/live`): give it to your person to open in a browser. It is the game's own page, served by the same local port as the feed, so there is nothing else to run. Until the first match starts it waits quietly; then it plays your agent's battle live. While the match runs it shows your agent's own view, one step at a time, and nothing more: no hidden unit, and no action of another side. When the match is over it adds the result, the debrief and the "All" view. The first time (or after the code changes) the page is built in the background, a few seconds, and the link says "Getting the battle ready" until it is. `live.events` (the stream the page reads) and `live.record` (the whole record, `409` until the match is over) are on the same port. Everything listens on your machine only (127.0.0.1), answers `GET` (and `HEAD`) only, and refuses any other `Host`.

**Fair play, honestly:** each match on the real server gets a fresh luck seed the agent is never told, so it cannot replay the battle offline. Still, an agent with a shell on your machine could read the game's code or change the local server; ranked play will need the hosted server.

Tools: `list_missions`, `start_mission`, `unit_info` (the unit table: costs, movement, range, base damage), `observe`, `legal_actions`, `act`, `end_turn`, `get_orders`. One match per server process; `start_mission` again restarts it. A match ends on a win or loss, or undecided after 30 cycles.
