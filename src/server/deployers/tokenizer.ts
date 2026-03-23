import { randomBytes, createHash } from "node:crypto";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";
import type { DeployConfig } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────

/** Default image — pin to a specific digest/tag for reproducible deployments. */
export const TOKENIZER_IMAGE = "ghcr.io/nickcao/tokenizer:main";
export const TOKENIZER_PORT = 4001;
const NACL_KEY_LENGTH = 32;

// ── Key management ──────────────────────────────────────────────────

/** Generate a 32-byte hex-encoded private ("open") key. */
export function generateTokenizerOpenKey(): string {
  return randomBytes(32).toString("hex");
}

/** Derive the public ("seal") key from the private ("open") key. */
export function deriveTokenizerSealKey(openKeyHex: string): string {
  const privBytes = Buffer.from(openKeyHex, "hex");
  if (privBytes.length !== NACL_KEY_LENGTH) {
    throw new Error(`Invalid open key: expected ${NACL_KEY_LENGTH} bytes, got ${privBytes.length}`);
  }
  const keyPair = nacl.box.keyPair.fromSecretKey(new Uint8Array(privBytes));
  return Buffer.from(keyPair.publicKey).toString("hex");
}

// ── NaCl sealed box ─────────────────────────────────────────────────
// crypto_box_seal: anonymous public-key encryption compatible with
// golang.org/x/crypto/nacl/box.SealAnonymous used by Tokenizer.

/**
 * NaCl sealed box encryption (crypto_box_seal).
 *
 * Construction:
 *   1. Generate ephemeral X25519 key pair
 *   2. nonce = blake2b(ek_pk || recipient_pk, outputLength=24)
 *   3. ct = nacl.box(msg, nonce, recipient_pk, ek_sk)
 *   4. output = ek_pk || ct
 */
function sealedBox(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== NACL_KEY_LENGTH) {
    throw new Error(`Invalid seal key: expected ${NACL_KEY_LENGTH} bytes, got ${recipientPublicKey.length}`);
  }
  const ephemeral = nacl.box.keyPair();

  // Derive nonce: blake2b(ek_pk || recipient_pk) truncated to 24 bytes
  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeral.publicKey, 0);
  nonceInput.set(recipientPublicKey, 32);
  const nonce = blake2b(nonceInput, undefined, 24);

  // Encrypt
  const ct = nacl.box(message, nonce, recipientPublicKey, ephemeral.secretKey);
  if (!ct) throw new Error("nacl.box encryption failed — check that all keys are 32 bytes and nonce is 24 bytes");

  // Prepend ephemeral public key
  const out = new Uint8Array(32 + ct.length);
  out.set(ephemeral.publicKey, 0);
  out.set(ct, 32);

  // Zero ephemeral secret key material
  ephemeral.secretKey.fill(0);

  return out;
}

// ── Secret building & sealing ───────────────────────────────────────

export interface TokenizerCredentialEntry {
  /** Human-readable name, e.g. "github" */
  name: string;
  /** Raw API key / token (never sent to the agent) */
  secret: string;
  /** Hosts this credential may be used against, e.g. ["api.github.com"] */
  allowedHosts: string[];
  /** Target header (default: "Authorization") */
  headerDst?: string;
  /** Header format string (default: "Bearer %s") */
  headerFmt?: string;
}

export interface SealedCredential {
  name: string;
  allowedHosts: string[];
  /** Base64 NaCl sealed box containing the secret JSON */
  sealedToken: string;
  /** Plaintext password the agent sends in Proxy-Authorization */
  bearerPassword: string;
}

/** Build the Tokenizer secret JSON wire format and seal it. */
export function sealCredential(
  entry: TokenizerCredentialEntry,
  sealKeyHex: string,
): SealedCredential {
  const bearerPassword = randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(bearerPassword).digest("base64");

  const secretObj: Record<string, unknown> = {
    inject_processor: {
      token: entry.secret,
      ...(entry.headerDst ? { dst: entry.headerDst } : {}),
      ...(entry.headerFmt ? { fmt: entry.headerFmt } : {}),
    },
    bearer_auth: { digest },
    allowed_hosts: entry.allowedHosts,
  };

  const plaintext = new TextEncoder().encode(JSON.stringify(secretObj));
  const sealKeyBytes = Buffer.from(sealKeyHex, "hex");
  if (sealKeyBytes.length !== NACL_KEY_LENGTH) {
    throw new Error(`Invalid seal key: expected ${NACL_KEY_LENGTH} hex-decoded bytes, got ${sealKeyBytes.length}`);
  }
  const sealKey = new Uint8Array(sealKeyBytes);
  const sealed = sealedBox(plaintext, sealKey);

  return {
    name: entry.name,
    allowedHosts: entry.allowedHosts,
    sealedToken: Buffer.from(sealed).toString("base64"),
    bearerPassword,
  };
}

// ── Config helpers ──────────────────────────────────────────────────

/** Returns true when the Tokenizer proxy should be deployed. */
export function shouldUseTokenizer(config: DeployConfig): boolean {
  return !!(config.tokenizerEnabled && config.tokenizerCredentials?.length);
}

/** Environment variables passed to the gateway container. */
export function tokenizerAgentEnv(
  sealed: SealedCredential[],
  sealKeyHex: string,
): Record<string, string> {
  const env: Record<string, string> = {
    TOKENIZER_PROXY_URL: `http://localhost:${TOKENIZER_PORT}`,
    TOKENIZER_SEAL_KEY: sealKeyHex,
  };
  const seen = new Set<string>();
  for (const s of sealed) {
    const key = sanitizeCredName(s.name);
    if (seen.has(key)) {
      throw new Error(`Duplicate sanitized credential name: ${key} (from "${s.name}")`);
    }
    seen.add(key);
    env[`TOKENIZER_CRED_${key}`] = s.sealedToken;
    env[`TOKENIZER_AUTH_${key}`] = s.bearerPassword;
    env[`TOKENIZER_HOSTS_${key}`] = s.allowedHosts.join(",");
  }
  return env;
}

/** Sanitize a credential name into a valid env var key suffix. */
export function sanitizeCredName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/**
 * Compute the list of Secret keys used by the tokenizer integration.
 * Used by both the gateway env vars and the init container env vars so
 * the key-name logic isn't duplicated.
 */
export function tokenizerSecretKeys(config: DeployConfig): string[] {
  const keys = ["TOKENIZER_PROXY_URL", "TOKENIZER_SEAL_KEY"];
  if (config.tokenizerCredentials) {
    for (const c of config.tokenizerCredentials) {
      const k = sanitizeCredName(c.name);
      keys.push(`TOKENIZER_CRED_${k}`, `TOKENIZER_AUTH_${k}`, `TOKENIZER_HOSTS_${k}`);
    }
  }
  return keys;
}

/**
 * Validate tokenizer credentials. Returns an error string if invalid,
 * or null if valid.
 *
 * This function does NOT mutate the input objects. Callers that need
 * normalized `allowedHosts` (always an array, no empty entries) should
 * use {@link normalizeTokenizerCredentials} after validation.
 */
export function validateTokenizerCredentials(
  credentials: Array<{ name: string; secret?: string; allowedHosts: string[] | string }>,
): string | null {
  if (credentials.length > 50) {
    return "Maximum of 50 credentials allowed";
  }
  // Hostname pattern: alphanumeric labels separated by dots, optional port
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:\d+)?$/;
  for (const cred of credentials) {
    const hostList = Array.isArray(cred.allowedHosts)
      ? cred.allowedHosts
      : [cred.allowedHosts];
    const hosts = hostList.filter((h) => h.length > 0);
    if (!cred.name || !cred.secret || !hosts.length) {
      return "Each tokenizer credential must have name, secret, and at least one allowedHosts entry";
    }
    if (cred.name.length > 128) {
      return `Credential name "${cred.name.slice(0, 20)}..." exceeds maximum length of 128 characters`;
    }
    for (const host of hosts) {
      if (host.length > 253) {
        return `Hostname "${host}" exceeds maximum length of 253 characters`;
      }
      const labels = host.replace(/:\d+$/, "").split(".");
      const longLabel = labels.find((l) => l.length > 63);
      if (longLabel) {
        return `Hostname label "${longLabel}" in "${host}" exceeds maximum length of 63 characters`;
      }
      if (!hostnamePattern.test(host)) {
        return `Invalid hostname "${host}" in credential "${cred.name}". Allowed hosts must be valid hostnames (e.g. api.github.com).`;
      }
    }
  }
  for (const c of credentials) {
    if ((c as { headerFmt?: string }).headerFmt) {
      const fmt = (c as { headerFmt?: string }).headerFmt!;
      const placeholders = fmt.match(/%/g);
      if (!placeholders || placeholders.length !== 1 || !fmt.includes('%s')) {
        return `Credential "${c.name}": headerFmt must contain exactly one %s placeholder`;
      }
    }
  }
  const sanitized = credentials.map((c) => sanitizeCredName(c.name));
  if (new Set(sanitized).size !== sanitized.length) {
    return "Tokenizer credential names must be unique after sanitization (uppercase, non-alphanumeric replaced with _)";
  }
  return null;
}

/**
 * Return a copy of credentials with `allowedHosts` normalized to
 * a string array with empty entries removed. Call after validation.
 */
export function normalizeTokenizerCredentials<
  T extends { allowedHosts: string[] | string },
>(credentials: T[]): (T & { allowedHosts: string[] })[] {
  return credentials.map((c) => {
    const hostList = Array.isArray(c.allowedHosts)
      ? c.allowedHosts
      : [c.allowedHosts];
    return { ...c, allowedHosts: hostList.filter((h) => h.length > 0) };
  });
}

// ── Skill generation ────────────────────────────────────────────────

/** Generate SKILL.md content that teaches the agent how to use Tokenizer. */
export function generateTokenizerSkill(sealed: SealedCredential[]): string {
  const lines: string[] = [
    "# Tokenizer — Secure API Credential Proxy",
    "",
    "## What is this?",
    "",
    "A Tokenizer proxy (https://github.com/NickCao/tokenizer) is running as",
    "a sidecar alongside this agent. It lets you make authenticated HTTP",
    "requests to external APIs **without ever seeing the actual credentials**.",
    "The credentials are encrypted; the proxy decrypts them and injects the",
    "real tokens into your outgoing requests.",
    "",
    "## Proxy URL",
    "",
    "`http://localhost:" + TOKENIZER_PORT + "`",
    "",
    "## Available Credentials",
    "",
  ];

  for (const s of sealed) {
    const key = sanitizeCredName(s.name);
    lines.push(`### ${s.name}`);
    lines.push("");
    lines.push(`- **Allowed hosts**: ${s.allowedHosts.join(", ")}`);
    lines.push(`- **Sealed token env var**: \`TOKENIZER_CRED_${key}\``);
    lines.push(`- **Auth password env var**: \`TOKENIZER_AUTH_${key}\``);
    lines.push("");
  }

  lines.push(
    "## How to make requests",
    "",
    "Route HTTP requests through the Tokenizer proxy, including the sealed",
    "token and bearer password in the request headers.",
    "",
    "### Important rules",
    "",
    "1. Use `http://` (not `https://`) for the target URL in the request.",
    "   The proxy upgrades all upstream connections to HTTPS automatically.",
    "2. Each sealed token is restricted to its listed allowed hosts.",
    "3. The proxy blocks connections to private/loopback addresses — it only",
    "   works for external (public) APIs.",
    "",
    "### curl example",
    "",
  );

  if (sealed.length > 0) {
    const ex = sealed[0];
    const key = sanitizeCredName(ex.name);
    const host = ex.allowedHosts[0] || "api.example.com";
    lines.push(
      "```bash",
      `curl -x http://localhost:${TOKENIZER_PORT} \\`,
      `  -H "Proxy-Tokenizer: $TOKENIZER_CRED_${key}" \\`,
      `  -H "Proxy-Authorization: Bearer $TOKENIZER_AUTH_${key}" \\`,
      `  http://${host}/`,
      "```",
      "",
    );
  }

  lines.push(
    "### Node.js / fetch example",
    "",
    "```javascript",
    "// The Tokenizer acts as an HTTP proxy. Set the proxy headers and",
    "// point the request at the target host via the proxy.",
    `const proxyUrl = process.env.TOKENIZER_PROXY_URL; // http://localhost:${TOKENIZER_PORT}`,
    "",
    "// Build the request through the proxy",
    "const resp = await fetch(`http://api.example.com/endpoint`, {",
    "  headers: {",
    "    'Proxy-Tokenizer': process.env.TOKENIZER_CRED_EXAMPLE,",
    "    'Proxy-Authorization': `Bearer ${process.env.TOKENIZER_AUTH_EXAMPLE}`,",
    "  },",
    "  // In Node.js, configure HTTP_PROXY=http://localhost:" + TOKENIZER_PORT,
    "  // or use an HTTP proxy agent library.",
    "});",
    "```",
    "",
    "### Python requests example",
    "",
    "```python",
    "import os, requests",
    "",
    `proxies = {"http": "http://localhost:${TOKENIZER_PORT}"}`,
    "headers = {",
    '    "Proxy-Tokenizer": os.environ["TOKENIZER_CRED_EXAMPLE"],',
    '    "Proxy-Authorization": f"Bearer {os.environ[\'TOKENIZER_AUTH_EXAMPLE\']}",',
    "}",
    '# Use http:// — the proxy upgrades to HTTPS automatically',
    'resp = requests.get("http://api.example.com/endpoint",',
    "                     proxies=proxies, headers=headers)",
    "```",
    "",
    "### Shell / environment variable approach",
    "",
    "You can also set `http_proxy` so that all HTTP requests go through the proxy:",
    "",
    "```bash",
    `export http_proxy=http://localhost:${TOKENIZER_PORT}`,
    "```",
    "",
    "Then include the Proxy-Tokenizer and Proxy-Authorization headers in each request.",
    "",
  );

  return lines.join("\n");
}
