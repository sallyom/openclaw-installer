import path from "node:path";

export const OPENCLAW_SERVICE_ACCOUNT_NAME = "openclaw";
export const MANAGED_VAULT_HELPER_PATH = "/home/node/.openclaw/bin/openclaw-vault";
export const LEGACY_IMAGE_VAULT_HELPER_PATH = "/home/node/bin/openclaw-vault";
export const DEFAULT_VAULT_ADDR = "http://vault.vault.svc:8200";
export const DEFAULT_VAULT_K8S_ROLE = OPENCLAW_SERVICE_ACCOUNT_NAME;
export const DEFAULT_VAULT_K8S_AUTH_PATH = "auth/kubernetes/login";
export const MANAGED_VAULT_HELPER_TIMEOUT_MS = 15000;
export const MANAGED_VAULT_HELPER_NO_OUTPUT_TIMEOUT_MS = 15000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isManagedVaultHelperCommand(command: string | undefined): boolean {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  return path.posix.basename(trimmed) === "openclaw-vault";
}

export function normalizeManagedVaultProviders(
  raw?: string,
): Record<string, unknown> | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return undefined;
    }
    const normalized: Record<string, unknown> = {};
    for (const [providerName, provider] of Object.entries(parsed)) {
      if (!isRecord(provider)) {
        normalized[providerName] = provider;
        continue;
      }
      const candidate = { ...provider };
      if (
        candidate.source === "exec"
        && typeof candidate.command === "string"
        && isManagedVaultHelperCommand(candidate.command)
      ) {
        candidate.command = MANAGED_VAULT_HELPER_PATH;
        if (typeof candidate.timeoutMs !== "number") {
          candidate.timeoutMs = MANAGED_VAULT_HELPER_TIMEOUT_MS;
        }
        if (typeof candidate.noOutputTimeoutMs !== "number") {
          candidate.noOutputTimeoutMs = MANAGED_VAULT_HELPER_NO_OUTPUT_TIMEOUT_MS;
        }
      }
      normalized[providerName] = candidate;
    }
    return normalized;
  } catch {
    return undefined;
  }
}

export function buildManagedVaultHelperScript(): string {
  return [
    "#!/usr/local/bin/node",
    "const { existsSync, readFileSync } = require('node:fs');",
    "const { spawnSync } = require('node:child_process');",
    "",
    "function fail(message, code = 2) {",
    "  if (message) process.stderr.write(String(message).trimEnd() + '\\n');",
    "  process.exit(code);",
    "}",
    "",
    "function parseJson(text, label) {",
    "  try {",
    "    return JSON.parse(text);",
    "  } catch {",
    "    fail(`${label} returned invalid JSON`);",
    "  }",
    "}",
    "",
    "function sleep(ms) {",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
    "}",
    "",
    "function runVaultWithRetry(args, env, label) {",
    "  const maxAttempts = Number.parseInt(env.VAULT_HELPER_MAX_ATTEMPTS || '8', 10) || 8;",
    "  const delayMs = Number.parseInt(env.VAULT_HELPER_RETRY_DELAY_MS || '750', 10) || 750;",
    "  let last = null;",
    "  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {",
    "    const result = spawnSync('/usr/bin/vault', args, { encoding: 'utf8', env });",
    "    if (result.status === 0) {",
    "      return result;",
    "    }",
    "    last = result;",
    "    if (attempt < maxAttempts) {",
    "      sleep(delayMs);",
    "    }",
    "  }",
    "  if (last && last.stderr) process.stderr.write(last.stderr);",
    "  fail(`${label} failed with code ${(last && last.status) || 2}`, (last && last.status) || 2);",
    "}",
    "",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "  let request = {};",
    "  try {",
    "    request = JSON.parse(input || '{}');",
    "  } catch {",
    "    fail('invalid exec-provider request payload');",
    "  }",
    "  const ids = Array.isArray(request.ids) ? request.ids.filter((id) => typeof id === 'string') : [];",
    "  const env = { ...process.env };",
    "  env.HOME = env.HOME || '/home/node';",
    "  env.VAULT_ADDR = env.VAULT_ADDR || '" + DEFAULT_VAULT_ADDR + "';",
    "  if (!env.VAULT_TOKEN) {",
    "    const jwtPath = env.VAULT_JWT_PATH || '/var/run/secrets/kubernetes.io/serviceaccount/token';",
    "    if (existsSync(jwtPath)) {",
    "      const jwt = readFileSync(jwtPath, 'utf8').trim();",
    "      if (!jwt) fail('vault service account token file was empty');",
    "      const role = env.VAULT_K8S_ROLE || '" + DEFAULT_VAULT_K8S_ROLE + "';",
    "      const authPath = env.VAULT_K8S_AUTH_PATH || '" + DEFAULT_VAULT_K8S_AUTH_PATH + "';",
    "      const login = runVaultWithRetry(",
    "        ['write', '-format=json', authPath, `role=${role}`, `jwt=${jwt}`],",
    "        env,",
    "        'vault kubernetes auth',",
    "      );",
    "      const loginJson = parseJson(login.stdout, 'vault kubernetes auth');",
    "      const token = loginJson && loginJson.auth && typeof loginJson.auth.client_token === 'string'",
    "        ? loginJson.auth.client_token.trim()",
    "        : '';",
    "      if (!token) fail('vault kubernetes auth response missing client_token');",
    "      env.VAULT_TOKEN = token;",
    "    }",
    "  }",
    "  const result = runVaultWithRetry(process.argv.slice(2), env, 'vault command');",
    "  const secretData = parseJson(result.stdout, 'vault provider');",
    "  if (!secretData || typeof secretData !== 'object' || Array.isArray(secretData)) {",
    "    fail('vault provider returned a non-object payload');",
    "  }",
    "  const values = {};",
    "  const errors = {};",
    "  for (const id of ids) {",
    "    if (Object.prototype.hasOwnProperty.call(secretData, id)) {",
    "      values[id] = secretData[id];",
    "    } else {",
    "      errors[id] = { message: `missing key ${id}` };",
    "    }",
    "  }",
    "  const response = { protocolVersion: 1, values };",
    "  if (Object.keys(errors).length > 0) response.errors = errors;",
    "  process.stdout.write(JSON.stringify(response));",
    "});",
  ].join("\n");
}
