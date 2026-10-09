# Configuration

## Connecting a client

The server speaks MCP over stdio. Build it first (`npm install && npm run build`), then point your client at `dist/index.js` with an absolute path.

**Kiro**: `.kiro/settings/mcp.json` (project) or `~/.kiro/settings/mcp.json` (global)

```json
{
  "mcpServers": {
    "diagram": {
      "command": "node",
      "args": ["/absolute/path/to/diagram-mcp/dist/index.js"]
    }
  }
}
```

**Claude Desktop**: `claude_desktop_config.json`, same `mcpServers` block.

**Claude Code**:

```bash
claude mcp add diagram -- node /absolute/path/to/diagram-mcp/dist/index.js
```

**Cursor**: `.cursor/mcp.json`, same `mcpServers` block.

After changing the code, run `npm run build` and restart or reconnect the server in the client.

## Output folder

The server writes to `<folder>/.diagram-mcp/`. The folder is the first of:

1. `DIAGRAM_MCP_DIR` (environment variable): forces one folder for everything.
2. The `output_dir` argument. The server's instructions tell the model to pass the project path every time.
3. The first MCP root the client reports.
4. The server's working directory (ignored if it is `/` or your home folder).
5. `~/.diagram-mcp` as a last resort. The reply says so when this happens.

Layout of the folder:

```
.diagram-mcp/
  <name>.png        the image
  <name>.json       the spec, needed by update_diagram
  logs/<log_id>.json   one file per call, newest 200 kept
```

## Plain-language mode (LLM)

`draw_diagram` talks to an OpenAI-compatible server, LM Studio by default. Set these in the `env` block of the MCP config:

| Variable                     | Default                          | Meaning                       |
| ---------------------------- | -------------------------------- | ----------------------------- |
| `DIAGRAM_MCP_LLM_URL`        | `http://127.0.0.1:1234/v1`       | Base URL of the server        |
| `DIAGRAM_MCP_LLM_MODEL`      | first loaded non-embedding model | Model id to use               |
| `DIAGRAM_MCP_LLM_TIMEOUT_MS` | `240000`                         | Timeout for each LLM call     |
| `DIAGRAM_MCP_LLM_API_KEY`    | none                             | Sent as a bearer token if set |

```json
{
  "mcpServers": {
    "diagram": {
      "command": "node",
      "args": ["/absolute/path/to/diagram-mcp/dist/index.js"],
      "env": { "DIAGRAM_MCP_LLM_MODEL": "qwen3-14b" }
    }
  }
}
```

Notes for local models:

- Output is constrained with a JSON schema when the server supports it, and parsed defensively otherwise. Reasoning models that put the answer in `reasoning_content` are handled.
- A call takes roughly 10 to 30 seconds. A diagram needs one interpreter call plus up to 5 review calls.
- The server sends MCP progress notifications while it works. If your client has a tool timeout setting, raise it.
