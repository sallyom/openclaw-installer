import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type { DeployConfig, DeployResult } from "./deployers/types.js";

const SENSITIVE_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "MODEL_ENDPOINT_API_KEY",
  "TELEGRAM_BOT_TOKEN",
]);

const SENSITIVE_CONFIG_KEYS = new Set<keyof DeployConfig>([
  "anthropicApiKey",
  "openaiApiKey",
  "googleApiKey",
  "openrouterApiKey",
  "modelEndpointApiKey",
  "telegramBotToken",
  "gcpServiceAccountJson",
  "sandboxSshIdentity",
]);

function defaultAllowedPathRoots(): string[] {
  return [
    resolve(homedir()),
    resolve(process.cwd()),
    resolve(tmpdir()),
  ];
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function effectivePath(candidatePath: string): string {
  const resolved = resolve(candidatePath);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

export function validateUserSuppliedPath(pathValue: string, label: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  const candidate = effectivePath(trimmed);
  const allowedRoots = defaultAllowedPathRoots();
  if (allowedRoots.some((root) => isWithinRoot(candidate, root))) {
    return candidate;
  }

  throw new Error(
    `${label} must be under your home directory, the current repository, or the system temp directory`,
  );
}

export function sanitizeSavedConfigVars(vars: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(vars)) {
    if (SENSITIVE_ENV_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }

  for (const key of SENSITIVE_CONFIG_KEYS) {
    delete sanitized[key];
  }

  return sanitized;
}

export function sanitizeDeployConfig(config: DeployConfig): DeployConfig {
  const sanitized: DeployConfig = { ...config };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

export function sanitizeDeployResult(result: DeployResult): DeployResult {
  return {
    ...result,
    config: sanitizeDeployConfig(result.config),
  };
}

export function installerBindHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCLAW_INSTALLER_BIND_HOST?.trim() || "127.0.0.1";
}

export function installerDisplayHost(bindHost: string): string {
  return bindHost === "0.0.0.0" ? "localhost" : bindHost;
}

function parsePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const port = Number.parseInt(trimmed, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

export function installerPort(env: NodeJS.ProcessEnv = process.env): number {
  return parsePort(env.OPENCLAW_INSTALLER_PORT) ?? 3000;
}
