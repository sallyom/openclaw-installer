import type { InferenceProvider, SecretRefValue } from "./types.js";

export function defaultImageForProvider(provider: InferenceProvider): string {
  return provider === "vertex-anthropic"
    ? "ghcr.io/openclaw/openclaw:latest"
    : "ghcr.io/openclaw/openclaw:latest";
}

export function decodeBase64(value: string | undefined): string {
  if (!value) return "";
  try {
    return window.atob(value);
  } catch {
    return "";
  }
}

export function encodeBase64(value: string): string {
  return window.btoa(value);
}

export function decodeJsonBase64<T>(value: string | undefined): T | undefined {
  const decoded = decodeBase64(value);
  if (!decoded) return undefined;
  try {
    return JSON.parse(decoded) as T;
  } catch {
    return undefined;
  }
}

export function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function buildSecretRef(source: string, provider: string, id: string): SecretRefValue | undefined {
  const trimmedProvider = provider.trim();
  const trimmedId = id.trim();
  if (!source && !trimmedProvider && !trimmedId) return undefined;
  if ((source !== "env" && source !== "file" && source !== "exec") || !trimmedProvider || !trimmedId) {
    return undefined;
  }
  return {
    source,
    provider: trimmedProvider,
    id: trimmedId,
  } as SecretRefValue;
}

export function inferAgentNameFromPath(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] || "";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferDisplayNameFromAgentName(value: string): string {
  return value
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function sanitizeNamespacePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveNamespace(prefix: string, agentName: string): string {
  const cleanPrefix = sanitizeNamespacePart(prefix) || "user";
  const cleanAgent = sanitizeNamespacePart(agentName) || "agent";
  return `${cleanPrefix}-${cleanAgent}-openclaw`;
}
