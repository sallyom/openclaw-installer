import { describe, expect, it } from "vitest";
import { deploymentManifest, secretManifest, fileConfigMapManifest, fileTreeConfigMapManifest } from "../k8s-manifests.js";
import { TOKENIZER_PORT } from "../tokenizer.js";
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
    expect(initContainer?.command?.[2]).toContain("find /agents-tree -mindepth 1 -type d -name 'workspace-*'");
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
});


// Regression tests for #6: API keys must not leak to the gateway in proxy mode
describe("gateway env vars in proxy mode", () => {
  it("excludes ANTHROPIC_API_KEY and OPENAI_API_KEY when litellm proxy is active", () => {
    const proxyConfig = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      anthropicApiKey: "sk-ant-test",
      openaiApiKey: "sk-oai-test",
      gcpServiceAccountJson: '{"project_id":"test"}',
    });

    const deployment = deploymentManifest("ns", proxyConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).not.toContain("ANTHROPIC_API_KEY");
    expect(envNames).not.toContain("OPENAI_API_KEY");
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

// ── secretManifest: tokenizer data ──────────────────────────────────

describe("secretManifest with tokenizer", () => {
  const baseConfig: DeployConfig = {
    mode: "kubernetes",
    agentName: "test",
    agentDisplayName: "Test",
  };

  it("includes tokenizer data when provided", () => {
    const tokenizerData = {
      openKey: "deadbeef".repeat(8),
      agentEnv: {
        TOKENIZER_PROXY_URL: "http://localhost:4001",
        TOKENIZER_SEAL_KEY: "aabbccdd".repeat(8),
        TOKENIZER_CRED_GITHUB: "sealed-token-1",
        TOKENIZER_AUTH_GITHUB: "bearer-pass-1",
        TOKENIZER_HOSTS_GITHUB: "api.github.com",
      },
    };

    const secret = secretManifest("ns", baseConfig, "gw-token", undefined, tokenizerData);
    const data = secret.stringData!;

    expect(data.TOKENIZER_OPEN_KEY).toBe(tokenizerData.openKey);
    expect(data.TOKENIZER_PROXY_URL).toBe("http://localhost:4001");
    expect(data.TOKENIZER_SEAL_KEY).toBe(tokenizerData.agentEnv.TOKENIZER_SEAL_KEY);
    expect(data.TOKENIZER_CRED_GITHUB).toBe("sealed-token-1");
    expect(data.TOKENIZER_AUTH_GITHUB).toBe("bearer-pass-1");
    expect(data.TOKENIZER_HOSTS_GITHUB).toBe("api.github.com");
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBe("gw-token");
  });

  it("omits tokenizer data when not provided", () => {
    const secret = secretManifest("ns", baseConfig, "gw-token");
    const data = secret.stringData!;

    expect(data.TOKENIZER_OPEN_KEY).toBeUndefined();
    expect(data.TOKENIZER_PROXY_URL).toBeUndefined();
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBe("gw-token");
  });
});

// ── deploymentManifest: tokenizer sidecar ───────────────────────────

describe("deploymentManifest with tokenizer", () => {
  const tkzConfig: DeployConfig = {
    mode: "kubernetes",
    prefix: "openclaw",
    agentName: "alpha",
    agentDisplayName: "Alpha",
    tokenizerEnabled: true,
    tokenizerCredentials: [
      { name: "github", secret: "ghp_test", allowedHosts: ["api.github.com"] },
      { name: "stripe", secret: "sk_test", allowedHosts: ["api.stripe.com"] },
    ],
  };

  const noTkzConfig: DeployConfig = {
    mode: "kubernetes",
    prefix: "openclaw",
    agentName: "alpha",
    agentDisplayName: "Alpha",
  };

  it("includes tokenizer sidecar container when enabled", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const tkz = containers.find((c) => c.name === "tokenizer");

    expect(tkz).toBeDefined();
    expect(tkz!.ports?.[0].containerPort).toBe(TOKENIZER_PORT);
    expect(tkz!.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "LISTEN_ADDRESS", value: `0.0.0.0:${TOKENIZER_PORT}` }),
        expect.objectContaining({ name: "OPEN_KEY_FILE", value: "/secrets/open-key" }),
      ]),
    );
  });

  it("reads OPEN_KEY from file via OPEN_KEY_FILE env var", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const tkz = containers.find((c) => c.name === "tokenizer");

    // The fork reads the key via OPEN_KEY_FILE env var pointing to the
    // secret volume mount, so no sh -c entrypoint is needed.
    expect(tkz!.command).toBeUndefined();

    // OPEN_KEY_FILE should be set, OPEN_KEY should NOT
    const envNames = (tkz!.env ?? []).map((e) => e.name);
    expect(envNames).toContain("OPEN_KEY_FILE");
    expect(envNames).not.toContain("OPEN_KEY");

    // Volume mount for the key file
    const mounts = tkz!.volumeMounts ?? [];
    expect(mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tokenizer-open-key", mountPath: "/secrets", readOnly: true }),
      ]),
    );
  });

  it("has security context with dropped capabilities", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const tkz = containers.find((c) => c.name === "tokenizer");

    expect(tkz!.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      runAsUser: 1000,
      capabilities: { drop: ["ALL"] },
    });
  });

  it("has resource limits", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const tkz = containers.find((c) => c.name === "tokenizer");

    expect(tkz!.resources?.requests?.memory).toBe("64Mi");
    expect(tkz!.resources?.limits?.memory).toBe("256Mi");
  });

  it("does not include tokenizer sidecar when not enabled", () => {
    const dep = deploymentManifest("ns", noTkzConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const tkz = containers.find((c) => c.name === "tokenizer");

    expect(tkz).toBeUndefined();
  });

  it("adds only tokenizer-open-key and tokenizer-tmp volumes when enabled", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const volumes = dep.spec?.template.spec?.volumes ?? [];

    // SKILL.md goes through skills-config; env vars go through secretKeyRef
    expect(volumes.find((v) => v.name === "tokenizer-skill")).toBeUndefined();
    expect(volumes.find((v) => v.name === "tokenizer-env")).toBeUndefined();
    expect(volumes.find((v) => v.name === "tokenizer-open-key")).toBeDefined();
    expect(volumes.find((v) => v.name === "tokenizer-tmp")).toBeDefined();
  });

  it("does not add tokenizer volumes when not enabled", () => {
    const dep = deploymentManifest("ns", noTkzConfig);
    const volumes = dep.spec?.template.spec?.volumes ?? [];

    expect(volumes.find((v) => v.name === "tokenizer-open-key")).toBeUndefined();
    expect(volumes.find((v) => v.name === "tokenizer-tmp")).toBeUndefined();
  });

  it("tokenizer-open-key volume projects TOKENIZER_OPEN_KEY from Secret", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const volumes = dep.spec?.template.spec?.volumes ?? [];
    const openKeyVol = volumes.find((v) => v.name === "tokenizer-open-key");

    expect(openKeyVol?.secret?.secretName).toBe("openclaw-secrets");
    expect(openKeyVol?.secret?.items).toEqual([{ key: "TOKENIZER_OPEN_KEY", path: "open-key" }]);
  });



  it("injects tokenizer env vars from Secret into gateway container", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const gateway = containers.find((c) => c.name === "gateway");
    const envVars = gateway?.env ?? [];

    const tkzEnvNames = envVars
      .filter((e) => e.name.startsWith("TOKENIZER_"))
      .map((e) => e.name);

    expect(tkzEnvNames).toContain("TOKENIZER_PROXY_URL");
    expect(tkzEnvNames).toContain("TOKENIZER_SEAL_KEY");
    expect(tkzEnvNames).toContain("TOKENIZER_CRED_GITHUB");
    expect(tkzEnvNames).toContain("TOKENIZER_AUTH_GITHUB");
    expect(tkzEnvNames).toContain("TOKENIZER_CRED_STRIPE");
    expect(tkzEnvNames).toContain("TOKENIZER_AUTH_STRIPE");

    // All should come from secretKeyRef
    const tkzEnvs = envVars.filter((e) => e.name.startsWith("TOKENIZER_"));
    for (const env of tkzEnvs) {
      expect(env.valueFrom?.secretKeyRef?.name).toBe("openclaw-secrets");
      expect(env.valueFrom?.secretKeyRef?.optional).toBe(true);
    }
  });

  it("init container gets tokenizer env vars via secretKeyRef (no tokenizer-env volume)", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const initContainer = dep.spec?.template.spec?.initContainers?.[0];

    // No tokenizer-env volume mount — env vars are injected directly
    const mounts = initContainer?.volumeMounts ?? [];
    const mountNames = mounts.map((m) => m.name);
    expect(mountNames).not.toContain("tokenizer-env");

    // Init container should have tokenizer env vars from Secret
    const envNames = (initContainer?.env ?? []).map((e: { name: string }) => e.name);
    expect(envNames).toContain("TOKENIZER_PROXY_URL");
    expect(envNames).toContain("TOKENIZER_SEAL_KEY");
    expect(envNames).toContain("TOKENIZER_CRED_GITHUB");
    expect(envNames).toContain("TOKENIZER_AUTH_GITHUB");

    // tokenizer skill is delivered via the existing /skills-src mount
    const mountPaths = mounts.map((m) => m.mountPath);
    expect(mountPaths).toContain("/skills-src");
  });

  it("init script writes tokenizer .env vars (skill comes via skills-config)", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const initContainer = dep.spec?.template.spec?.initContainers?.[0];
    const script = initContainer?.command?.[2] ?? "";

    // Tokenizer env vars are written into the workspace .env
    expect(script).toContain("TOKENIZER_PROXY_URL");
    expect(script).toContain("chmod 600");
    // Skills are copied by the existing generic line, not a tokenizer-specific one
    expect(script).toContain("cp -r /skills-src/. /home/node/.openclaw/skills/");
  });

  it("init script strips old TOKENIZER_* lines before appending (no duplicates on restart)", () => {
    const dep = deploymentManifest("ns", tkzConfig);
    const initContainer = dep.spec?.template.spec?.initContainers?.[0];
    const script = initContainer?.command?.[2] ?? "";

    // The sed command should appear before the first printf for TOKENIZER_ vars
    expect(script).toContain("sed -i '/^TOKENIZER_/d'");
    const sedIdx = script.indexOf("sed -i");
    const printfIdx = script.indexOf("printf '%s=%s\\n' 'TOKENIZER_");
    expect(printfIdx).toBeGreaterThan(-1);
    expect(sedIdx).toBeLessThan(printfIdx);
  });

  it("init script does not mention tokenizer when not enabled", () => {
    const dep = deploymentManifest("ns", noTkzConfig);
    const initContainer = dep.spec?.template.spec?.initContainers?.[0];
    const script = initContainer?.command?.[2] ?? "";

    expect(script).not.toContain("tokenizer");
    expect(script).not.toContain("TOKENIZER");
  });

  it("uses custom tokenizerImage when provided", () => {
    const customConfig = { ...tkzConfig, tokenizerImage: "my-reg/tokenizer:v2" };
    const dep = deploymentManifest("ns", customConfig);
    const containers = dep.spec?.template.spec?.containers ?? [];
    const tkz = containers.find((c) => c.name === "tokenizer");

    expect(tkz!.image).toBe("my-reg/tokenizer:v2");
  });
});
