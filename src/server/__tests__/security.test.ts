import { describe, expect, it } from "vitest";
import type { DeployResult } from "../deployers/types.js";
import {
  installerBindHost,
  installerDisplayHost,
  installerPort,
  sanitizeDeployResult,
  sanitizeSavedConfigVars,
  validateUserSuppliedPath,
} from "../security.js";

describe("security helpers", () => {
  it("redacts sensitive values from saved config payloads", () => {
    const sanitized = sanitizeSavedConfigVars({
      OPENCLAW_AGENT_NAME: "lynx",
      OPENAI_API_KEY: "sk-openai-secret",
      TELEGRAM_BOT_TOKEN: "tg-secret",
      googleApiKey: "gemini-secret",
      gcpServiceAccountJson: "{\"private_key\":\"secret\"}",
    });

    expect(sanitized).toEqual({
      OPENCLAW_AGENT_NAME: "lynx",
    });
  });

  it("redacts sensitive values from public instance payloads", () => {
    const result: DeployResult = {
      id: "openclaw-lynx",
      mode: "local",
      status: "running",
      startedAt: "",
      config: {
        mode: "local",
        agentName: "lynx",
        agentDisplayName: "Lynx",
        openaiApiKey: "sk-openai-secret",
        modelEndpointApiKey: "endpoint-secret",
        openaiApiKeyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
      },
    };

    expect(sanitizeDeployResult(result).config).toEqual({
      mode: "local",
      agentName: "lynx",
      agentDisplayName: "Lynx",
      openaiApiKeyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    });
  });

  it("allows user-supplied paths inside approved roots and rejects paths outside them", () => {
    expect(validateUserSuppliedPath("README.md", "test path")).toContain("/openclaw-installer/README.md");
    expect(() => validateUserSuppliedPath("/etc/passwd", "test path")).toThrow(
      /must be under your home directory, the current repository, or the system temp directory/,
    );
  });

  it("binds to loopback by default and preserves explicit container binds", () => {
    expect(installerBindHost({})).toBe("127.0.0.1");
    expect(installerBindHost({ OPENCLAW_INSTALLER_BIND_HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(installerDisplayHost("0.0.0.0")).toBe("localhost");
  });

  it("uses the installer-specific port and ignores ambient PORT", () => {
    expect(installerPort({ PORT: "58127" })).toBe(3000);
    expect(installerPort({ OPENCLAW_INSTALLER_PORT: "3100", PORT: "58127" })).toBe(3100);
    expect(installerPort({ OPENCLAW_INSTALLER_PORT: "not-a-port" })).toBe(3000);
  });
});
