# Software Q&A with MCP Servers Demo

This demo is an `Agent Source Directory` bundle for the OpenClaw installer.

It provisions a single agent that can answer questions about software using live documentation from an MCP server:

- **Context7** — Current docs for popular libraries and frameworks

It also includes a few reusable team conventions:

- a verification subagent for tricky documentation questions
- shared answer-format conventions in `TOOLS.md`
- a reusable skill for doc-backed answer flow

## What's included

| File | Purpose |
|------|---------|
| `openclaw-agents.json` | Enables the `docs-checker` verification subagent |
| `mcp.json` | Configures Context7 as a streamable HTTP MCP server |
| `exec-approvals.json` | Sets baseline tool approval policy |
| `workspace-main/AGENTS.md` | Agent identity and instructions |
| `workspace-main/TOOLS.md` | Shared team conventions for software answers |
| `workspace-main/SOUL.md` | Agent persona |
| `workspace-docs-checker/*` | Verification-focused subagent workspace |
| `skills/docs-answering/SKILL.md` | Reusable docs-answering workflow |

## How to use it

1. Open the OpenClaw installer
2. Set **Agent Source Directory** to this folder (e.g., `demos/software-qa-mcp`)
3. Deploy as usual — the MCP server is configured automatically

After deployment, ask your agent questions like:

- "How does the Next.js App Router handle layouts?"
- "What's the API for the octokit/rest.js GitHub client?"
- "How does Django's ORM handle migrations?"

The agent will use its MCP tools to fetch current documentation before answering.

For version-sensitive questions, the main agent can also delegate a verification pass to `docs-checker`.

## Customizing

Edit `mcp.json` to add or remove MCP servers. The format follows the OpenClaw `mcpServers` convention:

```json
{
  "mcpServers": {
    "server-name": {
      "url": "https://your-server.example.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

For stdio-based servers, use `command` and `args` instead of `url`:

```json
{
  "mcpServers": {
    "local-server": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"]
    }
  }
}
```
