import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";
import {
  generateTokenizerOpenKey,
  deriveTokenizerSealKey,
  sealCredential,
  shouldUseTokenizer,
  tokenizerAgentEnv,
  generateTokenizerSkill,
  sanitizeCredName,
  tokenizerSecretKeys,
  validateTokenizerCredentials,
  normalizeTokenizerCredentials,
  TOKENIZER_PORT,
  type SealedCredential,
} from "../tokenizer.js";
import type { DeployConfig } from "../types.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Recreate the NaCl sealed-box open (decrypt) for verification. */
function sealedBoxOpen(
  sealed: Uint8Array,
  recipientPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array | null {
  if (sealed.length < 48) return null; // 32 (ephemeral pk) + 16 (mac)
  const ephemeralPk = sealed.subarray(0, 32);
  const ct = sealed.subarray(32);

  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeralPk, 0);
  nonceInput.set(recipientPublicKey, 32);
  const nonce = blake2b(nonceInput, undefined, 24);

  return nacl.box.open(ct, nonce, ephemeralPk, recipientSecretKey);
}

function minimalConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "test",
    agentDisplayName: "Test",
    ...overrides,
  };
}

// ── Key management ──────────────────────────────────────────────────

describe("generateTokenizerOpenKey", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const key = generateTokenizerOpenKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns unique keys on each call", () => {
    const a = generateTokenizerOpenKey();
    const b = generateTokenizerOpenKey();
    expect(a).not.toBe(b);
  });
});

describe("deriveTokenizerSealKey", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);
    expect(sealKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same open key", () => {
    const openKey = generateTokenizerOpenKey();
    const a = deriveTokenizerSealKey(openKey);
    const b = deriveTokenizerSealKey(openKey);
    expect(a).toBe(b);
  });

  it("produces different seal keys for different open keys", () => {
    const a = deriveTokenizerSealKey(generateTokenizerOpenKey());
    const b = deriveTokenizerSealKey(generateTokenizerOpenKey());
    expect(a).not.toBe(b);
  });

  it("matches tweetnacl key pair derivation", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const keyPair = nacl.box.keyPair.fromSecretKey(
      new Uint8Array(Buffer.from(openKey, "hex")),
    );
    const expected = Buffer.from(keyPair.publicKey).toString("hex");
    expect(sealKey).toBe(expected);
  });
});

// ── Sealed box round-trip ───────────────────────────────────────────

describe("sealCredential", () => {
  it("produces a SealedCredential with all fields", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "github",
        secret: "ghp_test123",
        allowedHosts: ["api.github.com"],
      },
      sealKey,
    );

    expect(result.name).toBe("github");
    expect(result.allowedHosts).toEqual(["api.github.com"]);
    expect(result.sealedToken).toBeTruthy();
    expect(result.bearerPassword).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sealed token can be decrypted with the open key", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "test",
        secret: "my-secret-token",
        allowedHosts: ["api.example.com"],
      },
      sealKey,
    );

    // Decrypt the sealed token
    const sealedBytes = new Uint8Array(
      Buffer.from(result.sealedToken, "base64"),
    );
    const pubKey = new Uint8Array(Buffer.from(sealKey, "hex"));
    const privKey = new Uint8Array(Buffer.from(openKey, "hex"));

    const plaintext = sealedBoxOpen(sealedBytes, pubKey, privKey);
    expect(plaintext).not.toBeNull();

    const secret = JSON.parse(new TextDecoder().decode(plaintext!));
    expect(secret.inject_processor.token).toBe("my-secret-token");
    expect(secret.allowed_hosts).toEqual(["api.example.com"]);
    expect(secret.bearer_auth.digest).toBeTruthy();
  });

  it("includes custom header dst/fmt when provided", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "custom",
        secret: "tok",
        allowedHosts: ["api.test.com"],
        headerDst: "X-Custom-Token",
        headerFmt: "token=%s",
      },
      sealKey,
    );

    const sealedBytes = new Uint8Array(
      Buffer.from(result.sealedToken, "base64"),
    );
    const pubKey = new Uint8Array(Buffer.from(sealKey, "hex"));
    const privKey = new Uint8Array(Buffer.from(openKey, "hex"));

    const plaintext = sealedBoxOpen(sealedBytes, pubKey, privKey);
    const secret = JSON.parse(new TextDecoder().decode(plaintext!));
    expect(secret.inject_processor.dst).toBe("X-Custom-Token");
    expect(secret.inject_processor.fmt).toBe("token=%s");
  });

  it("bearer_auth digest is SHA-256 of the bearer password", async () => {
    const { createHash } = await import("node:crypto");
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "test",
        secret: "tok",
        allowedHosts: ["example.com"],
      },
      sealKey,
    );

    const sealedBytes = new Uint8Array(
      Buffer.from(result.sealedToken, "base64"),
    );
    const pubKey = new Uint8Array(Buffer.from(sealKey, "hex"));
    const privKey = new Uint8Array(Buffer.from(openKey, "hex"));
    const plaintext = sealedBoxOpen(sealedBytes, pubKey, privKey);
    const secret = JSON.parse(new TextDecoder().decode(plaintext!));

    const expectedDigest = createHash("sha256")
      .update(result.bearerPassword)
      .digest("base64");
    expect(secret.bearer_auth.digest).toBe(expectedDigest);
  });

  it("produces different sealed tokens for the same input (ephemeral keys)", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);
    const entry = {
      name: "test",
      secret: "tok",
      allowedHosts: ["example.com"],
    };

    const a = sealCredential(entry, sealKey);
    const b = sealCredential(entry, sealKey);
    // Sealed tokens differ (different ephemeral keys)
    expect(a.sealedToken).not.toBe(b.sealedToken);
    // Bearer passwords differ (different random values)
    expect(a.bearerPassword).not.toBe(b.bearerPassword);
  });
});

// ── shouldUseTokenizer ──────────────────────────────────────────────

describe("shouldUseTokenizer", () => {
  it("returns false when not enabled", () => {
    expect(shouldUseTokenizer(minimalConfig())).toBe(false);
  });

  it("returns false when enabled but no credentials", () => {
    expect(
      shouldUseTokenizer(
        minimalConfig({ tokenizerEnabled: true, tokenizerCredentials: [] }),
      ),
    ).toBe(false);
  });

  it("returns true when enabled with credentials", () => {
    expect(
      shouldUseTokenizer(
        minimalConfig({
          tokenizerEnabled: true,
          tokenizerCredentials: [
            { name: "test", secret: "tok", allowedHosts: ["example.com"] },
          ],
        }),
      ),
    ).toBe(true);
  });
});

// ── tokenizerAgentEnv ───────────────────────────────────────────────

describe("tokenizerAgentEnv", () => {
  it("includes proxy URL and seal key", () => {
    const sealed: SealedCredential[] = [];
    const env = tokenizerAgentEnv(sealed, "aabbccdd");
    expect(env.TOKENIZER_PROXY_URL).toBe(`http://localhost:${TOKENIZER_PORT}`);
    expect(env.TOKENIZER_SEAL_KEY).toBe("aabbccdd");
  });

  it("generates correctly named env vars for each credential", () => {
    const sealed: SealedCredential[] = [
      {
        name: "github",
        allowedHosts: ["api.github.com"],
        sealedToken: "sealed-1",
        bearerPassword: "pass-1",
      },
      {
        name: "slack-api",
        allowedHosts: ["slack.com"],
        sealedToken: "sealed-2",
        bearerPassword: "pass-2",
      },
    ];
    const env = tokenizerAgentEnv(sealed, "key");

    expect(env.TOKENIZER_CRED_GITHUB).toBe("sealed-1");
    expect(env.TOKENIZER_AUTH_GITHUB).toBe("pass-1");
    expect(env).toHaveProperty("TOKENIZER_HOSTS_GITHUB");
    expect(env.TOKENIZER_HOSTS_GITHUB).toBe("api.github.com");
    expect(env.TOKENIZER_CRED_SLACK_API).toBe("sealed-2");
    expect(env.TOKENIZER_AUTH_SLACK_API).toBe("pass-2");
    expect(env).toHaveProperty("TOKENIZER_HOSTS_SLACK_API");
    expect(env.TOKENIZER_HOSTS_SLACK_API).toBe("slack.com");
  });

  it("sanitizes non-alphanumeric chars in names to underscores", () => {
    const sealed: SealedCredential[] = [
      {
        name: "my.api-key",
        allowedHosts: ["x.com"],
        sealedToken: "s",
        bearerPassword: "p",
      },
    ];
    const env = tokenizerAgentEnv(sealed, "key");
    expect(env.TOKENIZER_CRED_MY_API_KEY).toBe("s");
    expect(env.TOKENIZER_AUTH_MY_API_KEY).toBe("p");
    expect(env).toHaveProperty("TOKENIZER_HOSTS_MY_API_KEY");
    expect(env.TOKENIZER_HOSTS_MY_API_KEY).toBe("x.com");
  });
});

// ── generateTokenizerSkill ──────────────────────────────────────────

describe("generateTokenizerSkill", () => {
  it("contains proxy URL", () => {
    const skill = generateTokenizerSkill([]);
    expect(skill).toContain(`http://localhost:${TOKENIZER_PORT}`);
  });

  it("lists each credential with env var names", () => {
    const sealed: SealedCredential[] = [
      {
        name: "github",
        allowedHosts: ["api.github.com"],
        sealedToken: "s",
        bearerPassword: "p",
      },
    ];
    const skill = generateTokenizerSkill(sealed);
    expect(skill).toContain("### github");
    expect(skill).toContain("TOKENIZER_CRED_GITHUB");
    expect(skill).toContain("TOKENIZER_AUTH_GITHUB");
    expect(skill).toContain("api.github.com");
  });

  it("includes curl example with the first credential", () => {
    const sealed: SealedCredential[] = [
      {
        name: "stripe",
        allowedHosts: ["api.stripe.com"],
        sealedToken: "s",
        bearerPassword: "p",
      },
    ];
    const skill = generateTokenizerSkill(sealed);
    expect(skill).toContain("curl -x");
    expect(skill).toContain("TOKENIZER_CRED_STRIPE");
    expect(skill).toContain("api.stripe.com");
  });

  it("explains http:// requirement and TLS upgrade", () => {
    const skill = generateTokenizerSkill([]);
    expect(skill).toContain("http://");
    expect(skill).toContain("HTTPS");
  });
});

// ── sanitizeCredName ────────────────────────────────────────────────

describe("sanitizeCredName", () => {
  it("uppercases and replaces non-alphanumeric with underscores", () => {
    expect(sanitizeCredName("my.api-key")).toBe("MY_API_KEY");
  });

  it("leaves uppercase alphanumeric unchanged", () => {
    expect(sanitizeCredName("GITHUB")).toBe("GITHUB");
  });

  it("handles special characters", () => {
    expect(sanitizeCredName("a@b#c$d")).toBe("A_B_C_D");
  });
});

// ── tokenizerSecretKeys ─────────────────────────────────────────────

describe("tokenizerSecretKeys", () => {
  it("returns base keys with no credentials", () => {
    const keys = tokenizerSecretKeys(minimalConfig({ tokenizerEnabled: true }));
    expect(keys).toEqual(["TOKENIZER_PROXY_URL", "TOKENIZER_SEAL_KEY"]);
  });

  it("includes per-credential keys", () => {
    const keys = tokenizerSecretKeys(minimalConfig({
      tokenizerEnabled: true,
      tokenizerCredentials: [
        { name: "github", secret: "s", allowedHosts: ["api.github.com"] },
        { name: "slack", secret: "s", allowedHosts: ["slack.com"] },
      ],
    }));
    expect(keys).toContain("TOKENIZER_CRED_GITHUB");
    expect(keys).toContain("TOKENIZER_AUTH_GITHUB");
    expect(keys).toContain("TOKENIZER_HOSTS_GITHUB");
    expect(keys).toContain("TOKENIZER_CRED_SLACK");
    expect(keys).toContain("TOKENIZER_AUTH_SLACK");
    expect(keys).toContain("TOKENIZER_HOSTS_SLACK");
  });

  it("sanitizes credential names", () => {
    const keys = tokenizerSecretKeys(minimalConfig({
      tokenizerEnabled: true,
      tokenizerCredentials: [{ name: "my-api", secret: "s", allowedHosts: ["x.com"] }],
    }));
    expect(keys).toContain("TOKENIZER_CRED_MY_API");
    expect(keys).toContain("TOKENIZER_AUTH_MY_API");
    expect(keys).toContain("TOKENIZER_HOSTS_MY_API");
  });
});

// ── validateTokenizerCredentials ────────────────────────────────────

describe("validateTokenizerCredentials", () => {
  it("returns null for valid credentials", () => {
    expect(validateTokenizerCredentials([
      { name: "github", secret: "tok", allowedHosts: ["api.github.com"] },
    ])).toBeNull();
  });

  it("returns error for missing name", () => {
    expect(validateTokenizerCredentials([
      { name: "", secret: "tok", allowedHosts: ["x.com"] },
    ])).toBeTruthy();
  });

  it("returns error for missing secret", () => {
    expect(validateTokenizerCredentials([
      { name: "test", secret: "", allowedHosts: ["x.com"] },
    ])).toBeTruthy();
  });

  it("returns error for empty allowedHosts", () => {
    expect(validateTokenizerCredentials([
      { name: "test", secret: "tok", allowedHosts: [] },
    ])).toBeTruthy();
  });

  it("returns error for duplicate names after sanitization", () => {
    const err = validateTokenizerCredentials([
      { name: "my-api", secret: "a", allowedHosts: ["x.com"] },
      { name: "my.api", secret: "b", allowedHosts: ["y.com"] },
    ]);
    expect(err).toContain("unique");
  });

  it("allows string allowedHosts (for form compatibility)", () => {
    expect(validateTokenizerCredentials([
      { name: "test", secret: "tok", allowedHosts: "api.example.com" },
    ])).toBeNull();
  });

  it("does not mutate the input objects", () => {
    const creds = [
      { name: "test", secret: "tok", allowedHosts: "api.example.com" as string | string[] },
    ];
    validateTokenizerCredentials(creds);
    // allowedHosts should still be the original string, not mutated to an array
    expect(typeof creds[0].allowedHosts).toBe("string");
  });
});

// ── normalizeTokenizerCredentials ───────────────────────────────────

describe("normalizeTokenizerCredentials", () => {
  it("converts string allowedHosts to array", () => {
    const result = normalizeTokenizerCredentials([
      { name: "test", secret: "tok", allowedHosts: "api.example.com" as string | string[] },
    ]);
    expect(result[0].allowedHosts).toEqual(["api.example.com"]);
  });

  it("filters empty entries from allowedHosts", () => {
    const result = normalizeTokenizerCredentials([
      { name: "test", secret: "tok", allowedHosts: ["api.example.com", "", "other.com"] },
    ]);
    expect(result[0].allowedHosts).toEqual(["api.example.com", "other.com"]);
  });

  it("does not mutate the original objects", () => {
    const original = [
      { name: "test", secret: "tok", allowedHosts: ["a.com", ""] },
    ];
    const result = normalizeTokenizerCredentials(original);
    // Original should be unchanged
    expect(original[0].allowedHosts).toEqual(["a.com", ""]);
    // Result should be normalized
    expect(result[0].allowedHosts).toEqual(["a.com"]);
  });

  it("preserves extra fields", () => {
    const result = normalizeTokenizerCredentials([
      { name: "test", secret: "tok", allowedHosts: ["a.com"], headerDst: "X-Token", headerFmt: "%s" },
    ]);
    expect(result[0].headerDst).toBe("X-Token");
    expect(result[0].headerFmt).toBe("%s");
  });

  it("treats empty secret as 'preserve existing' (filter contract)", () => {
    const creds = [
      { name: "kept", secret: "", allowedHosts: ["api.example.com"] },
      { name: "new", secret: "sk_new_123", allowedHosts: ["api.new.com"] },
    ];
    const kept = creds.filter(c => !c.secret);
    const newOnes = creds.filter(c => c.secret);
    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe("kept");
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].name).toBe("new");
  });
});
