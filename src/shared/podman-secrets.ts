export interface PodmanSecretMapping {
  secretName: string;
  targetEnv: string;
}

const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function normalizePodmanSecretMappings(value: unknown): PodmanSecretMapping[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: PodmanSecretMapping[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const secretName = typeof (entry as { secretName?: unknown }).secretName === "string"
      ? (entry as { secretName: string }).secretName.trim()
      : "";
    const targetEnv = typeof (entry as { targetEnv?: unknown }).targetEnv === "string"
      ? (entry as { targetEnv: string }).targetEnv.trim()
      : "";

    if (!secretName || !targetEnv) {
      continue;
    }
    if (!SECRET_NAME_PATTERN.test(secretName) || !ENV_VAR_PATTERN.test(targetEnv)) {
      continue;
    }

    const dedupeKey = `${secretName}\u0000${targetEnv}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({ secretName, targetEnv });
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function parsePodmanSecretMappingsText(value: string): {
  mappings: PodmanSecretMapping[];
  errors: string[];
} {
  const mappings: PodmanSecretMapping[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split("=");
    if (parts.length !== 2) {
      errors.push(`Invalid Podman secret mapping: "${line}". Use secret_name=ENV_VAR_NAME.`);
      continue;
    }

    const secretName = parts[0].trim();
    const targetEnv = parts[1].trim();

    if (!SECRET_NAME_PATTERN.test(secretName)) {
      errors.push(`Invalid Podman secret name "${secretName}".`);
      continue;
    }
    if (!ENV_VAR_PATTERN.test(targetEnv)) {
      errors.push(`Invalid Podman secret target env "${targetEnv}".`);
      continue;
    }

    const dedupeKey = `${secretName}\u0000${targetEnv}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    mappings.push({ secretName, targetEnv });
  }

  return { mappings, errors };
}

export function formatPodmanSecretMappingsText(mappings: PodmanSecretMapping[] | undefined): string {
  if (!mappings || mappings.length === 0) {
    return "";
  }
  return mappings.map((entry) => `${entry.secretName}=${entry.targetEnv}`).join("\n");
}

export function buildPodmanSecretRunArgs(mappings: PodmanSecretMapping[] | undefined): string[] {
  if (!mappings || mappings.length === 0) {
    return [];
  }
  return mappings.flatMap((entry) => ["--secret", `${entry.secretName},type=env,target=${entry.targetEnv}`]);
}

export function hasPodmanSecretTarget(
  mappings: PodmanSecretMapping[] | undefined,
  targetEnv: string,
): boolean {
  return Boolean(mappings?.some((entry) => entry.targetEnv === targetEnv));
}
