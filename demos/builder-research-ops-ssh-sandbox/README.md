# Builder Research Ops Demo

This demo is an `Agent Source Directory` bundle for `claw-installer`.

It provisions:

- a main orchestrator agent from `workspace-main/`
- a `builder` agent with sandboxed runtime and file tools
- a `research` agent with file and memory tools
- an `ops` agent with file, memory, and automation tools

## How to use it

1. Open `claw-installer`
2. Set `Agent Source Directory` to this folder
3. Enable the SSH sandbox backend
4. Deploy as usual

Recommended for first use:

- `Sandbox Mode`: `all`
- `Sandbox Scope`: `session`
- `Workspace Access`: `rw`

The bundle uses `openclaw-agents.json` to register the extra named agents and
their per-agent sandbox tool policies.

It also supports per-agent model routing in `openclaw-agents.json`.

Current defaults:

- `builder`: primary `openai/gpt-5.4`, fallback `openai/gpt-5.4-mini`
- `research`: primary `anthropic/claude-sonnet-4-6`, fallback `openai/gpt-5.4`
- `ops`: inherits the main deploy-time model selection

## Updating Models Before Deploy

Edit [openclaw-agents.json](/Users/somalley/git/ambient-code/openclaw-installer/demos/openclaw-builder-research-ops/openclaw-agents.json) before launching.

Each named agent can set:

```json
{
  "id": "research",
  "model": {
    "primary": "anthropic/claude-sonnet-4-6",
    "fallbacks": ["openai/gpt-5.4"]
  }
}
```

Notes:

- `primary` is the first model OpenClaw will try
- `fallbacks` is an ordered list used if the primary model is unavailable or rejected
- if an agent has no `model` block, it inherits the main deploy-time model from the installer form

The main agent is configured to allow these spawn targets:

- `builder`
- `research`
- `ops`
