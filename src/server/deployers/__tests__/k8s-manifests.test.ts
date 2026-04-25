import { describe, expect, it } from "vitest";
import { deploymentManifest, fileConfigMapManifest, fileTreeConfigMapManifest, secretManifest } from "../k8s-manifests.js";
import type { DeployConfig } from "../types.js";
import type * as k8s from "@kubernetes/client-node";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "kubernetes",
    prefix: "openclaw",
    agentName: "alpha",
    agentDisplayName: "Alpha",
    agentModel: "claude-sonnet-4-6",
    ...overrides,
  };
}

/** Extract env var names from the gateway container in a deployment manifest. */
function gatewayEnvNames(deployment: k8s.V1Deployment): string[] {
  const container = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
  return (container?.env ?? []).map((e) => e.name);
}

describe("k8s state sync manifests", () => {
  const config: DeployConfig = makeConfig();

  it("uses IfNotPresent for the gateway container image pull policy", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const gatewayContainer = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");

    expect(gatewayContainer?.imagePullPolicy).toBe("IfNotPresent");
  });

  it("renders skill and cron ConfigMaps from host state entries", () => {
    const skillsCm = fileTreeConfigMapManifest("openclaw-alpha-openclaw", "openclaw-skills", [
      { key: "f0", path: "briefing-bot/SKILL.md", content: "# Briefing Bot" },
    ]);
    const cronCm = fileConfigMapManifest(
      "openclaw-alpha-openclaw",
      "openclaw-cron",
      "jobs.json",
      "{\"jobs\":[{\"name\":\"daily-brief\"}]}",
    );

    expect(skillsCm.data).toEqual({ f0: "# Briefing Bot" });
    expect(cronCm.data).toEqual({ "jobs.json": "{\"jobs\":[{\"name\":\"daily-brief\"}]}" });
  });

  it("mounts and copies skill and cron state into the PVC", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      config,
      false,
      [{ key: "f0", path: "briefing-bot/SKILL.md", content: "# Briefing Bot" }],
      [{ key: "f1", path: "workspace-main/AGENTS.md", content: "# Alpha" }],
      "{\"jobs\":[{\"name\":\"daily-brief\"}]}",
    );

    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    expect(initContainer?.command?.[2]).toContain("for dir in /agents-tree/workspace-*; do");
    expect(initContainer?.command?.[2]).toContain("cp -r /skills-src/. /home/node/.openclaw/skills/");
    expect(initContainer?.command?.[2]).toContain("cp /cron-src/jobs.json /home/node/.openclaw/cron/jobs.json");

    const volumeMounts = initContainer?.volumeMounts?.map((mount) => mount.mountPath) ?? [];
    expect(volumeMounts).toContain("/agents-tree");
    expect(volumeMounts).toContain("/skills-src");
    expect(volumeMounts).toContain("/cron-src");

    const volumes = deployment.spec?.template.spec?.volumes ?? [];
    const agentTreeVolume = volumes.find((volume) => volume.name === "agent-tree-config");
    const skillsVolume = volumes.find((volume) => volume.name === "skills-config");
    const cronVolume = volumes.find((volume) => volume.name === "cron-config");

    expect(agentTreeVolume?.configMap?.name).toBe("openclaw-agent-tree");
    expect(agentTreeVolume?.configMap?.items).toEqual([{ key: "f1", path: "workspace-main/AGENTS.md" }]);
    expect(skillsVolume?.configMap?.name).toBe("openclaw-skills");
    expect(skillsVolume?.configMap?.items).toEqual([{ key: "f0", path: "briefing-bot/SKILL.md" }]);
    expect(cronVolume?.configMap?.name).toBe("openclaw-cron");
    expect(cronVolume?.configMap?.items).toEqual([{ key: "jobs.json", path: "jobs.json" }]);
  });

  it("provisions the managed Vault helper in the writable home volume", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("cat > /home/node/.openclaw/bin/openclaw-vault <<'EOF_VAULT_HELPER'");
    expect(initScript).toContain("#!/usr/local/bin/node");
    expect(initScript).not.toContain("EOF_NODE");
    expect(initScript).toContain("env.HOME = env.HOME || '/home/node';");
    expect(initScript).toContain("vault kubernetes auth");
    expect(initScript).toContain("chmod 0755 /home/node/.openclaw/bin/openclaw-vault");
  });

  it("writes SecretRef-backed auth profiles into each managed agent directory", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        anthropicApiKeyRef: {
          source: "exec",
          provider: "vault",
          id: "providers/anthropic/apiKey",
        },
        openaiApiKeyRef: {
          source: "exec",
          provider: "vault",
          id: "providers/openai/apiKey",
        },
      }),
    );
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("mkdir -p /home/node/.openclaw/agents/openclaw_alpha/agent");
    expect(initScript).toContain("/home/node/.openclaw/agents/openclaw_alpha/agent/auth-profiles.json");
    expect(initScript).toContain('"anthropic:default"');
    expect(initScript).toContain('"openai:default"');
    expect(initScript).toContain('"provider": "vault"');
    expect(initScript).toContain('"id": "providers/anthropic/apiKey"');
    expect(initScript).toContain('"id": "providers/openai/apiKey"');
  });

  it("stores imported Codex OAuth profiles in the Secret instead of the init command", () => {
    const codexAuthJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "codex-access-token",
        refresh_token: "codex-refresh-token",
        account_id: "acct_123",
      },
    });
    const codexConfig = makeConfig({
      inferenceProvider: "openai-codex",
      codexOauthAuthJson: codexAuthJson,
      codexOauthProfileId: "openai-codex:default",
      codexModel: "gpt-5.4",
    });

    const secret = secretManifest("openclaw-alpha-openclaw", codexConfig, "gateway-token");
    const deployment = deploymentManifest("openclaw-alpha-openclaw", codexConfig);
    const initScript = deployment.spec?.template.spec?.initContainers?.[0]?.command?.[2] ?? "";

    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"openai-codex:default"');
    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain("codex-refresh-token");
    expect(initScript).toContain("/openclaw-secrets/OPENAI_CODEX_AUTH_PROFILES_JSON");
    expect(initScript).not.toContain("codex-refresh-token");
  });

  it("uses the dedicated openclaw service account for non-A2A deployments", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    expect(deployment.spec?.template?.spec?.serviceAccountName).toBe("openclaw");
  });

  it("volume indices used by redeploy match the deployment manifest order", () => {
    // Regression test for #131: redeploy() uses hardcoded JSON Patch indices
    // to update specific volume ConfigMaps. If volumes are reordered or new
    // volumes are inserted, these indices must be updated to match.
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const volumes = deployment.spec?.template.spec?.volumes ?? [];

    // These are the indices redeploy() patches — keep in sync with kubernetes.ts
    expect(volumes[4]?.name).toBe("skills-config");
    expect(volumes[4]?.configMap?.name).toBe("openclaw-skills");

    expect(volumes[5]?.name).toBe("cron-config");
    expect(volumes[5]?.configMap?.name).toBe("openclaw-cron");

    expect(volumes[7]?.name).toBe("agent-tree-config");
    expect(volumes[7]?.configMap?.name).toBe("openclaw-agent-tree");
  });
});

// Regression test for #62: workspace-shadowman not recognized as main agent workspace
describe("workspace routing in init script", () => {
  it("does not hard-code workspace-main in the init script", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    // The old bug: init script contained a hard-coded check for "workspace-main"
    // which caused persona-named workspaces (e.g. workspace-shadowman) to be
    // copied to dead paths. The fix uses bundle-aware routing instead.
    expect(initScript).not.toContain('"workspace-main"');
    expect(initScript).not.toContain("= \"workspace-main\"");
  });

  it("still copies workspace-* directories via a shell loop", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("for dir in /agents-tree/workspace-*; do");
    expect(initScript).toContain("[ -d \"$dir\" ] || continue");
  });
});

// Regression test for #63: workspace copy must not depend on findutils in minimal init images
describe("workspace copy in init script", () => {
  it("copies workspace projections without find", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("for dir in /agents-tree/workspace-*; do");
    expect(initScript).toContain("cp -r \"$dir\"/. \"$dest\"/");
    expect(initScript).not.toContain("find -L /agents-tree");
  });

  it("uses ownership and group permissions that work on Kind and OpenShift", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("chown -R 1000:0 /home/node/.openclaw");
    expect(initScript).toContain("chmod -R g=u /home/node/.openclaw");
    expect(initScript).toContain("chmod 0755 /home/node/.openclaw/bin/openclaw-vault");
    expect(initScript).not.toContain("chown -R 1000:1000 /home/node/.openclaw");
  });

  // Regression test for https://github.com/sallyom/openclaw-installer/issues/71:
  // openclaw.json contains gateway tokens and API key refs — it must not be
  // world-readable, and the state directory must not be world-writable.
  it("strips world bits from the state directory and config file (issue #71)", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    // openclaw.json must start at 600, not 644, so even before the g=u pass
    // the file is not world-readable.
    expect(initScript).toContain("chmod 600 /home/node/.openclaw/openclaw.json");
    expect(initScript).not.toContain("chmod 644 /home/node/.openclaw/openclaw.json");

    // World bits must be stripped after the g=u pass.
    expect(initScript).toContain("chmod -R o-rwx /home/node/.openclaw");

    // Stripping world bits must happen BEFORE the vault binary re-open so the
    // binary's world-execute bit is intentionally restored.
    const oRwxIdx = initScript.indexOf("chmod -R o-rwx /home/node/.openclaw");
    const vaultChmodIdx = initScript.indexOf("chmod 0755 /home/node/.openclaw/bin/openclaw-vault", oRwxIdx);
    expect(oRwxIdx).toBeGreaterThan(-1);
    expect(vaultChmodIdx).toBeGreaterThan(oRwxIdx);
  });
});

// Gateway always gets provider API keys — LiteLLM only handles Vertex,
// secondary providers (OpenAI, Anthropic) are routed directly by the gateway.
describe("gateway env vars in proxy mode", () => {
  it("includes ANTHROPIC_API_KEY and OPENAI_API_KEY even when litellm proxy is active", () => {
    const proxyConfig = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      anthropicApiKey: "sk-ant-test",
      openaiApiKey: "sk-oai-test",
      gcpServiceAccountJson: '{"project_id":"test"}',
    });

    const deployment = deploymentManifest("ns", proxyConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).toContain("ANTHROPIC_API_KEY");
    expect(envNames).toContain("OPENAI_API_KEY");
  });

  it("includes ANTHROPIC_API_KEY and OPENAI_API_KEY when proxy is not active", () => {
    const directConfig = makeConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-ant-test",
      openaiApiKey: "sk-oai-test",
    });

    const deployment = deploymentManifest("ns", directConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).toContain("ANTHROPIC_API_KEY");
    expect(envNames).toContain("OPENAI_API_KEY");
  });

  it("materializes default env SecretRefs into the backing Secret data", () => {
    const config = makeConfig({
      inferenceProvider: "openai",
      openaiApiKey: "sk-oai-test",
      openaiApiKeyRef: {
        source: "env",
        provider: "default",
        id: "OPENAI_API_KEY",
      },
      telegramBotToken: "123:abc",
      telegramBotTokenRef: {
        source: "env",
        provider: "default",
        id: "TELEGRAM_BOT_TOKEN",
      },
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.OPENAI_API_KEY).toBe("sk-oai-test");
    expect(secret.stringData?.TELEGRAM_BOT_TOKEN).toBe("123:abc");
  });

  it("materializes Google credentials into the backing Secret data", () => {
    const config = makeConfig({
      inferenceProvider: "google",
      googleApiKey: "google-key",
      googleApiKeyRef: {
        source: "env",
        provider: "default",
        id: "GOOGLE_API_KEY",
      },
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.GOOGLE_API_KEY).toBe("google-key");
    expect(secret.stringData?.GEMINI_API_KEY).toBeUndefined();
  });

  it("materializes custom env/default SecretRef ids into the backing Secret data", () => {
    const config = makeConfig({
      inferenceProvider: "openai",
      openaiApiKey: "sk-oai-test",
      openaiApiKeyRef: {
        source: "env",
        provider: "default",
        id: "JOY_OPENAI_API_KEY",
      },
      telegramBotToken: "123:abc",
      telegramBotTokenRef: {
        source: "env",
        provider: "default",
        id: "JOY_TELEGRAM_BOT_TOKEN",
      },
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.JOY_OPENAI_API_KEY).toBe("sk-oai-test");
    expect(secret.stringData?.JOY_TELEGRAM_BOT_TOKEN).toBe("123:abc");
    expect(secret.stringData?.OPENAI_API_KEY).toBeUndefined();
    expect(secret.stringData?.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("excludes GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION when proxy is active", () => {
    const proxyConfig = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
    });

    const deployment = deploymentManifest("ns", proxyConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).not.toContain("GOOGLE_CLOUD_PROJECT");
    expect(envNames).not.toContain("GOOGLE_CLOUD_LOCATION");
  });
});

// Regression test for #140: switching providers should not inject stale env var refs
describe("gateway env vars with custom endpoint only", () => {
  it("excludes provider env vars when those providers are not configured", () => {
    const endpointConfig = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "http://vllm:8000/v1",
      modelEndpointApiKey: "fake",
    });

    const deployment = deploymentManifest("ns", endpointConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).not.toContain("ANTHROPIC_API_KEY");
    expect(envNames).not.toContain("OPENAI_API_KEY");
    expect(envNames).not.toContain("GEMINI_API_KEY");
    expect(envNames).not.toContain("OPENROUTER_API_KEY");
    expect(envNames).toContain("MODEL_ENDPOINT");
    expect(envNames).toContain("MODEL_ENDPOINT_API_KEY");
  });
});

/** Extract env var names from the LiteLLM sidecar container in a deployment manifest. */
function litellmEnvNames(deployment: k8s.V1Deployment): string[] {
  const container = deployment.spec?.template.spec?.containers?.find((c) => c.name === "litellm");
  return (container?.env ?? []).map((e) => e.name);
}

// LiteLLM sidecar only handles Vertex — no secondary provider keys needed
describe("litellm sidecar env vars in proxy mode", () => {
  it("does not inject secondary provider keys into litellm sidecar", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
      openaiApiKey: "sk-oai-test",
      anthropicApiKey: "sk-ant-test",
    });

    const deployment = deploymentManifest("ns", config);
    const envNames = litellmEnvNames(deployment);

    // LiteLLM only needs GCP creds for Vertex
    expect(envNames).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    expect(envNames).not.toContain("OPENAI_API_KEY");
    expect(envNames).not.toContain("ANTHROPIC_API_KEY");
  });

  it("gateway gets secondary keys even in proxy mode", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
      openaiApiKey: "sk-oai-test",
      anthropicApiKey: "sk-ant-test",
    });

    const deployment = deploymentManifest("ns", config);
    const gwEnvNames = gatewayEnvNames(deployment);

    // Gateway routes to OpenAI/Anthropic directly
    expect(gwEnvNames).toContain("OPENAI_API_KEY");
    expect(gwEnvNames).toContain("ANTHROPIC_API_KEY");
  });
});
