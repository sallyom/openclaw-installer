# Builder Research Ops Demo (No Sandbox)

This demo is an `Agent Source Directory` bundle for `claw-installer`.

It provisions:

- a main orchestrator agent from `workspace-shadowman/`
- a `builder` agent
- a `research` agent
- an `ops` agent

Unlike the sandboxed variant, this bundle does not configure per-agent SSH sandbox tool policies.

## How to use it

1. Open `claw-installer`
2. Set `Agent Source Directory` to this folder
3. Deploy as usual

The bundle uses `openclaw-agents.json` to register the extra named agents and
their per-agent model choices.

Current defaults:

- `builder`: primary `openai/gpt-5.4`, fallback `openai/gpt-5.4-mini`
- `research`: primary `anthropic/claude-sonnet-4-6`, fallback `openai/gpt-5.4`
- `ops`: inherits the main deploy-time model selection

## Updating Models Before Deploy

Edit [openclaw-agents.json](/Users/somalley/git/ambient-code/openclaw-installer/demos/openclaw-builder-research-ops-no-sandbox/openclaw-agents.json) before launching.

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
