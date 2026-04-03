import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TreeEntry } from "../state-tree.js";
import { loadTextTree } from "../state-tree.js";
import type { DeployConfig } from "./types.js";

export interface AgentSourceAgentEntry {
  id: string;
  name?: string;
  workspaceDir?: string;
  model?: { primary?: string; fallbacks?: string[] };
  tools?: Record<string, unknown>;
  subagents?: { allowAgents?: string[] };
}

export interface AgentSourceBundle {
  mainAgent?: {
    model?: { primary?: string; fallbacks?: string[] };
    tools?: Record<string, unknown>;
    subagents?: { allowAgents?: string[] };
  };
  agents?: AgentSourceAgentEntry[];
}

export function loadAgentSourceBundle(config: DeployConfig): AgentSourceBundle | undefined {
  if (!config.agentSourceDir) return undefined;
  const bundlePath = join(config.agentSourceDir, "openclaw-agents.json");
  if (!existsSync(bundlePath)) return undefined;
  try {
    return JSON.parse(readFileSync(bundlePath, "utf8")) as AgentSourceBundle;
  } catch {
    return undefined;
  }
}

export async function loadAgentSourceWorkspaceTree(agentSourceDir?: string): Promise<TreeEntry[]> {
  if (!agentSourceDir) return [];
  return await loadTextTree(agentSourceDir);
}

/**
 * Extract subagent IDs from a loaded bundle.
 */
export function subagentIds(bundle: AgentSourceBundle | undefined): string[] {
  return (bundle?.agents || []).map((a) => a.id);
}

/**
 * Build a shell snippet that routes workspace-* directories during copy.
 *
 * Directories whose basename matches a known subagent ID (e.g. workspace-builder)
 * are copied to their own path.  The remaining workspace-* directory — regardless
 * of its name — is treated as the main agent workspace.  This allows bundles to
 * use persona names like workspace-shadowman instead of the rigid workspace-main.
 *
 * `workspace-main` continues to work because it will never collide with a
 * subagent ID.
 *
 * @param mainDest  Shell expression for the main agent workspace path
 *                  (may contain shell variables, e.g. '${workspaceDir}')
 * @param bundle    The loaded agent source bundle (may be undefined)
 * @returns         A shell `if` statement body suitable for embedding
 */
export function mainWorkspaceShellCondition(
  mainDest: string,
  bundle: AgentSourceBundle | undefined,
): string {
  const ids = subagentIds(bundle);
  if (ids.length === 0) {
    // No subagents — every workspace-* directory is the main workspace
    // (preserves legacy workspace-main behaviour too).
    return `dest="${mainDest}"`;
  }
  // Build: if [ "$base" = "workspace-builder" ] || [ "$base" = "workspace-research" ] ...
  const checks = ids.map((id) => `[ "$base" = "workspace-${id}" ]`).join(" || ");
  return `if ${checks}; then dest="/home/node/.openclaw/$base"; else dest="${mainDest}"; fi`;
}

export function loadAgentSourceCronJobs(agentSourceDir?: string): string | undefined {
  if (!agentSourceDir) return undefined;
  const cronPath = join(agentSourceDir, "cron", "jobs.json");
  if (!existsSync(cronPath)) return undefined;
  try {
    return readFileSync(cronPath, "utf8");
  } catch {
    return undefined;
  }
}

export function loadAgentSourceMcpServers(agentSourceDir?: string): Record<string, unknown> | undefined {
  if (!agentSourceDir) return undefined;
  const mcpPath = join(agentSourceDir, "mcp.json");
  if (!existsSync(mcpPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(mcpPath, "utf8"));
    const servers = parsed.mcpServers || parsed;
    if (typeof servers === "object" && servers !== null && !Array.isArray(servers) && Object.keys(servers).length > 0) {
      return servers as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function loadAgentSourceExecApprovals(agentSourceDir?: string): string | undefined {
  if (!agentSourceDir) return undefined;
  const approvalsPath = join(agentSourceDir, "exec-approvals.json");
  if (!existsSync(approvalsPath)) return undefined;
  try {
    return readFileSync(approvalsPath, "utf8");
  } catch {
    return undefined;
  }
}
