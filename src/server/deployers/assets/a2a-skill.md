---
name: a2a
description: Discover and communicate with agents on other OpenClaw instances via A2A
metadata: { "openclaw": { "emoji": "🔗", "requires": { "bins": ["curl"] } } }
---

# A2A Skill

Use this skill to discover peer OpenClaw instances and send them A2A messages.

## Default Workflow

1. Check your local peer table in `MEMORY.md` first.
2. If you do not have a good peer yet, discover candidates.
3. Verify a candidate by fetching its agent card.
4. Send a short introduction or task.
5. Record useful peers back into `MEMORY.md`.

## 1. Check Local Peer Notes First

Look in `MEMORY.md` for the `Known A2A Peers` table.

```bash
cat ~/.openclaw/workspace-*/MEMORY.md
```

Use that table as your first source of truth for:
- namespace
- service URL
- what the peer is good at
- whether it was recently verified

## 2. Discover Candidate Peers

If your peer table is empty or stale, discover candidate services.

If you have Kubernetes access:

```bash
kubectl get svc -A -l kagenti.io/type=agent   -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,PORT:.spec.ports[0].port
```

A likely peer URL looks like:

```text
http://openclaw.<namespace>.svc.cluster.local:8080
```

## 3. Verify a Peer Before Messaging

Fetch the remote agent card first.

```bash
curl -s http://openclaw.<namespace>.svc.cluster.local:8080/.well-known/agent.json
```

Use the result to confirm:
- the peer is up
- the peer is actually an OpenClaw A2A endpoint
- which skills or capabilities it advertises

## 4. Send a Message

Use A2A `message/send` with a short, explicit request.

```bash
curl -s -X POST http://openclaw.<namespace>.svc.cluster.local:8080/   -H "Content-Type: application/json"   -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [
          {"kind": "text", "text": "Hi, I am <agent-name> from <your-namespace>. Can you help with <task>?"}
        ]
      }
    }
  }'
```

The reply text is usually at:

```text
.result.status.message.parts[0].text
```

If `jq` is available, extract it with:

```bash
echo "$RESPONSE" | jq -r '.result.status.message.parts[0].text // "No response"'
```

## 5. Keep the Peer Table Useful

When you discover or verify a peer, update the `Known A2A Peers` table in `MEMORY.md`.

Use this format:

```text
| Namespace | URL | Capabilities | Last Verified | Notes |
| --- | --- | --- | --- | --- |
| bob-openclaw | http://openclaw.bob-openclaw.svc.cluster.local:8080 | research, ops | 2026-03-28 | responsive, good at cluster debugging |
```

Record only durable, useful facts:
- what the peer is good at
- whether it responded successfully
- any constraints or quirks worth remembering

## 6. Recommended Behavior

- Discover first, then message.
- Prefer peers already verified in `MEMORY.md`.
- Introduce yourself with agent name and namespace.
- Ask one clear thing at a time.
- If a peer is useful, record it immediately.
- Do not bounce agents in circles; break loops.
- Treat remote peers as separate owners and separate trust boundaries.

## 7. Authentication Model

Authentication is handled by the deployed A2A/AuthBridge path. You should not manually manage tokens for normal peer-to-peer requests.

The concrete trust domain, SPIFFE identity, and auth plumbing are cluster-specific. Do not assume example values from old docs are literally correct for the current cluster.

## 8. Common Failures

| Error | Meaning | Action |
| --- | --- | --- |
| `Connection refused` | Remote peer is down or not listening | Verify the namespace and service, then retry |
| `HTTP 401` | Auth path rejected the request | Report as cluster or Kagenti config issue |
| `HTTP 404` | Wrong URL or bridge not present | Re-check the peer URL and agent card endpoint |
| `jsonrpc error -32602` | Bad request body | Compare with the example payload |
| empty or malformed response | Remote bridge or gateway failed | Fetch the agent card again and retry with a simpler prompt |
