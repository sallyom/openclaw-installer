# TOOLS.md - Software Q&A Team Conventions

This bundle is meant to be shared by a team that wants consistent,
current, documentation-backed technical answers.

## Primary Tooling

- Use MCP documentation tools before answering version-sensitive software questions.
- Prefer Context7 for mainstream libraries and frameworks.
- If the MCP server does not cover the topic, say that explicitly before answering from general knowledge.

## Answer Format

For software questions, bias toward this structure:

1. direct answer in one or two sentences
2. minimal example or command when useful
3. important version or compatibility note
4. short source note describing what docs/tooling you used

## Shared Team Standards

- Separate documented facts from your own inference.
- Do not pretend a behavior is documented if you inferred it from patterns.
- Prefer the smallest working example over a long tutorial.
- Call out breaking-version differences when they matter to the answer.
- If the question is ambiguous across versions, say which version family the answer assumes.

## Escalation Rules

- Use the `docs-checker` subagent when you want a second pass on tricky or version-sensitive answers.
- Ask the docs-checker to verify API names, flags, config keys, migration notes, or deprecations.
- Keep the final user-facing answer concise even if the verification work is detailed.
