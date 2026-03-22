import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TreeEntry } from "../state-tree.js";
import { loadTextTree } from "../state-tree.js";
import type { DeployConfig } from "./types.js";

export interface AgentSourceAgentEntry {
  id: string;
  name?: string;
  workspaceDir?: string;
  model?: { primary?: string };
  tools?: Record<string, unknown>;
  subagents?: { allowAgents?: string[] };
}

export interface AgentSourceBundle {
  mainAgent?: {
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
